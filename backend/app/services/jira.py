"""Jira-style module: permissions, key parsing, ranking, serialization, history and notifications."""
import re
import time
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import String, case, cast, func, or_, update
from sqlalchemy.orm import Session

import json
import re as _re

from ..models import (JiraColumn, JiraComment, JiraComponent, JiraCustomField, JiraHistory, JiraIssue,
                      JiraIssueComponent, JiraLink, JiraMember, JiraProject, JiraSprint, JiraTransition,
                      JiraVersion, JiraWatcher, JiraWorklog, JiraAttachment, User)
from . import mailer
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


def check_writable(p: JiraProject):
    if p.archived:
        raise HTTPException(409, "Project is archived and read-only")


def project_for(db: Session, user: User, key: str, min_role: str = "viewer",
                allow_archived: bool = False) -> tuple[JiraProject, str]:
    p = db.query(JiraProject).filter(JiraProject.key == key.strip().upper()).first()
    m = get_member(db, p.id, user.id) if p else None
    if not p or not m:  # non-members must not learn the project exists
        raise HTTPException(404, "Project not found")
    require_role(m.role, min_role)
    if min_role != "viewer" and not allow_archived:
        check_writable(p)
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


def _name(db: Session, uid: int | None) -> str:
    u = db.get(User, uid) if uid else None
    return u.name if u else "nobody"


def notify_assigned(db: Session, project: JiraProject, issue: JiraIssue, actor: User):
    if issue.assignee_id and issue.assignee_id != actor.id:
        k = issue_key(project, issue)
        notif.create_notification(
            db, issue.assignee_id, "jira", f"{k} assigned to you", f"{actor.name} assigned you: {issue.title}",
            {"issue_key": k}, dedupe_key=f"jira:assigned:{issue.id}:{issue.assignee_id}:{_uniq()}")
        mailer.notify_user(db, issue.assignee_id, f"[{k}] assigned to you",
                           f"{actor.name} assigned you {k}: {issue.title}")
        add_watcher(db, issue.id, issue.assignee_id)
        notify_watchers(db, project, issue, actor, f"{k} assigned to {_name(db, issue.assignee_id)}",
                        f"{actor.name} assigned {k} to {_name(db, issue.assignee_id)}: {issue.title}",
                        exclude={issue.assignee_id})
    elif issue.assignee_id:
        add_watcher(db, issue.id, issue.assignee_id)


def notify_added(db: Session, project: JiraProject, user_id: int, actor: User, role: str):
    if user_id != actor.id:
        notif.create_notification(
            db, user_id, "jira", f"Added to project {project.key}",
            f"{actor.name} added you to {project.name} as {role}", {"project_key": project.key},
            dedupe_key=f"jira:member:{project.id}:{user_id}:{_uniq()}")


# ---- watchers / mentions
MENTION_RE = _re.compile(r"@\[user:(\d+)\]")


def mention_ids(body: str) -> list[int]:
    seen: list[int] = []
    for m in MENTION_RE.finditer(body or ""):
        n = int(m.group(1))
        if n not in seen:
            seen.append(n)
    return seen


def add_watcher(db: Session, issue_id: int, user_id: int | None):
    if user_id is None:
        return
    if db.query(JiraWatcher.id).filter_by(issue_id=issue_id, user_id=user_id).first() is None:
        db.add(JiraWatcher(issue_id=issue_id, user_id=user_id))
        db.flush()


def watcher_ids(db: Session, project: JiraProject, issue: JiraIssue) -> set[int]:
    """Watchers who are still project members."""
    ids = {r[0] for r in db.query(JiraWatcher.user_id).filter_by(issue_id=issue.id).all()}
    if not ids:
        return set()
    ok = {r[0] for r in db.query(JiraMember.user_id).filter(JiraMember.project_id == project.id,
                                                            JiraMember.user_id.in_(ids)).all()}
    return ok


def notify_watchers(db: Session, project: JiraProject, issue: JiraIssue, actor: User, title: str, body: str,
                    exclude: set[int] = frozenset()):
    k = issue_key(project, issue)
    for uid in watcher_ids(db, project, issue) - {actor.id} - set(exclude):
        notif.create_notification(db, uid, "jira", title, body, {"issue_key": k},
                                  dedupe_key=f"jira:watch:{issue.id}:{uid}:{_uniq()}")


def notify_status(db: Session, project: JiraProject, issue: JiraIssue, actor: User, old: str | None, new: str):
    k = issue_key(project, issue)
    notify_watchers(db, project, issue, actor, f"{k} moved to {new}",
                    f"{actor.name} changed status from {old or '-'} to {new}: {issue.title}")


def notify_comment(db: Session, project: JiraProject, issue: JiraIssue, comment: JiraComment, actor: User):
    k = issue_key(project, issue)
    mentioned = notify_mentions(db, project, issue, comment, actor)
    recipients = ({issue.assignee_id, issue.reporter_id} | watcher_ids(db, project, issue)) - {None, actor.id}
    for uid in recipients - mentioned:
        if not get_member(db, project.id, uid):
            continue
        notif.create_notification(
            db, uid, "jira", f"New comment on {k}", f"{actor.name}: {comment.body[:140]}", {"issue_key": k},
            dedupe_key=f"jira:comment:{comment.id}:{uid}")


def notify_mentions(db: Session, project: JiraProject, issue: JiraIssue, comment: JiraComment,
                    actor: User) -> set[int]:
    """Notify mentioned project members (deduped per comment+user) and auto-watch them. Returns their ids."""
    k = issue_key(project, issue)
    out: set[int] = set()
    for uid in mention_ids(comment.body):
        if not get_member(db, project.id, uid):
            continue
        add_watcher(db, issue.id, uid)
        if uid == actor.id:
            continue
        out.add(uid)
        n = notif.create_notification(
            db, uid, "jira", f"{actor.name} mentioned you on {k}", comment.body[:140], {"issue_key": k},
            dedupe_key=f"jira:mention:{comment.id}:{uid}")
        if n is not None:
            mailer.notify_user(db, uid, f"[{k}] {actor.name} mentioned you",
                               f"{actor.name} mentioned you on {k} ({issue.title}):" + chr(10) * 2 + comment.body[:500])
    return out


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
LINK_LABELS = {  # (link_type, is_source) -> label
    ("blocks", True): "blocks", ("blocks", False): "is blocked by",
    ("relates", True): "relates to", ("relates", False): "relates to",
    ("duplicates", True): "duplicates", ("duplicates", False): "is duplicated by",
    ("clones", True): "clones", ("clones", False): "is cloned by"}


def serialize_issues(db: Session, issues: list[JiraIssue], detail: bool = False,
                     viewer: User | None = None) -> list[dict]:
    if not issues:
        return []
    ids = [i.id for i in issues]
    idset = set(ids)
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
    # v2 batches
    comps: dict[int, list] = {}
    for iid, cid, cname in (db.query(JiraIssueComponent.issue_id, JiraComponent.id, JiraComponent.name)
                            .join(JiraComponent, JiraComponent.id == JiraIssueComponent.component_id)
                            .filter(JiraIssueComponent.issue_id.in_(ids)).order_by(JiraComponent.name).all()):
        comps.setdefault(iid, []).append({"id": cid, "name": cname})
    vids = {i.fix_version_id for i in issues if i.fix_version_id}
    versions = {v.id: v for v in db.query(JiraVersion).filter(JiraVersion.id.in_(vids)).all()} if vids else {}
    watch_count = dict(db.query(JiraWatcher.issue_id, func.count(JiraWatcher.id))
                       .filter(JiraWatcher.issue_id.in_(ids)).group_by(JiraWatcher.issue_id).all())
    watching = ({r[0] for r in db.query(JiraWatcher.issue_id).filter(JiraWatcher.issue_id.in_(ids),
                                                                   JiraWatcher.user_id == viewer.id).all()}
                if viewer else set())
    spent = dict(db.query(JiraWorklog.issue_id, func.coalesce(func.sum(JiraWorklog.seconds), 0))
                 .filter(JiraWorklog.issue_id.in_(ids)).group_by(JiraWorklog.issue_id).all())
    att = dict(db.query(JiraAttachment.issue_id, func.count(JiraAttachment.id))
               .filter(JiraAttachment.issue_id.in_(ids)).group_by(JiraAttachment.issue_id).all())
    # links (+ blocked flag)
    link_rows = (db.query(JiraLink).filter(or_(JiraLink.source_id.in_(ids), JiraLink.target_id.in_(ids))).all())
    other_ids = {x for l in link_rows for x in (l.source_id, l.target_id)} - set(ids)
    others = {o.id: o for o in db.query(JiraIssue).filter(JiraIssue.id.in_(other_ids)).all()} if other_ids else {}
    by_id = {i.id: i for i in issues}
    by_id.update(others)
    opids = {o.project_id for o in others.values()} - set(projects)
    all_projects = dict(projects)
    if opids:
        all_projects.update({p.id: p for p in db.query(JiraProject).filter(JiraProject.id.in_(opids)).all()})
        cols.update({c.id: c for c in db.query(JiraColumn).filter(JiraColumn.project_id.in_(opids)).all()})
    visible = None
    if viewer is not None:
        visible = {r[0] for r in db.query(JiraMember.project_id).filter(JiraMember.user_id == viewer.id).all()}
    links: dict[int, list] = {}
    blocked: set[int] = set()
    for l in link_rows:
        for me, other, is_src in ((l.source_id, l.target_id, True), (l.target_id, l.source_id, False)):
            if me not in idset:
                continue
            o = by_id.get(other)
            if o is None:
                continue
            oc = cols.get(o.column_id)
            if l.link_type == "blocks" and not is_src and oc is not None and oc.category != "done":
                blocked.add(me)
            if visible is not None and o.project_id not in visible:
                continue
            op = all_projects.get(o.project_id)
            links.setdefault(me, []).append({
                "id": l.id, "link_type": l.link_type, "direction_label": LINK_LABELS[(l.link_type, is_src)],
                "issue": {"id": o.id, "key": f"{op.key}-{o.number}" if op else str(o.id), "title": o.title,
                          "status_name": oc.name if oc else None, "status_category": oc.category if oc else None,
                          "type": o.type}})
    trans: dict[int, dict[int, set]] = {}
    enforced = [p.id for p in projects.values() if p.enforce_workflow]
    if enforced:
        for t in db.query(JiraTransition).filter(JiraTransition.project_id.in_(enforced)).all():
            trans.setdefault(t.project_id, {}).setdefault(t.from_column_id, set()).add(t.to_column_id)
    proj_cols: dict[int, list] = {}
    for c in sorted(cols.values(), key=lambda c: (c.position, c.id)):
        proj_cols.setdefault(c.project_id, []).append(c.id)
    out = []
    for i in issues:
        proj = projects[i.project_id]
        col = cols.get(i.column_id)
        par = parents.get(i.parent_id)
        ver = versions.get(i.fix_version_id)
        clist = comps.get(i.id, [])
        if proj.enforce_workflow:
            allowed = [c for c in proj_cols.get(proj.id, [])
                       if c == i.column_id or c in trans.get(proj.id, {}).get(i.column_id, set())]
        else:
            allowed = proj_cols.get(proj.id, [])
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
             "comment_count": comments.get(i.id, 0),
             "start_date": i.start_date, "original_estimate_min": i.original_estimate_min,
             "remaining_estimate_min": i.remaining_estimate_min, "flagged": bool(i.flagged),
             "archived": bool(i.archived), "fix_version_id": i.fix_version_id,
             "fix_version": {"id": ver.id, "name": ver.name} if ver else None,
             "custom_fields": dict(i.custom_fields or {}), "environment": i.environment,
             "component_ids": [c["id"] for c in clist], "components": clist,
             "watchers_count": watch_count.get(i.id, 0), "is_watching": i.id in watching,
             "time_spent_min": int(spent.get(i.id, 0)) // 60, "links": links.get(i.id, []),
             "attachment_count": att.get(i.id, 0), "blocked": i.id in blocked,
             "allowed_column_ids": allowed}
        out.append(d)
    if detail:
        atts: dict[int, list] = {}
        arows = (db.query(JiraAttachment.id, JiraAttachment.issue_id, JiraAttachment.filename,
                          JiraAttachment.size, JiraAttachment.content_type, JiraAttachment.user_id,
                          JiraAttachment.created_at)
                 .filter(JiraAttachment.issue_id.in_(ids)).order_by(JiraAttachment.id).all())
        au = {u.id: u for u in db.query(User).filter(User.id.in_({r[5] for r in arows})).all()} if arows else {}
        for aid, iid, fn, size, ct, uid_, ca in arows:
            atts.setdefault(iid, []).append({"id": aid, "filename": fn, "size": size, "content_type": ct,
                                             "user": user_ref(au.get(uid_)), "created_at": aware(ca)})
        for d, i in zip(out, issues):
            kids = (db.query(JiraIssue).filter(JiraIssue.parent_id == i.id, JiraIssue.type == "subtask")
                    .order_by(JiraIssue.rank, JiraIssue.id).all())
            d["subtasks"] = serialize_issues(db, kids, viewer=viewer)
            d["epic_children_count"] = (db.query(func.count(JiraIssue.id))
                                        .filter(JiraIssue.parent_id == i.id).scalar() if i.type == "epic" else 0)
            d["attachments"] = atts.get(i.id, [])
    return out


def serialize_issue(db: Session, issue: JiraIssue, detail: bool = False, viewer: User | None = None) -> dict:
    return serialize_issues(db, [issue], detail, viewer)[0]


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
    issue_count = (db.query(func.count(JiraIssue.id))
                   .filter(JiraIssue.project_id == p.id, JiraIssue.archived.is_(False)).scalar() or 0)
    done_count = (db.query(func.count(JiraIssue.id))
                  .filter(JiraIssue.project_id == p.id, JiraIssue.archived.is_(False),
                          JiraIssue.column_id.in_(done_ids or [-1])).scalar() or 0)
    members = db.query(func.count(JiraMember.id)).filter(JiraMember.project_id == p.id).scalar() or 0
    act = active_sprint(db, p.id)
    out = {"id": p.id, "key": p.key, "name": p.name, "description": p.description, "lead": user_ref(lead),
           "my_role": role, "member_count": members, "issue_count": issue_count,
           "open_issue_count": issue_count - done_count,
           "active_sprint": {"id": act.id, "name": act.name} if act else None,
           "board_type": p.board_type or "scrum", "enforce_workflow": bool(p.enforce_workflow),
           "default_assignee_id": p.default_assignee_id, "archived": bool(p.archived),
           "created_at": aware(p.created_at), "updated_at": aware(p.updated_at)}
    if detail:
        out["columns"] = [column_out(c) for c in project_columns(db, p.id)]
        out["members"] = member_list(db, p.id)
        out["sprints"] = [sprint_out(db, s) for s in project_sprints(db, p.id)]
        out["components"] = [{"id": c.id, "name": c.name} for c in
                             db.query(JiraComponent).filter_by(project_id=p.id).order_by(JiraComponent.name)]
        out["versions"] = [{"id": v.id, "name": v.name, "released": bool(v.released)} for v in
                           db.query(JiraVersion).filter_by(project_id=p.id).order_by(JiraVersion.id)]
        out["custom_fields"] = [custom_field_out(f) for f in
                                db.query(JiraCustomField).filter_by(project_id=p.id)
                                .order_by(JiraCustomField.position, JiraCustomField.id)]
    return out


def column_out(c: JiraColumn) -> dict:
    return {"id": c.id, "project_id": c.project_id, "name": c.name, "category": c.category,
            "position": c.position, "wip_limit": c.wip_limit}


def custom_field_out(f: JiraCustomField) -> dict:
    return {"id": f.id, "project_id": f.project_id, "name": f.name, "field_type": f.field_type,
            "options": list(f.options or []), "required": bool(f.required), "position": f.position}


def member_list(db: Session, project_id: int) -> list[dict]:
    rows = (db.query(JiraMember, User).join(User, User.id == JiraMember.user_id)
            .filter(JiraMember.project_id == project_id).order_by(User.name, User.id).all())
    return [member_out(m, u) for m, u in rows]


def member_out(m: JiraMember, u: User) -> dict:
    return {"user_id": u.id, "name": u.name, "email": u.email, "role": m.role}


def comment_out(c: JiraComment, key: str, users: dict) -> dict:
    return {"id": c.id, "issue_key": key, "user": user_ref(users.get(c.user_id)), "body": c.body,
            "mentions": [user_ref(users[n]) for n in mention_ids(c.body) if n in users],
            "created_at": aware(c.created_at), "updated_at": aware(c.updated_at)}


# ------------------------------------------------------------------ project / issue operations
def accept_invites(db: Session, user: User) -> int:
    """Convert pending invites for the user's email into memberships (idempotent)."""
    from ..models import JiraInvite
    invs = db.query(JiraInvite).filter(JiraInvite.email == user.email.lower()).all()
    n = 0
    for inv in invs:
        proj = db.get(JiraProject, inv.project_id)
        if proj is not None and not get_member(db, proj.id, user.id):
            db.add(JiraMember(project_id=proj.id, user_id=user.id, role=inv.role))
            inviter = db.get(User, inv.invited_by) if inv.invited_by else None
            notif.create_notification(
                db, user.id, "jira", f"Added to project {proj.key}",
                f"{inviter.name if inviter else 'Someone'} added you to {proj.name} as {inv.role}",
                {"project_key": proj.key}, dedupe_key=f"jira:invite:{inv.id}")
            n += 1
        db.delete(inv)
    if invs:
        db.flush()
    return n


def create_project(db: Session, user: User, key: str, name: str, description: str | None,
                   board_type: str = "scrum") -> JiraProject:
    p = JiraProject(key=key, name=name, description=description, lead_id=user.id, issue_seq=0,
                    board_type=board_type)
    db.add(p)
    db.flush()
    db.add(JiraMember(project_id=p.id, user_id=user.id, role="admin"))
    for n, (cname, cat) in enumerate(DEFAULT_COLUMNS):
        db.add(JiraColumn(project_id=p.id, name=cname, category=cat, position=n))
    if board_type != "kanban":
        db.add(JiraSprint(project_id=p.id, name="Sprint 1", state="planned"))
    db.flush()
    return p


# ------------------------------------------------------------------ v2 field helpers
def check_version(db: Session, project: JiraProject, version_id: int | None) -> JiraVersion | None:
    if version_id is None:
        return None
    v = db.get(JiraVersion, version_id)
    if not v or v.project_id != project.id:
        raise HTTPException(422, "fix_version_id does not belong to this project")
    return v


def check_components(db: Session, project: JiraProject, ids: list[int]) -> list[JiraComponent]:
    ids = list(dict.fromkeys(ids or []))
    if not ids:
        return []
    rows = db.query(JiraComponent).filter(JiraComponent.project_id == project.id, JiraComponent.id.in_(ids)).all()
    if len(rows) != len(ids):
        raise HTTPException(422, "component_ids must all belong to this project")
    return sorted(rows, key=lambda c: c.name)


def issue_components(db: Session, issue: JiraIssue) -> list[JiraComponent]:
    return (db.query(JiraComponent).join(JiraIssueComponent, JiraIssueComponent.component_id == JiraComponent.id)
            .filter(JiraIssueComponent.issue_id == issue.id).order_by(JiraComponent.name).all())


def set_components(db: Session, issue: JiraIssue, comps: list[JiraComponent]):
    db.query(JiraIssueComponent).filter(JiraIssueComponent.issue_id == issue.id).delete(synchronize_session=False)
    for c in comps:
        db.add(JiraIssueComponent(issue_id=issue.id, component_id=c.id))
    db.flush()


def validate_custom_fields(db: Session, project: JiraProject, values: dict, base: dict | None = None,
                           require: bool = False) -> dict:
    """Type-check `values` against project field definitions and merge them onto `base`.
    A null value clears a field. With require=True every required field must end up set."""
    defs = {str(f.id): f for f in db.query(JiraCustomField).filter_by(project_id=project.id).all()}
    out = dict(base or {})
    for k, v in (values or {}).items():
        k = str(k)
        f = defs.get(k)
        if f is None:
            raise HTTPException(422, f"Unknown custom field {k}")
        if v is None or v == "":
            out.pop(k, None)
            continue
        t = f.field_type
        if t == "text":
            if not isinstance(v, str) or len(v) > 5000:
                raise HTTPException(422, f"{f.name}: expected text up to 5000 characters")
        elif t == "number":
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise HTTPException(422, f"{f.name}: expected a number")
        elif t == "select":
            if v not in (f.options or []):
                raise HTTPException(422, f"{f.name}: must be one of {', '.join(f.options or [])}")
        elif t == "date":
            try:
                date.fromisoformat(str(v))
            except ValueError:
                raise HTTPException(422, f"{f.name}: expected a date YYYY-MM-DD")
        elif t == "checkbox":
            if not isinstance(v, bool):
                raise HTTPException(422, f"{f.name}: expected true or false")
        out[k] = v
    if require:
        for k, f in defs.items():
            if f.required and k not in out:
                raise HTTPException(422, f"{f.name} is required")
    return out


def check_transition(db: Session, project: JiraProject, from_id: int, to_id: int):
    """409 listing allowed targets when the project enforces its workflow."""
    if not project.enforce_workflow or from_id == to_id:
        return
    ok = db.query(JiraTransition.id).filter_by(project_id=project.id, from_column_id=from_id,
                                              to_column_id=to_id).first()
    if ok:
        return
    targets = {t.to_column_id for t in db.query(JiraTransition).filter_by(project_id=project.id,
                                                                         from_column_id=from_id).all()}
    allowed = [c.name for c in project_columns(db, project.id) if c.id in targets]
    raise HTTPException(409, "Transition not allowed by the workflow. Allowed targets: "
                        + (", ".join(allowed) if allowed else "none"))


def create_issue(db: Session, project: JiraProject, user: User, data: dict) -> JiraIssue:
    itype = data.get("type", "task")
    parent = validate_parent(db, project, itype, data.get("parent_id"))
    if data.get("column_id") is not None:
        col = column_in_project(db, project, data["column_id"])
    else:
        col = project_columns(db, project.id)[0]
    if "assignee_id" not in data and project.default_assignee_id and get_member(db, project.id,
                                                                             project.default_assignee_id):
        data = {**data, "assignee_id": project.default_assignee_id}
    check_assignee(db, project, data.get("assignee_id"))
    check_version(db, project, data.get("fix_version_id"))
    comps = check_components(db, project, data.get("component_ids") or [])
    cfields = validate_custom_fields(db, project, data.get("custom_fields") or {}, require=True)
    kanban = project.board_type == "kanban"
    if kanban:
        sprint_id = None
    elif "sprint_id" in data:
        sprint_id = data["sprint_id"]
        check_sprint(db, project, sprint_id)
    elif parent is not None and itype == "subtask" and parent.sprint_id and not kanban:
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
                      due_date=data.get("due_date"), rank=next_rank(db, project.id),
                      start_date=data.get("start_date"), original_estimate_min=data.get("original_estimate_min"),
                      remaining_estimate_min=data.get("remaining_estimate_min", data.get("original_estimate_min")),
                      flagged=bool(data.get("flagged", False)), archived=bool(data.get("archived", False)),
                      fix_version_id=data.get("fix_version_id"), custom_fields=cfields,
                      environment=data.get("environment"))
    set_resolved(issue, col)
    db.add(issue)
    db.flush()
    set_components(db, issue, comps)
    add_watcher(db, issue.id, user.id)
    notify_assigned(db, project, issue, user)
    return issue


_SIMPLE: tuple = ("title", "description", "priority", "story_points", "due_date")


def update_issue(db: Session, project: JiraProject, issue: JiraIssue, user: User, data: dict):
    """Apply a PATCH dict (only the provided keys), writing history rows for every changed field."""
    if project.board_type == "kanban":
        data.pop("sprint_id", None)
    for k in ("type", "title", "priority", "column_id", "flagged", "archived", "component_ids", "custom_fields"):
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
    if new_col is not None:
        check_transition(db, project, issue.column_id, new_col.id)
    if "fix_version_id" in data:
        check_version(db, project, data["fix_version_id"])
    new_comps = check_components(db, project, data["component_ids"]) if "component_ids" in data else None
    new_cf = (validate_custom_fields(db, project, data["custom_fields"], base=issue.custom_fields)
              if "custom_fields" in data else None)

    notify = False
    for k in _SIMPLE + ("start_date", "original_estimate_min", "remaining_estimate_min", "flagged", "archived",
                        "environment"):
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
        notify_status(db, project, issue, user, old_col.name if old_col else None, new_col.name)
    if "fix_version_id" in data and data["fix_version_id"] != issue.fix_version_id:
        ov = db.get(JiraVersion, issue.fix_version_id) if issue.fix_version_id else None
        nv = db.get(JiraVersion, data["fix_version_id"]) if data["fix_version_id"] else None
        log_change(db, issue, user, "fix_version", ov.name if ov else None, nv.name if nv else None)
        issue.fix_version_id = data["fix_version_id"]
    if new_comps is not None:
        old_names = [c.name for c in issue_components(db, issue)]
        new_names = [c.name for c in new_comps]
        if old_names != new_names:
            log_change(db, issue, user, "components", ", ".join(old_names), ", ".join(new_names))
            set_components(db, issue, new_comps)
    if new_cf is not None:
        names = {str(f.id): f.name for f in db.query(JiraCustomField).filter_by(project_id=project.id).all()}
        old_cf = dict(issue.custom_fields or {})
        for k in set(old_cf) | set(new_cf):
            if old_cf.get(k) != new_cf.get(k):
                log_change(db, issue, user, "cf:" + names.get(k, k), old_cf.get(k), new_cf.get(k))
        issue.custom_fields = new_cf
    issue.updated_at = now()
    db.flush()
    if notify:
        notify_assigned(db, project, issue, user)


def move_issue(db: Session, project: JiraProject, issue: JiraIssue, user: User, column_id: int,
               before_id: int | None, after_id: int | None):
    col = column_in_project(db, project, column_id)
    check_transition(db, project, issue.column_id, col.id)
    items = (db.query(JiraIssue).filter(JiraIssue.project_id == project.id, JiraIssue.column_id == col.id,
                                        JiraIssue.id != issue.id).order_by(JiraIssue.rank, JiraIssue.id).all())
    rank = compute_rank(items, before_id, after_id)
    if col.id != issue.column_id:
        old_col = db.get(JiraColumn, issue.column_id)
        log_change(db, issue, user, "status", old_col.name if old_col else None, col.name)
        issue.column_id = col.id
        set_resolved(issue, col)
        notify_status(db, project, issue, user, old_col.name if old_col else None, col.name)
    issue.rank = rank
    issue.updated_at = now()
    db.flush()


def rank_issue(db: Session, project: JiraProject, issue: JiraIssue, user: User, sprint_id: int | None,
               before_id: int | None, after_id: int | None):
    if project.board_type == "kanban":
        sprint_id = None
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
                  column_id=None, assignee=None, priority=None, label=None, sprint_id=None, parent_id=None,
                  include_archived=False):
    query = db.query(JiraIssue).filter(JiraIssue.project_id == project.id)
    if not include_archived:
        query = query.filter(JiraIssue.archived.is_(False))
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
