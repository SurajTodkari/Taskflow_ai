"""Web Push via pywebpush. No-op when VAPID is not configured."""
import json
import logging

from sqlalchemy.orm import Session

from ..config import settings
from ..models import PushSubscription

log = logging.getLogger(__name__)


def push_configured() -> bool:
    return bool(settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY)


def send_push(db: Session, user_id: int, payload: dict) -> int:
    """Send to all of the user's subscriptions. Returns number delivered. Removes dead (404/410) subscriptions."""
    if not push_configured():
        return 0
    subs = db.query(PushSubscription).filter_by(user_id=user_id).all()
    if not subs:
        return 0
    try:
        from pywebpush import WebPushException, webpush
    except Exception:  # pragma: no cover
        return 0
    sent = 0
    for s in subs:
        try:
            webpush(
                subscription_info={"endpoint": s.endpoint, "keys": {"p256dh": s.p256dh, "auth": s.auth}},
                data=json.dumps(payload),
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_SUBJECT},
                ttl=3600,
            )
            sent += 1
            s.failures = 0
        except WebPushException as e:
            code = getattr(getattr(e, "response", None), "status_code", None)
            if code in (404, 410):
                db.delete(s)
            else:
                s.failures = (s.failures or 0) + 1
                if s.failures >= 10:
                    db.delete(s)
            log.warning("push failed user=%s code=%s", user_id, code)
        except Exception as e:
            s.failures = (s.failures or 0) + 1
            log.warning("push error user=%s: %s", user_id, e)
    try:
        db.flush()
    except Exception:  # pragma: no cover
        pass
    return sent
