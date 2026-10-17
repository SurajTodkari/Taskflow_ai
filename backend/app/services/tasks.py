"""Task domain helpers: semantics from SPEC.md live here (scheduled_date, effective_status, rollover queries)."""
import calendar as _cal
import logging
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session, selectinload

from ..models import (RecurringRule, Task, TaskActivity, TaskReminder, TimeEntry, User,
                      UserPreferences)

log = logging.getLogger(__name__)

OPEN_STATUSES = ("not_started", "in_progress", "on_hold")
CLOSED_STATUSES = ("completed", "cancelled")
BOARD_COLUMNS = ("backlog", "todo", "in_progress", "review", "completed")
PRIORITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}
DATE_FIELDS = ("start_date", "due_date", "start_time", "end_time")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def is_open(t: Task) -> bool:
    return t.status in OPEN_STATUSES


def scheduled_date(t: Task) -> date | None:
    return t.start_date or t.due_date


def effective_status(t: Task, today: date) -> str:
    if t.status in OPEN_STATUSES and t.due_date and t.due_date < today:
        return "overdue"
    return t.status


# ---------------------------------------------------------------- queries
def base_query(db: Session, user_id: int):
    return (db.query(Task).options(selectinload(Task.subtasks), selectinload(Task.checklist),
                                   selectinload(Task.attachments), selectinload(Task.project))
            .filter(Task.user_id == user_id))


def _sched_expr():
    return func.coalesce(Task.start_date, Task.due_date)


def day_tasks(db: Session, user_id: int, d: date) -> list[Task]:
    q = base_query(db, user_id).filter(or_(_sched_expr() == d, Task.queued_date == d))
    return q.order_by(Task.start_time.is_(None), Task.start_time, Task.id).all()


def carried_forward(db: Session, user_id: int, today: date) -> list[Task]:
    q = base_query(db, user_id).filter(
        Task.status.in_(OPEN_STATUSES),
        _sched_expr() < today,
        or_(Task.due_date.is_(None), Task.due_date >= today),
        or_(Task.queued_date.is_(None), Task.queued_date != today))
    return q.order_by(_sched_expr(), Task.id).all()


def overdue_tasks(db: Session, user_id: int, today: date) -> list[Task]:
    q = base_query(db, user_id).filter(Task.status.in_(OPEN_STATUSES), Task.due_date < today)
    return q.order_by(Task.due_date, Task.id).all()


def get_user_task(db: Session, user_id: int, task_id: int) -> Task | None:
    return base_query(db, user_id).filter(Task.id == task_id).first()


# ---------------------------------------------------------------- serialization
def tracked_map(db: Session, task_ids: list[int]) -> dict[int, int]:
    if not task_ids:
        return {}
    now = utcnow()
    out: dict[int, int] = {}
    for e in db.query(TimeEntry).filter(TimeEntry.task_id.in_(task_ids)).all():
        secs = e.seconds or 0
        if e.ended_at is None:
            secs = max(0, int((now - aware(e.started_at)).total_seconds()))
        out[e.task_id] = out.get(e.task_id, 0) + secs
    return out


def serialize_task(t: Task, today: date, tracked: int = 0) -> dict:
    p = t.project
    return {
        "id": t.id, "title": t.title, "description": t.description,
        "project_id": t.project_id, "project_name": p.name if p else None,
        "project_color": p.color if p else None,
        "category": t.category, "priority": t.priority, "status": t.status,
        "effective_status": effective_status(t, today), "board_column": t.board_column,
        "start_date": t.start_date, "due_date": t.due_date,
        "start_time": t.start_time, "end_time": t.end_time,
        "estimated_minutes": t.estimated_minutes, "reminder_at": aware(t.reminder_at),
        "tags": t.tags or [], "notes": t.notes, "queued_date": t.queued_date,
        "reschedule_count": t.reschedule_count, "completed_at": aware(t.completed_at),
        "recurrence_rule_id": t.recurrence_rule_id,
        "subtasks": [{"id": s.id, "title": s.title, "done": s.done} for s in t.subtasks],
        "checklist": [{"id": c.id, "title": c.title, "done": c.done} for c in t.checklist],
        "attachments": [{"id": a.id, "filename": a.filename, "size": a.size} for a in t.attachments],
        "created_at": aware(t.created_at), "updated_at": aware(t.updated_at),
        "tracked_seconds": tracked,
    }


def serialize_tasks(db: Session, tasks: list[Task], today: date) -> list[dict]:
    tm = tracked_map(db, [t.id for t in tasks])
    return [serialize_task(t, today, tm.get(t.id, 0)) for t in tasks]


# ---------------------------------------------------------------- activity / events
def log_activity(db: Session, task_id: int, user_id: int, action: str, detail: dict | None = None):
    db.add(TaskActivity(task_id=task_id, user_id=user_id, action=action, detail=detail or {}))


def publish_change(user_id: int, entity: str = "tasks") -> None:
    """Best-effort live 'changed' event for the websocket router (owned by another module)."""
    try:
        from ..routers import ws  # type: ignore
        fn = getattr(ws, "notify_changed", None)
        if fn:
            fn(user_id, entity)
    except Exception:  # pragma: no cover
        pass


def _jsonable(v):
    if isinstance(v, (date, datetime, time)):
        return v.isoformat()
    return v


# ---------------------------------------------------------------- board <-> status sync
def sync_board_from_status(t: Task) -> None:
    if t.status == "completed":
        t.board_column = "completed"
    elif t.status == "in_progress":
        if t.board_column not in ("in_progress", "review"):
            t.board_column = "in_progress"
    elif t.status in ("not_started", "on_hold"):
        if t.board_column in ("completed", "in_progress", "review"):
            t.board_column = "todo"
    # cancelled: column left as is


def apply_board_column(t: Task, col: str) -> None:
    t.board_column = col
    if col == "completed":
        set_status(t, "completed")
    elif col in ("in_progress", "review"):
        if t.status != "in_progress":
            set_status(t, "in_progress")
    else:  # backlog / todo
        if t.status in ("completed", "cancelled", "in_progress"):
            set_status(t, "not_started")


def set_status(t: Task, status: str) -> None:
    prev = t.status
    t.status = status
    if status == "completed":
        if prev != "completed":
            t.completed_at = utcnow()
    else:
        t.completed_at = None


# ---------------------------------------------------------------- reminders
def _local_to_utc(d: date, tm: time, tz: ZoneInfo) -> datetime:
    return datetime.combine(d, tm).replace(tzinfo=tz).astimezone(timezone.utc)


def sync_reminders(db: Session, task: Task, prefs: UserPreferences) -> None:
    """Rebuild pending custom/default reminders from reminder_at, start_time and default minutes."""
    db.query(TaskReminder).filter(TaskReminder.task_id == task.id, TaskReminder.status != "sent",
                                  TaskReminder.kind.in_(("custom", "default"))).delete(synchronize_session=False)
    db.flush()
    if not is_open(task):
        return
    try:
        tz = ZoneInfo(prefs.timezone)
    except Exception:
        tz = ZoneInfo("UTC")
    wanted: list[tuple[str, datetime]] = []
    if task.reminder_at:
        wanted.append(("custom", aware(task.reminder_at)))
    sd = scheduled_date(task)
    if sd and task.start_time and prefs.default_reminder_minutes and prefs.default_reminder_minutes > 0:
        at = _local_to_utc(sd, task.start_time, tz) - timedelta(minutes=prefs.default_reminder_minutes)
        if not task.reminder_at or abs((at - aware(task.reminder_at)).total_seconds()) >= 60:
            wanted.append(("default", at))
    for kind, at in wanted:
        exists = db.query(TaskReminder).filter(TaskReminder.task_id == task.id, TaskReminder.kind == kind,
                                               TaskReminder.remind_at == at).first()
        if not exists:
            db.add(TaskReminder(task_id=task.id, user_id=task.user_id, kind=kind, remind_at=at,
                                status="pending"))
    db.flush()


def resync_user_reminders(db: Session, user_id: int, prefs: UserPreferences) -> None:
    for t in db.query(Task).filter(Task.user_id == user_id, Task.status.in_(OPEN_STATUSES)).all():
        sync_reminders(db, t, prefs)


# ---------------------------------------------------------------- create / update
WRITABLE = ("title", "description", "project_id", "category", "priority", "status", "board_column",
            "start_date", "due_date", "start_time", "end_time", "estimated_minutes", "reminder_at",
            "tags", "notes")


class TaskError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code, self.detail = status_code, detail


def _check_project(db: Session, user_id: int, project_id: int | None):
    if project_id is None:
        return
    from ..models import Project
    if not db.query(Project).filter_by(id=project_id, user_id=user_id).first():
        raise TaskError(404, "Project not found")


def _norm_reminder(dt: datetime | None, prefs) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        try:
            dt = dt.replace(tzinfo=ZoneInfo(prefs.timezone))
        except Exception:
            dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def create_task(db: Session, user: User, prefs: UserPreferences, data: dict) -> Task:
    rec = data.pop("recurrence", None)
    _check_project(db, user.id, data.get("project_id"))
    fields = {k: data[k] for k in WRITABLE if k in data}
    fields["reminder_at"] = _norm_reminder(fields.get("reminder_at"), prefs)
    board = fields.pop("board_column", None)
    t = Task(user_id=user.id, **fields)
    t.board_column = "todo"
    if board and t.status == "not_started":
        apply_board_column(t, board)
    else:
        sync_board_from_status(t)
    if t.status == "completed":
        t.completed_at = utcnow()
        t.board_column = "completed"
    db.add(t)
    db.flush()
    log_activity(db, t.id, user.id, "created", {"title": t.title})
    if rec:
        set_recurrence(db, user, prefs, t, rec)
    sync_reminders(db, t, prefs)
    return t


def update_task(db: Session, user: User, prefs: UserPreferences, t: Task, data: dict, today: date) -> Task:
    rec_given = "recurrence" in data
    rec = data.pop("recurrence", None)
    if "project_id" in data:
        _check_project(db, user.id, data["project_id"])
    if "reminder_at" in data:
        data["reminder_at"] = _norm_reminder(data["reminder_at"], prefs)
    # cross-field validation with existing values
    sd = data.get("start_date", t.start_date)
    dd = data.get("due_date", t.due_date)
    if sd and dd and dd < sd:
        raise TaskError(422, "due_date must be on or after start_date")
    st = data.get("start_time", t.start_time)
    et = data.get("end_time", t.end_time)
    if st and et and et <= st:
        raise TaskError(422, "end_time must be after start_time")
    for nn in ("title", "priority", "status"):
        if nn in data and data[nn] is None:
            raise TaskError(422, f"{nn} cannot be null")

    changes, resched = {}, {}
    old_status = t.status
    board_in = data.pop("board_column", None)
    for k in WRITABLE:
        if k in data and k != "board_column":
            old, new = getattr(t, k), data[k]
            if k == "reminder_at":
                same = aware(old) == aware(new)
            else:
                same = old == new
            if same:
                continue
            if k in DATE_FIELDS:
                resched[k] = [_jsonable(old), _jsonable(new)]
            else:
                changes[k] = [_jsonable(old), _jsonable(new)] if k not in ("description", "notes") else "changed"
            if k == "status":
                set_status(t, new)
            else:
                setattr(t, k, new)
    if t.status != old_status:
        sync_board_from_status(t)
    if board_in and board_in != t.board_column:
        prev = t.board_column
        apply_board_column(t, board_in)
        changes["board_column"] = [prev, board_in]
    if t.status != old_status:
        action = "completed" if t.status == "completed" else (
            "reopened" if old_status in CLOSED_STATUSES and t.status in OPEN_STATUSES else "status_changed")
        log_activity(db, t.id, user.id, action, {"from": old_status, "to": t.status})
    if resched:
        had_previous = any(v[0] is not None for v in resched.values())
        if had_previous:
            t.reschedule_count = (t.reschedule_count or 0) + 1
        log_activity(db, t.id, user.id, "rescheduled", resched)
    other = {k: v for k, v in changes.items() if k != "status"}
    if other:
        log_activity(db, t.id, user.id, "updated", other)
    if rec_given:
        set_recurrence(db, user, prefs, t, rec)
    t.updated_at = utcnow()
    db.flush()
    sync_reminders(db, t, prefs)
    return t


def complete_task(db: Session, user: User, prefs, t: Task) -> Task:
    if t.status != "completed":
        old = t.status
        set_status(t, "completed")
        t.board_column = "completed"
        log_activity(db, t.id, user.id, "completed", {"from": old, "to": "completed"})
        sync_reminders(db, t, prefs)
    return t


def reschedule_task(db: Session, user: User, prefs, t: Task, data: dict) -> Task:
    patch = {k: v for k, v in data.items() if v is not None and k in DATE_FIELDS}
    if not patch:
        raise TaskError(422, "Provide at least one of start_date, due_date, start_time, end_time")
    from ..deps import user_today
    return update_task(db, user, prefs, t, patch, user_today(prefs))


def add_to_today(db: Session, user: User, t: Task, today: date) -> Task:
    if t.status not in OPEN_STATUSES:
        raise TaskError(409, "Only open tasks can be added to today")
    t.queued_date = today
    log_activity(db, t.id, user.id, "queued_today", {"date": today.isoformat()})
    return t


def duplicate_task(db: Session, user: User, prefs, t: Task) -> Task:
    n = Task(user_id=user.id, project_id=t.project_id, title=(t.title + " (copy)")[:200],
             description=t.description, category=t.category, priority=t.priority, status="not_started",
             board_column="todo", start_date=t.start_date, due_date=t.due_date, start_time=t.start_time,
             end_time=t.end_time, estimated_minutes=t.estimated_minutes, reminder_at=t.reminder_at,
             tags=list(t.tags or []), notes=t.notes)
    db.add(n)
    db.flush()
    from ..models import ChecklistItem, Subtask
    for s in t.subtasks:
        db.add(Subtask(task_id=n.id, title=s.title, done=False))
    for c in t.checklist:
        db.add(ChecklistItem(task_id=n.id, title=c.title, done=False))
    log_activity(db, n.id, user.id, "created", {"duplicated_from": t.id})
    db.flush()
    sync_reminders(db, n, prefs)
    return n


# ---------------------------------------------------------------- recurrence
def _template_from_task(t: Task) -> dict:
    span = (t.due_date - t.start_date).days if t.start_date and t.due_date else 0
    return {"title": t.title, "description": t.description, "project_id": t.project_id,
            "category": t.category, "priority": t.priority, "tags": list(t.tags or []),
            "start_time": t.start_time.isoformat() if t.start_time else None,
            "end_time": t.end_time.isoformat() if t.end_time else None,
            "estimated_minutes": t.estimated_minutes, "notes": t.notes, "span_days": span,
            "has_start": t.start_date is not None, "has_due": t.due_date is not None}


def set_recurrence(db: Session, user: User, prefs, t: Task, rec) -> None:
    rule = db.get(RecurringRule, t.recurrence_rule_id) if t.recurrence_rule_id else None
    if rec is None:
        if rule:
            rule.active = False
        return
    r = rec if isinstance(rec, dict) else rec.model_dump()
    start = scheduled_date(t) or user_today_for(prefs)
    if rule is None:
        rule = RecurringRule(user_id=user.id, freq=r["freq"], interval=r.get("interval", 1),
                             by_weekday=r.get("by_weekday") or [], start_date=start,
                             end_date=r.get("end_date"), template=_template_from_task(t),
                             template_task_id=t.id)
        db.add(rule)
        db.flush()
        t.recurrence_rule_id = rule.id
        t.occurrence_date = start
    else:
        rule.freq, rule.interval = r["freq"], r.get("interval", 1)
        rule.by_weekday, rule.end_date = r.get("by_weekday") or [], r.get("end_date")
        rule.template = _template_from_task(t)
        rule.active = True
    db.flush()


def user_today_for(prefs) -> date:
    try:
        return datetime.now(ZoneInfo(prefs.timezone)).date()
    except Exception:
        return datetime.now(timezone.utc).date()


def _add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    y, mo = d.year + m // 12, m % 12 + 1
    return date(y, mo, 1)


def occurrence_dates(rule: RecurringRule, until: date) -> list[date]:
    start, end = rule.start_date, min(until, rule.end_date) if rule.end_date else until
    out: list[date] = []
    iv = max(1, rule.interval or 1)
    if rule.freq == "daily":
        d = start
        while d <= end:
            out.append(d)
            d += timedelta(days=iv)
    elif rule.freq == "weekly":
        days = rule.by_weekday or [start.weekday()]
        week0 = start - timedelta(days=start.weekday())
        d = start
        while d <= end:
            weeks = ((d - timedelta(days=d.weekday())) - week0).days // 7
            if weeks % iv == 0 and d.weekday() in days:
                out.append(d)
            d += timedelta(days=1)
    elif rule.freq == "monthly":
        i = 0
        while True:
            first = _add_months(start.replace(day=1), i * iv)
            if first > end:
                break
            day = min(start.day, _cal.monthrange(first.year, first.month)[1])
            d = first.replace(day=day)
            if start <= d <= end:
                out.append(d)
            i += 1
    return out


def materialize_rules(db: Session, user_id: int | None = None, days_ahead: int = 30) -> int:
    """Create Task rows for upcoming occurrences. Idempotent (unique rule+occurrence_date). Returns created count."""
    q = db.query(RecurringRule).filter(RecurringRule.active.is_(True))
    if user_id is not None:
        q = q.filter(RecurringRule.user_id == user_id)
    created = 0
    prefs_cache: dict[int, UserPreferences | None] = {}
    for rule in q.all():
        if rule.user_id not in prefs_cache:
            prefs_cache[rule.user_id] = db.query(UserPreferences).filter_by(user_id=rule.user_id).first()
        prefs = prefs_cache[rule.user_id]
        today = user_today_for(prefs) if prefs else datetime.now(timezone.utc).date()
        until = today + timedelta(days=days_ahead)
        dates = occurrence_dates(rule, until)
        if not dates:
            continue
        existing = {r[0] for r in db.query(Task.occurrence_date).filter(
            Task.recurrence_rule_id == rule.id, Task.occurrence_date.isnot(None)).all()}
        tpl = rule.template or {}
        for d in dates:
            if d in existing:
                continue
            span = tpl.get("span_days", 0) or 0
            has_start = tpl.get("has_start", True)
            has_due = tpl.get("has_due", True)
            sd = d if has_start or not has_due else None
            dd = (d + timedelta(days=span)) if has_due else None
            if has_due and not has_start:
                dd = d
            t = Task(user_id=rule.user_id, project_id=tpl.get("project_id"), title=tpl.get("title", "Task"),
                     description=tpl.get("description"), category=tpl.get("category"),
                     priority=tpl.get("priority", "medium"), status="not_started", board_column="todo",
                     start_date=sd, due_date=dd,
                     start_time=time.fromisoformat(tpl["start_time"]) if tpl.get("start_time") else None,
                     end_time=time.fromisoformat(tpl["end_time"]) if tpl.get("end_time") else None,
                     estimated_minutes=tpl.get("estimated_minutes"), tags=tpl.get("tags", []),
                     notes=tpl.get("notes"), recurrence_rule_id=rule.id, occurrence_date=d)
            try:
                with db.begin_nested():
                    db.add(t)
                    db.flush()
                    log_activity(db, t.id, rule.user_id, "created", {"recurring": True})
                    if prefs:
                        sync_reminders(db, t, prefs)
                created += 1
            except Exception as e:  # unique race -> already created elsewhere
                log.warning("materialize skip rule=%s date=%s: %s", rule.id, d, e)
    db.commit()
    return created
