"""Jira-style module: permissions, key parsing, ranking, serialization, history and notifications."""
import re
import time
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import String, case, cast, func, or_, update
from sqlalchemy.orm import Session

from ..models import (JiraColumn, JiraComment, JiraHistory, JiraIssue, JiraMember, JiraProject, JiraSprint,
                      User)
from . import notifications as notif
from .tasks import aware

ROLE_RANK = {"viewer": 1, "member": 2, "admin": 3}
DEFAULT_COLUMNS = [("To Do", "todo"), ("In Progress", "in_progress"), ("In Review", "in_progress"),
                   ("Done", "done")]
PRIORITY_ORDER = {"highest": 0, "high": 1, "medium": 2, "low": 3, "lowest": 4}
RANK_STEP = 1000.0


def now() -> datetime:
    return datetime.now(timezone.utc)


def user_ref(u: User | None) -> dict | None:
    return {"id": u.id, "name": u.name} if u else None


# ------------------------------------------------------------------ permissions / lookups
def require_role(role: str, min_role: str):
    if ROLE_RANK[role] < ROLE_RANK[min_role]:
        raise HTTPException(403, f"This action requires the {min_role} role")


def get_member(db: Session, project_id: int, user_id: int) -> JiraMember | None:
    return db.query(JiraMember).filter_by(project_id=project_id, user_id=user_id).first()


def project_for(db: Session, user: User, key: str, min_role: str = "viewer") -> tuple[JiraProject, str]:
    p = db.query(JiraProject).filter(JiraProject.key == key.strip().upper()).first()
    m = get_member(db, p.id, user.id) if p else None
    if not p or not m:  # non-members must not learn the project exists
        raise HTTPException(404, "Project not found")
    require_role(m.role, min_role)
    return p, m.role


def parse_issue_key(key: str) -> tuple[str, int]:
    if "-" not in key:
        raise HTTPException(404, "Issue not found")
    prefix, num = key.rsplit("-", 1)
    if not num.isdigit():
        raise HTTPException(404, "Issue not found")
    return prefix.upper(), int(num)


def issue_for(db: Session, user: User, key: str, min_role: str = "viewer") -> tuple[JiraIssue, JiraProject, str]:
    prefix, num = parse_issue_key(key)
    p, role = project_for(db, user, prefix, min_role)
    i = db.query(JiraIssue).filter_by(project_id=p.id, number=num).first()
    if not i:
        raise HTTPException(404, "Issue not found")
    return i, p, role


def issue_by_id(db: Session, project: JiraProject, issue_id: int | None, what: str = "issue") -> JiraIssue:
    i = db.get(JiraIssue, issue_id) if issue_id is not None else None
    if not i or i.project_id != project.id:
        raise HTTPException(422, f"{what} not found in this project")
    return i


def issue_key(project: JiraProject, issue: JiraIssue) -> str:
    return f"{project.key}-{issue.number}"


def project_columns(db: Session, project_id: int) -> list[JiraColumn]:
    return (db.query(JiraColumn).filter_by(project_id=project_id)
            .order_by(JiraColumn.position, JiraColumn.id).all())


def column_in_project(db: Session, project: JiraProject, column_id: int | None) -> JiraColumn:
    c = db.get(JiraColumn, column_id) if column_id is not None else None
    if not c or c.project_id != project.id:
        raise HTTPException(422, "column_id does not belong to this project")
    return c


def check_assignee(db: Session, project: JiraProject, assignee_id: int | None):
    if assignee_id is not None and not get_member(db, project.id, assignee_id):
        raise HTTPException(422, "Assignee must be a project member")


def check_sprint(db: Session, project: JiraProject, sprint_id: int | None) -> JiraSprint | None:
    if sprint_id is None:
        return None
    s = db.get(JiraSprint, sprint_id)
    if not s or s.project_id != project.id:
        raise HTTPException(422, "sprint_id does not belong to this project")
    if s.state == "closed":
        raise HTTPException(422, "Cannot add issues to a closed sprint")
    return s


def validate_parent(db: Session, project: JiraProject, itype: str, parent_id: int | None,
                    self_id: int | None = None) -> JiraIssue | None:
    if itype == "epic":
        if parent_id is not None:
            raise HTTPException(422, "An epic cannot have a parent")
        return None
    if itype == "subtask" and parent_id is None:
        raise HTTPException(422, "A subtask requires a parent issue")
    if parent_id is None:
        return None
    if self_id is not None and parent_id == self_id:
        raise HTTPException(422, "An issue cannot be its own parent")
    parent = issue_by_id(db, project, parent_id, "Parent issue")
    if itype == "subtask":
        if parent.type in ("subtask", "epic"):
            raise HTTPException(422, "A subtask's parent must be a story, task or bug")
    elif parent.type != "epic":
        raise HTTPException(422, "Only an epic can be the parent of a story, task or bug")
    return parent


# ------------------------------------------------------------------ history / notifications
def log_change(db: Session, issue: JiraIssue, user: User, field: str, old, new):
    o = None if old is None else str(old)
    n = None if new is None else str(new)
    if o == n:
        return
    db.add(JiraHistory(issue_id=issue.id, user_id=user.id, field=field, old_value=o, new_value=n))


def _uniq() -> str:
    return str(time.time_ns())


def notify_assigned(db: Session, project: JiraProject, issue: JiraIssue, actor: User):
    if issue.assignee_id and issue.assignee_id != actor.id:
        k = issue_key(project, issue)
        notif.create_notification(
            db, issue.assignee_id, "jira", f"{k} assigned to you", f"{actor.name} assigned you: {issue.title}",
            {"issue_key": k}, dedupe_key=f"jira:assigned:{issue.id}:{issue.assignee_id}:{_uniq()}")


def notify_added(db: Session, project: JiraProject, user_id: int, actor: User, role: str):
    if user_id != actor.id:
        notif.create_notification(
            db, user_id, "jira", f"Added to project {project.key}",
            f"{actor.name} added you to {project.name} as {role}", {"project_key": project.key},
            dedupe_key=f"jira:member:{project.id}:{user_id}:{_uniq()}")


def notify_comment(db: Session, project: JiraProject, issue: JiraIssue, comment: JiraComment, actor: User):
    k = issue_key(project, issue)
    for uid in {issue.assignee_id, issue.reporter_id} - {None, actor.id}:
        if not get_member(db, project.id, uid):
            continue
        notif.create_notification(
            db, uid, "jira", f"New comment on {k}", f"{actor.name}: {comment.body[:140]}", {"issue_key": k},
            dedupe_key=f"jira:comment:{comment.id}:{uid}")


# ------------------------------------------------------------------ ranking
def _renumber(items: list[JiraIssue]):
    for n, it in enumerate(items, start=1):
        it.rank = n * RANK_STEP


def compute_rank(items: list[JiraIssue], before_id: int | None, after_id: int | None) -> float:
    """items: rank-ordered neighbours (without the moving issue). Returns the rank for the moving issue and may
    renumber the neighbours when the gap collapsed."""
    if before_id is not None:
        idx = next((n for n, i in enumerate(items) if i.id == before_id), None)
        if idx is None:
            raise HTTPException(422, "before_issue_id is not in the target list")
    elif after_id is not None:
        idx = next((n for n, i in enumerate(items) if i.id == after_id), None)
        if idx is None:
            raise HTTPException(422, "after_issue_id is not in the target list")
        idx += 1
    else:
        idx = len(items)
    for _ in range(2):
        low = items[idx - 1].rank if idx > 0 else None
        high = items[idx].rank if idx < len(items) else None
        if low is not None and high is not None:
            if high - low < 1e-6:
                _renumber(items)
                continue
            return (low + high) / 2
        if low is not None:
            return low + RANK_STEP
        if high is not None:
            return high - RANK_STEP
        return RANK_STEP
    return items[idx - 1].rank + RANK_STEP / 2  # unreachable after renumber, keeps types simple


def next_rank(db: Session, project_id: int) -> float:
    m = db.query(func.max(JiraIssue.rank)).filter(JiraIssue.project_id == project_id).scalar()
    return (m or 0.0) + RANK_STEP


def set_resolved(issue: JiraIssue, column: JiraColumn):
    if column.category == "done":
        if issue.resolved_at is None:
            issue.resolved_at = now()
    else:
        issue.resolved_at = None


def set_sprint(db: Session, issue: JiraIssue, sprint_id: int | None):
    """Change the sprint and carry sub-tasks that were in the same sprint along."""
    old = issue.sprint_id
    issue.sprint_id = sprint_id
    if issue.type != "subtask" and old != sprint_id:
        db.query(JiraIssue).filter(JiraIssue.parent_id == issue.id, JiraIssue.type == "subtask",
                                   JiraIssue.sprint_id.is_(old) if old is None else JiraIssue.sprint_id == old
                                   ).update({"sprint_id": sprint_id}, synchronize_session=False)


def sprint_name(db: Session, sprint_id: int | None) -> str | None:
    s = db.get(JiraSprint, sprint_id) if sprint_id else None
    return s.name if s else None


# ------------------------------------------------------------------ serialization
def serialize_issues(db: Session, issues: list[JiraIssue], detail: bool = False) -> list[dict]:
    if not issues:
        return []
    ids = [i.id for i in issues]
    pids = {i.project_id for i in issues}
    projects = {p.id: p for p in db.query(JiraProject).filter(JiraProject.id.in_(pids)).all()}
    cols = {c.id: c for c in db.query(JiraColumn).filter(JiraColumn.project_id.in_(pids)).all()}
    uids = {x for i in issues for x in (i.assignee_id, i.reporter_id) if x}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    parent_ids = {i.parent_id for i in issues if i.parent_id}
    parents = {p.id: p for p in db.query(JiraIssue).filter(JiraIssue.id.in_(parent_ids)).all()} if parent_ids else {}
    sub_total = dict(db.query(JiraIssue.parent_id, func.count(JiraIssue.id))
                     .filter(JiraIssue.parent_id.in_(ids), JiraIssue.type == "subtask")
                     .group_by(JiraIssue.parent_id).all())
    done_ids = [c.id for c in cols.values() if c.category == "done"]
    sub_done = dict(db.query(JiraIssue.parent_id, func.count(JiraIssue.id))
                    .filter(JiraIssue.parent_id.in_(ids), JiraIssue.type == "subtask",
                            JiraIssue.column_id.in_(done_ids or [-1]))
                    .group_by(JiraIssue.parent_id).all())
    comments = dict(db.query(JiraComment.issue_id, func.count(JiraComment.id))
                    .filter(JiraComment.issue_id.in_(ids)).group_by(JiraComment.issue_id).all())
    out = []
    for i in issues:
        proj = projects[i.project_id]
        col = cols.get(i.column_id)
        par = parents.get(i.parent_id)
        d = {"id": i.id, "key": f"{proj.key}-{i.number}", "number": i.number, "project_key": proj.key,
             "type": i.type, "title": i.title, "description": i.description, "column_id": i.column_id,
             "status_name": col.name if col else None, "status_category": col.category if col else None,
             "priority": i.priority, "assignee": user_ref(users.get(i.assignee_id)),
             "reporter": user_ref(users.get(i.reporter_id)),
             "parent": ({"id": par.id, "key": f"{proj.key}-{par.number}", "title": par.title, "type": par.type}
                        if par else None),
             "sprint_id": i.sprint_id, "story_points": i.story_points, "labels": list(i.labels or []),
             "due_date": i.due_date, "rank": i.rank, "resolved_at": aware(i.resolved_at),
             "created_at": aware(i.created_at), "updated_at": aware(i.updated_at),
             "subtask_count": sub_total.get(i.id, 0), "subtasks_done": sub_done.get(i.id, 0),
             "comment_count": comments.get(i.id, 0)}
        out.append(d)
    if detail:
        for d, i in zip(out, issues):
            kids = (db.query(JiraIssue).filter(JiraIssue.parent_id == i.id, JiraIssue.type == "subtask")
                    .order_by(JiraIssue.rank, JiraIssue.id).all())
            d["subtasks"] = serialize_issues(db, kids)
            d["epic_children_count"] = (db.query(func.count(JiraIssue.id))
                                        .filter(JiraIssue.parent_id == i.id).scalar() if i.type == "epic" else 0)
    return out


def serialize_issue(db: Session, issue: JiraIssue, detail: bool = False) -> dict:
    return serialize_issues(db, [issue], detail)[0]


def sprint_out(db: Session, s: JiraSprint) -> dict:
    done_ids = [c.id for c in db.query(JiraColumn.id).filter_by(project_id=s.project_id, category="done").all()]
    rows = db.query(JiraIssue.column_id, JiraIssue.story_points).filter(JiraIssue.sprint_id == s.id).all()
    total = sum(p or 0 for _, p in rows)
    done = sum(p or 0 for c, p in rows if c in done_ids)
    return {"id": s.id, "project_id": s.project_id, "name": s.name, "goal": s.goal, "state": s.state,
            "start_date": s.start_date, "end_date": s.end_date, "completed_at": aware(s.completed_at),
            "issue_count": len(rows), "points_total": total, "points_done": done}


def project_sprints(db: Session, project_id: int) -> list[JiraSprint]:
    order = case((JiraSprint.state == "active", 0), (JiraSprint.state == "planned", 1), else_=2)
    return db.query(JiraSprint).filter_by(project_id=project_id).order_by(order, JiraSprint.id).all()


def active_sprint(db: Session, project_id: int) -> JiraSprint | None:
    return db.query(JiraSprint).filter_by(project_id=project_id, state="active").first()


def project_out(db: Session, p: JiraProject, role: str, detail: bool = False) -> dict:
    lead = db.get(User, p.lead_id) if p.lead_id else None
    done_ids = [c.id for c in db.query(JiraColumn.id).filter_by(project_id=p.id, category="done").all()]
    issue_count = db.query(func.count(JiraIssue.id)).filter(JiraIssue.project_id == p.id).scalar() or 0
    done_count = (db.query(func.count(JiraIssue.id))
                  .filter(JiraIssue.project_id == p.id, JiraIssue.column_id.in_(done_ids or [-1])).scalar() or 0)
    members = db.query(func.count(JiraMember.id)).filter(JiraMember.project_id == p.id).scalar() or 0
    act = active_sprint(db, p.id)
    out = {"id": p.id, "key": p.key, "name": p.name, "description": p.description, "lead": user_ref(lead),
           "my_role": role, "member_count": members, "issue_count": issue_count,
           "open_issue_count": issue_count - done_count,
           "active_sprint": {"id": act.id, "name": act.name} if act else None,
           "created_at": aware(p.created_at), "updated_at": aware(p.updated_at)}
    if detail:
        out["columns"] = [column_out(c) for c in project_columns(db, p.id)]
        out["members"] = member_list(db, p.id)
        out["sprints"] = [sprint_out(db, s) for s in project_sprints(db, p.id)]
    return out


def column_out(c: JiraColumn) -> dict:
    return {"id": c.id, "project_id": c.project_id, "name": c.name, "category": c.category,
            "position": c.position}


def member_list(db: Session, project_id: int) -> list[dict]:
    rows = (db.query(JiraMember, User).join(User, User.id == JiraMember.user_id)
            .filter(JiraMember.project_id == project_id).order_by(User.name, User.id).all())
    return [member_out(m, u) for m, u in rows]


def member_out(m: JiraMember, u: User) -> dict:
    return {"user_id": u.id, "name": u.name, "email": u.email, "role": m.role}


def comment_out(c: JiraComment, key: str, users: dict) -> dict:
    return {"id": c.id, "issue_key": key, "user": user_ref(users.get(c.user_id)), "body": c.body,
            "created_at": aware(c.created_at), "updated_at": aware(c.updated_at)}


# ------------------------------------------------------------------ project / issue operations
def create_project(db: Session, user: User, key: str, name: str, description: str | None) -> JiraProject:
    p = JiraProject(key=key, name=name, description=description, lead_id=user.id, issue_seq=0)
    db.add(p)
    db.flush()
    db.add(JiraMember(project_id=p.id, user_id=user.id, role="admin"))
    for n, (cname, cat) in enumerate(DEFAULT_COLUMNS):
        db.add(JiraColumn(project_id=p.id, name=cname, category=cat, position=n))
    db.add(JiraSprint(project_id=p.id, name="Sprint 1", state="planned"))
    db.flush()
    return p


def create_issue(db: Session, project: JiraProject, user: User, data: dict) -> JiraIssue:
    itype = data.get("type", "task")
    parent = validate_parent(db, project, itype, data.get("parent_id"))
    if data.get("column_id") is not None:
        col = column_in_project(db, project, data["column_id"])
    else:
        col = project_columns(db, project.id)[0]
    check_assignee(db, project, data.get("assignee_id"))
    if "sprint_id" in data:
        sprint_id = data["sprint_id"]
        check_sprint(db, project, sprint_id)
    elif parent is not None and itype == "subtask" and parent.sprint_id:
        ps = db.get(JiraSprint, parent.sprint_id)
        sprint_id = parent.sprint_id if ps and ps.state != "closed" else None
    else:
        sprint_id = None
    # atomic per-project counter (row lock on Postgres keeps concurrent creates unique)
    db.execute(update(JiraProject).where(JiraProject.id == project.id).values(issue_seq=JiraProject.issue_seq + 1))
    number = db.query(JiraProject.issue_seq).filter(JiraProject.id == project.id).scalar()
    issue = JiraIssue(project_id=project.id, number=number, type=itype, title=data["title"],
                      description=data.get("description"), column_id=col.id,
                      priority=data.get("priority", "medium"), assignee_id=data.get("assignee_id"),
                      reporter_id=user.id, parent_id=data.get("parent_id"), sprint_id=sprint_id,
                      story_points=data.get("story_points"), labels=data.get("labels") or [],
                      due_date=data.get("due_date"), rank=next_rank(db, project.id))
    set_resolved(issue, col)
    db.add(issue)
    db.flush()
    notify_assigned(db, project, issue, user)
    return issue


_SIMPLE = ("title", "description", "priority", "story_points", "due_date")


def update_issue(db: Session, project: JiraProject, issue: JiraIssue, user: User, data: dict):
    """Apply a PATCH dict (only the provided keys), writing history rows for every changed field."""
    for k in ("type", "title", "priority", "column_id"):
        if k in data and data[k] is None:
            raise HTTPException(422, f"{k} cannot be null")
    if "type" in data or "parent_id" in data:
        new_type = data.get("type", issue.type)
        new_parent = data["parent_id"] if "parent_id" in data else issue.parent_id
        if new_type != issue.type:
            has_children = db.query(JiraIssue.id).filter(JiraIssue.parent_id == issue.id).first() is not None
            if has_children and (new_type in ("epic", "subtask") or issue.type in ("epic", "subtask")):
                raise HTTPException(409, "Issue has child issues; cannot change to/from this type")
        validate_parent(db, project, new_type, new_parent, issue.id)
    if "assignee_id" in data:
        check_assignee(db, project, data["assignee_id"])
    if "sprint_id" in data and data["sprint_id"] != issue.sprint_id:
        check_sprint(db, project, data["sprint_id"])
    new_col = column_in_project(db, project, data["column_id"]) if "column_id" in data else None

    notify = False
    for k in _SIMPLE:
        if k in data and data[k] != getattr(issue, k):
            log_change(db, issue, user, k, getattr(issue, k), data[k])
            setattr(issue, k, data[k])
    if "type" in data and data["type"] != issue.type:
        log_change(db, issue, user, "type", issue.type, data["type"])
        issue.type = data["type"]
    if "labels" in data and (data["labels"] or []) != list(issue.labels or []):
        log_change(db, issue, user, "labels", ", ".join(issue.labels or []), ", ".join(data["labels"] or []))
        issue.labels = data["labels"] or []
    if "assignee_id" in data and data["assignee_id"] != issue.assignee_id:
        old = db.get(User, issue.assignee_id) if issue.assignee_id else None
        new = db.get(User, data["assignee_id"]) if data["assignee_id"] else None
        log_change(db, issue, user, "assignee", old.name if old else None, new.name if new else None)
        issue.assignee_id = data["assignee_id"]
        notify = True
    if "parent_id" in data and data["parent_id"] != issue.parent_id:
        old = db.get(JiraIssue, issue.parent_id) if issue.parent_id else None
        new = db.get(JiraIssue, data["parent_id"]) if data["parent_id"] else None
        log_change(db, issue, user, "parent", issue_key(project, old) if old else None,
                   issue_key(project, new) if new else None)
        issue.parent_id = data["parent_id"]
    if "sprint_id" in data and data["sprint_id"] != issue.sprint_id:
        log_change(db, issue, user, "sprint", sprint_name(db, issue.sprint_id), sprint_name(db, data["sprint_id"]))
        set_sprint(db, issue, data["sprint_id"])
    if new_col is not None and new_col.id != issue.column_id:
        old_col = db.get(JiraColumn, issue.column_id)
        log_change(db, issue, user, "status", old_col.name if old_col else None, new_col.name)
        issue.column_id = new_col.id
        set_resolved(issue, new_col)
    issue.updated_at = now()
    db.flush()
    if notify:
        notify_assigned(db, project, issue, user)


def move_issue(db: Session, project: JiraProject, issue: JiraIssue, user: User, column_id: int,
               before_id: int | None, after_id: int | None):
    col = column_in_project(db, project, column_id)
    items = (db.query(JiraIssue).filter(JiraIssue.project_id == project.id, JiraIssue.column_id == col.id,
                                        JiraIssue.id != issue.id).order_by(JiraIssue.rank, JiraIssue.id).all())
    rank = compute_rank(items, before_id, after_id)
    if col.id != issue.column_id:
        old_col = db.get(JiraColumn, issue.column_id)
        log_change(db, issue, user, "status", old_col.name if old_col else None, col.name)
        issue.column_id = col.id
        set_resolved(issue, col)
    issue.rank = rank
    issue.updated_at = now()
    db.flush()


def rank_issue(db: Session, project: JiraProject, issue: JiraIssue, user: User, sprint_id: int | None,
               before_id: int | None, after_id: int | None):
    if sprint_id != issue.sprint_id:
        check_sprint(db, project, sprint_id)
    q = db.query(JiraIssue).filter(JiraIssue.project_id == project.id, JiraIssue.id != issue.id)
    q = q.filter(JiraIssue.sprint_id.is_(None)) if sprint_id is None else q.filter(JiraIssue.sprint_id == sprint_id)
    items = q.order_by(JiraIssue.rank, JiraIssue.id).all()
    rank = compute_rank(items, before_id, after_id)
    if sprint_id != issue.sprint_id:
        log_change(db, issue, user, "sprint", sprint_name(db, issue.sprint_id), sprint_name(db, sprint_id))
        set_sprint(db, issue, sprint_id)
    issue.rank = rank
    issue.updated_at = now()
    db.flush()


def delete_issue(db: Session, issue: JiraIssue):
    if issue.type == "epic":
        db.query(JiraIssue).filter(JiraIssue.parent_id == issue.id).update({"parent_id": None},
                                                                          synchronize_session=False)
    else:
        for sub in db.query(JiraIssue).filter(JiraIssue.parent_id == issue.id, JiraIssue.type == "subtask").all():
            db.delete(sub)
    db.flush()
    db.delete(issue)
    db.flush()


# ------------------------------------------------------------------ querying
def issue_filters(db: Session, project: JiraProject, user: User, q=None, type=None, status_category=None,
                  column_id=None, assignee=None, priority=None, label=None, sprint_id=None, parent_id=None):
    query = db.query(JiraIssue).filter(JiraIssue.project_id == project.id)
    if q:
        term = q.strip()
        conds = [JiraIssue.title.ilike(f"%{term}%"), JiraIssue.description.ilike(f"%{term}%")]
        m = re.fullmatch(r"([A-Za-z0-9]+)-(\d+)", term)
        if m and m.group(1).upper() == project.key:
            conds.append(JiraIssue.number == int(m.group(2)))
        query = query.filter(or_(*conds))
    if type:
        query = query.filter(JiraIssue.type == type)
    if priority:
        query = query.filter(JiraIssue.priority == priority)
    if column_id is not None:
        query = query.filter(JiraIssue.column_id == column_id)
    if status_category:
        query = query.filter(JiraIssue.column_id.in_(
            db.query(JiraColumn.id).filter(JiraColumn.project_id == project.id,
                                           JiraColumn.category == status_category)))
    if assignee:
        if assignee == "me":
            query = query.filter(JiraIssue.assignee_id == user.id)
        elif assignee == "unassigned":
            query = query.filter(JiraIssue.assignee_id.is_(None))
        elif assignee.isdigit():
            query = query.filter(JiraIssue.assignee_id == int(assignee))
        else:
            raise HTTPException(422, "assignee must be a user id, 'me' or 'unassigned'")
    if label:
        import json
        query = query.filter(cast(JiraIssue.labels, String).like(f"%{json.dumps(label)}%"))
    if parent_id is not None:
        query = query.filter(JiraIssue.parent_id == parent_id)
    if sprint_id:
        if sprint_id == "backlog":
            query = query.filter(JiraIssue.sprint_id.is_(None))
        elif sprint_id == "active":
            act = active_sprint(db, project.id)
            query = query.filter(JiraIssue.sprint_id == (act.id if act else -1))
        elif sprint_id == "all":
            pass
        elif sprint_id.isdigit():
            query = query.filter(JiraIssue.sprint_id == int(sprint_id))
        else:
            raise HTTPException(422, "sprint_id must be an id, 'backlog' or 'active'")
    return query


def sort_clause(sort: str, order: str):
    if sort == "priority":
        col = case(*[(JiraIssue.priority == k, v) for k, v in PRIORITY_ORDER.items()], else_=9)
    else:
        col = {"rank": JiraIssue.rank, "created": JiraIssue.created_at, "updated": JiraIssue.updated_at,
               "due": JiraIssue.due_date}[sort]
    clauses = [col.desc() if order == "desc" else col.asc()]
    if sort == "due":
        clauses.insert(0, JiraIssue.due_date.is_(None))  # undated issues last
    return clauses + [JiraIssue.id.asc()]


# ------------------------------------------------------------------ sprint report / summary
def sprint_report(db: Session, s: JiraSprint) -> dict:
    done_ids = {c.id for c in db.query(JiraColumn.id).filter_by(project_id=s.project_id, category="done").all()}
    issues = db.query(JiraIssue).filter(JiraIssue.sprint_id == s.id).all()
    committed = sum(i.story_points or 0 for i in issues)
    done = [i for i in issues if i.column_id in done_ids]
    completed = sum(i.story_points or 0 for i in done)
    burndown, ideal = [], []
    if s.state != "planned":
        start = s.start_date or aware(s.created_at).date()
        today = now().date()
        end = aware(s.completed_at).date() if s.state == "closed" and s.completed_at else today
        end = min(max(end, start), start + timedelta(days=365))
        n_days = (end - start).days
        sched_end = s.end_date or end
        span = max((sched_end - start).days, 1)
        resolved = [(aware(i.resolved_at).date(), i.story_points or 0) for i in done if i.resolved_at]
        for k in range(n_days + 1):
            d = start + timedelta(days=k)
            burned = sum(p for rd, p in resolved if rd <= d)
            burndown.append({"date": d, "remaining_points": committed - burned})
            ideal.append({"date": d, "remaining_points": round(max(committed * (1 - k / span), 0), 2)})
    return {"sprint": sprint_out(db, s), "committed_points": committed, "completed_points": completed,
            "issues_total": len(issues), "issues_done": len(done), "burndown": burndown, "ideal": ideal}


def project_summary(db: Session, project: JiraProject) -> dict:
    cols = {c.id: c for c in project_columns(db, project.id)}
    issues = db.query(JiraIssue).filter(JiraIssue.project_id == project.id).all()
    by_cat = {"todo": 0, "in_progress": 0, "done": 0}
    by_type: dict = {}
    by_pri: dict = {}
    by_ass: dict = {}
    for i in issues:
        by_cat[cols[i.column_id].category] += 1
        by_type[i.type] = by_type.get(i.type, 0) + 1
        by_pri[i.priority] = by_pri.get(i.priority, 0) + 1
        by_ass[i.assignee_id] = by_ass.get(i.assignee_id, 0) + 1
    users = {u.id: u for u in db.query(User).filter(User.id.in_([k for k in by_ass if k])).all()} if by_ass else {}
    assignees = [{"user": user_ref(users.get(k)), "count": n}
                 for k, n in sorted(by_ass.items(), key=lambda kv: -kv[1])]
    today = now().date()
    days = [today - timedelta(days=n) for n in range(13, -1, -1)]
    created = {d: 0 for d in days}
    resolved = {d: 0 for d in days}
    for i in issues:
        cd = aware(i.created_at).date()
        if cd in created:
            created[cd] += 1
        if i.resolved_at:
            rd = aware(i.resolved_at).date()
            if rd in resolved:
                resolved[rd] += 1
    return {"total": len(issues), "by_status_category": by_cat, "by_type": by_type, "by_priority": by_pri,
            "by_assignee": assignees,
            "created_vs_resolved_14d": [{"date": d, "created": created[d], "resolved": resolved[d]} for d in days]}
