import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from sqlalchemy.orm import Session

from .config import settings

ALGO = "HS256"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode()[:72], hashed.encode())
    except Exception:
        return False


def create_access_token(user_id: int) -> str:
    now = utcnow()
    payload = {"sub": str(user_id), "type": "access", "iat": now,
               "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_MINUTES)}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGO)


def decode_access_token(token: str) -> int | None:
    try:
        data = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGO])
        if data.get("type") != "access":
            return None
        return int(data["sub"])
    except Exception:
        return None


def _hash_token(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


def issue_refresh_token(db: Session, user_id: int) -> str:
    from .models import RefreshToken
    raw = secrets.token_urlsafe(48)
    db.add(RefreshToken(user_id=user_id, token_hash=_hash_token(raw),
                        expires_at=utcnow() + timedelta(days=settings.REFRESH_TOKEN_DAYS)))
    db.flush()
    return raw


def rotate_refresh_token(db: Session, raw: str):
    """Returns (user_id, new_raw) or None. Old token is revoked; reuse of a revoked token revokes all."""
    from .models import RefreshToken
    rt = db.query(RefreshToken).filter(RefreshToken.token_hash == _hash_token(raw)).first()
    if not rt:
        return None
    if rt.revoked_at is not None:
        # reuse detection
        db.query(RefreshToken).filter(RefreshToken.user_id == rt.user_id,
                                      RefreshToken.revoked_at.is_(None)).update({"revoked_at": utcnow()})
        db.commit()
        return None
    exp = rt.expires_at if rt.expires_at.tzinfo else rt.expires_at.replace(tzinfo=timezone.utc)
    if exp < utcnow():
        return None
    rt.revoked_at = utcnow()
    new = issue_refresh_token(db, rt.user_id)
    return rt.user_id, new


def revoke_refresh_token(db: Session, raw: str) -> None:
    from .models import RefreshToken
    rt = db.query(RefreshToken).filter(RefreshToken.token_hash == _hash_token(raw)).first()
    if rt and rt.revoked_at is None:
        rt.revoked_at = utcnow()
