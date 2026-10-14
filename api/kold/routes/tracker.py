"""Application tracker: saved jobs, detail, contacts, tailored resume, outreach campaigns, reminders."""
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from ..config import settings
from ..db import get_session
from ..deps import current_user
from ..models import (Campaign, Contact, InboxMessage, Job, OutboxEmail, Reminder, TailoredResume, User, UserJob,
                      utcnow)
from ..serialize import inbox as ser_inbox
from ..serialize import job_card
from ..services import contacts, notify, outreach

router = APIRouter(prefix="/api")
STAGES = ["liked", "applied", "reaching_out", "replied", "interview", "offer", "rejected", "archived"]


def _own(session: Session, user: User, uj_id: int) -> tuple[UserJob, Job]:
    uj = session.get(UserJob, uj_id)
    if not uj or uj.user_id != user.id:
        raise HTTPException(404)
    return uj, session.get(Job, uj.job_id)


def _campaign_summary(c: Campaign | None, today) -> dict | None:
    if not c:
        return None
    return {"id": c.id, "status": c.status, "to": c.to_email, "steps_sent": c.steps_sent, "max_followups": c.max_followups,
            "gaps": c.gaps, "next_due": c.next_due.isoformat() if c.next_due else None,
            "paused_until": c.paused_until.isoformat() if c.paused_until else None, "stop_reason": c.stop_reason}


@router.get("/tracker")
def tracker(user: User = Depends(current_user), session: Session = Depends(get_session)):
    rows = session.exec(select(UserJob, Job).join(Job).where(UserJob.user_id == user.id, UserJob.status.in_(STAGES))
                        .order_by(UserJob.updated_at.desc())).all()
    camps = {c.user_job_id: c for c in session.exec(select(Campaign).where(Campaign.user_id == user.id).order_by(Campaign.id))}
    today = outreach.user_today(user)
    items = []
    for uj, job in rows:
        d = job_card(job, uj)
        d["campaign"] = _campaign_summary(camps.get(uj.id), today)
        items.append(d)
    return {"stages": STAGES, "items": items}


@router.get("/jobs/{uj_id}")
def detail(uj_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    uj, job = _own(session, user, uj_id)
    camps = list(session.exec(select(Campaign).where(Campaign.user_job_id == uj.id).order_by(Campaign.id.desc())))
    camp = camps[0] if camps else None
    emails = [] if not camp else [
        {"id": o.id, "step": o.step, "to": o.to_email, "subject": o.subject, "body": o.body, "status": o.status,
         "sent_at": o.sent_at.isoformat() + "Z" if o.sent_at else None, "error": o.error}
        for o in session.exec(select(OutboxEmail).where(OutboxEmail.campaign_id == camp.id).order_by(OutboxEmail.id))]
    replies = [] if not camp else [ser_inbox(m, job, camp) for m in session.exec(select(InboxMessage).where(InboxMessage.campaign_id == camp.id).order_by(InboxMessage.received_at))]
    tr = session.exec(select(TailoredResume).where(TailoredResume.user_id == user.id, TailoredResume.job_id == job.id)).first()
    found = job_contacts(session, user, uj, job)
    reminders = list(session.exec(select(Reminder).where(Reminder.user_job_id == uj.id).order_by(Reminder.due_at)))
    rec, tz, now_ok = outreach.recommended_send_at(job)
    d = job_card(job, uj, full=True)
    d.update({
        "campaign": _campaign_summary(camp, None), "emails": emails, "replies": replies,
        "tailored": {"changes": tr.changes, "created_at": tr.created_at.isoformat() + "Z"} if tr else None,
        "contacts": [_contact(c) for c in found],
        "reminders": [{"id": r.id, "title": r.title, "due_at": r.due_at.isoformat() + "Z", "kind": r.kind, "done": r.done} for r in reminders],
        "recipient_tz": tz, "suggested_cadence": suggest_cadence(job),
    })
    return d


def job_contacts(session: Session, user: User, uj: UserJob, job: Job) -> list[Contact]:
    """Addresses this user may email about this job: ones the company published, plus ones this user added."""
    published = list(session.exec(select(Contact).where(Contact.company_domain == job.company_domain, Contact.user_id == None,  # noqa: E711
                                                        Contact.mx_ok == True, Contact.bounced == False))) if job.company_domain else []  # noqa: E712
    mine = list(session.exec(select(Contact).where(Contact.user_id == user.id, Contact.user_job_id == uj.id, Contact.bounced == False)))  # noqa: E712
    seen, out = set(), []
    for c in contacts._rank(mine + published):
        if c.email not in seen:
            seen.add(c.email)
            out.append(c)
    return out


def _contact(c: Contact) -> dict:
    return {"id": c.id, "email": c.email, "role": c.role_hint, "source_url": c.source_url, "confidence": c.confidence,
            "mx_ok": c.mx_ok, "found_at": c.found_at.isoformat() + "Z"}


def suggest_cadence(job: Job) -> dict:
    """Kold's recommended follow-up schedule, with the reasoning shown to the user."""
    if job.job_type == "internship":
        gaps, why = [3, 6], "Internship hiring moves fast: follow up after 3 days, then 6 days later."
    elif job.seniority in ("senior", "lead"):
        gaps, why = [5, 9], "Senior roles take longer to review: give it 5 days, then 9."
    else:
        gaps, why = [4, 7], "Most replies arrive in the first week: follow up after 4 days, then 7 days later."
    return {"gaps": gaps[: settings.max_followups], "max_followups": min(2, settings.max_followups),
            "why": why + " Two follow-ups maximum; more than that tends to annoy recipients."}


@router.patch("/jobs/{uj_id}")
def update(uj_id: int, body: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    uj, job = _own(session, user, uj_id)
    if "status" in body:
        if body["status"] not in STAGES + ["new", "passed"]:
            raise HTTPException(400, "bad status")
        if body["status"] != uj.status:
            notify.record(session, user.id, "tracker", f"Moved {job.title} at {job.company} to {body['status'].replace('_', ' ')}", url=f"/tracker?job={uj.id}")
        uj.status = body["status"]
    if "notes" in body:
        uj.notes = body["notes"][:5000]
    if "deadline" in body:
        uj.deadline = _parse_dt(body["deadline"]) if body["deadline"] else None
        r = session.exec(select(Reminder).where(Reminder.user_job_id == uj.id, Reminder.kind == "deadline")).first()
        if uj.deadline:
            r = r or Reminder(user_id=user.id, user_job_id=uj.id, kind="deadline", title=f"Apply: {job.title} at {job.company}", due_at=uj.deadline)
            r.due_at, r.notified_stage, r.done = uj.deadline, 0, False
            session.add(r)
        elif r:
            session.delete(r)
    uj.updated_at = utcnow()
    session.add(uj)
    session.commit()
    return {"ok": True}


@router.post("/jobs/{uj_id}/contacts/find")
def find_contacts(uj_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    uj, job = _own(session, user, uj_id)
    contacts.find_for_job(session, job, force=True)
    found = job_contacts(session, user, uj, job)
    msg = (f"Found {len(found)} published address{'es' if len(found) != 1 else ''} for {job.company}" if found
           else f"No published email found on {job.company_domain or job.company}'s website")
    notify.record(session, user.id, "contact", msg, url=f"/tracker?job={uj.id}")
    return {"contacts": [_contact(c) for c in found], "domain": job.company_domain}


@router.post("/jobs/{uj_id}/contacts")
def add_contact(uj_id: int, body: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    uj, job = _own(session, user, uj_id)
    email = (body.get("email") or "").strip().lower()
    if not re.fullmatch(r"[\w.+-]+@[\w-]+(\.[\w-]+)+", email):
        raise HTTPException(400, "That doesn't look like an email address")
    domain = email.split("@")[1]
    existing = session.exec(select(Contact).where(Contact.user_id == user.id, Contact.user_job_id == uj.id, Contact.email == email)).first()
    if existing:
        return _contact(existing)
    if not contacts.mx_ok(domain):
        raise HTTPException(400, f"{domain} has no mail server (MX record), so emails to it would bounce.")
    # Private to this user and this job: never shown to anyone else, never changes the shared job record.
    c = Contact(user_id=user.id, user_job_id=uj.id, company_domain=domain, email=email, role_hint="user-added",
                source_url="Added by you", confidence="user", mx_ok=True)
    session.add(c)
    session.commit()
    session.refresh(c)
    return _contact(c)


@router.post("/jobs/{uj_id}/tailor")
def retailor(uj_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    uj, job = _own(session, user, uj_id)
    old = session.exec(select(TailoredResume).where(TailoredResume.user_id == user.id, TailoredResume.job_id == job.id)).first()
    if old:
        old.pdf_path = ""
        session.add(old)
        session.commit()
    tr = outreach.ensure_tailored(session, user, job)
    return {"changes": tr.changes, "data": tr.data}


@router.get("/jobs/{uj_id}/resume.pdf")
def tailored_pdf(uj_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    uj, job = _own(session, user, uj_id)
    tr = outreach.ensure_tailored(session, user, job)
    return FileResponse(tr.pdf_path, media_type="application/pdf", filename=tr.pdf_path.replace("\\", "/").split("/")[-1])


@router.post("/jobs/{uj_id}/outreach")
def start_outreach(uj_id: int, body: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    uj, job = _own(session, user, uj_id)
    to = (body.get("to_email") or "").strip().lower()
    if not to:
        raise HTTPException(400, "Choose who to email")
    if to not in {c.email for c in job_contacts(session, user, uj, job)}:
        raise HTTPException(400, "Pick a verified contact for this job (published by the company, or added by you)")
    sugg = suggest_cadence(job)
    try:
        gaps = [max(2, min(21, int(g))) for g in (body.get("gaps") or sugg["gaps"])]
        maxf = max(0, min(settings.max_followups, int(body.get("max_followups", sugg["max_followups"]))))
    except (TypeError, ValueError):
        raise HTTPException(400, "Follow-up days must be numbers")
    if len(gaps) < maxf:
        gaps += [gaps[-1] if gaps else 5] * (maxf - len(gaps))
    try:
        camp = outreach.start(session, user, uj, to, gaps, maxf)
    except outreach.OutreachError as e:
        raise HTTPException(409, str(e))
    return {"campaign_id": camp.id}


@router.post("/campaigns/{cid}/decision")
def decision(cid: int, body: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    camp = session.get(Campaign, cid)
    if not camp or camp.user_id != user.id:
        raise HTTPException(404)
    action = body.get("action")
    if action == "stop":
        camp.status, camp.stop_reason, camp.next_due = "stopped", "Stopped by you", None
        for ob in session.exec(select(OutboxEmail).where(OutboxEmail.campaign_id == cid, OutboxEmail.status.in_(["pending", "scheduled"]))):
            ob.status, ob.error = "skipped", "Outreach stopped"
            session.add(ob)
        notify.record(session, user.id, "stop", f"Stopped outreach to {camp.to_email}. No more emails will be drafted.", url="/tracker")
    elif action == "resume":
        if camp.stop_reason == "Address bounced":
            raise HTTPException(400, "That address bounced. Pick another contact instead.")
        if camp.steps_sent > camp.max_followups:
            raise HTTPException(400, "All follow-ups have already been sent")
        if camp.status == "active":
            return {"ok": True, "status": camp.status}
        camp.status, camp.stop_reason, camp.paused_until = "active", "", None
        camp.next_due = camp.next_due or outreach.user_today(user)
        session.add(camp)
        session.commit()
        notify.record(session, user.id, "campaign", f"Resumed outreach to {camp.to_email}", url="/today")
        if camp.next_due <= outreach.user_today(user):
            outreach.draft_step(session, user, camp)
        return {"ok": True, "status": camp.status}
    else:
        raise HTTPException(400, "action must be stop or resume")
    session.add(camp)
    session.commit()
    return {"ok": True, "status": camp.status}


@router.post("/reminders")
def add_reminder(body: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    uj_id = body.get("user_job_id")
    if uj_id:
        _own(session, user, uj_id)
    title = str(body.get("title") or "").strip()
    if not title or not body.get("due_at"):
        raise HTTPException(400, "A reminder needs a title and a date")
    r = Reminder(user_id=user.id, user_job_id=uj_id, kind=body.get("kind", "custom"), title=title[:200], due_at=_parse_dt(body["due_at"]))
    session.add(r)
    session.commit()
    return {"id": r.id}


def _parse_dt(value) -> datetime:
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "Invalid date")
    if dt.tzinfo:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


@router.patch("/reminders/{rid}")
def update_reminder(rid: int, body: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    r = session.get(Reminder, rid)
    if not r or r.user_id != user.id:
        raise HTTPException(404)
    r.done = bool(body.get("done", r.done))
    session.add(r)
    session.commit()
    return {"ok": True}


@router.get("/reminders")
def reminders(user: User = Depends(current_user), session: Session = Depends(get_session)):
    rows = session.exec(select(Reminder).where(Reminder.user_id == user.id, Reminder.done == False).order_by(Reminder.due_at)).all()  # noqa: E712
    return [{"id": r.id, "title": r.title, "due_at": r.due_at.isoformat() + "Z", "kind": r.kind, "user_job_id": r.user_job_id} for r in rows]
