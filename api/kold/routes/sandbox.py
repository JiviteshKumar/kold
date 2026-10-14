"""Sandbox-only endpoints (mounted only when KOLD_GMAIL_SANDBOX=1). For testing the full outreach loop
without sending real email: see what "went out", simulate a company's reply, and fast-forward follow-ups."""
import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..deps import current_user
from ..models import Campaign, User
from ..services import gmail, outreach

router = APIRouter(prefix="/api/sandbox")


def _camp(session: Session, user: User, cid: int) -> Campaign:
    camp = session.get(Campaign, cid)
    if not camp or camp.user_id != user.id:
        raise HTTPException(404)
    return camp


@router.get("/mailbox")
def mailbox(user: User = Depends(current_user), session: Session = Depends(get_session)):
    mine = {c.thread_id: c.id for c in session.exec(select(Campaign).where(Campaign.user_id == user.id, Campaign.thread_id != ""))}
    return {tid: {"campaign_id": mine[tid], "messages": msgs} for tid, msgs in gmail.sandbox_threads().items() if tid in mine}


@router.post("/reply")
def simulate_reply(body: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    """Simulate a company's email. `new_thread: true` = they wrote a fresh email instead of replying in-thread."""
    camp = _camp(session, user, int(body.get("campaign_id", 0)))
    if not camp.thread_id:
        raise HTTPException(400, "Send the first email before simulating a reply")
    new = bool(body.get("new_thread"))
    thread = f"sbn{secrets.token_hex(6)}" if new else camp.thread_id
    msg = gmail.sandbox_add(thread, {
        "from_email": (body.get("from_email") or camp.to_email).lower(), "from_name": body.get("from_name", "Hiring Team"),
        "to": user.gmail_email,
        "subject": body.get("subject") or (f"Your application at {camp.to_email.split('@')[1]}" if new else f"Re: {camp.first_subject}"),
        "body": body.get("body", ""), "headers": body.get("headers") or {}, "label_ids": body.get("label_ids") or ["INBOX"],
    })
    return msg


@router.post("/advance")
def make_followup_due(body: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    """Pretend the follow-up gap has passed, then run the daily queue exactly like the scheduler does."""
    camp = _camp(session, user, int(body.get("campaign_id", 0)))
    if camp.next_due:
        camp.next_due = outreach.user_today(user)
    camp.paused_until = None if body.get("clear_pause") else camp.paused_until
    session.add(camp)
    session.commit()
    return {"drafted": outreach.build_daily_queue(session, user)}
