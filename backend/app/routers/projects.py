from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, get_prefs, user_today
from ..models import Milestone, Project, Task, User
from ..schemas import MilestoneIn, MilestoneUpdate, ProjectIn, ProjectUpdate
from ..services import tasks as svc

router = APIRouter(prefix="/api", tags=["projects"])


def _project(db: Session, user: User, pid: int) -> Project:
    p = db.query(Project).filter_by(id=pid, user_id=user.id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    return p


def _ms(m: Milestone) -> dict:
    return {"id": m.id, "project_id": m.project_id, "title": m.title, "due_date": m.due_date, "done": m.done}


def project_out(db: Session, p: Project, detail: bool = False) -> dict:
    rows = db.query(Task.status, func.count(Task.id)).filter(Task.project_id == p.id,
                                                              Task.user_id == p.user_id).group_by(Task.status).all()
    counts = {s: n for s, n in rows}
    denom = sum(n for s, n in counts.items() if s != "cancelled")
    pct = round(counts.get("completed", 0) / denom * 100) if denom else 0
    out = {"id": p.id, "name": p.name, "description": p.description, "color": p.color, "status": p.status,
           "start_date": p.start_date, "due_date": p.due_date, "progress_percent": pct,
           "task_counts": {"by_status": counts, "total": sum(counts.values())},
           "milestones": [_ms(m) for m in p.milestones],
           "created_at": svc.aware(p.created_at), "updated_at": svc.aware(p.updated_at)}
    return out


@router.get("/projects")
def list_projects(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [project_out(db, p) for p in db.query(Project).filter_by(user_id=user.id).order_by(Project.name).all()]


@router.post("/projects", status_code=201)
def create_project(body: ProjectIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = Project(user_id=user.id, **body.model_dump())
    db.add(p)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A project with this name already exists")
    return project_out(db, p)


@router.get("/projects/{pid}")
def get_project(pid: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return project_out(db, _project(db, user, pid), True)


@router.patch("/projects/{pid}")
def patch_project(pid: int, body: ProjectUpdate, user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    p = _project(db, user, pid)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        if v is None and k in ("name", "color", "status"):
            raise HTTPException(422, f"{k} cannot be null")
        setattr(p, k, v)
    if p.start_date and p.due_date and p.due_date < p.start_date:
        db.rollback()
        raise HTTPException(422, "due_date must be on or after start_date")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A project with this name already exists")
    return project_out(db, p)


@router.delete("/projects/{pid}", status_code=204)
def delete_project(pid: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _project(db, user, pid)
    db.query(Task).filter(Task.project_id == p.id, Task.user_id == user.id).update({"project_id": None})
    db.delete(p)
    db.commit()
    return Response(status_code=204)


@router.post("/projects/{pid}/milestones", status_code=201)
def add_milestone(pid: int, body: MilestoneIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _project(db, user, pid)
    m = Milestone(project_id=p.id, **body.model_dump())
    db.add(m)
    db.commit()
    return _ms(m)


def _milestone(db, user, mid) -> Milestone:
    m = db.get(Milestone, mid)
    if not m or not db.query(Project).filter_by(id=m.project_id, user_id=user.id).first():
        raise HTTPException(404, "Milestone not found")
    return m


@router.patch("/milestones/{mid}")
def patch_milestone(mid: int, body: MilestoneUpdate, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    m = _milestone(db, user, mid)
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is None and k in ("title", "done"):
            continue
        setattr(m, k, v)
    db.commit()
    return _ms(m)


@router.delete("/milestones/{mid}", status_code=204)
def delete_milestone(mid: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(_milestone(db, user, mid))
    db.commit()
    return Response(status_code=204)


def _board(db: Session, user: User, project_id: int | None):
    today = user_today(get_prefs(db, user))
    q = svc.base_query(db, user.id)
    if project_id is not None:
        q = q.filter(Task.project_id == project_id)
    out = {c: [] for c in svc.BOARD_COLUMNS}
    tasks = q.order_by(Task.id).all()
    ser = svc.serialize_tasks(db, tasks, today)
    for t in ser:
        out.setdefault(t["board_column"], []).append(t)
    return out


@router.get("/projects/{pid}/board")
def project_board(pid: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _project(db, user, pid)
    return _board(db, user, pid)


@router.get("/board")
def all_board(project_id: int | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if project_id is not None:
        _project(db, user, project_id)
    return _board(db, user, project_id)
