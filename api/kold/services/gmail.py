"""Gmail access with the two permissions the user approved: gmail.send and gmail.readonly.

Privacy rule enforced in code: Kold only reads (1) the threads it started and (2) new emails *from the
companies you've contacted* (exact contact address, or their company domain when the email is clearly about
your application). It never browses, searches or stores the rest of the mailbox.
"""
import base64
import json
import mimetypes
import secrets
import threading
import time
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from sqlmodel import Session

from ..config import settings
from ..models import User

SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
]

_pending: dict[str, tuple[int, str | None, str]] = {}  # oauth state -> (user_id, pkce verifier, web origin)


class GmailNotConnected(RuntimeError):
    pass


def configured() -> bool:
    return settings.gmail_sandbox or bool(settings.google_client_id and settings.google_client_secret)


# ---------------------------------------------------------------------------------------------
# Sandbox mailbox: a local JSON file standing in for Gmail. Used for development and testing.
_SANDBOX = settings.data_dir / "sandbox_mailbox.json"
_sandbox_lock = threading.Lock()


def _sb_load() -> dict:
    return json.loads(_SANDBOX.read_text(encoding="utf-8")) if _SANDBOX.exists() else {"threads": {}}


def _sb_save(d: dict) -> None:
    _SANDBOX.write_text(json.dumps(d, indent=1), encoding="utf-8")


def sandbox_add(thread_id: str, msg: dict) -> dict:
    """Append a message to a sandbox thread (our sends, or a simulated reply from a company)."""
    with _sandbox_lock:
        d = _sb_load()
        thread = d["threads"].setdefault(thread_id, [])
        n = secrets.token_hex(6)  # random: ids must never repeat, even after the sandbox file is reset
        full = {"id": f"sb{n}", "thread_id": thread_id, "from_name": "", "subject": "", "headers": {}, "label_ids": [],
                "internal_date": int(time.time() * 1000), "message_id_header": f"<sb{n}@kold.sandbox>", **msg}
        full["snippet"] = full.get("snippet") or full.get("body", "")[:120]
        thread.append(full)
        _sb_save(d)
        return full


def sandbox_threads() -> dict:
    with _sandbox_lock:
        return _sb_load()["threads"]


def _is_sandbox(user: User) -> bool:
    return bool((user.gmail_token or {}).get("sandbox"))


def _flow(origin: str, state: str | None = None) -> Flow:
    redirect = f"{origin}/api/gmail/callback"
    cfg = {"web": {
        "client_id": settings.google_client_id, "client_secret": settings.google_client_secret,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth", "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": [redirect],
    }}
    return Flow.from_client_config(cfg, scopes=SCOPES, state=state, redirect_uri=redirect)


def auth_url(user_id: int, origin: str) -> str:
    state = secrets.token_urlsafe(24)
    if settings.gmail_sandbox:
        _pending[state] = (user_id, None, origin)
        return f"{origin}/api/gmail/callback?state={state}&code=sandbox"
    flow = _flow(origin, state)
    url, _ = flow.authorization_url(access_type="offline", prompt="consent", include_granted_scopes="true")
    _pending[state] = (user_id, getattr(flow, "code_verifier", None), origin)
    return url


def pending_origin(state: str) -> str | None:
    p = _pending.get(state)
    return p[2] if p else None


def finish(session: Session, state: str, code: str) -> User:
    user_id, verifier, origin = _pending.pop(state)
    user = session.get(User, user_id)
    if settings.gmail_sandbox:
        user.gmail_token = {"sandbox": True, "refresh_token": "sandbox"}
        user.gmail_email = settings.sandbox_email.replace("@", f"+{user.id}@")  # unique per user
    else:
        flow = _flow(origin, state)
        if verifier:
            flow.code_verifier = verifier
        flow.fetch_token(code=code)
        creds = flow.credentials
        user.gmail_token = _to_dict(creds)
        profile = build("gmail", "v1", credentials=creds, cache_discovery=False).users().getProfile(userId="me").execute()
        user.gmail_email = profile["emailAddress"].lower()
    user.email = user.email or user.gmail_email
    session.add(user)
    session.commit()
    return user


def _to_dict(creds: Credentials) -> dict:
    return {"token": creds.token, "refresh_token": creds.refresh_token, "token_uri": creds.token_uri,
            "client_id": creds.client_id, "client_secret": creds.client_secret, "scopes": list(creds.scopes or SCOPES)}


def _service(session: Session, user: User):
    if not user.gmail_token or not user.gmail_token.get("refresh_token") or _is_sandbox(user):
        raise GmailNotConnected("Connect Gmail first")
    creds = Credentials(**user.gmail_token)
    if not creds.valid:
        creds.refresh(Request())
        user.gmail_token = _to_dict(creds)
        session.add(user)
        session.commit()
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def disconnect(session: Session, user: User) -> None:
    token = (user.gmail_token or {}).get("refresh_token") or (user.gmail_token or {}).get("token")
    if token and not _is_sandbox(user):
        try:
            import httpx

            httpx.post("https://oauth2.googleapis.com/revoke", params={"token": token}, timeout=10)
        except Exception:
            pass
    user.gmail_token = {}
    user.gmail_email = ""
    session.add(user)
    session.commit()


def send(session: Session, user: User, to: str, subject: str, body: str, attachment: str = "",
         thread_id: str = "", in_reply_to: str = "") -> dict:
    """Send one email. Returns {id, thread_id, message_id_header}."""
    if "\n" in subject or "\r" in subject:
        raise ValueError("Subject can't contain line breaks")
    if _is_sandbox(user):
        if not settings.gmail_sandbox:
            raise GmailNotConnected("This account is connected to the sandbox. Connect a real Gmail account.")
        tid = thread_id or f"sbt{secrets.token_hex(6)}"
        m = sandbox_add(tid, {"from_email": user.gmail_email, "from_name": user.name, "to": to, "subject": subject, "body": body,
                              "attachment": Path(attachment).name if attachment else "", "label_ids": ["SENT"],
                              "headers": {"in-reply-to": in_reply_to} if in_reply_to else {}})
        return {"id": m["id"], "thread_id": tid, "message_id_header": m["message_id_header"]}
    svc = _service(session, user)
    msg = EmailMessage()
    msg["To"] = to
    msg["From"] = formataddr((user.name or "", user.gmail_email))
    msg["Subject"] = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = in_reply_to
    msg.set_content(body)
    if attachment and Path(attachment).exists():
        ctype, _ = mimetypes.guess_type(attachment)
        maintype, subtype = (ctype or "application/pdf").split("/", 1)
        msg.add_attachment(Path(attachment).read_bytes(), maintype=maintype, subtype=subtype, filename=Path(attachment).name)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    payload = {"raw": raw}
    if thread_id:
        payload["threadId"] = thread_id
    sent = svc.users().messages().send(userId="me", body=payload).execute()
    meta = svc.users().messages().get(userId="me", id=sent["id"], format="metadata", metadataHeaders=["Message-ID"]).execute()
    mid = next((h["value"] for h in meta["payload"].get("headers", []) if h["name"].lower() == "message-id"), "")
    return {"id": sent["id"], "thread_id": sent["threadId"], "message_id_header": mid}


def _body_text(payload: dict) -> str:
    """Plain-text body; falls back to the HTML part (many recruiting systems send HTML-only email)."""
    from ..sources.common import html_to_text

    found: dict[str, str] = {}

    def walk(p):
        mt, data = p.get("mimeType", ""), (p.get("body") or {}).get("data")
        if data and mt in ("text/plain", "text/html") and mt not in found:
            found[mt] = base64.urlsafe_b64decode(data).decode(errors="ignore")
        for part in p.get("parts") or []:
            walk(part)

    walk(payload)
    if found.get("text/plain", "").strip():
        return found["text/plain"]
    if found.get("text/html"):
        return html_to_text(found["text/html"])
    return ""


def _parse(m: dict) -> dict:
    headers = {h["name"].lower(): h["value"] for h in m["payload"].get("headers", [])}
    name, addr = parseaddr(headers.get("from", ""))
    return {
        "id": m["id"], "thread_id": m["threadId"], "from_email": addr.lower(), "from_name": name,
        "subject": headers.get("subject", ""), "snippet": m.get("snippet", ""), "headers": headers,
        "body": _body_text(m["payload"])[:20000], "internal_date": int(m.get("internalDate", "0")),
        "message_id_header": headers.get("message-id", ""), "label_ids": m.get("labelIds", []),
    }


def thread_messages(session: Session, user: User, thread_id: str) -> list[dict]:
    """All messages in ONE thread Kold started. This is the only read path."""
    if _is_sandbox(user):
        return [dict(m) for m in sandbox_threads().get(thread_id, [])]
    svc = _service(session, user)
    t = svc.users().threads().get(userId="me", id=thread_id, format="full").execute()
    return [_parse(m) for m in t.get("messages", [])]


def messages_from(session: Session, user: User, senders: list[str], after_ts: int, skip_ids: set[str]) -> list[dict]:
    """New emails FROM the given addresses/domains (e.g. "hr@acme.com", "acme.com") since `after_ts`.
    Used to catch replies a company sends as a fresh email instead of in our thread."""
    if not senders:
        return []
    if _is_sandbox(user):
        out = []
        for msgs in sandbox_threads().values():
            for m in msgs:
                if m.get("to") != user.gmail_email or m["id"] in skip_ids or m.get("internal_date", 0) < after_ts * 1000:
                    continue
                frm = m.get("from_email", "")
                if any(frm == s or frm.endswith("@" + s) for s in senders):
                    out.append(dict(m))
        return out
    svc = _service(session, user)
    out = []
    for i in range(0, len(senders), 20):  # keep each search query short
        q = "(" + " OR ".join(f"from:{s}" for s in senders[i:i + 20]) + f") after:{after_ts} -in:sent -in:drafts -in:spam"
        listing = svc.users().messages().list(userId="me", q=q, maxResults=50).execute()
        for ref in listing.get("messages", []):
            if ref["id"] in skip_ids:
                continue
            out.append(_parse(svc.users().messages().get(userId="me", id=ref["id"], format="full").execute()))
    return out
