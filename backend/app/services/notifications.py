"""Create in-app notifications (deduped by unique key) and fan out Web Push + live event."""
import logging

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Notification
from . import push, realtime

log = logging.getLogger(__name__)


def notification_exists(db: Session, user_id: int, dedupe_key: str) -> bool:
    return db.query(Notification.id).filter_by(user_id=user_id, dedupe_key=dedupe_key).first() is not None


def create_notification(db: Session, user_id: int, type: str, title: str, body: str | None = None,
                        data: dict | None = None, dedupe_key: str | None = None,
                        send_push: bool = True) -> Notification | None:
    """Returns the new Notification, or None when dedupe_key already used. Commits nothing (flush only)."""
    import uuid
    key = dedupe_key or f"{type}:{uuid.uuid4().hex}"
    n = Notification(user_id=user_id, type=type, title=title[:200], body=body, data=data or {}, dedupe_key=key)
    try:
        with db.begin_nested():
            db.add(n)
            db.flush()
    except IntegrityError:
        return None
    if send_push:
        try:
            push.send_push(db, user_id, {"title": n.title, "body": body or "", "type": type,
                                         "data": data or {}, "id": n.id, "tag": key})
        except Exception as e:  # push is best effort; in-app notification already stored
            log.warning("push failed: %s", e)
    realtime.broadcast(user_id, {"type": "notification", "id": n.id})
    return n
