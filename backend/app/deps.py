from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models import User, UserPreferences
from .security import decode_access_token, utcnow

bearer = HTTPBearer(auto_error=False)


def get_current_user(cred: HTTPAuthorizationCredentials | None = Depends(bearer),
                     db: Session = Depends(get_db)) -> User:
    if cred is None:
        raise HTTPException(401, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    uid = decode_access_token(cred.credentials)
    user = db.get(User, uid) if uid else None
    if not user or not user.is_active:
        raise HTTPException(401, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    return user


def get_prefs(db: Session, user: User) -> UserPreferences:
    p = user.preferences
    if p is None:
        p = db.query(UserPreferences).filter_by(user_id=user.id).first()
    if p is None:
        p = UserPreferences(user_id=user.id, timezone="UTC")
        db.add(p)
        db.flush()
    return p


def get_tz(prefs) -> ZoneInfo:
    try:
        return ZoneInfo(prefs.timezone if prefs else "UTC")
    except Exception:
        return ZoneInfo("UTC")


def user_today(prefs) -> date:
    return datetime.now(get_tz(prefs)).date()


def user_now(prefs) -> datetime:
    return datetime.now(get_tz(prefs))


def current_prefs(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> UserPreferences:
    return get_prefs(db, user)


# ---- rate limiting (shared limiter; routers decorate endpoints, main wires middleware)
from slowapi import Limiter  # noqa: E402
from slowapi.util import get_remote_address  # noqa: E402

from .config import settings  # noqa: E402

limiter = Limiter(key_func=get_remote_address, default_limits=["600/minute"],
                  enabled=settings.RATE_LIMIT_ENABLED)
