"""Outreach orchestration.

The user is always in control:
* Every email, first or follow-up, is drafted into "Today" and waits for the user's decision.
* Nothing is sent until the user taps Send (immediately) or "Send at their morning" (scheduled).
* Any human reply stops follow-ups automatically. A negative or annoyed reply pauses the campaign
  and asks the user whether to stop for good.
* Each email can only ever be sent once (atomic claim), and a contact is never in two campaigns at once.
"""
import logging
import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import update
from sqlmodel import Session, func, select

from ..config import settings
from ..models import (Campaign, Contact, InboxMessage, Job, OutboxEmail, Profile, Reminder, SentReply,
                      TailoredResume, User, UserJob, utcnow)
from . import classifier, gmail, geo, notify, quality, tailor, writer

log = logging.getLogger(__name__)

SEND_WINDOW = (time(9, 30), time(16, 30))
SENDABLE = ("pending", "scheduled", "failed")
WATCH_DAYS = 90  # keep watching a thread for replies this long after outreach started


class OutreachError(ValueError):
    pass


def user_today(user: User) -> date:
    return datetime.now(_tz(user)).date()


def _tz(user: User) -> ZoneInfo:
    try:
        return ZoneInfo(user.timezone or "Asia/Kolkata")
    except Exception:
        return ZoneInfo("Asia/Kolkata")


def recommended_send_at(job: Job) -> tuple[datetime, str, bool]:
    """(UTC send time, recipient timezone, is_now_good). Weekday mornings in the recipient's timezone."""
    tz = ZoneInfo(geo.timezone_for(job.location_raw, job.region))
    now_local = datetime.now(tz)
    if now_local.weekday() < 5 and SEND_WINDOW[0] <= now_local.time() <= SEND_WINDOW[1]:
        return utcnow(), tz.key, True
    d = now_local.date() if now_local.time() < SEND_WINDOW[0] else now_local.date() + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    target = datetime.combine(d, SEND_WINDOW[0], tz)
    return target.astimezone(timezone.utc).replace(tzinfo=None), tz.key, False


def sent_today(session: Session, user: User) -> int:
    start = datetime.combine(user_today(user), time.min, _tz(user)).astimezone(timezone.utc).replace(tzinfo=None)
    return session.exec(select(func.count()).select_from(OutboxEmail).where(
        OutboxEmail.user_id == user.id, OutboxEmail.status == "sent", OutboxEmail.sent_at >= start)).one()


def ensure_tailored(session: Session, user: User, job: Job) -> TailoredResume:
    tr = session.exec(select(TailoredResume).where(TailoredResume.user_id == user.id, TailoredResume.job_id == job.id)).first()
    if tr and tr.pdf_path:
        return tr
    profile = session.get(Profile, user.id)
    data, changes = tailor.tailor(profile.data, job)
    path = tailor.render_pdf(data, tailor.pdf_path(user.id, job.id, data.get("name", "")))
    tr = tr or TailoredResume(user_id=user.id, job_id=job.id)
    tr.data, tr.changes, tr.pdf_path = data, changes, str(path)
    session.add(tr)
    session.commit()
    session.refresh(tr)
    uj = session.exec(select(UserJob).where(UserJob.user_id == user.id, UserJob.job_id == job.id)).first()
    notify.record(session, user.id, "resume", f"Tailored your resume for {job.title} at {job.company}",
                  url=f"/tracker?job={uj.id}" if uj else "/tracker")
    return tr


def start(session: Session, user: User, uj: UserJob, to_email: str, gaps: list[int], max_followups: int) -> Campaign:
    job = session.get(Job, uj.job_id)
    to_email = to_email.lower()
    existing = session.exec(select(Campaign).where(Campaign.user_job_id == uj.id, Campaign.status.in_(["active", "paused"]))).first()
    if existing:
        return existing
    # Never email the same person twice about the same role, and never run two sequences to one inbox at once.
    if session.exec(select(Campaign).where(Campaign.user_job_id == uj.id, Campaign.to_email == to_email,
                                           Campaign.stop_reason != "First email skipped")).first():
        raise OutreachError(f"You've already emailed {to_email} about this role.")
    busy = session.exec(select(Campaign).where(Campaign.user_id == user.id, Campaign.to_email == to_email,
                                               Campaign.status.in_(["active", "paused"]))).first()
    if busy:
        other = session.get(Job, session.get(UserJob, busy.user_job_id).job_id)
        raise OutreachError(f"You're already emailing {to_email} about {other.title}. Wait for that to finish, "
                            f"or mention both roles in one email, so you don't flood their inbox.")
    contact = session.exec(select(Contact).where(Contact.email == to_email, (Contact.user_id == None) | (Contact.user_id == user.id))).first()  # noqa: E711
    tr = ensure_tailored(session, user, job)
    camp = Campaign(user_id=user.id, user_job_id=uj.id, contact_id=contact.id if contact else None, to_email=to_email,
                    gaps=gaps[:max_followups], max_followups=max_followups, next_due=user_today(user), tailored_resume_id=tr.id)
    session.add(camp)
    uj.status, uj.updated_at = "reaching_out", utcnow()
    session.add(uj)
    session.commit()
    session.refresh(camp)
    notify.record(session, user.id, "campaign", f"Started outreach to {to_email} for {job.title} at {job.company}",
                  url="/today", campaign_id=camp.id)
    draft_step(session, user, camp)
    return camp


def draft_step(session: Session, user: User, camp: Campaign) -> OutboxEmail | None:
    """Create the draft for the campaign's next step and put it in Today's queue for the user to review."""
    if camp.status != "active" or camp.steps_sent > camp.max_followups:
        return None
    if session.exec(select(OutboxEmail).where(OutboxEmail.campaign_id == camp.id, OutboxEmail.status.in_(SENDABLE + ("sending",)))).first():
        return None
    uj = session.get(UserJob, camp.user_job_id)
    job = session.get(Job, uj.job_id)
    profile = session.get(Profile, user.id).data
    step = camp.steps_sent
    tr = session.get(TailoredResume, camp.tailored_resume_id) if camp.tailored_resume_id else None
    facts = tr.data if tr else profile
    if step == 0:
        contact = session.get(Contact, camp.contact_id) if camp.contact_id else None
        subject, body, by = writer.first_email(facts, job, contact.role_hint if contact else "general")
        attachment = tr.pdf_path if tr else ""
    else:
        previous = [o.body for o in session.exec(select(OutboxEmail).where(OutboxEmail.campaign_id == camp.id, OutboxEmail.status == "sent").order_by(OutboxEmail.step))]
        body, by = writer.follow_up(facts, job, step, camp.max_followups, previous)
        subject = camp.first_subject if camp.first_subject.lower().startswith("re:") else f"Re: {camp.first_subject}"
        attachment = ""
    rec, tz, _ = recommended_send_at(job)
    ob = OutboxEmail(user_id=user.id, campaign_id=camp.id, step=step, to_email=camp.to_email, subject=subject, body=body,
                     attachment_path=attachment, queue_date=user_today(user), recommended_send_at=rec, generated_by=by,
                     quality=quality.check(subject, body, job.company, step, bool(attachment), writer.support_text(facts, job)))
    session.add(ob)
    session.commit()
    session.refresh(ob)
    label = "first email" if step == 0 else f"follow-up {step}"
    notify.record(session, user.id, "draft", f"Drafted {label} to {camp.to_email} ({job.company}). Waiting for your review.",
                  url="/today", outbox_id=ob.id)
    return ob


def build_daily_queue(session: Session, user: User) -> int:
    """Draft every follow-up that is due today. Drafts only; nothing is sent."""
    today = user_today(user)
    made = 0
    for camp in session.exec(select(Campaign).where(Campaign.user_id == user.id, Campaign.status == "active")).all():
        if camp.paused_until and camp.paused_until > today:
            continue
        if camp.next_due and camp.next_due <= today and camp.steps_sent <= camp.max_followups:
            if draft_step(session, user, camp):
                made += 1
    if made:
        notify.record(session, user.id, "queue", f"{made} email{'s' if made > 1 else ''} ready for your review today", push=True, url="/today")
    return made


def _claim(session: Session, ob: OutboxEmail) -> bool:
    """Atomically move an email to 'sending'. Only one caller can win, so it can never go out twice."""
    res = session.exec(update(OutboxEmail).where(OutboxEmail.id == ob.id, OutboxEmail.status.in_(SENDABLE)).values(status="sending"))
    session.commit()
    session.refresh(ob)
    return res.rowcount == 1


def send_now(session: Session, user: User, ob: OutboxEmail) -> OutboxEmail:
    if ob.status == "sent":
        return ob
    if ob.status not in SENDABLE:
        raise OutreachError("This draft is no longer waiting to be sent (it was skipped, replaced, or is already sending).")
    if not (ob.quality or {}).get("ready", True):
        raise OutreachError("Fix the highlighted issues (like placeholders) first")
    camp = session.get(Campaign, ob.campaign_id)
    if camp.status != "active":
        raise OutreachError("This outreach is paused or stopped.")
    if camp.paused_until and camp.paused_until > user_today(user):
        raise OutreachError(f"They're out of office until {camp.paused_until:%d %b}. Sending is paused until then.")
    if sent_today(session, user) >= settings.max_cold_emails_per_day:
        raise OutreachError(f"Daily limit of {settings.max_cold_emails_per_day} emails reached. This protects your Gmail reputation. Try again tomorrow.")
    if not _claim(session, ob):
        raise OutreachError("This email is already being sent.")
    try:
        res = gmail.send(session, user, ob.to_email, ob.subject, ob.body, ob.attachment_path,
                         thread_id=camp.thread_id, in_reply_to=camp.last_message_id_header)
    except gmail.GmailNotConnected:
        ob.status = "pending"
        session.add(ob)
        session.commit()
        raise
    except Exception as e:
        ob.status, ob.error = "failed", str(e)[:500]
        session.add(ob)
        session.commit()
        notify.record(session, user.id, "error", f"Couldn't send to {ob.to_email}: {ob.error[:120]}", url="/today")
        raise OutreachError(f"Gmail refused the send: {ob.error[:200]}") from e
    ob.status, ob.sent_at, ob.gmail_message_id, ob.error = "sent", utcnow(), res["id"], ""
    camp.thread_id = camp.thread_id or res["thread_id"]
    camp.last_message_id_header = res["message_id_header"] or camp.last_message_id_header
    if ob.step == 0:
        camp.first_subject = ob.subject
    camp.steps_sent = ob.step + 1
    if camp.steps_sent <= camp.max_followups and ob.step < len(camp.gaps):
        camp.next_due = user_today(user) + timedelta(days=camp.gaps[ob.step])
    else:
        camp.next_due, camp.status = None, "completed"
    session.add(ob)
    session.add(camp)
    session.commit()
    job = session.get(Job, session.get(UserJob, camp.user_job_id).job_id)
    nxt = (f" Next follow-up will be drafted on {camp.next_due:%d %b} for your review." if camp.next_due
           else " That was the last one. Kold keeps watching for a reply.")
    notify.record(session, user.id, "send", f"Sent {'first email' if ob.step == 0 else f'follow-up {ob.step}'} to {ob.to_email} ({job.company}).{nxt}",
                  url="/tracker", outbox_id=ob.id)
    return ob


def send_due_scheduled(session: Session) -> None:
    for ob in session.exec(select(OutboxEmail).where(OutboxEmail.status == "scheduled", OutboxEmail.scheduled_for <= utcnow())).all():
        user = session.get(User, ob.user_id)
        try:
            send_now(session, user, ob)
        except Exception as e:
            log.info("scheduled send failed %s: %s", ob.id, e)
            session.refresh(ob)
            if ob.status == "scheduled":
                ob.status, ob.error = "pending", f"Scheduled send didn't go out: {str(e)[:250]}"
                session.add(ob)
                session.commit()
                notify.record(session, user.id, "error", f"A scheduled email to {ob.to_email} wasn't sent: {str(e)[:120]}", url="/today")


def _skip_pending(session: Session, camp: Campaign, reason: str) -> None:
    for ob in session.exec(select(OutboxEmail).where(OutboxEmail.campaign_id == camp.id, OutboxEmail.status.in_(SENDABLE))).all():
        ob.status, ob.error = "skipped", reason
        session.add(ob)


LABEL_TEXT = {
    "positive": "replied positively 🎉", "question": "asked a question", "not_now": "said not right now",
    "negative": "declined", "annoyed": "seems unhappy about the emails", "auto_reply": "sent an automatic reply",
    "out_of_office": "is out of office", "bounce": "address bounced", "unclear": "replied (please read it)",
}


def _ts(m: dict) -> datetime:
    return datetime.fromtimestamp(m.get("internal_date", 0) / 1000, timezone.utc).replace(tzinfo=None)


def _is_own(m: dict, user: User) -> bool:
    labels = set(m.get("label_ids") or [])
    return "SENT" in labels or "DRAFT" in labels or m["from_email"] == (user.gmail_email or "").lower()


def check_replies(session: Session, user: User) -> int:
    """Read only the threads Kold started and the new emails companies send, classify replies, act safely."""
    if not user.gmail_email:
        return 0
    found = 0
    cutoff = utcnow() - timedelta(days=WATCH_DAYS)
    camps = session.exec(select(Campaign).where(Campaign.user_id == user.id, Campaign.thread_id != "",
                                                Campaign.created_at >= cutoff)).all()
    for camp in camps:
        found += _process_thread(session, user, camp, camp.thread_id, new_thread=False)
    found += _check_new_threads(session, user, camps)
    # Conversations that moved to a new email thread: keep following those threads too.
    ids = {c.id for c in camps}
    extra = session.exec(select(InboxMessage.campaign_id, InboxMessage.thread_id).where(
        InboxMessage.user_id == user.id, InboxMessage.new_thread == True)).all()  # noqa: E712
    for cid, tid in set(extra):
        if cid in ids:
            found += _process_thread(session, user, session.get(Campaign, cid), tid, new_thread=True)
    return found


def _process_thread(session: Session, user: User, camp: Campaign, thread_id: str, new_thread: bool) -> int:
    try:
        msgs = gmail.thread_messages(session, user, thread_id)
    except Exception as e:
        log.info("thread fetch failed: %s", e)
        return 0
    found = 0
    ours = set(session.exec(select(OutboxEmail.gmail_message_id).where(OutboxEmail.campaign_id == camp.id)).all())
    ours |= set(session.exec(select(SentReply.gmail_message_id).where(SentReply.campaign_id == camp.id)).all())
    for m in sorted(msgs, key=lambda m: m.get("internal_date", 0)):
        if _is_own(m, user):
            if m["id"] not in ours and _ts(m) >= camp.created_at:
                # The user wrote in this conversation from Gmail: show it in Kold's conversation too.
                session.add(SentReply(user_id=user.id, campaign_id=camp.id, gmail_message_id=m["id"], thread_id=m["thread_id"],
                                      to_email=(m.get("to") or (m.get("headers") or {}).get("to", "")), subject=m.get("subject", ""), body=m.get("body", ""),
                                      sent_at=_ts(m), via="gmail"))
                ours.add(m["id"])
            # Anything they sent before the user's message is now handled.
            for earlier in session.exec(select(InboxMessage).where(InboxMessage.campaign_id == camp.id,
                                                                   InboxMessage.handled == False,  # noqa: E712
                                                                   InboxMessage.received_at <= _ts(m))).all():
                earlier.handled, earlier.reply_mode = True, earlier.reply_mode or "self"
                session.add(earlier)
            continue
        if session.exec(select(InboxMessage).where(InboxMessage.user_id == user.id, InboxMessage.gmail_message_id == m["id"])).first():
            continue
        c = classifier.classify(m.get("headers") or {}, m["from_email"], m.get("subject", ""), m.get("body", ""))
        msg = InboxMessage(user_id=user.id, campaign_id=camp.id, gmail_message_id=m["id"], thread_id=m["thread_id"],
                           new_thread=new_thread, from_email=m["from_email"], from_name=m.get("from_name", ""),
                           subject=m.get("subject", ""), snippet=m.get("snippet", ""), body=m.get("body", ""), received_at=_ts(m),
                           message_id_header=m.get("message_id_header", ""),
                           label=c["label"], label_confidence=c["confidence"], label_source=c["source"],
                           label_reason=c["reason"], return_date=c["return_date"],
                           handled=c["label"] in ("auto_reply", "out_of_office"))
        session.add(msg)
        session.flush()
        if not new_thread:
            camp.last_message_id_header = m.get("message_id_header") or camp.last_message_id_header
        apply_label(session, user, camp, msg)
        found += 1
    session.commit()
    return found


FREE_MAIL = {"gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com",
             "rediffmail.com", "protonmail.com", "proton.me", "aol.com", "zoho.com"}
NOT_A_PERSON = re.compile(r"no-?reply|do-?not-?reply|notification|newsletter|marketing|news@|updates?@|billing|receipts?|"
                          r"invoice|alerts?@|digest|promo|offers?@|support@|help@|team@.*(update|news)", re.I)
_rejected: set[str] = set()  # message ids already judged "not about your application" (per process)


def _about_application(m: dict, user: User, camp: Campaign, job: Job) -> bool:
    """For a domain-only match: is this email plausibly a reply about the user's application?"""
    h = m.get("headers") or {}
    if NOT_A_PERSON.search(m.get("from_email", "")) or "list-unsubscribe" in h or h.get("precedence", "").lower() in ("bulk", "list"):
        return False
    text = f"{m.get('subject', '')}\n{m.get('body', '')[:4000]}".lower()
    first_name = (user.name or "").split(" ")[0].lower()
    title_words = [w for w in re.findall(r"[a-z]{4,}", job.title.lower()) if w not in ("senior", "junior", "engineer", "manager")]
    signals = [
        bool(first_name) and len(first_name) > 2 and re.search(rf"\b{re.escape(first_name)}\b", text) is not None,
        bool(camp.first_subject) and camp.first_subject.lower().removeprefix("re: ")[:40] in text,
        job.title.lower() in text,
        sum(1 for w in title_words if w in text) >= 2,
        re.search(r"\b(your (application|resume|cv|profile|email)|you (reached|wrote)|thanks for (reaching|writing|your email)|interview)\b", text) is not None,
    ]
    return any(signals)


def _check_new_threads(session: Session, user: User, camps: list[Campaign]) -> int:
    """Catch replies sent as a brand-new email (new subject, forwarded to a colleague, etc.)."""
    live = [c for c in camps if c.thread_id and c.steps_sent > 0]
    if not live:
        return 0
    by_address: dict[str, Campaign] = {}
    by_domain: dict[str, Campaign] = {}
    for c in sorted(live, key=lambda c: c.created_at):  # latest campaign wins
        by_address[c.to_email] = c
        domain = c.to_email.split("@")[1]
        if domain not in FREE_MAIL:
            by_domain[domain] = c
    known_threads = {c.thread_id for c in live}
    known_ids = set(session.exec(select(InboxMessage.gmail_message_id).where(InboxMessage.user_id == user.id)).all())
    after = int(min(c.created_at for c in live).replace(tzinfo=timezone.utc).timestamp())
    try:
        msgs = gmail.messages_from(session, user, sorted(set(by_address) | set(by_domain)), after, known_ids | _rejected)
    except Exception as e:
        log.info("new-thread search failed: %s", e)
        return 0
    found = 0
    for m in sorted(msgs, key=lambda m: m.get("internal_date", 0)):
        if m["thread_id"] in known_threads or _is_own(m, user) or m["id"] in known_ids:
            continue
        frm = m.get("from_email", "")
        camp = by_address.get(frm)
        if not camp:
            camp = by_domain.get(frm.split("@")[-1])
            job = session.get(Job, session.get(UserJob, camp.user_job_id).job_id) if camp else None
            if not camp or not _about_application(m, user, camp, job):
                _rejected.add(m["id"])
                continue
        c = classifier.classify(m.get("headers") or {}, frm, m.get("subject", ""), m.get("body", ""))
        msg = InboxMessage(user_id=user.id, campaign_id=camp.id, gmail_message_id=m["id"], thread_id=m["thread_id"], new_thread=True,
                           from_email=frm, from_name=m.get("from_name", ""), subject=m.get("subject", ""),
                           snippet=m.get("snippet", ""), body=m.get("body", ""), received_at=_ts(m),
                           message_id_header=m.get("message_id_header", ""), label=c["label"], label_confidence=c["confidence"],
                           label_source=c["source"], label_reason=c["reason"], return_date=c["return_date"],
                           handled=c["label"] in ("auto_reply", "out_of_office"))
        session.add(msg)
        session.flush()
        known_ids.add(m["id"])
        apply_label(session, user, camp, msg)
        found += 1
    session.commit()
    return found


def apply_label(session: Session, user: User, camp: Campaign, msg: InboxMessage) -> None:
    uj = session.get(UserJob, camp.user_job_id)
    job = session.get(Job, uj.job_id)
    who = f"{job.company} ({msg.from_email})"
    label = msg.label
    if camp.status == "stopped" and label not in ("bounce",):
        # Outreach was stopped, but a reply still matters: show it, change nothing else.
        if label not in ("auto_reply", "out_of_office"):
            uj.status, uj.updated_at = "replied", utcnow()
            session.add(uj)
        notify.record(session, user.id, "reply", f"{who} {LABEL_TEXT.get(label, 'replied')} (outreach was already stopped).",
                      push=label in ("positive", "question"), url=f"/inbox?c={camp.id}", message_id=msg.id)
        return
    if label == "auto_reply":
        notify.record(session, user.id, "reply", f"{who} sent an automatic reply. Nothing changes.", url=f"/inbox?c={camp.id}", message_id=msg.id)
        return
    if label == "out_of_office":
        until = (msg.return_date or (user_today(user) + timedelta(days=7))) + timedelta(days=1)
        camp.paused_until = until
        if camp.next_due and camp.next_due < until:
            camp.next_due = until
        _skip_pending(session, camp, "Recipient out of office")
        session.add(camp)
        notify.record(session, user.id, "pause", f"{who} is out of office. Follow-ups paused until {until:%d %b}.", url=f"/inbox?c={camp.id}", message_id=msg.id)
        return
    if label == "bounce":
        camp.status, camp.stop_reason, camp.next_due = "stopped", "Address bounced", None
        _skip_pending(session, camp, "Address bounced")
        if camp.contact_id:
            contact = session.get(Contact, camp.contact_id)
            contact.mx_ok, contact.bounced = False, True
            session.add(contact)
        session.add(camp)
        notify.record(session, user.id, "stop", f"{camp.to_email} bounced. Outreach stopped. Pick another contact for {job.company}.",
                      push=True, url=f"/inbox?c={camp.id}", message_id=msg.id)
        return
    # A human answered: never send another automated follow-up on top of a reply.
    _skip_pending(session, camp, "They replied")
    camp.next_due = None
    if label in ("negative", "annoyed"):
        camp.status, camp.stop_reason = "paused", f"Awaiting your decision ({label})"
        notify.record(session, user.id, "reply", f"{who} {LABEL_TEXT.get(label, 'replied')}. Outreach is paused. Stop for good?",
                      push=True, url=f"/inbox?c={camp.id}", message_id=msg.id)
    else:
        camp.status = "replied"
        notify.record(session, user.id, "reply", f"{who} {LABEL_TEXT.get(label, 'replied')}. Follow-ups stopped; your move.",
                      push=True, url=f"/inbox?c={camp.id}", message_id=msg.id)
    uj.status, uj.updated_at = "replied", utcnow()
    session.add(uj)
    session.add(camp)


def send_reply(session: Session, user: User, msg: InboxMessage, body: str) -> None:
    camp = session.get(Campaign, msg.campaign_id)
    subject = msg.subject if msg.subject.lower().startswith("re:") else f"Re: {msg.subject}"
    res = gmail.send(session, user, msg.from_email, subject, body, thread_id=msg.thread_id,
                     in_reply_to=msg.message_id_header or camp.last_message_id_header)
    if not msg.new_thread:
        camp.last_message_id_header = res["message_id_header"] or camp.last_message_id_header
    msg.handled, msg.reply_mode = True, msg.reply_mode or "assisted"
    session.add(SentReply(user_id=user.id, campaign_id=camp.id, gmail_message_id=res["id"], thread_id=res["thread_id"],
                          to_email=msg.from_email, subject=subject, body=body, via="kold"))
    session.add(camp)
    session.add(msg)
    session.commit()
    notify.record(session, user.id, "send", f"Sent your reply to {msg.from_email}", url=f"/inbox?c={camp.id}", message_id=msg.id)


def check_reminders(session: Session, user: User) -> None:
    now = utcnow()
    for r in session.exec(select(Reminder).where(Reminder.user_id == user.id, Reminder.done == False)).all():  # noqa: E712
        left = r.due_at - now
        url = f"/tracker?job={r.user_job_id}" if r.user_job_id else "/tracker"
        if r.notified_stage < 1 and timedelta(days=1) < left <= timedelta(days=3):
            r.notified_stage = 1
            notify.record(session, user.id, "reminder", f"{r.title}: due in {left.days} day{'s' if left.days != 1 else ''} ({r.due_at:%d %b})", push=True, url=url)
        elif r.notified_stage < 2 and left <= timedelta(days=1):
            r.notified_stage = 2
            notify.record(session, user.id, "reminder", f"{r.title}: {'due within a day' if left > timedelta(0) else 'deadline has passed'}", push=True, url=url)
        session.add(r)
    session.commit()
