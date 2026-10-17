from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, get_prefs, limiter
from ..models import User, UserPreferences
from ..schemas import LoginIn, RefreshIn, RegisterIn, TokenOut
from ..services import jira as jira_svc
from ..security import (create_access_token, hash_password, issue_refresh_token, revoke_refresh_token,
                        rotate_refresh_token, verify_password)

router = APIRouter(prefix="/api/auth", tags=["auth"])

_DUMMY_HASH = hash_password("dummy-password-for-timing")


def user_out(db: Session, u: User) -> dict:
    p = get_prefs(db, u)
    return {"id": u.id, "email": u.email, "name": u.name, "timezone": p.timezone}


def token_response(db: Session, u: User, refresh: str) -> dict:
    return {"access_token": create_access_token(u.id), "refresh_token": refresh, "token_type": "bearer",
            "user": user_out(db, u)}


def _accept_invites(db: Session, u: User):
    """Pending Jira project invites become memberships; must never break sign-up/login."""
    try:
        with db.begin_nested():
            jira_svc.accept_invites(db, u)
    except Exception:
        import logging
        logging.getLogger(__name__).exception("accepting jira invites failed")


@router.post("/register", response_model=TokenOut, status_code=201)
@limiter.limit("10/minute")
def register(request: Request, body: RegisterIn, db: Session = Depends(get_db)):
    email = body.email.lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(409, "Email already registered")
    u = User(email=email, name=body.name, password_hash=hash_password(body.password))
    db.add(u)
    db.flush()
    db.add(UserPreferences(user_id=u.id, timezone=body.timezone))
    db.flush()
    _accept_invites(db, u)
    refresh = issue_refresh_token(db, u.id)
    db.commit()
    db.refresh(u)
    return token_response(db, u, refresh)


@router.post("/login", response_model=TokenOut)
@limiter.limit("10/minute")
def login(request: Request, body: LoginIn, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.email == body.email.lower()).first()
    ok = verify_password(body.password, u.password_hash if u else _DUMMY_HASH)
    if not u or not ok or not u.is_active:
        raise HTTPException(401, "Invalid email or password")
    _accept_invites(db, u)
    refresh = issue_refresh_token(db, u.id)
    db.commit()
    return token_response(db, u, refresh)


@router.post("/refresh", response_model=TokenOut)
@limiter.limit("30/minute")
def refresh(request: Request, body: RefreshIn, db: Session = Depends(get_db)):
    res = rotate_refresh_token(db, body.refresh_token)
    if not res:
        db.rollback()
        raise HTTPException(401, "Invalid or expired refresh token")
    uid, new = res
    u = db.get(User, uid)
    if not u or not u.is_active:
        db.rollback()
        raise HTTPException(401, "Invalid or expired refresh token")
    db.commit()
    return token_response(db, u, new)


@router.post("/logout")
def logout(body: RefreshIn, db: Session = Depends(get_db)):
    revoke_refresh_token(db, body.refresh_token)
    db.commit()
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return user_out(db, user)
