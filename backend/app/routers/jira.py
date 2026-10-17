from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import (JiraColumn, JiraComment, JiraHistory, JiraIssue, JiraMember, JiraProject, JiraSprint,
                      User)
from ..schemas import (JiraColumnCreate, JiraColumnUpdate, JiraCommentIn, JiraIssueCreate, JiraIssueUpdate,
                       JiraMemberAdd, JiraMemberUpdate, JiraMoveIn, JiraProjectCreate, JiraProjectUpdate,
                       JiraRankIn, JiraSprintComplete, JiraSprintCreate, JiraSprintStart, JiraSprintUpdate)
from ..services import jira as svc
from ..services.tasks import aware

router = APIRouter(prefix="/api/jira", tags=["jira"])


def _commit(db: Session, conflict: str = "Conflicting update"):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, conflict)


# ------------------------------------------------------------------ projects
@router.get("/projects")
def list_projects(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (db.query(JiraProject, JiraMember.role).join(JiraMember, JiraMember.project_id == JiraProject.id)
            .filter(JiraMember.user_id == user.id).order_by(JiraProject.name, JiraProject.id).all())
    return [svc.project_out(db, p, role) for p, role in rows]


@router.post("/projects", status_code=201)
def create_project(body: JiraProjectCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if db.query(JiraProject.id).filter(JiraProject.key == body.key).first():
        raise HTTPException(409, "A project with this key already exists")
    try:
        p = svc.create_project(db, user, body.key, body.name, body.description)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A project with this key already exists")
    return svc.project_out(db, p, "admin", detail=True)


@router.get("/projects/{key}")
def get_project(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, role = svc.project_for(db, user, key)
    return svc.project_out(db, p, role, detail=True)


@router.patch("/projects/{key}")
def patch_project(key: str, body: JiraProjectUpdate, user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    p, role = svc.project_for(db, user, key, "admin")
    data = body.model_dump(exclude_unset=True)
    if data.get("name", "x") is None:
        raise HTTPException(422, "name cannot be null")
    if data.get("lead_id") is not None and not svc.get_member(db, p.id, data["lead_id"]):
        raise HTTPException(422, "Lead must be a project member")
    for k, v in data.items():
        setattr(p, k, v)
    db.commit()
    return svc.project_out(db, p, role, detail=True)


@router.delete("/projects/{key}", status_code=204)
def delete_project(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key, "admin")
    db.query(JiraIssue).filter(JiraIssue.project_id == p.id).delete(synchronize_session=False)
    db.delete(p)
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ members
def _admin_count(db: Session, project_id: int) -> int:
    return db.query(JiraMember).filter_by(project_id=project_id, role="admin").count()


@router.post("/projects/{key}/members", status_code=201)
def add_member(key: str, body: JiraMemberAdd, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key, "admin")
    target = db.query(User).filter(User.email == body.email.lower()).first()
    if not target:
        raise HTTPException(404, "No user with that email")
    if svc.get_member(db, p.id, target.id):
        raise HTTPException(409, "User is already a member of this project")
    m = JiraMember(project_id=p.id, user_id=target.id, role=body.role)
    db.add(m)
    db.flush()
    svc.notify_added(db, p, target.id, user, body.role)
    _commit(db, "User is already a member of this project")
    return svc.member_out(m, target)


@router.patch("/projects/{key}/members/{user_id}")
def patch_member(key: str, user_id: int, body: JiraMemberUpdate, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key, "admin")
    m = svc.get_member(db, p.id, user_id)
    if not m:
        raise HTTPException(404, "Member not found")
    if m.role == "admin" and body.role != "admin" and _admin_count(db, p.id) <= 1:
        raise HTTPException(409, "A project must keep at least one admin")
    m.role = body.role
    db.commit()
    return svc.member_out(m, db.get(User, user_id))


@router.delete("/projects/{key}/members/{user_id}", status_code=204)
def remove_member(key: str, user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, role = svc.project_for(db, user, key)
    if user_id != user.id:
        svc.require_role(role, "admin")
    m = svc.get_member(db, p.id, user_id)
    if not m:
        raise HTTPException(404, "Member not found")
    if m.role == "admin" and _admin_count(db, p.id) <= 1:
        raise HTTPException(409, "A project must keep at least one admin")
    db.query(JiraIssue).filter(JiraIssue.project_id == p.id, JiraIssue.assignee_id == user_id
                               ).update({"assignee_id": None}, synchronize_session=False)
    if p.lead_id == user_id:
        p.lead_id = None
    db.delete(m)
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ columns
@router.post("/projects/{key}/columns", status_code=201)
def add_column(key: str, body: JiraColumnCreate, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key, "admin")
    cols = svc.project_columns(db, p.id)
    c = JiraColumn(project_id=p.id, name=body.name.strip(), category=body.category,
                   position=(cols[-1].position + 1) if cols else 0)
    db.add(c)
    db.commit()
    return svc.column_out(c)


def _column(db: Session, user: User, column_id: int) -> tuple[JiraColumn, JiraProject]:
    c = db.get(JiraColumn, column_id)
    p = db.get(JiraProject, c.project_id) if c else None
    if not c or not svc.get_member(db, p.id, user.id):
        raise HTTPException(404, "Column not found")
    svc.require_role(svc.get_member(db, p.id, user.id).role, "admin")
    return c, p


@router.patch("/columns/{column_id}")
def patch_column(column_id: int, body: JiraColumnUpdate, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    c, p = _column(db, user, column_id)
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        if data["name"] is None:
            raise HTTPException(422, "name cannot be null")
        c.name = data["name"].strip()
    if data.get("category") is not None and data["category"] != c.category:
        c.category = data["category"]
        for i in db.query(JiraIssue).filter(JiraIssue.column_id == c.id).all():
            svc.set_resolved(i, c)
    if data.get("position") is not None:
        cols = [x for x in svc.project_columns(db, p.id) if x.id != c.id]
        cols.insert(min(data["position"], len(cols)), c)
        for n, x in enumerate(cols):
            x.position = n
    db.commit()
    return svc.column_out(c)


@router.delete("/columns/{column_id}", status_code=204)
def delete_column(column_id: int, move_to: int | None = None, user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    c, p = _column(db, user, column_id)
    cols = svc.project_columns(db, p.id)
    if len(cols) <= 1:
        raise HTTPException(409, "Cannot delete the last column")
    issues = db.query(JiraIssue).filter(JiraIssue.column_id == c.id).all()
    if issues:
        if move_to is None:
            raise HTTPException(409, "Column has issues; pass move_to=<column_id> to move them")
        if move_to == c.id:
            raise HTTPException(422, "move_to must be a different column")
        target = svc.column_in_project(db, p, move_to)
        for i in issues:
            i.column_id = target.id
            svc.set_resolved(i, target)
        db.flush()
    db.delete(c)
    db.flush()
    for n, x in enumerate(svc.project_columns(db, p.id)):
        x.position = n
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ issues
@router.get("/projects/{key}/issues")
def list_issues(response: Response, key: str, q: str | None = None, type: str | None = None,
                status_category: str | None = None, column_id: int | None = None, assignee: str | None = None,
                priority: str | None = None, label: str | None = None, sprint_id: str | None = None,
                parent_id: int | None = None, sort: Literal["rank", "created", "updated", "priority", "due"] = "rank",
                order: Literal["asc", "desc"] = "asc", limit: int = Query(100, ge=1, le=200),
                offset: int = Query(0, ge=0), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key)
    query = svc.issue_filters(db, p, user, q, type, status_category, column_id, assignee, priority, label,
                              sprint_id, parent_id)
    response.headers["X-Total-Count"] = str(query.count())
    rows = query.order_by(*svc.sort_clause(sort, order)).offset(offset).limit(limit).all()
    return svc.serialize_issues(db, rows)


@router.post("/projects/{key}/issues", status_code=201)
def create_issue(key: str, body: JiraIssueCreate, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key, "member")
    try:
        issue = svc.create_issue(db, p, user, body.model_dump(exclude_unset=True))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Could not allocate an issue number, retry")
    return svc.serialize_issue(db, issue, detail=True)


# my-issues is declared before the /issues/{key} routes only for readability; paths do not collide
@router.get("/my-issues")
def my_issues(status_category: Literal["open", "done"] | None = None, user: User = Depends(get_current_user),
              db: Session = Depends(get_db)):
    q = (db.query(JiraIssue).join(JiraMember, (JiraMember.project_id == JiraIssue.project_id)
                                  & (JiraMember.user_id == user.id))
         .join(JiraColumn, JiraColumn.id == JiraIssue.column_id).filter(JiraIssue.assignee_id == user.id))
    if status_category == "done":
        q = q.filter(JiraColumn.category == "done")
    elif status_category == "open":
        q = q.filter(JiraColumn.category != "done")
    rows = q.order_by(JiraIssue.updated_at.desc(), JiraIssue.id.desc()).limit(200).all()
    return svc.serialize_issues(db, rows)


@router.get("/issues/{key}")
def get_issue(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    i, _, _ = svc.issue_for(db, user, key)
    return svc.serialize_issue(db, i, detail=True)


@router.patch("/issues/{key}")
def patch_issue(key: str, body: JiraIssueUpdate, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    i, p, _ = svc.issue_for(db, user, key, "member")
    svc.update_issue(db, p, i, user, body.model_dump(exclude_unset=True))
    db.commit()
    return svc.serialize_issue(db, i, detail=True)


@router.delete("/issues/{key}", status_code=204)
def delete_issue(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    i, _, _ = svc.issue_for(db, user, key, "member")
    svc.delete_issue(db, i)
    db.commit()
    return Response(status_code=204)


@router.post("/issues/{key}/move")
def move_issue(key: str, body: JiraMoveIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    i, p, _ = svc.issue_for(db, user, key, "member")
    svc.move_issue(db, p, i, user, body.column_id, body.before_issue_id, body.after_issue_id)
    db.commit()
    return svc.serialize_issue(db, i, detail=True)


@router.post("/issues/{key}/rank")
def rank_issue(key: str, body: JiraRankIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    i, p, _ = svc.issue_for(db, user, key, "member")
    svc.rank_issue(db, p, i, user, body.sprint_id, body.before_issue_id, body.after_issue_id)
    db.commit()
    return svc.serialize_issue(db, i, detail=True)


@router.get("/issues/{key}/history")
def issue_history(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    i, _, _ = svc.issue_for(db, user, key)
    rows = db.query(JiraHistory).filter_by(issue_id=i.id).order_by(JiraHistory.id.desc()).all()
    users = {u.id: u for u in db.query(User).filter(User.id.in_({r.user_id for r in rows})).all()} if rows else {}
    return [{"id": r.id, "user": svc.user_ref(users.get(r.user_id)), "field": r.field, "old_value": r.old_value,
             "new_value": r.new_value, "created_at": aware(r.created_at)} for r in rows]


# ------------------------------------------------------------------ comments
def _comment_users(db: Session, rows) -> dict:
    ids = {c.user_id for c in rows}
    return {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}


@router.get("/issues/{key}/comments")
def list_comments(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    i, p, _ = svc.issue_for(db, user, key)
    rows = db.query(JiraComment).filter_by(issue_id=i.id).order_by(JiraComment.id).all()
    users = _comment_users(db, rows)
    return [svc.comment_out(c, svc.issue_key(p, i), users) for c in rows]


@router.post("/issues/{key}/comments", status_code=201)
def add_comment(key: str, body: JiraCommentIn, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    i, p, _ = svc.issue_for(db, user, key, "member")
    c = JiraComment(issue_id=i.id, user_id=user.id, body=body.body)
    db.add(c)
    db.flush()
    svc.notify_comment(db, p, i, c, user)
    db.commit()
    return svc.comment_out(c, svc.issue_key(p, i), {user.id: user})


def _comment(db: Session, user: User, comment_id: int):
    c = db.get(JiraComment, comment_id)
    i = db.get(JiraIssue, c.issue_id) if c else None
    p = db.get(JiraProject, i.project_id) if i else None
    m = svc.get_member(db, p.id, user.id) if p else None
    if not c or not m:
        raise HTTPException(404, "Comment not found")
    if not (m.role == "admin" or (c.user_id == user.id and m.role != "viewer")):
        raise HTTPException(403, "Only the author or a project admin can change this comment")
    return c, i, p


@router.patch("/comments/{comment_id}")
def patch_comment(comment_id: int, body: JiraCommentIn, user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    c, i, p = _comment(db, user, comment_id)
    c.body = body.body
    db.commit()
    return svc.comment_out(c, svc.issue_key(p, i), _comment_users(db, [c]))


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(comment_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c, _, _ = _comment(db, user, comment_id)
    db.delete(c)
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ sprints
def _sprint(db: Session, user: User, sprint_id: int, min_role: str = "viewer"):
    s = db.get(JiraSprint, sprint_id)
    p = db.get(JiraProject, s.project_id) if s else None
    m = svc.get_member(db, p.id, user.id) if p else None
    if not s or not m:
        raise HTTPException(404, "Sprint not found")
    svc.require_role(m.role, min_role)
    return s, p


@router.get("/projects/{key}/sprints")
def list_sprints(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key)
    return [svc.sprint_out(db, s) for s in svc.project_sprints(db, p.id)]


@router.post("/projects/{key}/sprints", status_code=201)
def create_sprint(key: str, body: JiraSprintCreate, user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key, "member")
    s = JiraSprint(project_id=p.id, name=body.name.strip(), goal=body.goal, start_date=body.start_date,
                   end_date=body.end_date, state="planned")
    db.add(s)
    db.commit()
    return svc.sprint_out(db, s)


@router.patch("/sprints/{sprint_id}")
def patch_sprint(sprint_id: int, body: JiraSprintUpdate, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    s, _ = _sprint(db, user, sprint_id, "member")
    if s.state == "closed":
        raise HTTPException(409, "A closed sprint cannot be edited")
    data = body.model_dump(exclude_unset=True)
    if data.get("name", "x") is None:
        raise HTTPException(422, "name cannot be null")
    for k, v in data.items():
        setattr(s, k, v)
    if s.start_date and s.end_date and s.end_date < s.start_date:
        db.rollback()
        raise HTTPException(422, "end_date must be on or after start_date")
    db.commit()
    return svc.sprint_out(db, s)


@router.delete("/sprints/{sprint_id}", status_code=204)
def delete_sprint(sprint_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s, _ = _sprint(db, user, sprint_id, "admin")
    db.query(JiraIssue).filter(JiraIssue.sprint_id == s.id).update({"sprint_id": None}, synchronize_session=False)
    db.delete(s)
    db.commit()
    return Response(status_code=204)


@router.post("/sprints/{sprint_id}/start")
def start_sprint(sprint_id: int, body: JiraSprintStart | None = None, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    s, p = _sprint(db, user, sprint_id, "member")
    if s.state != "planned":
        raise HTTPException(409, f"Only a planned sprint can be started (this one is {s.state})")
    if svc.active_sprint(db, p.id):
        raise HTTPException(409, "Another sprint is already active in this project")
    body = body or JiraSprintStart()
    start = body.start_date or s.start_date or svc.now().date()
    end = body.end_date or s.end_date or (start + timedelta(days=14))
    if end < start:
        raise HTTPException(422, "end_date must be on or after start_date")
    s.state, s.start_date, s.end_date = "active", start, end
    db.commit()
    return svc.sprint_out(db, s)


@router.post("/sprints/{sprint_id}/complete")
def complete_sprint(sprint_id: int, body: JiraSprintComplete | None = None,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s, p = _sprint(db, user, sprint_id, "member")
    if s.state != "active":
        raise HTTPException(409, "Only an active sprint can be completed")
    target = (body or JiraSprintComplete()).move_open_to
    target_id = None
    if str(target) != "backlog":
        if not str(target).isdigit():
            raise HTTPException(422, "move_open_to must be 'backlog' or a sprint id")
        target_id = int(target)
        if target_id == s.id:
            raise HTTPException(422, "move_open_to cannot be the sprint being completed")
        svc.check_sprint(db, p, target_id)
    done_ids = [c.id for c in svc.project_columns(db, p.id) if c.category == "done"]
    open_issues = db.query(JiraIssue).filter(JiraIssue.sprint_id == s.id,
                                             JiraIssue.column_id.notin_(done_ids or [-1])).all()
    for i in open_issues:
        svc.log_change(db, i, user, "sprint", s.name, svc.sprint_name(db, target_id))
        i.sprint_id = target_id
    s.state, s.completed_at = "closed", svc.now()
    db.commit()
    return svc.sprint_out(db, s)


@router.get("/sprints/{sprint_id}/report")
def sprint_report(sprint_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s, _ = _sprint(db, user, sprint_id)
    return svc.sprint_report(db, s)


# ------------------------------------------------------------------ board / summary
@router.get("/projects/{key}/board")
def board(key: str, sprint_id: str = "active", assignee: str | None = None, label: str | None = None,
          q: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key)
    sprint = None
    if sprint_id == "active":
        sprint = svc.active_sprint(db, p.id)
    elif sprint_id.isdigit():
        sprint = db.get(JiraSprint, int(sprint_id))
        if not sprint or sprint.project_id != p.id:
            raise HTTPException(404, "Sprint not found")
    elif sprint_id != "all":
        raise HTTPException(422, "sprint_id must be 'active', 'all' or a sprint id")
    sid = "all" if sprint_id == "all" else str(sprint.id if sprint else 0)
    query = svc.issue_filters(db, p, user, q=q, assignee=assignee, label=label, sprint_id=sid)
    rows = query.order_by(JiraIssue.rank, JiraIssue.id).all()
    cards = svc.serialize_issues(db, rows)
    by_col: dict[int, list] = {}
    for c in cards:
        by_col.setdefault(c["column_id"], []).append(c)
    return {"sprint": svc.sprint_out(db, sprint) if sprint else None,
            "columns": [{**svc.column_out(c), "issues": by_col.get(c.id, [])}
                        for c in svc.project_columns(db, p.id)]}


@router.get("/projects/{key}/summary")
def summary(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key)
    return svc.project_summary(db, p)
