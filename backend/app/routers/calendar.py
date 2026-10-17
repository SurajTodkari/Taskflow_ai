from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, get_prefs, user_today
from ..models import Task, User
from ..services import tasks as svc

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


@router.get("")
def calendar(start: date, end: date, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if end < start:
        raise HTTPException(422, "end must be on or after start")
    if (end - start).days > 400:
        raise HTTPException(422, "range too large")
    today = user_today(get_prefs(db, user))
    q = svc.base_query(db, user.id).filter(or_(
        Task.start_date.between(start, end), Task.due_date.between(start, end),
        and_(Task.start_date <= start, Task.due_date >= end)))
    tasks = q.order_by(Task.start_date, Task.start_time, Task.id).limit(2000).all()
    return svc.serialize_tasks(db, tasks, today)
