"""Activity log + notifications. Everything Kold does for a user is written here first."""
import json
import logging

from sqlmodel import Session, select

from ..config import settings
from ..models import Activity, PushSubscription

log = logging.getLogger(__name__)


def record(session: Session, user_id: int, kind: str, message: str, push: bool = False, url: str = "/", **ref) -> Activity:
    a = Activity(user_id=user_id, kind=kind, message=message, ref={**ref, "url": url})
    session.add(a)
    session.commit()
    if push:
        _push(session, user_id, message, url)
    return a


def _push(session: Session, user_id: int, message: str, url: str) -> None:
    if not (settings.vapid_private_key and settings.vapid_public_key):
        return
    from pywebpush import WebPushException, webpush

    for sub in session.exec(select(PushSubscription).where(PushSubscription.user_id == user_id)):
        try:
            webpush(sub.data, json.dumps({"title": "Kold", "body": message, "url": url}),
                    vapid_private_key=settings.vapid_private_key, vapid_claims={"sub": settings.vapid_subject})
        except WebPushException as e:
            if e.response is not None and e.response.status_code in (404, 410):
                session.delete(sub)
                session.commit()
            else:
                log.info("push failed: %s", e)
