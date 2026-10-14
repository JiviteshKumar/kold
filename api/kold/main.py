"""Kold API. Run with:  uvicorn kold.main:app --reload --port 8000  (from the api/ folder)."""
import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from sqlmodel import select

from .config import settings
from .db import init_db, session_scope
from .models import User
from .routes import jobs, mail, me, sandbox, tracker
from .services import outreach

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("kold")
logging.getLogger("apscheduler").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)


def _for_each_user(fn, *where):
    with session_scope() as s:
        for user in s.exec(select(User).where(User.onboarded == True, *where)).all():  # noqa: E712
            try:
                fn(s, user)
            except Exception:
                s.rollback()  # one user's failure must not poison the session for everyone after them
                log.exception("%s failed for user %s", getattr(fn, "__name__", fn), user.id)


def _crawl_all():
    with session_scope() as s:
        ids = [u.id for u in s.exec(select(User).where(User.onboarded == True)).all()]  # noqa: E712
    for uid in ids:
        with jobs._lock:
            jobs._state["users"].add(uid)
    if ids:
        jobs.start_refresh(ids[0])


def _send_scheduled():
    with session_scope() as s:
        outreach.send_due_scheduled(s)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    sched = BackgroundScheduler(timezone="UTC")
    sched.add_job(_crawl_all, "interval", hours=settings.crawl_interval_hours, id="crawl")
    sched.add_job(lambda: _for_each_user(outreach.check_replies, User.gmail_email != ""), "interval",
                  minutes=settings.inbox_poll_minutes, id="inbox")
    sched.add_job(_send_scheduled, "interval", minutes=1, id="scheduled-sends")
    sched.add_job(lambda: _for_each_user(outreach.build_daily_queue), "interval", minutes=30, id="daily-queue")
    sched.add_job(lambda: _for_each_user(outreach.check_reminders), "interval", minutes=30, id="reminders")
    sched.start()
    yield
    sched.shutdown(wait=False)


app = FastAPI(title="Kold API", lifespan=lifespan)
for r in (me.router, jobs.router, tracker.router, mail.router):
    app.include_router(r)
if settings.gmail_sandbox:
    log.warning("SANDBOX MODE: Gmail is simulated with a local file. No real email will be sent or read.")
    app.include_router(sandbox.router)


@app.get("/api/health")
def health():
    return {"ok": True}
