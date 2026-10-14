import secrets

from fastapi import Cookie, Depends, HTTPException, Response
from sqlmodel import Session, select

from .db import get_session
from .models import User

COOKIE = "kold_session"


def current_user(kold_session: str | None = Cookie(default=None), session: Session = Depends(get_session)) -> User:
    if not kold_session:
        raise HTTPException(401, "Not signed in")
    user = session.exec(select(User).where(User.session_token == kold_session)).first()
    if not user:
        raise HTTPException(401, "Session expired")
    return user


def create_user(session: Session, response: Response) -> User:
    user = User(session_token=secrets.token_urlsafe(32))
    session.add(user)
    session.commit()
    session.refresh(user)
    set_session_cookie(response, user.session_token)
    return user


def set_session_cookie(response: Response, token: str) -> None:
    from .config import settings

    response.set_cookie(COOKIE, token, httponly=True, samesite="lax", secure=settings.cookie_secure, max_age=60 * 60 * 24 * 365)
