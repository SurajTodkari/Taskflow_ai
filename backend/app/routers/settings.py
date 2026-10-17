from datetime import time

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, get_prefs
from ..models import User
from ..schemas import SettingsUpdate
from ..services import tasks as svc

router = APIRouter(prefix="/api/settings", tags=["settings"])

TIME_FIELDS = ("morning_time", "evening_time", "tomorrow_time", "work_start", "work_end")
PLAIN = ("timezone", "default_reminder_minutes", "theme", "weekend_days", "notify_morning", "notify_evening",
         "notify_tomorrow", "notify_reminders", "notify_overdue", "recurring_defaults")


def settings_out(user: User, p) -> dict:
    out = {"name": user.name}
    for k in PLAIN:
        out[k] = getattr(p, k)
    for k in TIME_FIELDS:
        out[k] = getattr(p, k).strftime("%H:%M")
    return out


@router.get("")
def get_settings(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = get_prefs(db, user)
    db.commit()
    return settings_out(user, p)


@router.patch("")
def patch_settings(body: SettingsUpdate, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    p = get_prefs(db, user)
    data = body.model_dump(exclude_unset=True)
    resync = False
    if data.get("name"):
        user.name = data.pop("name").strip()
    data.pop("name", None)
    for k in TIME_FIELDS:
        if data.get(k) is not None:
            h, m = data[k].split(":")
            setattr(p, k, time(int(h), int(m)))
        data.pop(k, None)
    for k, v in data.items():
        if v is None:
            continue
        if k in ("timezone", "default_reminder_minutes") and getattr(p, k) != v:
            resync = True
        setattr(p, k, v)
    db.flush()
    if resync:
        svc.resync_user_reminders(db, user.id, p)
    db.commit()
    return settings_out(user, p)
