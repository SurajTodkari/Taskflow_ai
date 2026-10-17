from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, get_prefs, user_today
from ..models import Task, User
from ..services import tasks as svc
from ..services.analytics import stats_for, tasks_by_day

router = APIRouter(tags=["dashboard"])


def _ser(db, tasks, today):
    return svc.serialize_tasks(db, tasks, today)


def today_view(db: Session, user: User, d: date, today: date) -> dict:
    """View of day d, with carry-forward relative to d (original dates are never modified)."""
    day = svc.day_tasks(db, user.id, d)
    carried = svc.carried_forward(db, user.id, d)
    overdue = svc.overdue_tasks(db, user.id, d)
    st = stats_for(day, d)
    return {
        "date": d.isoformat(),
        "today": {k: st[k] for k in ("total", "completed", "pending", "in_progress", "overdue", "productivity")},
        "tasks_today": _ser(db, day, today),
        "carried_forward": _ser(db, carried, today),
        "overdue": _ser(db, overdue, today),
    }


def tomorrow_view(db: Session, user: User, d: date, today: date) -> dict:
    nxt = d + timedelta(days=1)
    planned = [t for t in svc.day_tasks(db, user.id, nxt)]
    # carried into tomorrow: open tasks scheduled before tomorrow that are not closed (excluding those already planned)
    carried = svc.carried_forward(db, user.id, nxt)
    ids = {t.id for t in planned}
    carried = [t for t in carried if t.id not in ids]
    return {"date": nxt.isoformat(), "planned": _ser(db, planned, today), "carried": _ser(db, carried, today)}


@router.get("/api/dashboard")
def dashboard(date_: date | None = Query(None, alias="date"), user: User = Depends(get_current_user),
              db: Session = Depends(get_db)):
    prefs = get_prefs(db, user)
    real_today = user_today(prefs)
    d = date_ or real_today
    v = today_view(db, user, d, real_today)
    upcoming = (svc.base_query(db, user.id)
                .filter(Task.status.in_(svc.OPEN_STATUSES), Task.due_date >= d, Task.due_date <= d + timedelta(days=7))
                .order_by(Task.due_date, Task.id).limit(20).all())
    start = d - timedelta(days=6)
    by_day = tasks_by_day(db, user.id, start, d)
    weekly = []
    for i in range(7):
        x = start + timedelta(days=i)
        s = stats_for(by_day.get(x, []), real_today)
        weekly.append({"date": x.isoformat(), "total": s["total"], "completed": s["completed"],
                       "productivity": s["productivity"]})
    return {"now": datetime.now(timezone.utc).isoformat(), **v,
            "tomorrow": tomorrow_view(db, user, d, real_today),
            "upcoming_deadlines": _ser(db, upcoming, real_today), "weekly": weekly}


@router.get("/api/today")
def today(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    prefs = get_prefs(db, user)
    t = user_today(prefs)
    return today_view(db, user, t, t)


@router.get("/api/tomorrow")
def tomorrow(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    prefs = get_prefs(db, user)
    t = user_today(prefs)
    return tomorrow_view(db, user, t, t)
