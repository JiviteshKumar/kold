"""Discover deck: refresh from sources, list cards, swipe."""
import threading
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, func, select

from ..db import get_session, session_scope
from ..deps import current_user
from ..models import CrawlRun, Job, Reminder, User, UserJob, utcnow
from ..serialize import job_card
from ..services import crawler, matching, notify

router = APIRouter(prefix="/api")

_lock = threading.Lock()
_state = {"running": False, "started_at": None, "users": set()}
RECRAWL_AFTER = timedelta(minutes=30)


def _last_run(session: Session) -> CrawlRun | None:
    return session.exec(select(CrawlRun).where(CrawlRun.finished_at != None).order_by(CrawlRun.id.desc())).first()  # noqa: E711


def _refresh_worker() -> None:
    try:
        with session_scope() as s:
            last = _last_run(s)
            ran = None
            if not last or last.finished_at < utcnow() - RECRAWL_AFTER:
                ran = crawler.run(s)
            for uid in list(_state["users"]):
                added = matching.build_feed(s, uid)
                if ran:
                    ok = sum(1 for v in ran.stats.values() if v.get("ok"))
                    notify.record(s, uid, "crawl", f"Scanned {ok} official sources: {ran.new_jobs} new listings, {ran.closed_jobs} closed. {added} new matches for you.",
                                  push=added > 0, url="/discover")
                elif added:
                    notify.record(s, uid, "match", f"{added} new matches for you", url="/discover")
    finally:
        with _lock:
            _state["running"] = False
            _state["users"] = set()


def start_refresh(user_id: int | None = None) -> bool:
    """Scan sources in the background, then rebuild the decks of the listed users (none = scan only)."""
    with _lock:
        if user_id is not None:
            _state["users"].add(user_id)
        if _state["running"]:
            return False
        _state["running"], _state["started_at"] = True, utcnow()
    threading.Thread(target=_refresh_worker, daemon=True).start()
    return True


@router.get("/feed")
def feed(user: User = Depends(current_user), session: Session = Depends(get_session)):
    rows = session.exec(select(UserJob, Job).join(Job).where(UserJob.user_id == user.id, UserJob.status == "new", Job.active == True)  # noqa: E712
                        .order_by(UserJob.match_score.desc(), Job.posted_at.desc()).limit(40)).all()
    total_new = session.exec(select(func.count()).select_from(UserJob).join(Job).where(UserJob.user_id == user.id, UserJob.status == "new", Job.active == True)).one()  # noqa: E712
    last = _last_run(session)
    return {
        "cards": [job_card(j, uj) for uj, j in rows],
        "remaining": total_new,
        "refreshing": _state["running"],
        "last_scan": {"at": last.finished_at.isoformat() + "Z", "new": last.new_jobs, "closed": last.closed_jobs,
                      "sources_ok": sum(1 for v in last.stats.values() if v.get("ok")), "sources": len(last.stats)} if last else None,
        "active_jobs": session.exec(select(func.count()).select_from(Job).where(Job.active == True)).one(),  # noqa: E712
    }


@router.post("/feed/refresh")
def refresh(user: User = Depends(current_user)):
    started = start_refresh(user.id)
    return {"started": started, "running": True}


@router.get("/feed/refresh")
def refresh_status(user: User = Depends(current_user)):
    return {"running": _state["running"]}


@router.post("/feed/{uj_id}/swipe")
def swipe(uj_id: int, body: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    uj = session.get(UserJob, uj_id)
    if not uj or uj.user_id != user.id:
        raise HTTPException(404)
    job = session.get(Job, uj.job_id)
    direction = body.get("direction")
    if direction == "right":
        uj.status = "liked"
        if job.deadline and not session.exec(select(Reminder).where(Reminder.user_job_id == uj.id, Reminder.kind == "deadline")).first():
            session.add(Reminder(user_id=user.id, user_job_id=uj.id, kind="deadline", title=f"Apply: {job.title} at {job.company}", due_at=job.deadline))
        notify.record(session, user.id, "match", f"Saved {job.title} at {job.company}", url=f"/tracker?job={uj.id}")
    elif direction == "left":
        uj.status = "passed"
    elif direction == "undo":
        uj.status = "new"
    else:
        raise HTTPException(400, "direction must be right, left or undo")
    uj.updated_at = utcnow()
    session.add(uj)
    session.commit()
    return {"ok": True, "status": uj.status}
