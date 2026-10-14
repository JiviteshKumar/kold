"""Session, resume upload and auto-built profile, preferences, Gmail connection, and data controls."""
import re
import shutil
from pathlib import Path

from fastapi import APIRouter, Cookie, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import RedirectResponse
from sqlmodel import Session, delete, func, select

from .. import llm, models
from ..config import settings
from ..db import get_session
from ..deps import COOKIE, create_user, current_user, set_session_cookie
from ..models import Profile, Resume, User, UserJob, utcnow
from ..resume import parser
from ..services import classifier, gmail, matching, notify

router = APIRouter(prefix="/api")

DEFAULT_PREFS = {
    "job_types": ["internship", "full_time"], "roles": [], "cities": [], "onsite_india": True, "remote_india": True,
    "remote_global": True, "include_unclear_remote": False, "experience_level": "", "exclude_companies": [],
    "exclude_keywords": [],
}


def _state(session: Session, user: User) -> dict:
    profile = session.get(Profile, user.id)
    resume = session.exec(select(Resume).where(Resume.user_id == user.id).order_by(Resume.uploaded_at.desc())).first()
    return {
        "user": {"id": user.id, "name": user.name, "email": user.email, "timezone": user.timezone, "onboarded": user.onboarded},
        "profile": profile.data if profile else None,
        "preferences": profile.preferences if profile else DEFAULT_PREFS,
        "resume": {"filename": resume.filename, "uploaded_at": resume.uploaded_at.isoformat() + "Z"} if resume else None,
        "gmail": {
            "configured": gmail.configured(), "connected": bool(user.gmail_email), "email": user.gmail_email,
            "scopes": [
                {"name": "Send email (gmail.send)", "why": "To send the emails you approve, from your own address."},
                {"name": "Read email (gmail.readonly)", "why": "To spot replies: only the threads Kold started, plus new emails from companies you contacted that are about your application. The rest of your inbox is never read or stored."},
            ],
        },
        "engine": {"local_model": settings.llm_model, "local_model_online": llm.available(), "reply_model_trained": classifier.model_trained()},
        "limits": {"max_emails_per_day": settings.max_cold_emails_per_day, "max_followups": settings.max_followups},
        "sandbox": settings.gmail_sandbox,
    }


@router.get("/me")
def me(kold_session: str | None = Cookie(default=None), session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.session_token == kold_session)).first() if kold_session else None
    if not user:
        return {"user": None, "sandbox": settings.gmail_sandbox,
                "gmail": {"configured": gmail.configured(), "connected": False, "email": "", "scopes": []}}
    return _state(session, user)


MAX_RESUME_BYTES = 8 * 1024 * 1024
LIST_FIELDS = ("links", "skills", "experience", "education", "projects", "certifications", "achievements", "suggested_roles")
STR_FIELDS = ("name", "headline", "email", "phone", "location", "summary", "experience_level")


def clean_profile(data: dict) -> dict:
    """Keep the profile well-formed whatever the client sends (matching and writing rely on these types)."""
    if not isinstance(data, dict):
        raise HTTPException(400, "Profile must be an object")
    out = dict(data)
    for k in STR_FIELDS:
        out[k] = str(out.get(k) or "")[:2000]
    for k in LIST_FIELDS:
        v = out.get(k) or []
        out[k] = v if isinstance(v, list) else [v]
    out["skills"] = [str(x).strip()[:60] for x in out["skills"] if str(x).strip()][:80]
    out["links"] = [str(x).strip()[:300] for x in out["links"] if str(x).strip()][:10]
    for k in ("certifications", "achievements", "suggested_roles"):
        out[k] = [str(x)[:500] for x in out[k] if str(x).strip()][:30]
    for e in out["experience"]:
        if isinstance(e, dict):
            e["bullets"] = [str(b)[:600] for b in (e.get("bullets") or []) if str(b).strip()][:15]
    out["experience"] = [e for e in out["experience"] if isinstance(e, dict)][:20]
    out["education"] = [e for e in out["education"] if isinstance(e, dict)][:10]
    out["projects"] = [p for p in out["projects"] if isinstance(p, dict)][:20]
    return out


def clean_prefs(prefs: dict) -> dict:
    if not isinstance(prefs, dict):
        raise HTTPException(400, "Preferences must be an object")
    out = {**DEFAULT_PREFS, **{k: v for k, v in prefs.items() if k in DEFAULT_PREFS}}
    for k in ("job_types", "roles", "cities", "exclude_companies", "exclude_keywords"):
        v = out[k] if isinstance(out[k], list) else []
        out[k] = [str(x).strip()[:80] for x in v if str(x).strip()][:40]
    out["job_types"] = [t for t in out["job_types"] if t in ("internship", "full_time", "part_time", "contract")]
    for k in ("onsite_india", "remote_india", "remote_global", "include_unclear_remote"):
        out[k] = bool(out[k])
    if out["experience_level"] not in ("", "student", "fresher", "1-3", "3-5", "5+"):
        out["experience_level"] = ""
    return out


@router.post("/resume")
def upload_resume(response: Response, file: UploadFile = File(...), kold_session: str | None = Cookie(default=None),
                        session: Session = Depends(get_session)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in (".pdf", ".docx", ".txt"):
        raise HTTPException(400, "Upload a PDF, DOCX or TXT resume")
    user = session.exec(select(User).where(User.session_token == kold_session)).first() if kold_session else None
    if not user:
        user = create_user(session, response)
    folder = settings.data_dir / "resumes" / str(user.id)
    folder.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(file.filename or f"resume{suffix}").name)[-120:]
    path = folder / f"{utcnow():%Y%m%d%H%M%S}_{safe}"
    size = 0
    with path.open("wb") as f:
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_RESUME_BYTES:
                f.close()
                path.unlink(missing_ok=True)
                raise HTTPException(413, "That file is over 8 MB. Please upload a smaller resume.")
            f.write(chunk)
    try:
        text = parser.extract_text(path)
    except Exception:
        path.unlink(missing_ok=True)
        raise HTTPException(422, "That file looks damaged or isn't really a PDF/DOCX. Try exporting it again.")
    if len(text) < 100:
        path.unlink(missing_ok=True)
        raise HTTPException(422, "We couldn't read text from that file. If it's a scanned image, upload a text-based PDF or DOCX.")
    data, method = parser.parse(text)
    data = clean_profile(data)
    session.add(Resume(user_id=user.id, filename=file.filename or safe, path=str(path), text=text))
    profile = session.get(Profile, user.id) or Profile(user_id=user.id, preferences=dict(DEFAULT_PREFS))
    profile.data = data
    prefs = dict(profile.preferences or DEFAULT_PREFS)
    if not prefs.get("roles"):
        prefs["roles"] = (data.get("suggested_roles") or [])[:5]
    if not prefs.get("experience_level") and data.get("experience_level"):
        prefs["experience_level"] = data["experience_level"]
        if data["experience_level"] == "student":
            prefs["job_types"] = ["internship", "full_time"]
    profile.preferences = prefs
    profile.updated_at = utcnow()
    user.name = data.get("name") or user.name
    user.email = user.email or data.get("email", "")
    session.add(profile)
    session.add(user)
    session.commit()
    notify.record(session, user.id, "profile", f"Read your resume ({file.filename}) and built your profile using {'the local model' if method != 'rules' else 'rule-based parsing'}",
                  url="/profile")
    return {"profile": data, "preferences": prefs, "method": method}


@router.put("/profile")
def update_profile(data: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    profile = session.get(Profile, user.id)
    if not profile:
        raise HTTPException(404, "Upload a resume first")
    data = clean_profile(data)
    profile.data, profile.updated_at = data, utcnow()
    user.name = data.get("name") or user.name
    session.add(profile)
    session.add(user)
    session.commit()
    return {"ok": True}


@router.put("/preferences")
def update_prefs(prefs: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    profile = session.get(Profile, user.id)
    if not profile:
        raise HTTPException(404, "Upload a resume first")
    tz = prefs.get("timezone") if isinstance(prefs, dict) else None
    profile.preferences = clean_prefs(prefs)
    if tz:
        from zoneinfo import ZoneInfo

        try:
            ZoneInfo(str(tz))
            user.timezone = str(tz)
            session.add(user)
        except Exception:
            pass  # unknown timezone from the browser: keep the current one
    session.add(profile)
    session.commit()
    matching.rescore_new(session, user.id)
    return {"ok": True}


@router.post("/onboarding/complete")
def complete(user: User = Depends(current_user), session: Session = Depends(get_session)):
    from .jobs import start_refresh

    if not session.get(Profile, user.id):
        raise HTTPException(400, "Upload your resume first")
    user.onboarded = True
    session.add(user)
    session.commit()
    matching.build_feed(session, user.id)
    waiting = session.exec(select(func.count()).select_from(UserJob).where(UserJob.user_id == user.id, UserJob.status == "new")).one()
    start_refresh(user.id)
    return {"ok": True, "matches": waiting}


@router.put("/me/timezone")
def set_tz(body: dict, user: User = Depends(current_user), session: Session = Depends(get_session)):
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        ZoneInfo(body.get("timezone", ""))
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(400, "Unknown timezone")
    user.timezone = body["timezone"]
    session.add(user)
    session.commit()
    return {"ok": True}


def web_origin(request: Request) -> str:
    """The web app's public origin: configured, or (in development) taken from the proxied request."""
    if settings.web_origin:
        return settings.web_origin.rstrip("/")
    h = request.headers
    host = h.get("x-forwarded-host") or h.get("host", "localhost:3000")
    proto = h.get("x-forwarded-proto") or request.url.scheme
    return f"{proto.split(',')[0].strip()}://{host.split(',')[0].strip()}"


@router.get("/gmail/connect")
def gmail_connect(request: Request, kold_session: str | None = Cookie(default=None), session: Session = Depends(get_session)):
    """Connect Gmail. Also works as "sign in" on a new device: no Kold session yet is fine."""
    if not gmail.configured():
        raise HTTPException(503, "Gmail isn't set up on this server yet. See README: Google OAuth setup.")
    user = session.exec(select(User).where(User.session_token == kold_session)).first() if kold_session else None
    redirect = RedirectResponse("")
    if not user:
        user = create_user(session, redirect)
    redirect.headers["location"] = gmail.auth_url(user.id, web_origin(request))
    return redirect


@router.get("/gmail/callback")
def gmail_callback(request: Request, state: str = "", code: str = "", error: str = "", session: Session = Depends(get_session)):
    origin = gmail.pending_origin(state) or web_origin(request)
    if error or not code:
        return RedirectResponse(f"{origin}/profile?gmail=denied")
    try:
        user = gmail.finish(session, state, code)
    except Exception:
        return RedirectResponse(f"{origin}/profile?gmail=failed")
    # Same Gmail already has a Kold account (e.g. signing in on a phone): continue as that account.
    existing = session.exec(select(User).where(User.gmail_email == user.gmail_email, User.id != user.id, User.onboarded == True)).first()  # noqa: E712
    # Only for a fresh session (no profile yet): never discard a resume someone just uploaded.
    if existing and not user.onboarded and not session.get(Profile, user.id):
        existing.gmail_token = user.gmail_token
        session.add(existing)
        session.commit()
        _purge(session, user)
        notify.record(session, existing.id, "gmail", f"Signed in on a new device with {existing.gmail_email}", url="/discover")
        resp = RedirectResponse(f"{origin}/discover")
        set_session_cookie(resp, existing.session_token)
        return resp
    notify.record(session, user.id, "gmail", f"Connected Gmail ({user.gmail_email}) with send + read-replies permissions", url="/profile")
    return RedirectResponse(f"{origin}/{'profile' if user.onboarded else 'onboarding'}?gmail=connected")


@router.post("/gmail/disconnect")
def gmail_disconnect(user: User = Depends(current_user), session: Session = Depends(get_session)):
    gmail.disconnect(session, user)
    notify.record(session, user.id, "gmail", "Disconnected Gmail and revoked Kold's access", url="/profile")
    return {"ok": True}


@router.delete("/me")
def delete_everything(response: Response, user: User = Depends(current_user), session: Session = Depends(get_session)):
    """Permanently deletes the user's data from Kold (not from Gmail)."""
    gmail.disconnect(session, user)
    _purge(session, user)
    response.delete_cookie(COOKIE)
    return {"ok": True}


def _purge(session: Session, user: User) -> None:
    uid = user.id
    for table in (models.Contact, models.Activity, models.PushSubscription, models.Reminder, models.SentReply, models.InboxMessage, models.OutboxEmail,
                  models.Campaign, models.TailoredResume, models.UserJob, models.Resume, models.Profile):
        session.exec(delete(table).where(table.user_id == uid))
    session.delete(user)
    session.commit()
    for folder in (settings.data_dir / "resumes" / str(uid), settings.data_dir / "tailored" / str(uid)):
        shutil.rmtree(folder, ignore_errors=True)
