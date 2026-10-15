"""Today (daily review queue), Inbox (replies), activity log and stats."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, func, select

from ..config import settings
from ..db import get_session
from ..deps import current_user
from ..models import (Activity, Campaign, InboxMessage, Job, OutboxEmail, Profile, PushSubscription, SentReply,
                      TailoredResume, User, UserJob)
from ..serialize import inbox as ser_inbox
from ..serialize import outbox as ser_outbox
from ..services import geo, gmail, notify, outreach, quality, writer

router = APIRouter(prefix="/api")
REPLACED = "Replaced by a new draft"


def _ctx(session: Session, campaign_id: int) -> tuple[Campaign, UserJob, Job]:
    camp = session.get(Campaign, campaign_id)
    uj = session.get(UserJob, camp.user_job_id)
    return camp, uj, session.get(Job, uj.job_id)


def _own_ob(session: Session, user: User, oid: int) -> OutboxEmail:
    ob = session.get(OutboxEmail, oid)
    if not ob or ob.user_id != user.id:
        raise HTTPException(404)
    return ob


@router.get("/today")
def today(user: User = Depends(current_user), session: Session = Depends(get_session)):
    day = outreach.user_today(user)
    rows = session.exec(select(OutboxEmail).where(OutboxEmail.user_id == user.id, (
        OutboxEmail.status.in_(["pending", "scheduled", "failed"])) | (OutboxEmail.queue_date == day)).order_by(OutboxEmail.id)).all()
    out = []
    for ob in rows:
        if ob.error == REPLACED:  # a draft replaced by "Rewrite" isn't something the user did today
            continue
        camp, uj, job = _ctx(session, ob.campaign_id)
        if ob.status in outreach.SENDABLE:
            # Recompute "best time" now, not when the draft was written (it goes stale within hours).
            ob.recommended_send_at = outreach.recommended_send_at(job)[0]
        out.append(ser_outbox(ob, job, camp, geo.timezone_for(job.location_raw, job.region)))
    return {"date": day.isoformat(), "emails": out, "sent_today": outreach.sent_today(session, user),
            "daily_limit": settings.max_cold_emails_per_day, "gmail_connected": bool(user.gmail_email)}


@router.put("/outbox/{oid}")
def edit(oid: int, body: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    ob = _own_ob(session, user, oid)
    if ob.status not in outreach.SENDABLE:
        raise HTTPException(409, "This email can't be edited anymore (it was sent, skipped or replaced)")
    ob.subject = " ".join(str(body.get("subject", ob.subject)).split())[:300]  # one line, no header injection
    ob.body = str(body.get("body", ob.body))[:10000]
    camp, _, job = _ctx(session, ob.campaign_id)
    tr = session.get(TailoredResume, camp.tailored_resume_id) if camp.tailored_resume_id else None
    facts = tr.data if tr else session.get(Profile, user.id).data
    ob.quality = quality.check(ob.subject, ob.body, job.company, ob.step, bool(ob.attachment_path), writer.support_text(facts, job))
    if ob.status == "scheduled":
        ob.status, ob.scheduled_for = "pending", None  # edits need a fresh decision
    session.add(ob)
    session.commit()
    return {"quality": ob.quality, "status": ob.status}


@router.post("/outbox/{oid}/send")
def send(oid: int, body: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    ob = _own_ob(session, user, oid)
    if not user.gmail_email:
        raise HTTPException(400, "Connect Gmail in Profile before sending")
    if ob.status not in outreach.SENDABLE:
        raise HTTPException(409, "This email is no longer waiting to be sent (it was sent, skipped or replaced). Refresh the page.")
    if not ob.quality.get("ready", True):
        raise HTTPException(400, "Fix the highlighted issues (like placeholders) first")
    camp, uj, job = _ctx(session, ob.campaign_id)
    if camp.status != "active":
        raise HTTPException(409, "This outreach is paused or stopped.")
    if body.get("when") == "best":
        rec, tz, now_ok = outreach.recommended_send_at(job)
        if not now_ok:
            ob.status, ob.scheduled_for = "scheduled", rec
            session.add(ob)
            session.commit()
            notify.record(session, user.id, "send", f"Scheduled email to {ob.to_email} for {rec:%d %b %H:%M} UTC (their morning, {tz})", url="/today")
            return {"status": "scheduled", "scheduled_for": rec.isoformat() + "Z"}
    try:
        outreach.send_now(session, user, ob)
    except gmail.GmailNotConnected:
        raise HTTPException(400, "Connect Gmail in Profile before sending")
    except ValueError as e:
        raise HTTPException(409 if "already" in str(e) or "no longer" in str(e) else 400, str(e))
    return {"status": "sent"}


@router.post("/outbox/{oid}/skip")
def skip(oid: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    ob = _own_ob(session, user, oid)
    if ob.status not in outreach.SENDABLE:
        raise HTTPException(409, "This email is no longer waiting to be sent")
    ob.status, ob.error = "skipped", "Skipped by you"
    camp, _, job = _ctx(session, ob.campaign_id)
    if ob.step == 0:
        camp.status, camp.stop_reason = "stopped", "First email skipped"
    else:  # skipping a follow-up moves the sequence on to the next one
        camp.steps_sent = ob.step + 1
        if camp.steps_sent <= camp.max_followups and ob.step < len(camp.gaps):
            camp.next_due = outreach.user_today(user) + timedelta(days=camp.gaps[ob.step])
        else:
            camp.status, camp.next_due = "completed", None
    session.add(ob)
    session.add(camp)
    session.commit()
    notify.record(session, user.id, "skip", f"Skipped email to {ob.to_email} ({job.company})", url="/today")
    return {"ok": True}


@router.post("/outbox/{oid}/regenerate")
def regenerate(oid: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    ob = _own_ob(session, user, oid)
    if ob.status not in outreach.SENDABLE:
        raise HTTPException(409, "This email is no longer waiting to be sent")
    camp, _, job = _ctx(session, ob.campaign_id)
    if camp.status != "active":
        raise HTTPException(409, "This outreach is paused or stopped.")
    ob.status, ob.error = "skipped", REPLACED
    session.add(ob)
    session.commit()
    new = outreach.draft_step(session, user, camp)
    return {"id": new.id if new else None}


@router.get("/inbox")
def inbox(user: User = Depends(current_user), session: Session = Depends(get_session)):
    rows = session.exec(select(InboxMessage).where(InboxMessage.user_id == user.id).order_by(InboxMessage.received_at.desc()).limit(200)).all()
    out = []
    for m in rows:
        camp, uj, job = _ctx(session, m.campaign_id)
        out.append(ser_inbox(m, job, camp))
    return {"messages": out, "gmail_connected": bool(user.gmail_email)}


@router.post("/inbox/check")
def check(user: User = Depends(current_user), session: Session = Depends(get_session)):
    if not user.gmail_email:
        raise HTTPException(400, "Connect Gmail first")
    n = outreach.check_replies(session, user)
    return {"new": n}


def _own_msg(session: Session, user: User, mid: int) -> InboxMessage:
    m = session.get(InboxMessage, mid)
    if not m or m.user_id != user.id:
        raise HTTPException(404)
    return m


@router.post("/inbox/{mid}/mode")
def reply_mode(mid: int, body: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    m = _own_msg(session, user, mid)
    mode = body.get("mode")
    if mode == "self":
        m.reply_mode = "self"
    elif mode == "assisted":
        camp, uj, job = _ctx(session, m.campaign_id)
        thread = [{"from": "candidate", "body": o.body} for o in session.exec(
            select(OutboxEmail).where(OutboxEmail.campaign_id == camp.id, OutboxEmail.status == "sent").order_by(OutboxEmail.id))]
        thread += [{"from": x.from_email, "body": x.body} for x in session.exec(
            select(InboxMessage).where(InboxMessage.campaign_id == camp.id).order_by(InboxMessage.received_at))]
        draft, by = writer.draft_reply(session.get(Profile, user.id).data, job, thread, m.label)
        m.reply_mode, m.suggested_reply = "assisted", draft
    else:
        raise HTTPException(400, "mode must be self or assisted")
    session.add(m)
    session.commit()
    _, _, job = _ctx(session, m.campaign_id)
    return {"suggested_reply": m.suggested_reply, "quality": quality.check(f"Re: {m.subject}", m.suggested_reply, job.company, 1, False) if m.suggested_reply else None}


@router.post("/inbox/{mid}/send")
def send_reply(mid: int, body: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    m = _own_msg(session, user, mid)
    text = (body.get("body") or "").strip()
    if not text:
        raise HTTPException(400, "Reply is empty")
    if quality.PLACEHOLDER.search(text):
        raise HTTPException(400, "Fill in the [bracketed] parts before sending")
    try:
        outreach.send_reply(session, user, m, text)
    except gmail.GmailNotConnected:
        raise HTTPException(400, "Connect Gmail first")
    except Exception as e:
        raise HTTPException(502, f"Gmail refused the send: {str(e)[:200]}")
    return {"ok": True}


@router.post("/inbox/{mid}/label")
def relabel(mid: int, body: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    """User correction. Saved as training data for Kold's own reply classifier."""
    m = _own_msg(session, user, mid)
    label = body.get("label")
    from ..services.classifier import LABELS

    if label not in LABELS:
        raise HTTPException(400, "unknown label")
    changed = label != m.label
    m.label, m.label_source, m.label_confidence, m.label_reason = label, "user", 1.0, "Confirmed by you"
    session.add(m)
    session.commit()
    if changed:
        camp = session.get(Campaign, m.campaign_id)
        outreach.apply_label(session, user, camp, m)
        session.commit()
    return {"ok": True}


@router.post("/inbox/{mid}/handled")
def handled(mid: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    m = _own_msg(session, user, mid)
    m.handled = True
    session.add(m)
    session.commit()
    return {"ok": True}


@router.get("/activity")
def activity(limit: int = 60, user: User = Depends(current_user), session: Session = Depends(get_session)):
    rows = session.exec(select(Activity).where(Activity.user_id == user.id).order_by(Activity.at.desc()).limit(min(limit, 300))).all()
    return [{"id": a.id, "at": a.at.isoformat() + "Z", "kind": a.kind, "message": a.message, "url": a.ref.get("url", "/"), "seen": a.seen} for a in rows]


@router.post("/activity/seen")
def activity_seen(user: User = Depends(current_user), session: Session = Depends(get_session)):
    for a in session.exec(select(Activity).where(Activity.user_id == user.id, Activity.seen == False)):  # noqa: E712
        a.seen = True
        session.add(a)
    session.commit()
    return {"ok": True}


@router.get("/stats")
def stats(user: User = Depends(current_user), session: Session = Depends(get_session)):
    def count(model, *where):
        return session.exec(select(func.count()).select_from(model).where(*where)).one()

    uid = user.id
    return {
        "to_review": count(UserJob, UserJob.user_id == uid, UserJob.status == "new"),
        "saved": count(UserJob, UserJob.user_id == uid, UserJob.status.notin_(["new", "passed"])),
        "awaiting_approval": count(OutboxEmail, OutboxEmail.user_id == uid, OutboxEmail.status == "pending"),
        "sent": count(OutboxEmail, OutboxEmail.user_id == uid, OutboxEmail.status == "sent"),
        "replies": count(InboxMessage, InboxMessage.user_id == uid, InboxMessage.label.notin_(["auto_reply", "bounce", "out_of_office"])),
        "positive": count(InboxMessage, InboxMessage.user_id == uid, InboxMessage.label == "positive"),
        "needs_attention": count(InboxMessage, InboxMessage.user_id == uid, InboxMessage.handled == False,  # noqa: E712
                                 InboxMessage.label.notin_(["auto_reply"])),
        "interviews": count(UserJob, UserJob.user_id == uid, UserJob.status == "interview"),
        "unseen_activity": count(Activity, Activity.user_id == uid, Activity.seen == False),  # noqa: E712
    }


@router.get("/push/key")
def push_key():
    return {"key": settings.vapid_public_key}


@router.post("/push/subscribe")
def push_subscribe(sub: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    endpoint = sub.get("endpoint")
    if not endpoint:
        raise HTTPException(400)
    row = session.exec(select(PushSubscription).where(PushSubscription.endpoint == endpoint)).first() or PushSubscription(user_id=user.id, endpoint=endpoint)
    row.user_id, row.data = user.id, sub
    session.add(row)
    session.commit()
    return {"ok": True}


def _conversation(session: Session, camp: Campaign) -> dict | None:
    sent = session.exec(select(OutboxEmail).where(OutboxEmail.campaign_id == camp.id, OutboxEmail.status == "sent")).all()
    recv = session.exec(select(InboxMessage).where(InboxMessage.campaign_id == camp.id)).all()
    if not sent and not recv:
        return None
    uj = session.get(UserJob, camp.user_job_id)
    job = session.get(Job, uj.job_id)
    msgs = [{"kind": "sent", "key": f"o{o.id}", "at": o.sent_at.isoformat() + "Z", "from_email": o.to_email, "subject": o.subject,
             "body": o.body, "step": o.step, "attachment": o.attachment_path.replace("\\", "/").split("/")[-1] if o.attachment_path else ""}
            for o in sent]
    msgs += [{**ser_inbox(m, job, camp), "kind": "received", "key": f"i{m.id}", "at": m.received_at.isoformat() + "Z",
              "new_thread": m.new_thread} for m in recv]
    msgs += [{"kind": "sent", "key": f"r{r.id}", "at": r.sent_at.isoformat() + "Z", "from_email": r.to_email, "subject": r.subject,
              "body": r.body, "step": -1, "attachment": "", "via": r.via}
             for r in session.exec(select(SentReply).where(SentReply.campaign_id == camp.id)).all()]
    msgs.sort(key=lambda x: x["at"])
    latest = max(recv, key=lambda m: m.received_at) if recv else None
    return {
        "campaign_id": camp.id, "user_job_id": uj.id, "company": job.company, "job_title": job.title, "to": camp.to_email,
        "status": camp.status, "stop_reason": camp.stop_reason, "steps_sent": camp.steps_sent, "max_followups": camp.max_followups,
        "next_due": camp.next_due.isoformat() if camp.next_due else None,
        "paused_until": camp.paused_until.isoformat() if camp.paused_until else None,
        "needs_you": sum(1 for m in recv if not m.handled), "replies": len(recv),
        "you_sent": sum(1 for m in msgs if m["kind"] == "sent"),
        "latest_label": latest.label if latest else "", "last_at": msgs[-1]["at"], "messages": msgs,
    }


@router.get("/conversations")
def conversations(user: User = Depends(current_user), session: Session = Depends(get_session)):
    """Every company you've emailed, with the full back-and-forth: the one place to read and act on replies."""
    out = [c for camp in session.exec(select(Campaign).where(Campaign.user_id == user.id)).all() if (c := _conversation(session, camp))]
    out.sort(key=lambda c: (c["needs_you"] > 0, c["last_at"]), reverse=True)
    return {"conversations": out, "gmail_connected": bool(user.gmail_email)}


@router.get("/home")
def home(user: User = Depends(current_user), session: Session = Depends(get_session)):
    """Everything that needs the user today, in one place."""
    from ..models import CrawlRun, Reminder, utcnow

    uid = user.id
    replies = session.exec(select(InboxMessage).where(InboxMessage.user_id == uid, InboxMessage.handled == False)  # noqa: E712
                           .order_by(InboxMessage.received_at.desc()).limit(6)).all()
    reply_cards = []
    for m in replies:
        camp, uj, job = _ctx(session, m.campaign_id)
        reply_cards.append({"id": m.id, "campaign_id": camp.id, "company": job.company, "job_title": job.title, "from": m.from_name or m.from_email,
                            "snippet": m.snippet, "label": m.label, "at": m.received_at.isoformat() + "Z"})
    approvals = session.exec(select(OutboxEmail).where(OutboxEmail.user_id == uid, OutboxEmail.status.in_(["pending", "failed"]))
                             .order_by(OutboxEmail.id)).all()
    approval_cards = []
    for ob in approvals[:4]:
        camp, uj, job = _ctx(session, ob.campaign_id)
        approval_cards.append({"id": ob.id, "company": job.company, "to": ob.to_email, "step": ob.step, "status": ob.status})
    soon = utcnow() + timedelta(days=7)
    reminders = session.exec(select(Reminder).where(Reminder.user_id == uid, Reminder.done == False, Reminder.due_at <= soon)  # noqa: E712
                             .order_by(Reminder.due_at)).all()
    top = session.exec(select(UserJob, Job).join(Job).where(UserJob.user_id == uid, UserJob.status == "new", Job.active == True)  # noqa: E712
                       .order_by(UserJob.match_score.desc()).limit(3)).all()
    stages = ["liked", "applied", "reaching_out", "replied", "interview", "offer"]
    pipeline = {s: session.exec(select(func.count()).select_from(UserJob).where(UserJob.user_id == uid, UserJob.status == s)).one() for s in stages}
    last = session.exec(select(CrawlRun).where(CrawlRun.finished_at != None).order_by(CrawlRun.id.desc())).first()  # noqa: E711
    acts = session.exec(select(Activity).where(Activity.user_id == uid).order_by(Activity.at.desc()).limit(6)).all()
    return {
        "name": (user.name or "").split(" ")[0],
        "gmail_connected": bool(user.gmail_email),
        "replies": reply_cards,
        "replies_waiting": session.exec(select(func.count()).select_from(InboxMessage).where(InboxMessage.user_id == uid, InboxMessage.handled == False)).one(),  # noqa: E712
        "approvals": approval_cards, "approvals_waiting": len(approvals),
        "scheduled": session.exec(select(func.count()).select_from(OutboxEmail).where(OutboxEmail.user_id == uid, OutboxEmail.status == "scheduled")).one(),
        "sent_today": outreach.sent_today(session, user), "daily_limit": settings.max_cold_emails_per_day,
        "deadlines": [{"id": r.id, "title": r.title, "due_at": r.due_at.isoformat() + "Z", "user_job_id": r.user_job_id} for r in reminders],
        "matches_waiting": session.exec(select(func.count()).select_from(UserJob).join(Job).where(UserJob.user_id == uid, UserJob.status == "new", Job.active == True)).one(),  # noqa: E712
        "top_matches": [{"user_job_id": uj.id, "company": j.company, "title": j.title, "score": uj.match_score} for uj, j in top],
        "pipeline": pipeline,
        "last_scan": {"at": last.finished_at.isoformat() + "Z", "new": last.new_jobs} if last else None,
        "activity": [{"id": a.id, "at": a.at.isoformat() + "Z", "kind": a.kind, "message": a.message, "url": a.ref.get("url", "/")} for a in acts],
    }
