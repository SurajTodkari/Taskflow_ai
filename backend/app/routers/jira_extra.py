"""Jira v2: invites, people, links, watchers, components, versions, worklogs, attachments, search/filters,
workflow, custom fields."""
import mimetypes
import os
import re
from datetime import date, datetime, time, timedelta, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import (JiraAttachment, JiraColumn, JiraComponent, JiraCustomField, JiraFilter, JiraInvite,
                      JiraIssue, JiraLink, JiraMember, JiraProject, JiraTransition, JiraVersion, JiraWatcher,
                      JiraWorklog, User)
from ..schemas import (JiraComponentIn, JiraComponentUpdate, JiraCustomFieldIn, JiraCustomFieldUpdate,
                       JiraFilterIn, JiraFilterUpdate, JiraLinkIn, JiraVersionIn, JiraVersionRelease,
                       JiraVersionUpdate, JiraWorkflowIn, JiraWorklogIn, JiraWorklogUpdate)
from ..services import jira as svc
from ..services import jql as jqlsvc
from ..services.tasks import aware

router = APIRouter(prefix="/api/jira", tags=["jira-v2"])


def _commit(db: Session, conflict: str = "Conflicting update"):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, conflict)


def _by_id(db: Session, model, obj_id: int, user: User, min_role: str, what: str):
    """Fetch a project-scoped row and the caller's role; 404 for non-members."""
    o = db.get(model, obj_id)
    p = db.get(JiraProject, o.project_id) if o else None
    m = svc.get_member(db, p.id, user.id) if p else None
    if not o or not m:
        raise HTTPException(404, f"{what} not found")
    svc.require_role(m.role, min_role)
    if min_role != "viewer":
        svc.check_writable(p)
    return o, p


# ------------------------------------------------------------------ invites / people
def invite_out(db: Session, i: JiraInvite) -> dict:
    inv = db.get(User, i.invited_by) if i.invited_by else None
    return {"id": i.id, "project_id": i.project_id, "email": i.email, "role": i.role,
            "invited_by": svc.user_ref(inv), "created_at": aware(i.created_at)}


@router.get("/projects/{key}/invites")
def list_invites(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key, "admin", allow_archived=True)
    rows = db.query(JiraInvite).filter_by(project_id=p.id).order_by(JiraInvite.id).all()
    return [invite_out(db, i) for i in rows]


@router.delete("/invites/{invite_id}", status_code=204)
def delete_invite(invite_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    i, _ = _by_id(db, JiraInvite, invite_id, user, "admin", "Invite")
    db.delete(i)
    db.commit()
    return Response(status_code=204)


@router.get("/people")
def people(q: str = "", user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = (q or "").strip().lower()
    if len(q) < 2:
        return []
    mine = db.query(JiraMember.project_id).filter(JiraMember.user_id == user.id)
    rows = (db.query(User).join(JiraMember, JiraMember.user_id == User.id)
            .filter(JiraMember.project_id.in_(mine), User.is_active.is_(True),
                    or_(func.lower(User.name).contains(q, autoescape=True),
                        func.lower(User.email).contains(q, autoescape=True)))
            .group_by(User.id).order_by(User.name, User.id).limit(8).all())
    return [{"id": u.id, "name": u.name, "email": u.email} for u in rows]


# ------------------------------------------------------------------ links
def _link_view(db: Session, link: JiraLink, issue_id: int, viewer: User) -> dict:
    i = db.get(JiraIssue, issue_id)
    for l in svc.serialize_issue(db, i, viewer=viewer)["links"]:
        if l["id"] == link.id:
            return l
    raise HTTPException(404, "Link not found")


@router.post("/issues/{key}/links", status_code=201)
def add_link(key: str, body: JiraLinkIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    src, _, _ = svc.issue_for(db, user, key, "member")
    tgt, _, _ = svc.issue_for(db, user, body.target_key.strip(), "member")
    if src.id == tgt.id:
        raise HTTPException(422, "An issue cannot be linked to itself")
    t = body.link_type
    dup = db.query(JiraLink.id).filter(JiraLink.link_type == t, or_(
        (JiraLink.source_id == src.id) & (JiraLink.target_id == tgt.id),
        (JiraLink.source_id == tgt.id) & (JiraLink.target_id == src.id) if t == "relates" else False)).first()
    if dup:
        raise HTTPException(409, "These issues are already linked that way")
    l = JiraLink(source_id=src.id, target_id=tgt.id, link_type=t, created_by=user.id)
    db.add(l)
    _commit(db, "These issues are already linked that way")
    return _link_view(db, l, src.id, user)


@router.delete("/links/{link_id}", status_code=204)
def delete_link(link_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    l = db.get(JiraLink, link_id)
    if l is None:
        raise HTTPException(404, "Link not found")
    ok = False
    for iid in (l.source_id, l.target_id):
        i = db.get(JiraIssue, iid)
        m = svc.get_member(db, i.project_id, user.id) if i else None
        if m and svc.ROLE_RANK[m.role] >= svc.ROLE_RANK["member"]:
            ok = True
    if not ok:
        raise HTTPException(404, "Link not found")
    db.delete(l)
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ watchers
@router.post("/issues/{key}/watch")
def watch(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    i, _, _ = svc.issue_for(db, user, key)
    svc.add_watcher(db, i.id, user.id)
    db.commit()
    return {"watching": True, "watchers_count": db.query(JiraWatcher).filter_by(issue_id=i.id).count()}


@router.delete("/issues/{key}/watch")
def unwatch(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    i, _, _ = svc.issue_for(db, user, key)
    db.query(JiraWatcher).filter_by(issue_id=i.id, user_id=user.id).delete()
    db.commit()
    return {"watching": False, "watchers_count": db.query(JiraWatcher).filter_by(issue_id=i.id).count()}


@router.get("/issues/{key}/watchers")
def watchers(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    i, _, _ = svc.issue_for(db, user, key)
    rows = (db.query(User).join(JiraWatcher, JiraWatcher.user_id == User.id)
            .filter(JiraWatcher.issue_id == i.id).order_by(User.name, User.id).all())
    return [svc.user_ref(u) for u in rows]


# ------------------------------------------------------------------ components
def component_out(db: Session, c: JiraComponent) -> dict:
    from ..models import JiraIssueComponent
    lead = db.get(User, c.lead_id) if c.lead_id else None
    n = db.query(func.count(JiraIssueComponent.issue_id)).filter(JiraIssueComponent.component_id == c.id).scalar()
    return {"id": c.id, "project_id": c.project_id, "name": c.name, "description": c.description,
            "lead": svc.user_ref(lead), "issue_count": n or 0}


@router.get("/projects/{key}/components")
def list_components(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key)
    return [component_out(db, c) for c in
            db.query(JiraComponent).filter_by(project_id=p.id).order_by(JiraComponent.name).all()]


@router.post("/projects/{key}/components", status_code=201)
def create_component(key: str, body: JiraComponentIn, user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key, "admin")
    if body.lead_id is not None and not svc.get_member(db, p.id, body.lead_id):
        raise HTTPException(422, "Lead must be a project member")
    c = JiraComponent(project_id=p.id, name=body.name.strip(), description=body.description, lead_id=body.lead_id)
    db.add(c)
    _commit(db, "A component with this name already exists")
    return component_out(db, c)


@router.patch("/components/{component_id}")
def patch_component(component_id: int, body: JiraComponentUpdate, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    c, p = _by_id(db, JiraComponent, component_id, user, "admin", "Component")
    data = body.model_dump(exclude_unset=True)
    if data.get("name", "x") is None:
        raise HTTPException(422, "name cannot be null")
    if data.get("lead_id") is not None and not svc.get_member(db, p.id, data["lead_id"]):
        raise HTTPException(422, "Lead must be a project member")
    for k, v in data.items():
        setattr(c, k, v.strip() if k == "name" else v)
    _commit(db, "A component with this name already exists")
    return component_out(db, c)


@router.delete("/components/{component_id}", status_code=204)
def delete_component(component_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c, _ = _by_id(db, JiraComponent, component_id, user, "admin", "Component")
    db.delete(c)
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ versions
def version_out(db: Session, v: JiraVersion) -> dict:
    done_ids = [c.id for c in db.query(JiraColumn.id).filter_by(project_id=v.project_id, category="done")]
    base = db.query(func.count(JiraIssue.id)).filter(JiraIssue.fix_version_id == v.id, JiraIssue.archived.is_(False))
    return {"id": v.id, "project_id": v.project_id, "name": v.name, "description": v.description,
            "start_date": v.start_date, "release_date": v.release_date, "released": bool(v.released),
            "released_at": aware(v.released_at), "issue_count": base.scalar() or 0,
            "done_count": base.filter(JiraIssue.column_id.in_(done_ids or [-1])).scalar() or 0}


@router.get("/projects/{key}/versions")
def list_versions(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key)
    rows = db.query(JiraVersion).filter_by(project_id=p.id).order_by(JiraVersion.released, JiraVersion.id).all()
    return [version_out(db, v) for v in rows]


def _check_dates(s, e):
    if s and e and e < s:
        raise HTTPException(422, "release_date must be on or after start_date")


@router.post("/projects/{key}/versions", status_code=201)
def create_version(key: str, body: JiraVersionIn, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key, "admin")
    _check_dates(body.start_date, body.release_date)
    v = JiraVersion(project_id=p.id, name=body.name.strip(), description=body.description,
                    start_date=body.start_date, release_date=body.release_date)
    db.add(v)
    _commit(db, "A version with this name already exists")
    return version_out(db, v)


@router.patch("/versions/{version_id}")
def patch_version(version_id: int, body: JiraVersionUpdate, user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    v, _ = _by_id(db, JiraVersion, version_id, user, "admin", "Version")
    data = body.model_dump(exclude_unset=True)
    if data.get("name", "x") is None:
        raise HTTPException(422, "name cannot be null")
    for k, val in data.items():
        setattr(v, k, val.strip() if k == "name" else val)
    _check_dates(v.start_date, v.release_date)
    _commit(db, "A version with this name already exists")
    return version_out(db, v)


@router.delete("/versions/{version_id}", status_code=204)
def delete_version(version_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    v, _ = _by_id(db, JiraVersion, version_id, user, "admin", "Version")
    db.query(JiraIssue).filter(JiraIssue.fix_version_id == v.id).update({"fix_version_id": None},
                                                                      synchronize_session=False)
    db.delete(v)
    db.commit()
    return Response(status_code=204)


@router.post("/versions/{version_id}/release")
def release_version(version_id: int, body: JiraVersionRelease | None = None,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    v, p = _by_id(db, JiraVersion, version_id, user, "admin", "Version")
    if v.released:
        raise HTTPException(409, "Version is already released")
    target = (body or JiraVersionRelease()).move_open_to_version_id
    if target is not None:
        if target == v.id:
            raise HTTPException(422, "move_open_to_version_id must be a different version")
        tv = svc.check_version(db, p, target)
        if tv.released:
            raise HTTPException(422, "Cannot move issues to an already released version")
        done_ids = [c.id for c in svc.project_columns(db, p.id) if c.category == "done"]
        for i in db.query(JiraIssue).filter(JiraIssue.fix_version_id == v.id,
                                            JiraIssue.column_id.notin_(done_ids or [-1])).all():
            svc.log_change(db, i, user, "fix_version", v.name, tv.name)
            i.fix_version_id = tv.id
    v.released, v.released_at = True, svc.now()
    db.commit()
    return version_out(db, v)


# ------------------------------------------------------------------ worklogs
def worklog_out(w: JiraWorklog, key: str, users: dict) -> dict:
    return {"id": w.id, "issue_key": key, "user": svc.user_ref(users.get(w.user_id)), "minutes": w.seconds // 60,
            "started_at": aware(w.started_at), "comment": w.comment, "created_at": aware(w.created_at)}


@router.get("/issues/{key}/worklogs")
def list_worklogs(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    i, p, _ = svc.issue_for(db, user, key)
    rows = db.query(JiraWorklog).filter_by(issue_id=i.id).order_by(JiraWorklog.started_at.desc(),
                                                                  JiraWorklog.id.desc()).all()
    users = {u.id: u for u in db.query(User).filter(User.id.in_({w.user_id for w in rows})).all()} if rows else {}
    return [worklog_out(w, svc.issue_key(p, i), users) for w in rows]


@router.post("/issues/{key}/worklogs", status_code=201)
def add_worklog(key: str, body: JiraWorklogIn, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    i, p, _ = svc.issue_for(db, user, key, "member")
    started = body.started_at or svc.now()
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    w = JiraWorklog(issue_id=i.id, user_id=user.id, seconds=body.minutes * 60, started_at=started,
                    comment=body.comment)
    db.add(w)
    if i.remaining_estimate_min is not None:
        old = i.remaining_estimate_min
        i.remaining_estimate_min = max(0, old - body.minutes)
        svc.log_change(db, i, user, "remaining_estimate_min", old, i.remaining_estimate_min)
    i.updated_at = svc.now()
    db.commit()
    return worklog_out(w, svc.issue_key(p, i), {user.id: user})


def _worklog(db: Session, user: User, wid: int):
    w = db.get(JiraWorklog, wid)
    i = db.get(JiraIssue, w.issue_id) if w else None
    p = db.get(JiraProject, i.project_id) if i else None
    m = svc.get_member(db, p.id, user.id) if p else None
    if not w or not m:
        raise HTTPException(404, "Worklog not found")
    svc.check_writable(p)
    if not (m.role == "admin" or (w.user_id == user.id and m.role != "viewer")):
        raise HTTPException(403, "Only the author or a project admin can change this worklog")
    return w, i, p


@router.patch("/worklogs/{worklog_id}")
def patch_worklog(worklog_id: int, body: JiraWorklogUpdate, user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    w, i, p = _worklog(db, user, worklog_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("minutes") is not None:
        w.seconds = data["minutes"] * 60
    if data.get("started_at") is not None:
        s = data["started_at"]
        w.started_at = s if s.tzinfo else s.replace(tzinfo=timezone.utc)
    if "comment" in data:
        w.comment = data["comment"]
    db.commit()
    return worklog_out(w, svc.issue_key(p, i), {w.user_id: db.get(User, w.user_id)})


@router.delete("/worklogs/{worklog_id}", status_code=204)
def delete_worklog(worklog_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    w, _, _ = _worklog(db, user, worklog_id)
    db.delete(w)
    db.commit()
    return Response(status_code=204)


@router.get("/projects/{key}/time-report")
def time_report(key: str, from_: date | None = Query(None, alias="from"), to: date | None = None,
                user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key)
    q = (db.query(JiraWorklog.user_id, func.sum(JiraWorklog.seconds), func.count(func.distinct(JiraWorklog.issue_id)))
         .join(JiraIssue, JiraIssue.id == JiraWorklog.issue_id).filter(JiraIssue.project_id == p.id))
    if from_:
        q = q.filter(JiraWorklog.started_at >= datetime.combine(from_, time.min, tzinfo=timezone.utc))
    if to:
        q = q.filter(JiraWorklog.started_at < datetime.combine(to + timedelta(days=1), time.min,
                                                                tzinfo=timezone.utc))
    rows = q.group_by(JiraWorklog.user_id).all()
    users = {u.id: u for u in db.query(User).filter(User.id.in_([r[0] for r in rows])).all()} if rows else {}
    out = [{"user": svc.user_ref(users.get(uid)), "minutes": int(sec or 0) // 60, "issues": n}
           for uid, sec, n in rows]
    return sorted(out, key=lambda r: -r["minutes"])


# ------------------------------------------------------------------ attachments (stored in the DB)
MAX_ATTACHMENT = 2 * 1024 * 1024
MAX_PER_ISSUE = 10
ALLOWED_EXT = {"png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "md", "csv", "json", "docx", "xlsx", "pptx", "zip"}
INLINE_EXT = {"png", "jpg", "jpeg", "gif", "webp"}


def _ext(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def attachment_out(a: JiraAttachment, users: dict) -> dict:
    return {"id": a.id, "issue_id": a.issue_id, "filename": a.filename, "size": a.size,
            "content_type": a.content_type, "user": svc.user_ref(users.get(a.user_id)),
            "created_at": aware(a.created_at)}


@router.post("/issues/{key}/attachments", status_code=201)
def upload_attachment(key: str, file: UploadFile = File(...), user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    i, _, _ = svc.issue_for(db, user, key, "member")
    name = os.path.basename((file.filename or "").replace("\\", "/"))
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()[:255]
    if not name:
        raise HTTPException(422, "A file name is required")
    if _ext(name) not in ALLOWED_EXT:
        raise HTTPException(422, "File type not allowed. Allowed: " + ", ".join(sorted(ALLOWED_EXT)))
    count = db.query(func.count(JiraAttachment.id)).filter(JiraAttachment.issue_id == i.id).scalar() or 0
    if count >= MAX_PER_ISSUE:
        raise HTTPException(409, f"An issue can have at most {MAX_PER_ISSUE} attachments")
    data = file.file.read(MAX_ATTACHMENT + 1)
    if len(data) > MAX_ATTACHMENT:
        raise HTTPException(413, "File is larger than 2 MB")
    if not data:
        raise HTTPException(422, "File is empty")
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"  # never trust the client's type
    a = JiraAttachment(issue_id=i.id, user_id=user.id, filename=name, content_type=ctype, size=len(data), data=data)
    db.add(a)
    svc.log_change(db, i, user, "attachment", None, name)
    db.commit()
    return attachment_out(a, {user.id: user})


def _attachment(db: Session, user: User, aid: int, min_role: str = "viewer"):
    a = db.get(JiraAttachment, aid)
    i = db.get(JiraIssue, a.issue_id) if a else None
    p = db.get(JiraProject, i.project_id) if i else None
    m = svc.get_member(db, p.id, user.id) if p else None
    if not a or not m:
        raise HTTPException(404, "Attachment not found")
    svc.require_role(m.role, min_role)
    return a, i, p, m


@router.get("/attachments/{attachment_id}")
def download_attachment(attachment_id: int, inline: int = 0, user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    a, _, _, _ = _attachment(db, user, attachment_id)
    ext = _ext(a.filename)
    disp = "inline" if (inline and ext in INLINE_EXT) else "attachment"
    ascii_name = re.sub(r'[^A-Za-z0-9._ -]', "_", a.filename)
    headers = {"Content-Disposition": f"{disp}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(a.filename)}",
               "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300",
               "Content-Security-Policy": "default-src 'none'; sandbox"}
    return Response(content=a.data, media_type=a.content_type, headers=headers)


@router.delete("/attachments/{attachment_id}", status_code=204)
def delete_attachment(attachment_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    a, i, p, m = _attachment(db, user, attachment_id, "member")
    svc.check_writable(p)
    if not (m.role == "admin" or a.user_id == user.id):
        raise HTTPException(403, "Only the uploader or a project admin can delete this attachment")
    svc.log_change(db, i, user, "attachment", a.filename, None)
    db.delete(a)
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ search + saved filters
@router.get("/search")
def search(response: Response, jql: str | None = None, limit: int = Query(50, ge=1, le=200),
           offset: int = Query(0, ge=0), include_archived: bool = False, user: User = Depends(get_current_user),
           db: Session = Depends(get_db)):
    mine = db.query(JiraMember.project_id).filter(JiraMember.user_id == user.id)
    if not include_archived:
        mine = mine.join(JiraProject, JiraProject.id == JiraMember.project_id).filter(JiraProject.archived.is_(False))
    q = db.query(JiraIssue).filter(JiraIssue.project_id.in_(mine))
    if not include_archived:
        q = q.filter(JiraIssue.archived.is_(False))
    q, order = jqlsvc.apply_jql(db, user, q, jql)
    response.headers["X-Total-Count"] = str(q.count())
    rows = q.order_by(*(order or [JiraIssue.updated_at.desc()]), JiraIssue.id.desc()).offset(offset).limit(limit).all()
    return svc.serialize_issues(db, rows, viewer=user)


def filter_out(db: Session, f: JiraFilter, user: User, projects: dict | None = None) -> dict:
    owner = db.get(User, f.owner_id)
    pk = None
    if f.project_id:
        pr = (projects or {}).get(f.project_id) or db.get(JiraProject, f.project_id)
        pk = pr.key if pr else None
    return {"id": f.id, "name": f.name, "jql": f.jql, "shared": bool(f.shared), "project_key": pk,
            "owner": svc.user_ref(owner), "is_owner": f.owner_id == user.id, "created_at": aware(f.created_at)}


@router.get("/filters")
def list_filters(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    mine = db.query(JiraMember.project_id).filter(JiraMember.user_id == user.id)
    rows = (db.query(JiraFilter).filter(or_(JiraFilter.owner_id == user.id,
                                            (JiraFilter.shared.is_(True)) & JiraFilter.project_id.in_(mine)))
            .order_by(JiraFilter.name, JiraFilter.id).all())
    return [filter_out(db, f, user) for f in rows]


@router.post("/filters", status_code=201)
def create_filter(body: JiraFilterIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    jqlsvc.validate(body.jql)
    pid = None
    if body.project_key:
        p, _ = svc.project_for(db, user, body.project_key)
        pid = p.id
    f = JiraFilter(owner_id=user.id, name=body.name.strip(), jql=body.jql.strip(), shared=body.shared,
                   project_id=pid)
    db.add(f)
    db.commit()
    return filter_out(db, f, user)


def _filter(db: Session, user: User, fid: int) -> JiraFilter:
    f = db.get(JiraFilter, fid)
    if not f or f.owner_id != user.id:
        raise HTTPException(404, "Filter not found")
    return f


@router.patch("/filters/{filter_id}")
def patch_filter(filter_id: int, body: JiraFilterUpdate, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    f = _filter(db, user, filter_id)
    data = body.model_dump(exclude_unset=True)
    if "jql" in data:
        if data["jql"] is None:
            raise HTTPException(422, "jql cannot be null")
        jqlsvc.validate(data["jql"])
    for k in ("name", "shared"):
        if k in data and data[k] is None:
            raise HTTPException(422, f"{k} cannot be null")
    for k, v in data.items():
        setattr(f, k, v.strip() if isinstance(v, str) else v)
    db.commit()
    return filter_out(db, f, user)


@router.delete("/filters/{filter_id}", status_code=204)
def delete_filter(filter_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    f = _filter(db, user, filter_id)
    db.delete(f)
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ workflow
@router.get("/projects/{key}/workflow")
def get_workflow(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key)
    rows = db.query(JiraTransition).filter_by(project_id=p.id).order_by(JiraTransition.id).all()
    return {"enforce_workflow": bool(p.enforce_workflow),
            "transitions": [{"from": t.from_column_id, "to": t.to_column_id} for t in rows]}


@router.put("/projects/{key}/workflow")
def put_workflow(key: str, body: JiraWorkflowIn, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key, "admin")
    col_ids = {c.id for c in svc.project_columns(db, p.id)}
    pairs = []
    for t in body.transitions:
        if t.from_ not in col_ids or t.to not in col_ids:
            raise HTTPException(422, "Transitions must reference columns of this project")
        if t.from_ != t.to and (t.from_, t.to) not in pairs:
            pairs.append((t.from_, t.to))
    db.query(JiraTransition).filter_by(project_id=p.id).delete()
    for f, t in pairs:
        db.add(JiraTransition(project_id=p.id, from_column_id=f, to_column_id=t))
    db.commit()
    return {"enforce_workflow": bool(p.enforce_workflow), "transitions": [{"from": f, "to": t} for f, t in pairs]}


# ------------------------------------------------------------------ custom fields
def _clean_options(ftype: str, options: list[str]) -> list[str]:
    opts = list(dict.fromkeys(o.strip() for o in options if o and o.strip()))
    if ftype == "select" and not opts:
        raise HTTPException(422, "A select field needs at least one option")
    return opts if ftype == "select" else []


@router.get("/projects/{key}/custom-fields")
def list_custom_fields(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key)
    return [svc.custom_field_out(f) for f in db.query(JiraCustomField).filter_by(project_id=p.id)
            .order_by(JiraCustomField.position, JiraCustomField.id)]


@router.post("/projects/{key}/custom-fields", status_code=201)
def create_custom_field(key: str, body: JiraCustomFieldIn, user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    p, _ = svc.project_for(db, user, key, "admin")
    n = db.query(func.count(JiraCustomField.id)).filter_by(project_id=p.id).scalar() or 0
    if n >= 30:
        raise HTTPException(409, "At most 30 custom fields per project")
    f = JiraCustomField(project_id=p.id, name=body.name.strip(), field_type=body.field_type,
                        options=_clean_options(body.field_type, body.options), required=body.required, position=n)
    db.add(f)
    db.commit()
    return svc.custom_field_out(f)


@router.patch("/custom-fields/{field_id}")
def patch_custom_field(field_id: int, body: JiraCustomFieldUpdate, user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    f, _ = _by_id(db, JiraCustomField, field_id, user, "admin", "Custom field")
    data = body.model_dump(exclude_unset=True)
    for k in ("name", "required", "options"):
        if k in data and data[k] is None:
            raise HTTPException(422, f"{k} cannot be null")
    if "name" in data:
        f.name = data["name"].strip()
    if "required" in data:
        f.required = data["required"]
    if "options" in data:
        f.options = _clean_options(f.field_type, data["options"]) if f.field_type == "select" else []
    if data.get("position") is not None:
        f.position = data["position"]
    db.commit()
    return svc.custom_field_out(f)


@router.delete("/custom-fields/{field_id}", status_code=204)
def delete_custom_field(field_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    f, p = _by_id(db, JiraCustomField, field_id, user, "admin", "Custom field")
    k = str(f.id)
    for i in db.query(JiraIssue).filter(JiraIssue.project_id == p.id).all():
        if k in (i.custom_fields or {}):
            i.custom_fields = {a: b for a, b in i.custom_fields.items() if a != k}
    db.delete(f)
    db.commit()
    return Response(status_code=204)
