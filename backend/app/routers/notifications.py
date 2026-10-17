from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..models import Notification, PushSubscription, User
from ..services.notifications import create_notification
from ..services.push import push_configured

router = APIRouter(prefix="/api", tags=["notifications"])


class Keys(BaseModel):
    p256dh: str
    auth: str


class SubscribeIn(BaseModel):
    endpoint: str
    keys: Keys


class UnsubscribeIn(BaseModel):
    endpoint: str


def _out(n: Notification) -> dict:
    ca = n.created_at if n.created_at.tzinfo else n.created_at.replace(tzinfo=timezone.utc)
    return {"id": n.id, "type": n.type, "title": n.title, "body": n.body, "data": n.data or {},
            "read": n.read_at is not None, "read_at": n.read_at, "created_at": ca}


@router.get("/notifications")
def list_notifications(unread_only: bool = False, limit: int = 50, user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    q = db.query(Notification).filter(Notification.user_id == user.id)
    if unread_only:
        q = q.filter(Notification.read_at.is_(None))
    return [_out(n) for n in q.order_by(Notification.id.desc()).limit(max(1, min(limit, 200))).all()]


@router.get("/notifications/unread-count")
def unread_count(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None)).count()
    return {"count": c}


@router.post("/notifications/read-all")
def read_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    n = (db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None))
         .update({"read_at": datetime.now(timezone.utc)}, synchronize_session=False))
    db.commit()
    return {"updated": n}


@router.post("/notifications/test")
def test_notification(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    n = create_notification(db, user.id, "test", "Test notification", "Notifications are working.",
                            {"test": True}, dedupe_key=f"test:{datetime.now(timezone.utc).timestamp()}")
    db.commit()
    return {"ok": True, "notification": _out(n) if n else None, "push_configured": push_configured()}


@router.post("/notifications/{nid}/read")
def mark_read(nid: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    n = db.query(Notification).filter_by(id=nid, user_id=user.id).first()
    if not n:
        raise HTTPException(404, "Notification not found")
    if n.read_at is None:
        n.read_at = datetime.now(timezone.utc)
        db.commit()
    return _out(n)


@router.get("/push/public-key")
def public_key():
    return {"public_key": settings.VAPID_PUBLIC_KEY or None, "enabled": push_configured()}


@router.post("/push/subscribe")
def subscribe(body: SubscribeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = db.query(PushSubscription).filter_by(endpoint=body.endpoint).first()
    if s:
        s.user_id, s.p256dh, s.auth, s.failures = user.id, body.keys.p256dh, body.keys.auth, 0
    else:
        db.add(PushSubscription(user_id=user.id, endpoint=body.endpoint, p256dh=body.keys.p256dh,
                                auth=body.keys.auth))
    db.commit()
    return {"ok": True}


@router.post("/push/unsubscribe")
def unsubscribe(body: UnsubscribeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(PushSubscription).filter_by(endpoint=body.endpoint, user_id=user.id).delete()
    db.commit()
    return {"ok": True}
