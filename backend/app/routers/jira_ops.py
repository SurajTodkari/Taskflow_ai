"""Jira v2: roadmap, reports, activity, dashboard, bulk, clone, move-project, CSV import/export."""
import csv
import io
import statistics
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from pydantic import ValidationError
from sqlalchemy import func, update
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import (JiraColumn, JiraComment, JiraHistory, JiraIssue, JiraLink, JiraMember, JiraProject,
                      JiraSprint, JiraWatcher, JiraWorklog, User)
from ..schemas import JiraBulkIn, JiraCloneIn, JiraIssueCreate, JiraMoveProjectIn
from ..services import jira as svc
from ..services import jql as jqlsvc
from ..services.tasks import aware

router = APIRouter(prefix="/api/jira", tags=["jira-v2"])


def _my_projects(db: Session, user: User) -> dict[int, tuple[JiraProject, str]]:
    rows = (db.query(JiraProject, JiraMember.role).join(JiraMember, JiraMember.project_id == JiraProject.id)
            .filter(JiraMember.user_id == user.id).all())
    return {p.id: (p, r) for p, r in rows}


def _done_ids(db: Session, project_id: int) -> list[int]:
    return [c.id for c in db.query(JiraColumn.id).filter_by(project_id=project_id, category="done")]


# ------------------------------------------------------------------ labels / roadmap
@router.get("/projects/{key}/labels")
def labels(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key)
    counts: dict[str, int] = {}
    for (lab,) in db.query(JiraIssue.labels).filter(JiraIssue.project_id == p.id,
                                                    JiraIssue.archived.is_(False)).all():
        for l in lab or []:
            counts[l] = counts.get(l, 0) + 1
    return [{"name": k, "count": v} for k, v in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]


@router.get("/projects/{key}/roadmap")
def roadmap(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key)
    epics = db.query(JiraIssue).filter(JiraIssue.project_id == p.id, JiraIssue.type == "epic",
                                       JiraIssue.archived.is_(False)).all()
    ids = [e.id for e in epics]
    done = _done_ids(db, p.id) or [-1]
    total = dict(db.query(JiraIssue.parent_id, func.count(JiraIssue.id)).filter(
        JiraIssue.parent_id.in_(ids or [-1]), JiraIssue.archived.is_(False)).group_by(JiraIssue.parent_id).all())
    fin = dict(db.query(JiraIssue.parent_id, func.count(JiraIssue.id)).filter(
        JiraIssue.parent_id.in_(ids or [-1]), JiraIssue.archived.is_(False), JiraIssue.column_id.in_(done))
        .group_by(JiraIssue.parent_id).all())
    ser = {d["id"]: d for d in svc.serialize_issues(db, epics, viewer=user)}
    out = []
    for e in epics:
        t, f = total.get(e.id, 0), fin.get(e.id, 0)
        d = ser[e.id]
        out.append({"issue": d, "start_date": e.start_date, "due_date": e.due_date, "children_total": t,
                    "children_done": f, "percent": round(100 * f / t) if t else (100 if d["status_category"] == "done" else 0),
                    "version": d["fix_version"]})
    out.sort(key=lambda r: (r["start_date"] is None, r["start_date"] or date.max, r["issue"]["id"]))
    return out


# ------------------------------------------------------------------ reports
@router.get("/projects/{key}/reports/velocity")
def velocity(key: str, n: int = Query(8, ge=1, le=50), user: User = Depends(get_current_user),
             db: Session = Depends(get_db)):
    """committed = story points of issues in the sprint at close (incl. those moved out as unfinished, found via
    sprint history rows); completed = points of those finished (in a done column)."""
    p, _ = svc.project_for(db, user, key)
    done = set(_done_ids(db, p.id))
    sprints = (db.query(JiraSprint).filter_by(project_id=p.id, state="closed")
               .order_by(JiraSprint.completed_at.desc(), JiraSprint.id.desc()).limit(n).all())[::-1]
    rows = []
    for s in sprints:
        cur = db.query(JiraIssue).filter(JiraIssue.sprint_id == s.id).all()
        moved_ids = {r[0] for r in db.query(JiraHistory.issue_id).join(JiraIssue, JiraIssue.id == JiraHistory.issue_id)
                     .filter(JiraIssue.project_id == p.id, JiraHistory.field == "sprint",
                             JiraHistory.old_value == s.name).all()}
        moved = (db.query(JiraIssue).filter(JiraIssue.id.in_(moved_ids - {i.id for i in cur})).all()
                 if moved_ids else [])
        committed = sum(i.story_points or 0 for i in cur + moved)
        completed = sum(i.story_points or 0 for i in cur if i.column_id in done)
        rows.append({"sprint": svc.sprint_out(db, s), "committed_points": committed, "completed_points": completed})
    avg = round(sum(r["completed_points"] for r in rows) / len(rows), 2) if rows else 0
    return {"sprints": rows, "average": avg, "average_velocity": avg}


@router.get("/projects/{key}/reports/created-vs-resolved")
def created_vs_resolved(key: str, days: int = Query(30, ge=1, le=365), user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key)
    today = svc.now().date()
    ds = [today - timedelta(days=k) for k in range(days - 1, -1, -1)]
    created = {d: 0 for d in ds}
    resolved = {d: 0 for d in ds}
    since = datetime.combine(ds[0], datetime.min.time(), tzinfo=timezone.utc)
    for c_at, r_at in db.query(JiraIssue.created_at, JiraIssue.resolved_at).filter(
            JiraIssue.project_id == p.id).filter((JiraIssue.created_at >= since) | (JiraIssue.resolved_at >= since)):
        if c_at and aware(c_at).date() in created:
            created[aware(c_at).date()] += 1
        if r_at and aware(r_at).date() in resolved:
            resolved[aware(r_at).date()] += 1
    return [{"date": d, "created": created[d], "resolved": resolved[d]} for d in ds]


@router.get("/projects/{key}/reports/resolution-time")
def resolution_time(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key)
    rows = db.query(JiraIssue.type, JiraIssue.created_at, JiraIssue.resolved_at).filter(
        JiraIssue.project_id == p.id, JiraIssue.resolved_at.is_not(None)).all()
    allv: list[float] = []
    by: dict[str, list[float]] = {}
    for t, c, r in rows:
        d = max((aware(r) - aware(c)).total_seconds() / 86400, 0)
        allv.append(d)
        by.setdefault(t, []).append(d)
    return {"count": len(allv), "avg_days": round(statistics.mean(allv), 2) if allv else 0,
            "median_days": round(statistics.median(allv), 2) if allv else 0,
            "by_type": [{"type": t, "count": len(v), "avg_days": round(statistics.mean(v), 2)}
                        for t, v in sorted(by.items())]}


@router.get("/projects/{key}/reports/workload")
def workload(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key)
    rows = (db.query(JiraIssue.assignee_id, func.count(JiraIssue.id), func.coalesce(func.sum(JiraIssue.story_points), 0),
                     func.coalesce(func.sum(JiraIssue.remaining_estimate_min), 0))
            .filter(JiraIssue.project_id == p.id, JiraIssue.archived.is_(False),
                    JiraIssue.column_id.notin_(_done_ids(db, p.id) or [-1]))
            .group_by(JiraIssue.assignee_id).all())
    users = {u.id: u for u in db.query(User).filter(User.id.in_([r[0] for r in rows if r[0]])).all()}
    out = [{"user": svc.user_ref(users.get(a)), "open_issues": n, "open_points": int(pts), "remaining_minutes": int(m)}
           for a, n, pts, m in rows]
    return sorted(out, key=lambda r: -r["open_issues"])


@router.get("/projects/{key}/reports/cfd")
def cfd(key: str, days: int = Query(30, ge=1, le=365), user: User = Depends(get_current_user),
        db: Session = Depends(get_db)):
    """Cumulative flow, APPROXIMATE: rebuilt from 'status' history rows keyed by column NAME. Issues are placed
    in their first known status at creation; renamed columns and deleted issues are not reconstructed."""
    p, _ = svc.project_for(db, user, key)
    cols = svc.project_columns(db, p.id)
    by_name = {c.name: c for c in cols}
    issues = db.query(JiraIssue).filter(JiraIssue.project_id == p.id).all()
    ids = [i.id for i in issues]
    events: dict[int, list] = {}
    for iid, old, new, at in (db.query(JiraHistory.issue_id, JiraHistory.old_value, JiraHistory.new_value,
                                       JiraHistory.created_at)
                              .filter(JiraHistory.issue_id.in_(ids or [-1]), JiraHistory.field == "status")
                              .order_by(JiraHistory.created_at, JiraHistory.id).all()):
        events.setdefault(iid, []).append((aware(at).date(), old, new))
    colname = {c.id: c.name for c in cols}
    today = svc.now().date()
    ds = [today - timedelta(days=k) for k in range(days - 1, -1, -1)]
    series = []
    timelines = []
    for i in issues:
        ev = events.get(i.id, [])
        first = ev[0][1] if ev else colname.get(i.column_id)
        timelines.append((aware(i.created_at).date(), [(aware(i.created_at).date(), first)] + [(d, n) for d, _, n in ev]))
    for d in ds:
        counts = {str(c.id): 0 for c in cols}
        for created, tl in timelines:
            if created > d:
                continue
            cur = None
            for ed, name in tl:
                if ed <= d:
                    cur = name
            c = by_name.get(cur)
            if c is not None:
                counts[str(c.id)] += 1
        series.append({"date": d, "counts": counts})
    return {"approximate": True, "columns": [{"id": c.id, "name": c.name, "category": c.category} for c in cols],
            "series": series}


# ------------------------------------------------------------------ activity / dashboard
def activity_feed(db: Session, project_ids: list[int], limit: int) -> list[dict]:
    if not project_ids:
        return []
    projects = {p.id: p for p in db.query(JiraProject).filter(JiraProject.id.in_(project_ids)).all()}
    items: list[tuple] = []  # (created_at, type, user_id, issue, text)
    base = db.query(JiraIssue)
    for kind, q in (
        ("created", db.query(JiraIssue, JiraIssue.reporter_id, JiraIssue.created_at)
         .filter(JiraIssue.project_id.in_(project_ids)).order_by(JiraIssue.created_at.desc()).limit(limit)),
        ("comment", db.query(JiraIssue, JiraComment.user_id, JiraComment.created_at, JiraComment.body)
         .join(JiraComment, JiraComment.issue_id == JiraIssue.id).filter(JiraIssue.project_id.in_(project_ids))
         .order_by(JiraComment.created_at.desc()).limit(limit)),
        ("change", db.query(JiraIssue, JiraHistory.user_id, JiraHistory.created_at, JiraHistory.field,
                            JiraHistory.old_value, JiraHistory.new_value)
         .join(JiraHistory, JiraHistory.issue_id == JiraIssue.id).filter(JiraIssue.project_id.in_(project_ids))
         .order_by(JiraHistory.created_at.desc(), JiraHistory.id.desc()).limit(limit)),
    ):
        for r in q.all():
            i, uid, at = r[0], r[1], r[2]
            key = f"{projects[i.project_id].key}-{i.number}"
            if kind == "created":
                text = f"created {key}"
            elif kind == "comment":
                text = r[3][:200]
            else:
                text = f"changed {r[3]} from {r[4] or '-'} to {r[5] or '-'}"
            items.append((aware(at), kind, uid, {"key": key, "title": i.title}, text))
    items.sort(key=lambda t: t[0], reverse=True)
    items = items[:limit]
    users = {u.id: u for u in db.query(User).filter(User.id.in_({t[2] for t in items if t[2]})).all()} if items else {}
    return [{"type": k, "user": svc.user_ref(users.get(uid)), "issue": iss, "text": text, "created_at": at}
            for at, k, uid, iss, text in items]


@router.get("/projects/{key}/activity")
def project_activity(key: str, limit: int = Query(50, ge=1, le=200), user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key)
    return activity_feed(db, [p.id], limit)


@router.get("/activity")
def my_activity(limit: int = Query(50, ge=1, le=200), user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    ids = [pid for pid, (p, _) in _my_projects(db, user).items() if not p.archived]
    return activity_feed(db, ids, limit)


@router.get("/dashboard")
def dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    mine = _my_projects(db, user)
    live = [pid for pid, (p, _) in mine.items() if not p.archived]
    done_cols = db.query(JiraColumn.id).filter(JiraColumn.project_id.in_(live or [-1]),
                                               JiraColumn.category == "done")
    open_mine = db.query(JiraIssue).filter(JiraIssue.project_id.in_(live or [-1]), JiraIssue.archived.is_(False),
                                           JiraIssue.assignee_id == user.id, JiraIssue.column_id.notin_(done_cols))
    soon = date.today() + timedelta(days=7)
    due = open_mine.filter(JiraIssue.due_date.is_not(None), JiraIssue.due_date <= soon).order_by(
        JiraIssue.due_date, JiraIssue.id).limit(10).all()
    recent = (db.query(JiraIssue).filter(JiraIssue.project_id.in_(live or [-1]), JiraIssue.archived.is_(False))
              .order_by(JiraIssue.updated_at.desc(), JiraIssue.id.desc()).limit(10).all())
    watching = (db.query(JiraIssue).join(JiraWatcher, JiraWatcher.issue_id == JiraIssue.id)
                .filter(JiraWatcher.user_id == user.id, JiraIssue.project_id.in_(live or [-1]),
                        JiraIssue.archived.is_(False), JiraIssue.column_id.notin_(done_cols))
                .order_by(JiraIssue.updated_at.desc()).limit(20).all())
    week = svc.now() - timedelta(days=7)
    secs = db.query(func.coalesce(func.sum(JiraWorklog.seconds), 0)).filter(
        JiraWorklog.user_id == user.id, JiraWorklog.started_at >= week).scalar()
    projects = sorted(((p, r) for pid, (p, r) in mine.items() if not p.archived), key=lambda t: (t[0].name, t[0].id))
    return {"assigned_to_me_open": open_mine.count(),
            "due_soon": svc.serialize_issues(db, due, viewer=user),
            "recently_updated": svc.serialize_issues(db, recent, viewer=user),
            "my_projects": [svc.project_out(db, p, r) for p, r in projects],
            "watching": svc.serialize_issues(db, watching, viewer=user),
            "worklog_minutes_week": int(secs or 0) // 60}


# ------------------------------------------------------------------ bulk / clone / move
@router.post("/projects/{key}/issues/bulk")
def bulk(key: str, body: JiraBulkIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key, "member")
    if body.action == "update" and body.patch is None:
        raise HTTPException(422, "patch is required for action=update")
    pd = body.patch.model_dump(exclude_unset=True) if body.patch else {}
    updated, failed = 0, []
    for k in dict.fromkeys(body.issue_keys):
        try:
            with db.begin_nested():
                prefix, num = svc.parse_issue_key(k)
                i = db.query(JiraIssue).filter_by(project_id=p.id, number=num).first() if prefix == p.key else None
                if i is None:
                    raise HTTPException(404, "Issue not found in this project")
                if body.action == "delete":
                    svc.delete_issue(db, i)
                elif body.action in ("archive", "unarchive"):
                    svc.update_issue(db, p, i, user, {"archived": body.action == "archive"})
                else:
                    data = {x: pd[x] for x in ("assignee_id", "priority", "column_id", "sprint_id",
                                               "fix_version_id", "component_ids") if x in pd}
                    if pd.get("labels_add") or pd.get("labels_remove"):
                        cur = list(i.labels or [])
                        cur = [l for l in cur if l not in set(pd.get("labels_remove") or [])]
                        for l in pd.get("labels_add") or []:
                            if l not in cur:
                                cur.append(l)
                        data["labels"] = cur
                    if data:
                        svc.update_issue(db, p, i, user, data)
            updated += 1
        except HTTPException as e:
            failed.append({"key": k, "detail": e.detail})
    db.commit()
    return {"updated": updated, "failed": failed}


@router.post("/issues/{key}/clone", status_code=201)
def clone(key: str, body: JiraCloneIn | None = None, user: User = Depends(get_current_user),
          db: Session = Depends(get_db)):
    body = body or JiraCloneIn()
    src, p, _ = svc.issue_for(db, user, key, "member")
    prefix = "CLONE - " if body.title_prefix is None else body.title_prefix
    if src.type == "subtask" and src.parent_id is None:
        raise HTTPException(422, "Cannot clone an orphan subtask")

    def data_for(i: JiraIssue, parent_id, title) -> dict:
        d = {"type": i.type, "title": title[:200], "description": i.description, "priority": i.priority,
             "parent_id": parent_id, "story_points": i.story_points, "labels": list(i.labels or []),
             "due_date": i.due_date, "start_date": i.start_date, "original_estimate_min": i.original_estimate_min,
             "remaining_estimate_min": i.original_estimate_min, "fix_version_id": i.fix_version_id,
             "custom_fields": dict(i.custom_fields or {}), "environment": i.environment,
             "component_ids": [c.id for c in svc.issue_components(db, i)]}
        if i.assignee_id and svc.get_member(db, p.id, i.assignee_id):
            d["assignee_id"] = i.assignee_id
        return d

    new = svc.create_issue(db, p, user, data_for(src, src.parent_id, prefix + src.title))
    db.add(JiraLink(source_id=new.id, target_id=src.id, link_type="clones", created_by=user.id))
    if body.include_subtasks and src.type not in ("subtask", "epic"):
        for sub in (db.query(JiraIssue).filter(JiraIssue.parent_id == src.id, JiraIssue.type == "subtask")
                    .order_by(JiraIssue.rank, JiraIssue.id).all()):
            svc.create_issue(db, p, user, data_for(sub, new.id, sub.title))
    db.commit()
    return svc.serialize_issue(db, new, detail=True, viewer=user)


def _map_column(db: Session, target: JiraProject, old: JiraColumn | None, forced: int | None) -> JiraColumn:
    if forced is not None:
        return svc.column_in_project(db, target, forced)
    cols = svc.project_columns(db, target.id)
    if old is not None:
        for c in cols:
            if c.name.lower() == old.name.lower():
                return c
        for c in cols:
            if c.category == old.category:
                return c
    return cols[0]


def _relocate(db: Session, issue: JiraIssue, old_key: str, old_col: JiraColumn | None, target: JiraProject,
              user: User, forced_col: int | None):
    db.execute(update(JiraProject).where(JiraProject.id == target.id).values(issue_seq=JiraProject.issue_seq + 1))
    number = db.query(JiraProject.issue_seq).filter(JiraProject.id == target.id).scalar()
    col = _map_column(db, target, old_col, forced_col)
    issue.project_id, issue.number, issue.column_id = target.id, number, col.id
    issue.sprint_id = None
    issue.fix_version_id = None
    issue.rank = svc.next_rank(db, target.id)
    if issue.assignee_id and not svc.get_member(db, target.id, issue.assignee_id):
        issue.assignee_id = None
    from ..models import JiraIssueComponent
    db.query(JiraIssueComponent).filter(JiraIssueComponent.issue_id == issue.id).delete(synchronize_session=False)
    issue.custom_fields = {}
    svc.set_resolved(issue, col)
    issue.updated_at = svc.now()
    db.flush()
    svc.log_change(db, issue, user, "project", old_key, f"{target.key}-{number}")


@router.post("/issues/{key}/move-project")
def move_project(key: str, body: JiraMoveProjectIn, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    issue, p, _ = svc.issue_for(db, user, key, "member")
    target, _ = svc.project_for(db, user, body.project_key, "member")
    if target.id == p.id:
        raise HTTPException(422, "Issue is already in that project")
    if issue.type == "subtask":
        raise HTTPException(422, "Move the parent issue instead; sub-tasks move with it")
    old_key = svc.issue_key(p, issue)
    cols = {c.id: c for c in svc.project_columns(db, p.id)}
    subs = db.query(JiraIssue).filter(JiraIssue.parent_id == issue.id, JiraIssue.type == "subtask").all()
    if issue.type == "epic":
        db.query(JiraIssue).filter(JiraIssue.parent_id == issue.id).update({"parent_id": None},
                                                                          synchronize_session=False)
    if body.column_id is not None:
        svc.column_in_project(db, target, body.column_id)
    sub_info = [(s, svc.issue_key(p, s), cols.get(s.column_id)) for s in subs]
    issue_old_col = cols.get(issue.column_id)
    if issue.type != "epic":
        issue.parent_id = None  # epic belongs to the old project
    _relocate(db, issue, old_key, issue_old_col, target, user, body.column_id)
    for s, k, oc in sub_info:
        _relocate(db, s, k, oc, target, user, None)
    db.commit()
    return svc.serialize_issue(db, issue, detail=True, viewer=user)


# ------------------------------------------------------------------ CSV export / import
CSV_COLS = ["key", "type", "title", "description", "priority", "assignee_email", "labels", "story_points",
            "due_date", "status", "reporter_email", "created_at"]


def _safe(v) -> str:
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s  # neutralise spreadsheet formula injection


@router.get("/projects/{key}/issues/export")
def export_issues(key: str, format: str = "csv", jql: str | None = None, include_archived: bool = False,
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if format != "csv":
        raise HTTPException(422, "Only format=csv is supported")
    p, _ = svc.project_for(db, user, key)
    q = svc.issue_filters(db, p, user, include_archived=include_archived)
    q, order = jqlsvc.apply_jql(db, user, q, jql)
    rows = q.order_by(*(order or [JiraIssue.rank, JiraIssue.id])).limit(5000).all()
    cols = {c.id: c for c in svc.project_columns(db, p.id)}
    uids = {x for i in rows for x in (i.assignee_id, i.reporter_id) if x}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(CSV_COLS)
    for i in rows:
        a, r = users.get(i.assignee_id), users.get(i.reporter_id)
        w.writerow([svc.issue_key(p, i), i.type, _safe(i.title), _safe(i.description), i.priority,
                    a.email if a else "", ";".join(i.labels or []),
                    "" if i.story_points is None else i.story_points, i.due_date or "",
                    cols[i.column_id].name if i.column_id in cols else "", r.email if r else "",
                    aware(i.created_at).isoformat()])
    return Response(content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{p.key}-issues.csv"',
                             "X-Content-Type-Options": "nosniff"})


@router.post("/projects/{key}/issues/import")
def import_issues(key: str, file: UploadFile = File(...), user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key, "member")
    raw = file.file.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise HTTPException(413, "CSV is larger than 1 MB")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(422, "CSV must be UTF-8 encoded")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "title" not in [h.strip().lower() for h in reader.fieldnames]:
        raise HTTPException(422, "CSV needs a header row with at least a 'title' column")
    rows = list(reader)
    if len(rows) > 500:
        raise HTTPException(422, "At most 500 rows per import")
    cols = {c.name.lower(): c for c in svc.project_columns(db, p.id)}
    created, errors = 0, []
    for n, raw_row in enumerate(rows, start=2):  # row 1 is the header
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw_row.items() if k}
        try:
            with db.begin_nested():
                d: dict = {"title": row.get("title", "")}
                for f in ("type", "priority", "description"):
                    if row.get(f):
                        d[f] = row[f].lower() if f != "description" else row[f]
                if row.get("labels"):
                    d["labels"] = [x.strip() for x in row["labels"].replace(";", ",").split(",") if x.strip()]
                if row.get("story_points"):
                    d["story_points"] = int(row["story_points"])
                if row.get("due_date"):
                    d["due_date"] = row["due_date"]
                if row.get("assignee_email"):
                    a = db.query(User).filter(User.email == row["assignee_email"].lower()).first()
                    if not a or not svc.get_member(db, p.id, a.id):
                        raise HTTPException(422, f"{row['assignee_email']} is not a project member")
                    d["assignee_id"] = a.id
                if row.get("status"):
                    c = cols.get(row["status"].lower())
                    if c is None:
                        raise HTTPException(422, f"Unknown status '{row['status']}'")
                    d["column_id"] = c.id
                try:
                    clean = JiraIssueCreate(**d).model_dump(exclude_unset=True)
                except ValidationError as e:
                    err = e.errors()[0]
                    raise HTTPException(422, f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}")
                svc.create_issue(db, p, user, clean)
            created += 1
        except ValueError as e:
            errors.append({"row": n, "detail": f"Invalid number: {e}"})
        except HTTPException as e:
            errors.append({"row": n, "detail": e.detail})
    db.commit()
    return {"created": created, "errors": errors}
