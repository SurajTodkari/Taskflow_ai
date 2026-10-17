from datetime import datetime, timedelta, timezone

from app.db import SessionLocal
from app.services.tasks import materialize_rules
from app.models import Task

from .conftest import register


def today():
    return datetime.now(timezone.utc).date()


def iso(d):
    return d.isoformat()


def mk(client, h, **kw):
    kw.setdefault("title", "T")
    r = client.post("/api/tasks", json=kw, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------- auth
def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json() == {"status": "ok", "db": True}


def test_register_login_refresh_logout(client):
    tok = register(client)
    assert tok["user"]["email"] == "a@example.com" and tok["token_type"] == "bearer"
    assert client.post("/api/auth/register", json={"email": "A@example.com", "password": "password123",
                                                   "name": "x"}).status_code == 409
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": "wrong"}).status_code == 401
    r = client.post("/api/auth/login", json={"email": "a@example.com", "password": "password123"})
    assert r.status_code == 200
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/api/auth/me", headers=h).json()["name"] == "Alice"
    rt = r.json()["refresh_token"]
    r2 = client.post("/api/auth/refresh", json={"refresh_token": rt})
    assert r2.status_code == 200 and r2.json()["refresh_token"] != rt
    # rotation: old token is dead (and reuse revokes the family)
    assert client.post("/api/auth/refresh", json={"refresh_token": rt}).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": r2.json()["refresh_token"]}).status_code == 401
    r3 = client.post("/api/auth/login", json={"email": "a@example.com", "password": "password123"}).json()
    assert client.post("/api/auth/logout", json={"refresh_token": r3["refresh_token"]}).status_code == 200
    assert client.post("/api/auth/refresh", json={"refresh_token": r3["refresh_token"]}).status_code == 401


def test_auth_required_and_validation(client):
    assert client.get("/api/tasks").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401
    assert client.post("/api/auth/register", json={"email": "bad", "password": "password123",
                                                   "name": "x"}).status_code == 422
    assert client.post("/api/auth/register", json={"email": "b@example.com", "password": "short",
                                                   "name": "x"}).status_code == 422
    assert client.post("/api/auth/register", json={"email": "b@example.com", "password": "password123",
                                                   "name": "x", "timezone": "Mars/Base"}).status_code == 422


# ---------------------------------------------------------------- CRUD
def test_task_crud(client, auth_headers):
    h = auth_headers
    t = mk(client, h, title="  Write report ", priority="high", tags=["a", "a", "b"], due_date=iso(today()))
    assert t["title"] == "Write report" and t["tags"] == ["a", "b"] and t["board_column"] == "todo"
    assert t["effective_status"] == "not_started" and t["tracked_seconds"] == 0
    tid = t["id"]
    assert client.get(f"/api/tasks/{tid}", headers=h).json()["id"] == tid
    p = client.patch(f"/api/tasks/{tid}", json={"status": "in_progress", "notes": "n"}, headers=h).json()
    assert p["status"] == "in_progress" and p["board_column"] == "in_progress"
    c = client.post(f"/api/tasks/{tid}/complete", headers=h).json()
    assert c["status"] == "completed" and c["completed_at"] and c["board_column"] == "completed"
    assert client.patch(f"/api/tasks/{tid}", json={"status": "on_hold"}, headers=h).json()["completed_at"] is None
    d = client.post(f"/api/tasks/{tid}/duplicate", headers=h).json()
    assert d["id"] != tid and d["title"].endswith("(copy)")
    assert client.delete(f"/api/tasks/{tid}", headers=h).status_code == 204
    assert client.get(f"/api/tasks/{tid}", headers=h).status_code == 404
    assert len(client.get("/api/tasks", headers=h).json()) == 1


def test_list_filters_sort(client, auth_headers):
    h = auth_headers
    mk(client, h, title="Alpha", priority="low", due_date="2030-01-02", tags=["x"])
    mk(client, h, title="Beta", priority="critical", due_date="2030-01-01")
    mk(client, h, title="Gamma report", priority="medium")
    r = client.get("/api/tasks?sort=priority&order=asc", headers=h)
    assert [t["title"] for t in r.json()][0] == "Beta" and r.headers["X-Total-Count"] == "3"
    assert [t["title"] for t in client.get("/api/tasks?sort=due_date&order=asc", headers=h).json()][:2] == ["Beta", "Alpha"]
    assert [t["title"] for t in client.get("/api/tasks?search=report", headers=h).json()] == ["Gamma report"]
    assert [t["title"] for t in client.get("/api/tasks?tag=x", headers=h).json()] == ["Alpha"]
    assert len(client.get("/api/tasks?priority=low,critical", headers=h).json()) == 2
    assert len(client.get("/api/tasks?limit=1&offset=1", headers=h).json()) == 1


def test_validation(client, auth_headers):
    h = auth_headers
    bad = [{"title": ""}, {"title": "   "}, {"title": "x" * 201},
           {"title": "a", "start_date": "2030-01-05", "due_date": "2030-01-01"},
           {"title": "a", "start_time": "10:00", "end_time": "09:00"},
           {"title": "a", "start_time": "10:00", "end_time": "10:00"},
           {"title": "a", "priority": "urgent"}, {"title": "a", "status": "overdue"}]
    for b in bad:
        assert client.post("/api/tasks", json=b, headers=h).status_code == 422, b
    t = mk(client, h, start_date="2030-01-05", due_date="2030-01-06")
    # cross-field validation against stored values on PATCH
    assert client.patch(f"/api/tasks/{t['id']}", json={"due_date": "2030-01-01"}, headers=h).status_code == 422
    assert client.post("/api/tasks", json={"title": "a", "project_id": 9999}, headers=h).status_code == 404
    assert client.get("/api/tasks?status=bogus", headers=h).status_code == 422


# ---------------------------------------------------------------- isolation
def test_user_isolation(client, auth_headers, make_headers):
    a, b = auth_headers, make_headers("b@example.com")
    t = mk(client, a, title="secret")
    pr = client.post("/api/projects", json={"name": "P"}, headers=a).json()
    sub = client.post(f"/api/tasks/{t['id']}/subtasks", json={"title": "s"}, headers=a).json()["subtasks"][0]
    tid = t["id"]
    assert client.get("/api/tasks", headers=b).json() == []
    for method, url in [("get", f"/api/tasks/{tid}"), ("delete", f"/api/tasks/{tid}"),
                        ("post", f"/api/tasks/{tid}/complete"), ("post", f"/api/tasks/{tid}/duplicate"),
                        ("get", f"/api/tasks/{tid}/comments"), ("get", f"/api/tasks/{tid}/activity"),
                        ("post", f"/api/tasks/{tid}/timer/start"), ("get", f"/api/projects/{pr['id']}"),
                        ("get", f"/api/projects/{pr['id']}/board"), ("delete", f"/api/projects/{pr['id']}"),
                        ("delete", f"/api/subtasks/{sub['id']}")]:
        assert getattr(client, method)(url, headers=b).status_code == 404, (method, url)
    assert client.patch(f"/api/tasks/{tid}", json={"title": "hax"}, headers=b).status_code == 404
    assert client.patch(f"/api/subtasks/{sub['id']}", json={"done": True}, headers=b).status_code == 404
    assert client.post("/api/tasks", json={"title": "x", "project_id": pr["id"]}, headers=b).status_code == 404
    assert client.get(f"/api/tasks/{tid}", headers=a).json()["title"] == "secret"


# ---------------------------------------------------------------- rollover semantics
def test_rollover_semantics(client, auth_headers):
    h = auth_headers
    td = today()
    y, tm = td - timedelta(days=1), td + timedelta(days=1)
    carried = mk(client, h, title="carried", start_date=iso(y), due_date=iso(tm))
    carried_nodue = mk(client, h, title="carried-nodue", start_date=iso(y))
    overdue = mk(client, h, title="overdue", due_date=iso(y))
    done = mk(client, h, title="done-old", start_date=iso(y))
    client.post(f"/api/tasks/{done['id']}/complete", headers=h)
    mk(client, h, title="today", start_date=iso(td))

    from app.services import tasks as svc
    with SessionLocal() as db:
        uid = client.get("/api/auth/me", headers=h).json()["id"]
        cf = {t.title for t in svc.carried_forward(db, uid, td)}
        od = {t.title for t in svc.overdue_tasks(db, uid, td)}
        day = {t.title for t in svc.day_tasks(db, uid, td)}
        assert cf == {"carried", "carried-nodue"}
        assert od == {"overdue"}  # overdue (due<today) is never "carried"
        assert day == {"today"}
        assert {t.title for t in svc.day_tasks(db, uid, y)} == {"carried", "carried-nodue", "overdue", "done-old"}

    assert client.get(f"/api/tasks/{overdue['id']}", headers=h).json()["effective_status"] == "overdue"
    assert client.get(f"/api/tasks/{overdue['id']}", headers=h).json()["status"] == "not_started"
    assert client.get(f"/api/tasks/{done['id']}", headers=h).json()["effective_status"] == "completed"
    # original dates never auto-changed
    assert client.get(f"/api/tasks/{carried['id']}", headers=h).json()["start_date"] == iso(y)

    # add-to-today queues it: now in today's list, no longer carried, dates untouched
    q = client.post(f"/api/tasks/{carried_nodue['id']}/add-to-today", headers=h).json()
    assert q["queued_date"] == iso(td) and q["start_date"] == iso(y) and q["reschedule_count"] == 0
    with SessionLocal() as db:
        assert {t.title for t in svc.carried_forward(db, uid, td)} == {"carried"}
        assert "carried-nodue" in {t.title for t in svc.day_tasks(db, uid, td)}
    acts = client.get(f"/api/tasks/{carried_nodue['id']}/activity", headers=h).json()
    assert "queued_today" in [a["action"] for a in acts]
    assert client.post(f"/api/tasks/{done['id']}/add-to-today", headers=h).status_code == 409


def test_reschedule_logging(client, auth_headers):
    h = auth_headers
    td = today()
    t = mk(client, h, start_date=iso(td), due_date=iso(td))
    tid = t["id"]
    r = client.post(f"/api/tasks/{tid}/reschedule", json={"start_date": iso(td + timedelta(days=2)),
                                                          "due_date": iso(td + timedelta(days=3))}, headers=h)
    assert r.status_code == 200 and r.json()["reschedule_count"] == 1
    r = client.patch(f"/api/tasks/{tid}", json={"due_date": iso(td + timedelta(days=5))}, headers=h)
    assert r.json()["reschedule_count"] == 2
    assert client.patch(f"/api/tasks/{tid}", json={"title": "renamed"}, headers=h).json()["reschedule_count"] == 2
    acts = client.get(f"/api/tasks/{tid}/activity", headers=h).json()
    resc = [a for a in acts if a["action"] == "rescheduled"]
    assert len(resc) == 2 and resc[0]["detail"]["due_date"][1] == iso(td + timedelta(days=5))
    assert client.post(f"/api/tasks/{tid}/reschedule", json={}, headers=h).status_code == 422
    # first-time date assignment is not a reschedule
    u = mk(client, h, title="undated")
    assert client.patch(f"/api/tasks/{u['id']}", json={"due_date": iso(td)}, headers=h).json()["reschedule_count"] == 0


# ---------------------------------------------------------------- misc features
def test_board_sync_subtasks_comments_timer(client, auth_headers):
    h = auth_headers
    t = mk(client, h)
    tid = t["id"]
    assert client.patch(f"/api/tasks/{tid}/board", json={"board_column": "review"}, headers=h).json()["status"] == "in_progress"
    assert client.patch(f"/api/tasks/{tid}/board", json={"board_column": "completed"}, headers=h).json()["status"] == "completed"
    r = client.patch(f"/api/tasks/{tid}/board", json={"board_column": "backlog"}, headers=h).json()
    assert r["status"] == "not_started" and r["completed_at"] is None
    assert client.patch(f"/api/tasks/{tid}/board", json={"board_column": "nope"}, headers=h).status_code == 422

    s = client.post(f"/api/tasks/{tid}/subtasks", json={"title": "s1"}, headers=h).json()["subtasks"][0]
    out = client.patch(f"/api/subtasks/{s['id']}", json={"done": True}, headers=h).json()
    assert out["subtasks"][0]["done"] is True
    c = client.post(f"/api/tasks/{tid}/checklist", json={"title": "c1"}, headers=h).json()["checklist"][0]
    assert client.delete(f"/api/checklist/{c['id']}", headers=h).json()["checklist"] == []

    assert client.post(f"/api/tasks/{tid}/comments", json={"body": "hi"}, headers=h).status_code == 201
    assert client.get(f"/api/tasks/{tid}/comments", headers=h).json()[0]["body"] == "hi"

    assert client.post(f"/api/tasks/{tid}/timer/stop", headers=h).status_code == 409
    assert client.post(f"/api/tasks/{tid}/timer/start", headers=h).json()["status"] == "in_progress"
    assert client.post(f"/api/tasks/{tid}/timer/stop", headers=h).status_code == 200
    te = client.get("/api/time-entries", headers=h).json()
    assert len(te) == 1 and te[0]["running"] is False


def test_attachments(client, auth_headers, make_headers):
    h = auth_headers
    tid = mk(client, h)["id"]
    r = client.post(f"/api/tasks/{tid}/attachments", files={"file": ("../../evil name.txt", b"hello", "text/plain")}, headers=h)
    assert r.status_code == 201 and "/" not in r.json()["filename"] and r.json()["size"] == 5
    aid = r.json()["id"]
    d = client.get(f"/api/attachments/{aid}/download", headers=h)
    assert d.status_code == 200 and d.content == b"hello"
    assert client.post(f"/api/tasks/{tid}/attachments", files={"file": ("x.exe", b"MZ", "application/octet-stream")},
                       headers=h).status_code == 422
    other = make_headers("o@example.com")
    assert client.get(f"/api/attachments/{aid}/download", headers=other).status_code == 404
    assert client.delete(f"/api/attachments/{aid}", headers=other).status_code == 404
    assert client.delete(f"/api/attachments/{aid}", headers=h).status_code == 204
    assert client.get(f"/api/tasks/{tid}", headers=h).json()["attachments"] == []


def test_attachment_size_limit(client, auth_headers, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "MAX_UPLOAD_MB", 0)
    tid = mk(client, auth_headers)["id"]
    r = client.post(f"/api/tasks/{tid}/attachments", files={"file": ("a.txt", b"x", "text/plain")}, headers=auth_headers)
    assert r.status_code == 413


def test_projects_settings_reminders(client, auth_headers):
    h = auth_headers
    p = client.post("/api/projects", json={"name": "Proj", "color": "#fff"}, headers=h).json()
    assert client.post("/api/projects", json={"name": "Proj"}, headers=h).status_code == 409
    t1 = mk(client, h, project_id=p["id"])
    mk(client, h, project_id=p["id"])
    client.post(f"/api/tasks/{t1['id']}/complete", headers=h)
    d = client.get(f"/api/projects/{p['id']}", headers=h).json()
    assert d["progress_percent"] == 50 and d["task_counts"]["by_status"]["completed"] == 1
    assert t1["project_name"] == "Proj"
    m = client.post(f"/api/projects/{p['id']}/milestones", json={"title": "M1"}, headers=h).json()
    assert client.patch(f"/api/milestones/{m['id']}", json={"done": True}, headers=h).json()["done"] is True
    b = client.get(f"/api/projects/{p['id']}/board", headers=h).json()
    assert set(b) == {"backlog", "todo", "in_progress", "review", "completed"} and len(b["completed"]) == 1
    assert b["todo"][0]["project_name"] == "Proj"
    assert client.delete(f"/api/projects/{p['id']}", headers=h).status_code == 204
    assert client.get("/api/tasks", headers=h).json()[0]["project_id"] is None

    s = client.get("/api/settings", headers=h).json()
    assert s["timezone"] == "UTC" and s["morning_time"] == "08:00" and s["default_reminder_minutes"] == 15
    s = client.patch("/api/settings", json={"morning_time": "07:30", "theme": "dark", "weekend_days": [6, 0]}, headers=h).json()
    assert s["morning_time"] == "07:30" and s["theme"] == "dark" and s["weekend_days"] == [0, 6]
    assert client.patch("/api/settings", json={"morning_time": "25:00"}, headers=h).status_code == 422
    assert client.patch("/api/settings", json={"timezone": "Nope/Zone"}, headers=h).status_code == 422

    # reminders: default reminder derived from start_time, resynced on settings change
    from app.models import TaskReminder
    t = mk(client, h, start_date="2031-05-05", start_time="10:00", reminder_at="2031-05-05T08:00:00Z")
    with SessionLocal() as db:
        rows = db.query(TaskReminder).filter_by(task_id=t["id"]).order_by(TaskReminder.remind_at).all()
        assert [r.kind for r in rows] == ["custom", "default"]
        assert rows[1].remind_at.replace(tzinfo=None).isoformat() == "2031-05-05T09:45:00"
    client.patch("/api/settings", json={"default_reminder_minutes": 30}, headers=h)
    with SessionLocal() as db:
        rows = db.query(TaskReminder).filter_by(task_id=t["id"], kind="default").all()
        assert len(rows) == 1 and rows[0].remind_at.replace(tzinfo=None).isoformat() == "2031-05-05T09:30:00"
    client.post(f"/api/tasks/{t['id']}/complete", headers=h)
    with SessionLocal() as db:
        assert db.query(TaskReminder).filter_by(task_id=t["id"]).count() == 0


def test_recurrence_materialize_idempotent(client, auth_headers):
    h = auth_headers
    td = today()
    t = mk(client, h, title="Standup", start_date=iso(td), recurrence={"freq": "daily", "interval": 1})
    assert t["recurrence_rule_id"]
    with SessionLocal() as db:
        n1 = materialize_rules(db, None, 30)
        n2 = materialize_rules(db, None, 30)
        assert n1 == 30 and n2 == 0
        assert db.query(Task).count() == 31
    # deleting an occurrence must not resurrect it
    occ = [x for x in client.get("/api/tasks?limit=500", headers=h).json() if x["start_date"] == iso(td + timedelta(days=3))][0]
    assert client.delete(f"/api/tasks/{occ['id']}", headers=h).status_code == 204
    with SessionLocal() as db:
        assert materialize_rules(db, None, 30) == 0
    # weekly rule
    mk(client, h, title="Weekly", start_date=iso(td), recurrence={"freq": "weekly", "interval": 1, "by_weekday": [td.weekday()]})
    with SessionLocal() as db:
        assert 4 <= materialize_rules(db, None, 30) <= 5
