import os
import re
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_current_user, get_prefs, user_today
from ..models import (ChecklistItem, Subtask, Task, TaskActivity, TaskAttachment, TaskComment, TimeEntry, User)
from ..schemas import (BoardIn, CommentIn, ItemIn, ItemUpdate, RescheduleIn, TaskCreate, TaskUpdate)
from ..security import utcnow
from ..services import tasks as svc

router = APIRouter(prefix="/api", tags=["tasks"])

ALLOWED_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".txt", ".md", ".csv", ".json", ".doc", ".docx",
               ".xls", ".xlsx", ".ppt", ".pptx", ".zip"}


def _task_or_404(db: Session, user: User, task_id: int) -> Task:
    t = svc.get_user_task(db, user.id, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    return t


def _out(db: Session, user: User, t: Task):
    p = get_prefs(db, user)
    return svc.serialize_tasks(db, [t], user_today(p))[0]


def _run(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except svc.TaskError as e:
        raise HTTPException(e.status_code, e.detail)


def _commit_out(db: Session, user: User, t: Task):
    db.commit()
    db.expire_all()
    t = _task_or_404(db, user, t.id)
    svc.publish_change(user.id, "tasks")
    return _out(db, user, t)


# ------------------------------------------------------------------ list / CRUD
@router.get("/tasks")
def list_tasks(response: Response, search: str | None = None, status: str | None = None,
               priority: str | None = None, project_id: int | None = None, category: str | None = None,
               tag: str | None = None, date_from: date | None = None, date_to: date | None = None,
               sort: str = Query("created_at", pattern="^(due_date|priority|created_at|title)$"),
               order: str = Query("desc", pattern="^(asc|desc)$"),
               limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0),
               user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = get_prefs(db, user)
    today = user_today(p)
    q = svc.base_query(db, user.id)
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(or_(Task.title.ilike(like), Task.description.ilike(like), Task.notes.ilike(like)))
    if status:
        conds = []
        for s in [x.strip() for x in status.split(",") if x.strip()]:
            if s == "overdue":
                conds.append((Task.status.in_(svc.OPEN_STATUSES)) & (Task.due_date < today))
            elif s in ("not_started", "in_progress", "on_hold", "completed", "cancelled"):
                conds.append(Task.status == s)
            else:
                raise HTTPException(422, f"Invalid status '{s}'")
        q = q.filter(or_(*conds))
    if priority:
        q = q.filter(Task.priority.in_([x.strip() for x in priority.split(",")]))
    if project_id is not None:
        q = q.filter(Task.project_id == project_id)
    if category:
        q = q.filter(Task.category == category)
    sched = func.coalesce(Task.start_date, Task.due_date)
    if date_from:
        q = q.filter(or_(sched >= date_from, Task.due_date >= date_from, Task.queued_date >= date_from))
    if date_to:
        q = q.filter(or_(sched <= date_to, Task.queued_date <= date_to))
    desc = order == "desc"
    if sort == "due_date":
        col = Task.due_date.desc() if desc else Task.due_date.asc()
        q = q.order_by(Task.due_date.is_(None), col, Task.id)
    elif sort == "priority":
        rank = case(*[(Task.priority == k, v) for k, v in svc.PRIORITY_RANK.items()], else_=9)
        q = q.order_by(rank.desc() if desc else rank.asc(), Task.id)
    elif sort == "title":
        q = q.order_by(func.lower(Task.title).desc() if desc else func.lower(Task.title).asc(), Task.id)
    else:
        q = q.order_by(Task.created_at.desc() if desc else Task.created_at.asc(), Task.id.desc() if desc else Task.id)
    if tag:
        rows = [t for t in q.all() if tag in (t.tags or [])]
        total = len(rows)
        rows = rows[offset:offset + limit]
    else:
        total = q.count()
        rows = q.limit(limit).offset(offset).all()
    response.headers["X-Total-Count"] = str(total)
    return svc.serialize_tasks(db, rows, today)


@router.post("/tasks", status_code=201)
def create_task(body: TaskCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = get_prefs(db, user)
    data = body.model_dump(exclude_unset=True)
    t = _run(svc.create_task, db, user, p, data)
    out = _commit_out(db, user, t)
    return out


@router.get("/tasks/{task_id}")
def get_task(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _out(db, user, _task_or_404(db, user, task_id))


@router.patch("/tasks/{task_id}")
def patch_task(task_id: int, body: TaskUpdate, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    t = _task_or_404(db, user, task_id)
    p = get_prefs(db, user)
    data = body.model_dump(exclude_unset=True)
    _run(svc.update_task, db, user, p, t, data, user_today(p))
    return _commit_out(db, user, t)


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = _task_or_404(db, user, task_id)
    files = [a.stored_name for a in t.attachments]
    if t.recurrence_rule_id and t.occurrence_date:
        # keep the occurrence row as cancelled so the recurrence materializer never recreates it
        svc.set_status(t, "cancelled")
        svc.log_activity(db, t.id, user.id, "status_changed", {"to": "cancelled", "reason": "deleted occurrence"})
    else:
        db.delete(t)
    db.commit()
    for f in files:
        try:
            os.remove(os.path.join(settings.UPLOAD_DIR, f))
        except OSError:
            pass
    svc.publish_change(user.id, "tasks")
    return Response(status_code=204)


@router.post("/tasks/{task_id}/duplicate", status_code=201)
def duplicate(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = _task_or_404(db, user, task_id)
    n = svc.duplicate_task(db, user, get_prefs(db, user), t)
    return _commit_out(db, user, n)


@router.post("/tasks/{task_id}/complete")
def complete(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = _task_or_404(db, user, task_id)
    svc.complete_task(db, user, get_prefs(db, user), t)
    return _commit_out(db, user, t)


@router.post("/tasks/{task_id}/reschedule")
def reschedule(task_id: int, body: RescheduleIn, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    t = _task_or_404(db, user, task_id)
    _run(svc.reschedule_task, db, user, get_prefs(db, user), t, body.model_dump(exclude_unset=True))
    return _commit_out(db, user, t)


@router.post("/tasks/{task_id}/add-to-today")
def add_to_today(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = _task_or_404(db, user, task_id)
    _run(svc.add_to_today, db, user, t, user_today(get_prefs(db, user)))
    return _commit_out(db, user, t)


@router.patch("/tasks/{task_id}/board")
def board(task_id: int, body: BoardIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = _task_or_404(db, user, task_id)
    _run(svc.update_task, db, user, get_prefs(db, user), t, {"board_column": body.board_column},
         user_today(get_prefs(db, user)))
    return _commit_out(db, user, t)


# ------------------------------------------------------------------ subtasks / checklist
def _item_routes(path: str, Model, label: str):
    @router.post(f"/tasks/{{task_id}}/{path}", status_code=201, name=f"add_{label}")
    def add(task_id: int, body: ItemIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        t = _task_or_404(db, user, task_id)
        db.add(Model(task_id=t.id, title=body.title.strip()))
        svc.log_activity(db, t.id, user.id, f"{label}_added", {"title": body.title.strip()})
        return _commit_out(db, user, t)

    def _get(db, user, iid):
        item = db.get(Model, iid)
        if not item:
            raise HTTPException(404, f"{label} not found")
        t = svc.get_user_task(db, user.id, item.task_id)
        if not t:
            raise HTTPException(404, f"{label} not found")
        return item, t

    @router.patch(f"/{label}/{{iid}}", name=f"patch_{label}")
    def patch(iid: int, body: ItemUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        item, t = _get(db, user, iid)
        data = body.model_dump(exclude_unset=True)
        if data.get("title") is not None:
            item.title = data["title"].strip()
        if data.get("done") is not None and data["done"] != item.done:
            item.done = data["done"]
            svc.log_activity(db, t.id, user.id, f"{label}_toggled", {"title": item.title, "done": item.done})
        return _commit_out(db, user, t)

    @router.delete(f"/{label}/{{iid}}", name=f"delete_{label}")
    def delete(iid: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        item, t = _get(db, user, iid)
        db.delete(item)
        svc.log_activity(db, t.id, user.id, f"{label}_removed", {"title": item.title})
        return _commit_out(db, user, t)


_item_routes("subtasks", Subtask, "subtasks")
_item_routes("checklist", ChecklistItem, "checklist")


# ------------------------------------------------------------------ comments / activity
@router.get("/tasks/{task_id}/comments")
def list_comments(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = _task_or_404(db, user, task_id)
    rows = db.query(TaskComment).filter_by(task_id=t.id).order_by(TaskComment.id).all()
    return [{"id": c.id, "body": c.body, "user_id": c.user_id, "created_at": svc.aware(c.created_at)} for c in rows]


@router.post("/tasks/{task_id}/comments", status_code=201)
def add_comment(task_id: int, body: CommentIn, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    t = _task_or_404(db, user, task_id)
    c = TaskComment(task_id=t.id, user_id=user.id, body=body.body.strip())
    db.add(c)
    svc.log_activity(db, t.id, user.id, "commented", {})
    db.commit()
    return {"id": c.id, "body": c.body, "user_id": c.user_id, "created_at": svc.aware(c.created_at)}


@router.get("/tasks/{task_id}/activity")
def activity(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = _task_or_404(db, user, task_id)
    rows = db.query(TaskActivity).filter_by(task_id=t.id).order_by(TaskActivity.id.desc()).all()
    return [{"id": a.id, "action": a.action, "detail": a.detail, "created_at": svc.aware(a.created_at)} for a in rows]


# ------------------------------------------------------------------ attachments
def _safe_display_name(name: str) -> str:
    name = os.path.basename((name or "file").replace("\\", "/"))
    name = re.sub(r"[^\w.\- ()]", "_", name).strip(" .")
    return (name or "file")[:200]


@router.post("/tasks/{task_id}/attachments", status_code=201)
async def upload_attachment(task_id: int, file: UploadFile = File(...), user: User = Depends(get_current_user),
                            db: Session = Depends(get_db)):
    t = _task_or_404(db, user, task_id)
    display = _safe_display_name(file.filename or "file")
    ext = os.path.splitext(display)[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(422, f"File type '{ext or 'unknown'}' not allowed")
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    stored = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(settings.UPLOAD_DIR, stored)
    size = 0
    try:
        with open(path, "wb") as fh:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(413, f"File exceeds {settings.MAX_UPLOAD_MB} MB limit")
                fh.write(chunk)
    except Exception:
        if os.path.exists(path):
            os.remove(path)
        raise
    a = TaskAttachment(task_id=t.id, user_id=user.id, filename=display, stored_name=stored,
                       content_type=file.content_type, size=size)
    db.add(a)
    svc.log_activity(db, t.id, user.id, "attachment_added", {"filename": display})
    db.commit()
    return {"id": a.id, "filename": a.filename, "size": a.size}


def _attachment(db, user, aid) -> TaskAttachment:
    a = db.get(TaskAttachment, aid)
    if not a or a.user_id != user.id or not svc.get_user_task(db, user.id, a.task_id):
        raise HTTPException(404, "Attachment not found")
    return a


@router.get("/attachments/{aid}/download")
def download_attachment(aid: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    a = _attachment(db, user, aid)
    path = os.path.join(settings.UPLOAD_DIR, os.path.basename(a.stored_name))
    if not os.path.isfile(path):
        raise HTTPException(404, "File missing")
    return FileResponse(path, filename=a.filename, media_type=a.content_type or "application/octet-stream",
                        headers={"X-Content-Type-Options": "nosniff"})


@router.delete("/attachments/{aid}", status_code=204)
def delete_attachment(aid: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    a = _attachment(db, user, aid)
    stored, tid, fn = a.stored_name, a.task_id, a.filename
    db.delete(a)
    svc.log_activity(db, tid, user.id, "attachment_removed", {"filename": fn})
    db.commit()
    try:
        os.remove(os.path.join(settings.UPLOAD_DIR, os.path.basename(stored)))
    except OSError:
        pass
    return Response(status_code=204)


# ------------------------------------------------------------------ timer / time entries
@router.post("/tasks/{task_id}/timer/start")
def timer_start(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = _task_or_404(db, user, task_id)
    if t.status in svc.CLOSED_STATUSES:
        raise HTTPException(409, "Cannot track time on a closed task")
    now = utcnow()
    for e in db.query(TimeEntry).filter(TimeEntry.user_id == user.id, TimeEntry.ended_at.is_(None)).all():
        e.ended_at = now
        e.seconds = max(0, int((now - svc.aware(e.started_at)).total_seconds()))
    db.add(TimeEntry(user_id=user.id, task_id=t.id, started_at=now, seconds=0))
    if t.status == "not_started":
        svc.update_task(db, user, get_prefs(db, user), t, {"status": "in_progress"}, user_today(get_prefs(db, user)))
    svc.log_activity(db, t.id, user.id, "timer_started", {})
    return _commit_out(db, user, t)


@router.post("/tasks/{task_id}/timer/stop")
def timer_stop(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = _task_or_404(db, user, task_id)
    e = db.query(TimeEntry).filter(TimeEntry.user_id == user.id, TimeEntry.task_id == t.id,
                                   TimeEntry.ended_at.is_(None)).first()
    if not e:
        raise HTTPException(409, "No running timer for this task")
    now = utcnow()
    e.ended_at = now
    e.seconds = max(0, int((now - svc.aware(e.started_at)).total_seconds()))
    svc.log_activity(db, t.id, user.id, "timer_stopped", {"seconds": e.seconds})
    return _commit_out(db, user, t)


@router.get("/time-entries")
def time_entries(date_from: date | None = None, date_to: date | None = None,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = get_prefs(db, user)
    from ..deps import get_tz
    from datetime import time as dtime, timezone
    tz = get_tz(p)
    q = db.query(TimeEntry, Task.title).join(Task, Task.id == TimeEntry.task_id).filter(TimeEntry.user_id == user.id)
    if date_from:
        q = q.filter(TimeEntry.started_at >= datetime.combine(date_from, dtime.min, tzinfo=tz).astimezone(timezone.utc))
    if date_to:
        q = q.filter(TimeEntry.started_at <= datetime.combine(date_to, dtime.max, tzinfo=tz).astimezone(timezone.utc))
    now = utcnow()
    out = []
    for e, title in q.order_by(TimeEntry.started_at.desc()).all():
        secs = e.seconds if e.ended_at else max(0, int((now - svc.aware(e.started_at)).total_seconds()))
        out.append({"id": e.id, "task_id": e.task_id, "task_title": title, "started_at": svc.aware(e.started_at),
                    "ended_at": svc.aware(e.ended_at), "seconds": secs, "running": e.ended_at is None})
    return out
