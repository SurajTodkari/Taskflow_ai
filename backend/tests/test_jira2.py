"""Jira v2 features: invites, links, watchers/mentions, components/versions, worklogs, attachments, JQL,
filters, workflow/WIP/kanban, custom fields, roadmap/reports/activity/dashboard, bulk/clone/move/import/export,
optional email."""
import io
from datetime import date, timedelta

import pytest

from app.db import SessionLocal
from app.models import JiraAttachment, Notification

from .test_jira import cols, mk, uid


@pytest.fixture(autouse=True)
def _fast_hash(monkeypatch):
    # bcrypt is slow; auth logic itself is covered by test_auth_tasks
    import app.routers.auth as auth
    monkeypatch.setattr(auth, "hash_password", lambda p: "h:" + p)
    monkeypatch.setattr(auth, "verify_password", lambda p, h: h == "h:" + p)


@pytest.fixture
def env(client, make_headers):
    """alice = admin, bob = member, carol = viewer, dave = unrelated user."""
    h = {n: make_headers(f"{n}@example.com") for n in ("alice", "bob", "carol", "dave")}
    r = client.post("/api/jira/projects", json={"key": "TF", "name": "TaskFlow"}, headers=h["alice"])
    assert r.status_code == 201, r.text
    for n, role in (("bob", "member"), ("carol", "viewer")):
        r = client.post("/api/jira/projects/TF/members", json={"email": f"{n}@example.com", "role": role},
                        headers=h["alice"])
        assert r.status_code == 201, r.text
    return h


def api(client, method, url, h, **kw):
    return getattr(client, method)("/api/jira" + url, headers=h, **kw)


# ------------------------------------------------------------------ 1. invitations
def test_invites_flow(client, env):
    a = env["alice"]
    r = api(client, "post", "/projects/TF/members", a, json={"email": "New@Example.com", "role": "viewer"})
    assert r.status_code == 201 and r.json() == {"invited": True, "email": "new@example.com", "role": "viewer"}
    invs = api(client, "get", "/projects/TF/invites", a).json()
    assert [(i["email"], i["role"]) for i in invs] == [("new@example.com", "viewer")]
    assert invs[0]["invited_by"]["name"] == "Alice"
    # only admins see / revoke invites
    assert api(client, "get", "/projects/TF/invites", env["bob"]).status_code == 403
    assert api(client, "delete", f"/invites/{invs[0]['id']}", env["bob"]).status_code == 403
    assert api(client, "delete", f"/invites/{invs[0]['id']}", env["dave"]).status_code == 404
    # re-inviting updates the role instead of duplicating
    api(client, "post", "/projects/TF/members", a, json={"email": "new@example.com", "role": "member"})
    invs = api(client, "get", "/projects/TF/invites", a).json()
    assert len(invs) == 1 and invs[0]["role"] == "member"
    # a second invite that gets revoked
    api(client, "post", "/projects/TF/members", a, json={"email": "gone@example.com", "role": "member"})
    gone = [i for i in api(client, "get", "/projects/TF/invites", a).json() if i["email"] == "gone@example.com"][0]
    assert api(client, "delete", f"/invites/{gone['id']}", a).status_code == 204
    # registration converts the pending invite into a membership + notification
    reg = client.post("/api/auth/register", json={"email": "new@example.com", "password": "password123",
                                                  "name": "Newbie", "timezone": "UTC"})
    assert reg.status_code == 201
    nh = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    projs = api(client, "get", "/projects", nh).json()
    assert [(p["key"], p["my_role"]) for p in projs] == [("TF", "member")]
    assert api(client, "get", "/projects/TF/invites", a).json() == []
    notes = client.get("/api/notifications", headers=nh).json()
    items = notes["items"] if isinstance(notes, dict) else notes
    assert any("TF" in n["title"] for n in items)
    # login is idempotent
    assert client.post("/api/auth/login", json={"email": "new@example.com", "password": "password123"}
                       ).status_code == 200
    assert len(api(client, "get", "/projects/TF", a).json()["members"]) == 4
    # the revoked invitee gets nothing
    reg2 = client.post("/api/auth/register", json={"email": "gone@example.com", "password": "password123",
                                                   "name": "Gone", "timezone": "UTC"})
    gh = {"Authorization": f"Bearer {reg2.json()['access_token']}"}
    assert api(client, "get", "/projects", gh).json() == []
    # existing user is still added immediately
    r = api(client, "post", "/projects/TF/members", a, json={"email": "dave@example.com", "role": "member"})
    assert r.status_code == 201 and r.json()["role"] == "member" and "invited" not in r.json()


def test_people_typeahead(client, env):
    b = env["bob"]
    assert api(client, "get", "/people?q=a", b).json() == []  # min 2 chars
    names = {p["email"] for p in api(client, "get", "/people?q=alice@ex", b).json()}
    assert names == {"alice@example.com"}
    assert api(client, "get", "/people?q=dave", b).json() == []  # dave shares no project
    assert api(client, "get", "/people?q=bob", env["dave"]).json() == []  # dave has no projects
    allp = api(client, "get", "/people?q=example", b).json()
    assert {p["email"] for p in allp} == {"alice@example.com", "bob@example.com", "carol@example.com"}
    assert set(allp[0]) == {"id", "name", "email"}


# ------------------------------------------------------------------ 1. project settings / archive / kanban
def test_project_settings_archive_kanban(client, env):
    a = env["alice"]
    p = api(client, "get", "/projects/TF", a).json()
    assert p["board_type"] == "scrum" and p["enforce_workflow"] is False and p["archived"] is False
    bob = uid(client, env["bob"])
    r = api(client, "patch", "/projects/TF", a, json={"default_assignee_id": bob})
    assert r.json()["default_assignee_id"] == bob
    assert api(client, "patch", "/projects/TF", a, json={"default_assignee_id": uid(client, env["dave"])}
               ).status_code == 422
    assert api(client, "patch", "/projects/TF", env["bob"], json={"archived": True}).status_code == 403
    assert mk(client, a, "auto")["assignee"]["id"] == bob  # default assignee applied
    assert mk(client, a, "explicit", assignee_id=uid(client, a))["assignee"]["id"] == uid(client, a)
    # archive -> read only, hidden from default list
    assert api(client, "patch", "/projects/TF", a, json={"archived": True}).json()["archived"] is True
    assert api(client, "get", "/projects", a).json() == []
    assert len(api(client, "get", "/projects?include_archived=1", a).json()) == 1
    assert api(client, "post", "/projects/TF/issues", a, json={"title": "x"}).status_code == 409
    assert api(client, "patch", "/issues/TF-1", a, json={"title": "x"}).status_code == 409
    assert api(client, "post", "/issues/TF-1/comments", a, json={"body": "x"}).status_code == 409
    assert api(client, "post", "/projects/TF/columns", a, json={"name": "X", "category": "todo"}).status_code == 409
    assert api(client, "get", "/issues/TF-1", a).status_code == 200  # still readable
    assert api(client, "patch", "/projects/TF", a, json={"name": "Renamed"}).status_code == 409
    assert api(client, "patch", "/projects/TF", a, json={"archived": False}).json()["archived"] is False
    assert api(client, "post", "/projects/TF/issues", a, json={"title": "ok"}).status_code == 201
    # kanban
    k = api(client, "post", "/projects", a, json={"key": "KB", "name": "Kan", "board_type": "kanban"})
    assert k.status_code == 201 and k.json()["board_type"] == "kanban" and k.json()["sprints"] == []
    assert api(client, "get", "/projects/KB/sprints", a).status_code == 409
    assert api(client, "post", "/projects/KB/sprints", a, json={"name": "S"}).status_code == 409
    i = mk(client, a, "k1", key="KB")
    sid = api(client, "get", "/projects/TF", a).json()["sprints"][0]["id"]
    i2 = api(client, "post", "/projects/KB/issues", a, json={"title": "k2", "sprint_id": sid}).json()
    assert i2["sprint_id"] is None  # sprint ignored
    board = api(client, "get", "/projects/KB/board", a).json()
    assert board["sprint"] is None and board["board_type"] == "kanban"
    assert sum(len(c["issues"]) for c in board["columns"]) == 2 and i["key"] == "KB-1"


# ------------------------------------------------------------------ 2. fields, components, versions
def test_issue_fields_components_versions(client, env):
    a, b = env["alice"], env["bob"]
    comp = api(client, "post", "/projects/TF/components", a, json={"name": "API", "description": "backend"}).json()
    comp2 = api(client, "post", "/projects/TF/components", a, json={"name": "UI"}).json()
    assert api(client, "post", "/projects/TF/components", a, json={"name": "API"}).status_code == 409
    assert api(client, "post", "/projects/TF/components", b, json={"name": "Z"}).status_code == 403
    ver = api(client, "post", "/projects/TF/versions", a, json={"name": "1.0", "release_date": "2030-01-01"}).json()
    ver2 = api(client, "post", "/projects/TF/versions", a, json={"name": "1.1"}).json()
    assert api(client, "post", "/projects/TF/versions", a, json={"name": "1.0"}).status_code == 409
    i = mk(client, b, "full", start_date="2030-01-01", original_estimate_min=120, flagged=True,
           fix_version_id=ver["id"], component_ids=[comp["id"], comp2["id"]], environment="prod",
           due_date="2030-02-01")
    assert i["start_date"] == "2030-01-01" and i["original_estimate_min"] == 120
    assert i["remaining_estimate_min"] == 120 and i["flagged"] is True and i["environment"] == "prod"
    assert i["fix_version"] == {"id": ver["id"], "name": "1.0"}
    assert [c["name"] for c in i["components"]] == ["API", "UI"] and len(i["component_ids"]) == 2
    assert i["watchers_count"] == 1 and i["is_watching"] is True
    assert i["time_spent_min"] == 0 and i["links"] == [] and i["attachment_count"] == 0 and i["archived"] is False
    assert api(client, "post", "/projects/TF/issues", b, json={"title": "x", "fix_version_id": 9999}).status_code == 422
    assert api(client, "post", "/projects/TF/issues", b, json={"title": "x", "component_ids": [9999]}
               ).status_code == 422
    # patch + history rows for each changed field
    r = api(client, "patch", "/issues/TF-1", b, json={
        "flagged": False, "environment": "staging", "fix_version_id": ver2["id"], "component_ids": [comp["id"]],
        "remaining_estimate_min": 30, "start_date": None})
    assert r.status_code == 200
    d = r.json()
    assert d["flagged"] is False and d["fix_version"]["name"] == "1.1" and d["component_ids"] == [comp["id"]]
    assert d["start_date"] is None
    fields = {h["field"] for h in api(client, "get", "/issues/TF-1/history", b).json()}
    assert {"flagged", "environment", "fix_version", "components", "remaining_estimate_min", "start_date"} <= fields
    assert api(client, "patch", "/issues/TF-1", b, json={"flagged": None}).status_code == 422
    # component listing / issue counts
    lst = api(client, "get", "/projects/TF/components", b).json()
    assert {c["name"]: c["issue_count"] for c in lst} == {"API": 1, "UI": 0}
    pc = api(client, "patch", f"/components/{comp2['id']}", a, json={"name": "Frontend"}).json()
    assert pc["name"] == "Frontend"
    assert api(client, "delete", f"/components/{comp2['id']}", a).status_code == 204
    # release flow: open issues move to the next version
    done = cols(client, a)["Done"]["id"]
    j = mk(client, b, "closed", fix_version_id=ver2["id"], column_id=done)
    k = mk(client, b, "open", fix_version_id=ver2["id"])
    vs = {v["name"]: v for v in api(client, "get", "/projects/TF/versions", b).json()}
    assert vs["1.1"]["issue_count"] == 3 and vs["1.1"]["done_count"] == 1 and vs["1.1"]["released"] is False
    assert api(client, "post", f"/versions/{ver2['id']}/release", b, json={}).status_code == 403
    nv = api(client, "post", "/projects/TF/versions", a, json={"name": "2.0"}).json()
    rel = api(client, "post", f"/versions/{ver2['id']}/release", a, json={"move_open_to_version_id": nv["id"]}).json()
    assert rel["released"] is True and rel["released_at"] and rel["issue_count"] == 1  # only the done issue stays
    assert api(client, "get", f"/issues/{k['key']}", a).json()["fix_version"]["name"] == "2.0"
    assert api(client, "get", f"/issues/{j['key']}", a).json()["fix_version"]["name"] == "1.1"
    assert api(client, "post", f"/versions/{ver2['id']}/release", a, json={}).status_code == 409
    assert api(client, "patch", f"/versions/{nv['id']}", a, json={"description": "next"}).json()["description"] == "next"
    assert api(client, "delete", f"/versions/{nv['id']}", a).status_code == 204
    assert api(client, "get", f"/issues/{k['key']}", a).json()["fix_version"] is None


# ------------------------------------------------------------------ 3. links
def test_links(client, env):
    a, b = env["alice"], env["bob"]
    x, y, z = mk(client, b, "x"), mk(client, b, "y"), mk(client, b, "z")
    r = api(client, "post", "/issues/TF-1/links", b, json={"link_type": "blocks", "target_key": "TF-2"})
    assert r.status_code == 201 and r.json()["direction_label"] == "blocks"
    assert r.json()["issue"]["key"] == "TF-2" and r.json()["issue"]["status_category"] == "todo"
    assert api(client, "post", "/issues/TF-1/links", b, json={"link_type": "blocks", "target_key": "TF-2"}
               ).status_code == 409
    assert api(client, "post", "/issues/TF-1/links", b, json={"link_type": "relates", "target_key": "TF-1"}
               ).status_code == 422
    assert api(client, "post", "/issues/TF-1/links", env["carol"], json={"link_type": "relates", "target_key": "TF-3"}
               ).status_code == 403
    api(client, "post", "/issues/TF-3/links", b, json={"link_type": "relates", "target_key": "TF-1"})
    assert api(client, "post", "/issues/TF-1/links", b, json={"link_type": "relates", "target_key": "TF-3"}
               ).status_code == 409  # relates is symmetric
    d1 = api(client, "get", "/issues/TF-1", b).json()
    assert sorted(l["direction_label"] for l in d1["links"]) == ["blocks", "relates to"]
    d2 = api(client, "get", "/issues/TF-2", b).json()
    assert d2["links"][0]["direction_label"] == "is blocked by" and d2["blocked"] is True
    assert d1["blocked"] is False
    board = api(client, "get", "/projects/TF/board?sprint_id=all", b).json()
    flags = {i["key"]: i["blocked"] for c in board["columns"] for i in c["issues"]}
    assert flags == {"TF-1": False, "TF-2": True, "TF-3": False}
    # a done blocker stops blocking
    done = cols(client, a)["Done"]["id"]
    api(client, "patch", "/issues/TF-1", b, json={"column_id": done})
    assert api(client, "get", "/issues/TF-2", b).json()["blocked"] is False
    # cross-project, member of both
    api(client, "post", "/projects", b, json={"key": "OT", "name": "Other"})
    o = mk(client, b, "other", key="OT")
    assert api(client, "post", "/issues/TF-1/links", b, json={"link_type": "clones", "target_key": o["key"]}
               ).status_code == 201
    assert api(client, "post", "/issues/TF-1/links", a, json={"link_type": "clones", "target_key": o["key"]}
               ).status_code == 404  # alice is not in OT
    # alice (not in OT) must not see the OT issue through the link
    assert all(l["issue"]["key"] != "OT-1" for l in api(client, "get", "/issues/TF-1", a).json()["links"])
    assert any(l["issue"]["key"] == "OT-1" for l in api(client, "get", "/issues/TF-1", b).json()["links"])
    lid = d1["links"][0]["id"]
    assert api(client, "delete", f"/links/{lid}", env["carol"]).status_code == 404
    assert api(client, "delete", f"/links/{lid}", b).status_code == 204
    assert len(api(client, "get", "/issues/TF-1", b).json()["links"]) == 2
    assert x["key"] and y["key"] and z["key"]


# ------------------------------------------------------------------ 4. watchers & mentions
def _notes(uid_):
    with SessionLocal() as db:
        return [(n.title, n.body) for n in db.query(Notification).filter_by(user_id=uid_, type="jira").all()]


def test_watchers_and_mentions(client, env):
    a, b, c = env["alice"], env["bob"], env["carol"]
    ida, idb, idc = uid(client, a), uid(client, b), uid(client, c)
    i = mk(client, a, "watched", assignee_id=idb)
    ws = api(client, "get", "/issues/TF-1/watchers", a).json()
    assert {w["id"] for w in ws} == {ida, idb}  # reporter + assignee auto-watch
    assert api(client, "post", "/issues/TF-1/watch", c).json() == {"watching": True, "watchers_count": 3}
    assert api(client, "post", "/issues/TF-1/watch", c).json()["watchers_count"] == 3  # idempotent
    assert api(client, "get", "/issues/TF-1", c).json()["is_watching"] is True
    before = len(_notes(idc))
    # status change notifies watchers, not the actor
    api(client, "patch", "/issues/TF-1", b, json={"column_id": cols(client, a)["In Progress"]["id"]})
    assert any("moved to In Progress" in t for t, _ in _notes(idc)[before:])
    assert not any("moved to" in t for t, _ in _notes(idb))
    # comment: watcher notified; mention notified once per comment and mention auto-watches
    dave = uid(client, env["dave"])
    api(client, "post", "/projects/TF/members", a, json={"email": "dave@example.com", "role": "member"})
    r = api(client, "post", "/issues/TF-1/comments", b, json={"body": f"hey @[user:{dave}] and @[user:{ida}] look"})
    assert r.status_code == 201
    assert {m["id"] for m in r.json()["mentions"]} == {dave, ida}
    assert sum("mentioned you" in t for t, _ in _notes(dave)) == 1
    assert sum("mentioned you" in t for t, _ in _notes(ida)) == 1
    assert not any("New comment" in t for t, _ in _notes(dave))  # mention replaces the generic notice
    assert any("New comment" in t for t, _ in _notes(idc))  # plain watcher gets it
    cid = r.json()["id"]
    api(client, "patch", f"/comments/{cid}", b, json={"body": f"edited @[user:{dave}]"})
    assert sum("mentioned you" in t for t, _ in _notes(dave)) == 1  # deduped per comment+user
    assert dave in {w["id"] for w in api(client, "get", "/issues/TF-1/watchers", a).json()}
    listed = api(client, "get", "/issues/TF-1/comments", a).json()
    assert listed[0]["mentions"] == [{"id": dave, "name": "Alice"}]
    # unrelated user (non member) mention is ignored
    api(client, "post", "/issues/TF-1/comments", b, json={"body": "ping @[user:99999]"})
    # unwatch
    assert api(client, "delete", "/issues/TF-1/watch", c).json() == {"watching": False, "watchers_count": 3}
    assert i["key"] == "TF-1"


# ------------------------------------------------------------------ 6. worklogs
def test_worklogs(client, env):
    a, b, c = env["alice"], env["bob"], env["carol"]
    mk(client, b, "timed", original_estimate_min=60)
    r = api(client, "post", "/issues/TF-1/worklogs", b, json={"minutes": 45, "comment": "work"})
    assert r.status_code == 201 and r.json()["minutes"] == 45 and r.json()["user"]["name"] == "Alice"
    d = api(client, "get", "/issues/TF-1", b).json()
    assert d["remaining_estimate_min"] == 15 and d["time_spent_min"] == 45
    api(client, "post", "/issues/TF-1/worklogs", a, json={"minutes": 30, "started_at": "2020-01-01T10:00:00Z"})
    d = api(client, "get", "/issues/TF-1", b).json()
    assert d["remaining_estimate_min"] == 0 and d["time_spent_min"] == 75  # never negative
    assert api(client, "post", "/issues/TF-1/worklogs", c, json={"minutes": 5}).status_code == 403
    assert api(client, "post", "/issues/TF-1/worklogs", b, json={"minutes": 0}).status_code == 422
    logs = api(client, "get", "/issues/TF-1/worklogs", c).json()
    assert [w["minutes"] for w in logs] == [45, 30]
    wid = logs[0]["id"]
    assert api(client, "patch", f"/worklogs/{wid}", env["dave"], json={"minutes": 5}).status_code == 404
    other = [w for w in logs if w["minutes"] == 30][0]["id"]
    assert api(client, "patch", f"/worklogs/{other}", b, json={"minutes": 5}).status_code == 403
    assert api(client, "patch", f"/worklogs/{wid}", b, json={"minutes": 50, "comment": "x"}).json()["minutes"] == 50
    rep = api(client, "get", "/projects/TF/time-report", a).json()
    assert sum(r["minutes"] for r in rep) == 50 + 30
    year = api(client, "get", "/projects/TF/time-report?from=2020-01-01&to=2020-01-01", a).json()
    assert sum(r["minutes"] for r in year) == 30 and year[0]["issues"] == 1
    assert api(client, "delete", f"/worklogs/{wid}", b).status_code == 204


# ------------------------------------------------------------------ 7. attachments
def test_attachments(client, env):
    a, b, c = env["alice"], env["bob"], env["carol"]
    mk(client, b, "with files")
    up = lambda h, name="note.txt", data=b"hello", ctype="text/plain": client.post(
        "/api/jira/issues/TF-1/attachments", headers=h, files={"file": (name, data, ctype)})
    r = up(b)
    assert r.status_code == 201 and r.json()["filename"] == "note.txt" and r.json()["size"] == 5
    aid = r.json()["id"]
    assert up(c).status_code == 403
    assert up(b, "evil.exe", b"MZ").status_code == 422
    assert up(b, "huge.zip", b"x" * (2 * 1024 * 1024 + 1)).status_code == 413
    assert up(b, "empty.txt", b"").status_code == 422
    assert up(b, "../../etc/passwd.txt").json()["filename"] == "passwd.txt"  # path stripped
    detail = api(client, "get", "/issues/TF-1", c).json()
    assert detail["attachment_count"] == 2 and detail["attachments"][0]["filename"] == "note.txt"
    assert detail["attachments"][0]["user"]["name"] == "Alice"
    dl = client.get(f"/api/jira/attachments/{aid}", headers=c)
    assert dl.status_code == 200 and dl.content == b"hello"
    assert dl.headers["content-disposition"].startswith("attachment") and dl.headers["x-content-type-options"] == "nosniff"
    assert client.get(f"/api/jira/attachments/{aid}", headers=env["dave"]).status_code == 404
    assert client.get(f"/api/jira/attachments/{aid}").status_code == 401
    png = up(b, "pic.png", b"\x89PNG\r\n\x1a\n", "image/png").json()
    inline = client.get(f"/api/jira/attachments/{png['id']}?inline=1", headers=c)
    assert inline.headers["content-disposition"].startswith("inline") and inline.headers["content-type"] == "image/png"
    txt_inline = client.get(f"/api/jira/attachments/{aid}?inline=1", headers=c)
    assert txt_inline.headers["content-disposition"].startswith("attachment")  # only images may be inline
    # data is never loaded in plain list queries
    with SessionLocal() as db:
        row = db.query(JiraAttachment).first()
        assert "data" not in row.__dict__  # deferred column
    # per-issue cap
    for n in range(7):
        assert up(b, f"f{n}.txt").status_code == 201
    assert up(b, "overflow.txt").status_code == 409
    # delete: uploader or admin only
    assert client.delete(f"/api/jira/attachments/{aid}", headers=env["dave"]).status_code == 404
    api(client, "post", "/projects/TF/members", a, json={"email": "dave@example.com", "role": "member"})
    assert client.delete(f"/api/jira/attachments/{aid}", headers=env["dave"]).status_code == 403
    assert client.delete(f"/api/jira/attachments/{aid}", headers=a).status_code == 204
    assert client.delete(f"/api/jira/attachments/{png['id']}", headers=b).status_code == 204
    assert api(client, "get", "/issues/TF-1", a).json()["attachment_count"] == 8


# ------------------------------------------------------------------ 8. JQL + filters
@pytest.fixture
def jenv(client, env):
    a, b = env["alice"], env["bob"]
    idb = uid(client, b)
    c = cols(client, a)
    sprint = api(client, "get", "/projects/TF", a).json()["sprints"][0]["id"]
    api(client, "post", f"/sprints/{sprint}/start", a, json={})
    comp = api(client, "post", "/projects/TF/components", a, json={"name": "API"}).json()
    ver = api(client, "post", "/projects/TF/versions", a, json={"name": "1.0"}).json()
    e = mk(client, a, "Epic one", type="epic")
    mk(client, a, "Login bug", type="bug", priority="high", labels=["auth", "urgent"], assignee_id=idb,
       sprint_id=sprint, component_ids=[comp["id"]], fix_version_id=ver["id"], due_date="2030-05-01",
       parent_id=e["id"], story_points=5)
    mk(client, a, "Write docs", type="task", priority="low", labels=["docs"], flagged=True)
    mk(client, a, "Ship it", type="story", column_id=c["Done"]["id"], story_points=3)
    return env


def keys(client, h, jql, url="/search"):
    r = api(client, "get", url, h, params={"jql": jql, "limit": 50})
    assert r.status_code == 200, (jql, r.text)
    return sorted(i["key"] for i in r.json())


def test_jql_fields_and_operators(client, jenv):
    a = jenv["alice"]
    k = lambda q: keys(client, a, q)
    assert k("") == ["TF-1", "TF-2", "TF-3", "TF-4"]
    assert k("type = bug") == ["TF-2"]
    assert k("type != bug AND type != epic") == ["TF-3", "TF-4"]
    assert k("type in (bug, story)") == ["TF-2", "TF-4"]
    assert k("type not in (bug, story)") == ["TF-1", "TF-3"]
    assert k('project = tf and priority = "high"') == ["TF-2"]
    assert k("key = TF-3") == ["TF-3"] and k("key in (TF-1, TF-4)") == ["TF-1", "TF-4"]
    assert k("status = Done") == ["TF-4"] and k('status = "To Do"') == ["TF-1", "TF-2", "TF-3"]
    assert k("statusCategory = done") == ["TF-4"] and k('statusCategory != "Done"') == ["TF-1", "TF-2", "TF-3"]
    assert k("assignee = bob@example.com") == ["TF-2"] and k("assignee = Alice") == ["TF-2"]  # fixture users are all named Alice
    assert k("assignee is empty") == ["TF-1", "TF-3", "TF-4"] and k("assignee is not empty") == ["TF-2"]
    assert k("reporter = currentUser()") == ["TF-1", "TF-2", "TF-3", "TF-4"]
    assert k("assignee != currentUser()") == ["TF-1", "TF-2", "TF-3", "TF-4"]
    assert k("label = auth") == ["TF-2"] and k("label in (docs, auth)") == ["TF-2", "TF-3"]
    assert k("label is empty") == ["TF-1", "TF-4"] and k("label != docs") == ["TF-1", "TF-2", "TF-4"]
    assert k("sprint in openSprints()") == ["TF-2"] and k('sprint = "Sprint 1"') == ["TF-2"]
    assert k("sprint is empty") == ["TF-1", "TF-3", "TF-4"]
    assert k("component = API") == ["TF-2"] and k("component is empty") == ["TF-1", "TF-3", "TF-4"]
    assert k("fixVersion = 1.0") == ["TF-2"] and k("fixVersion is empty") == ["TF-1", "TF-3", "TF-4"]
    assert k("parent = TF-1") == ["TF-2"] and k("epic = TF-1") == ["TF-2"]
    assert k("text ~ login") == ["TF-2"] and k("text ~ DOCS") == ["TF-3"]
    assert k("text !~ login") == ["TF-1", "TF-3", "TF-4"]
    assert k("flagged = true") == ["TF-3"] and k("flagged = false") == ["TF-1", "TF-2", "TF-4"]
    assert k("due = 2030-05-01") == ["TF-2"] and k("due >= 2030-01-01") == ["TF-2"]
    assert k("due < 2031-01-01 AND due > 2029-12-31") == ["TF-2"] and k("due is empty") == ["TF-1", "TF-3", "TF-4"]
    assert k("created >= -1d") == ["TF-1", "TF-2", "TF-3", "TF-4"] and k("created < -1w") == []
    assert k("created >= startOfDay()") == ["TF-1", "TF-2", "TF-3", "TF-4"]
    assert k("updated > now()") == []
    assert k("resolved is not empty") == ["TF-4"] and k("resolved >= -2d") == ["TF-4"]
    assert k("storyPoints > 3") == ["TF-2"] and k("storyPoints >= 3") == ["TF-2", "TF-4"]
    # grouping, NOT, precedence
    assert k("type = bug OR type = story") == ["TF-2", "TF-4"]
    assert k("(type = bug OR type = task) AND priority = low") == ["TF-3"]
    assert k("type = bug OR type = task AND priority = low") == ["TF-2", "TF-3"]
    assert k("NOT type = epic") == ["TF-2", "TF-3", "TF-4"]
    assert k("NOT (type = epic OR type = bug)") == ["TF-3", "TF-4"]
    # blocked
    api(client, "post", "/issues/TF-3/links", a, json={"link_type": "blocks", "target_key": "TF-4"})
    assert k("blocked = true") == ["TF-4"] and k("blocked = false") == ["TF-1", "TF-2", "TF-3"]


def test_jql_order_errors_and_safety(client, jenv):
    a = jenv["alice"]
    r = api(client, "get", "/search", a, params={"jql": "type != epic ORDER BY priority DESC, key ASC"})
    assert [i["key"] for i in r.json()] == ["TF-3", "TF-4", "TF-2"]  # low, medium, high -> desc = low first
    r = api(client, "get", "/search", a, params={"jql": "ORDER BY created DESC"})
    assert [i["key"] for i in r.json()] == ["TF-4", "TF-3", "TF-2", "TF-1"]
    r = api(client, "get", "/search", a, params={"jql": "ORDER BY storyPoints ASC"})
    assert [i["key"] for i in r.json()][:2] == ["TF-4", "TF-2"]
    r = api(client, "get", "/search", a, params={"jql": "type = bug", "limit": 1})
    assert r.headers["x-total-count"] == "1"
    r = api(client, "get", "/search", a, params={"jql": "ORDER BY key", "limit": 2, "offset": 2})
    assert r.headers["x-total-count"] == "4" and [i["key"] for i in r.json()] == ["TF-3", "TF-4"]
    # per project route understands jql too
    assert keys(client, a, "label = auth", "/projects/TF/issues") == ["TF-2"]
    # errors -> 422 with a message and a position
    for bad, pos in (("type = ", None), ("nofield = 1", 0), ("type == bug", None), ("type = (bug", None),
                     ("type = bug AND", None), ('type = "bug', 7), ("statusCategory = nope", None),
                     ("created > yesterday", None), ("type bug", None), ("ORDER BY bogus", None),
                     ("key = notakey", None), ("text > 3", None), ("type = bug )", None)):
        r = api(client, "get", "/search", a, params={"jql": bad})
        assert r.status_code == 422, bad
        assert "position" in r.json()["detail"], bad
        if pos is not None:
            assert f"position {pos}" in r.json()["detail"]
    # injection attempts are inert values, never SQL / code
    for inj in ("type = \"bug'; DROP TABLE jira_issues; --\"", "text ~ \"%\"", "label = \"__import__('os')\"",
                "assignee = \"' OR 1=1 --\""):
        r = api(client, "get", "/search", a, params={"jql": inj})
        assert r.status_code == 200, inj
    assert keys(client, a, "") == ["TF-1", "TF-2", "TF-3", "TF-4"]
    assert keys(client, a, "text ~ \"%\"") == []  # LIKE wildcards are escaped
    assert api(client, "get", "/search", a, params={"jql": "x" * 5000}).status_code == 422
    deep = "(" * 40 + "type = bug" + ")" * 40
    assert api(client, "get", "/search", a, params={"jql": deep}).status_code == 422


def test_search_scope_and_archived(client, jenv):
    a, b, d = jenv["alice"], jenv["bob"], jenv["dave"]
    api(client, "post", "/projects", b, json={"key": "OT", "name": "Other"})
    mk(client, b, "bob private", key="OT")
    assert keys(client, d, "") == []  # dave sees nothing
    assert keys(client, a, "") == ["TF-1", "TF-2", "TF-3", "TF-4"]  # alice is not in OT
    assert keys(client, b, "project = OT") == ["OT-1"] and "OT-1" in keys(client, b, "")
    assert keys(client, b, "project in (OT, TF) AND type = bug") == ["TF-2"]
    # archived issues are hidden unless include_archived
    api(client, "patch", "/issues/TF-3", a, json={"archived": True})
    assert "TF-3" not in keys(client, a, "")
    r = api(client, "get", "/search", a, params={"include_archived": 1})
    assert "TF-3" in [i["key"] for i in r.json()]
    assert "TF-3" not in [i["key"] for i in api(client, "get", "/projects/TF/issues", a).json()]
    assert "TF-3" in [i["key"] for i in api(client, "get", "/projects/TF/issues?include_archived=1", a).json()]
    board = api(client, "get", "/projects/TF/board?sprint_id=all", a).json()
    assert "TF-3" not in [i["key"] for c in board["columns"] for i in c["issues"]]


def test_saved_filters(client, jenv):
    a, b, d = jenv["alice"], jenv["bob"], jenv["dave"]
    r = api(client, "post", "/filters", a, json={"name": "Bugs", "jql": "type = bug", "shared": True,
                                                 "project_key": "TF"})
    assert r.status_code == 201 and r.json()["project_key"] == "TF" and r.json()["is_owner"] is True
    fid = r.json()["id"]
    api(client, "post", "/filters", a, json={"name": "Mine private", "jql": "assignee = currentUser()"})
    api(client, "post", "/filters", a, json={"name": "Shared no project", "jql": "type = bug", "shared": True})
    assert api(client, "post", "/filters", a, json={"name": "bad", "jql": "type ="}).status_code == 422
    assert api(client, "post", "/filters", a, json={"name": "bad", "jql": "", "project_key": "NOPE"}
               ).status_code == 404
    assert [f["name"] for f in api(client, "get", "/filters", a).json()] == ["Bugs", "Mine private",
                                                                              "Shared no project"]
    bobs = api(client, "get", "/filters", b).json()
    assert [f["name"] for f in bobs] == ["Bugs"] and bobs[0]["is_owner"] is False
    assert api(client, "get", "/filters", d).json() == []
    assert api(client, "patch", f"/filters/{fid}", b, json={"name": "x"}).status_code == 404
    assert api(client, "patch", f"/filters/{fid}", a, json={"name": "All bugs", "shared": False}).json()["name"] == "All bugs"
    assert api(client, "get", "/filters", b).json() == []
    assert api(client, "patch", f"/filters/{fid}", a, json={"jql": "type = "}).status_code == 422
    assert api(client, "delete", f"/filters/{fid}", b).status_code == 404
    assert api(client, "delete", f"/filters/{fid}", a).status_code == 204


# ------------------------------------------------------------------ 9. workflow / WIP
def test_workflow_and_wip(client, env):
    a, b = env["alice"], env["bob"]
    c = cols(client, a)
    todo, prog, rev, done = (c[n]["id"] for n in ("To Do", "In Progress", "In Review", "Done"))
    i = mk(client, b, "flow")
    assert i["allowed_column_ids"] == [todo, prog, rev, done]
    assert api(client, "put", "/projects/TF/workflow", b, json={"transitions": []}).status_code == 403
    assert api(client, "put", "/projects/TF/workflow", a, json={"transitions": [{"from": todo, "to": 9999}]}
               ).status_code == 422
    w = api(client, "put", "/projects/TF/workflow", a, json={"transitions": [
        {"from": todo, "to": prog}, {"from": prog, "to": rev}, {"from": rev, "to": done}, {"from": prog, "to": todo},
        {"from": todo, "to": prog}]}).json()
    assert len(w["transitions"]) == 4 and w["transitions"][0] == {"from": todo, "to": prog}
    assert api(client, "get", "/projects/TF/workflow", b).json()["transitions"] == w["transitions"]
    # not enforced yet -> anything goes
    assert api(client, "post", "/issues/TF-1/move", b, json={"column_id": done}).status_code == 200
    api(client, "post", "/issues/TF-1/move", b, json={"column_id": todo})
    api(client, "patch", "/projects/TF", a, json={"enforce_workflow": True})
    d = api(client, "get", "/issues/TF-1", b).json()
    assert d["allowed_column_ids"] == [todo, prog]  # current column + allowed targets
    r = api(client, "post", "/issues/TF-1/move", b, json={"column_id": done})
    assert r.status_code == 409 and "In Progress" in r.json()["detail"]
    assert api(client, "patch", "/issues/TF-1", b, json={"column_id": rev}).status_code == 409
    assert api(client, "post", "/issues/TF-1/move", b, json={"column_id": todo}).status_code == 200  # same column
    assert api(client, "post", "/issues/TF-1/move", b, json={"column_id": prog}).status_code == 200
    assert api(client, "patch", "/issues/TF-1", b, json={"column_id": rev}).status_code == 200
    # WIP limit warns but never blocks
    assert api(client, "patch", f"/columns/{todo}", a, json={"wip_limit": 1}).json()["wip_limit"] == 1
    assert api(client, "patch", f"/columns/{todo}", b, json={"wip_limit": 1}).status_code == 403
    assert api(client, "patch", f"/columns/{todo}", a, json={"wip_limit": 0}).status_code == 422
    mk(client, b, "a"), mk(client, b, "b")
    board = api(client, "get", "/projects/TF/board?sprint_id=all", b).json()
    bc = {c["name"]: c for c in board["columns"]}
    assert bc["To Do"]["wip_limit"] == 1 and bc["To Do"]["over_wip"] is True
    assert bc["Done"]["wip_limit"] is None and bc["Done"]["over_wip"] is False
    assert api(client, "patch", f"/columns/{todo}", a, json={"wip_limit": None}).json()["wip_limit"] is None


# ------------------------------------------------------------------ 10. custom fields
def test_custom_fields(client, env):
    a, b = env["alice"], env["bob"]
    mk_f = lambda **kw: api(client, "post", "/projects/TF/custom-fields", a, json=kw)
    t = mk_f(name="Notes", field_type="text").json()
    n = mk_f(name="Score", field_type="number").json()
    s = mk_f(name="Tier", field_type="select", options=["gold", "silver", "gold"]).json()
    dt = mk_f(name="Review", field_type="date").json()
    cb = mk_f(name="Approved", field_type="checkbox", required=True).json()
    assert s["options"] == ["gold", "silver"] and mk_f(name="X", field_type="select").status_code == 422
    assert api(client, "post", "/projects/TF/custom-fields", b, json={"name": "Q", "field_type": "text"}
               ).status_code == 403
    assert [f["name"] for f in api(client, "get", "/projects/TF/custom-fields", b).json()] == [
        "Notes", "Score", "Tier", "Review", "Approved"]
    assert [f["id"] for f in api(client, "get", "/projects/TF", b).json()["custom_fields"]][0] == t["id"]
    # required enforced on create
    assert api(client, "post", "/projects/TF/issues", b, json={"title": "x"}).status_code == 422
    good = {str(cb["id"]): True, str(t["id"]): "hello", str(n["id"]): 4.5, str(s["id"]): "gold",
            str(dt["id"]): "2030-01-02"}
    r = api(client, "post", "/projects/TF/issues", b, json={"title": "x", "custom_fields": good})
    assert r.status_code == 201 and r.json()["custom_fields"] == good
    for bad in ({str(n["id"]): "abc"}, {str(n["id"]): True}, {str(s["id"]): "bronze"}, {str(dt["id"]): "31/12"},
                {str(cb["id"]): "yes"}, {str(t["id"]): 5}, {"99999": "x"}):
        r = api(client, "patch", "/issues/TF-1", b, json={"custom_fields": bad})
        assert r.status_code == 422, bad
    r = api(client, "patch", "/issues/TF-1", b, json={"custom_fields": {str(n["id"]): 9, str(t["id"]): None}})
    assert r.status_code == 200 and r.json()["custom_fields"][str(n["id"])] == 9
    assert str(t["id"]) not in r.json()["custom_fields"]  # null clears; others retained
    assert r.json()["custom_fields"][str(s["id"])] == "gold"
    assert any(h["field"] == "cf:Score" for h in api(client, "get", "/issues/TF-1/history", b).json())
    pf = api(client, "patch", f"/custom-fields/{s['id']}", a, json={"options": ["gold", "bronze"], "name": "Level"})
    assert pf.json()["options"] == ["gold", "bronze"] and pf.json()["name"] == "Level"
    assert api(client, "delete", f"/custom-fields/{n['id']}", a).status_code == 204
    assert str(n["id"]) not in api(client, "get", "/issues/TF-1", a).json()["custom_fields"]


# ------------------------------------------------------------------ 11. roadmap / reports / activity / dashboard
def test_roadmap_reports_activity_dashboard(client, env):
    a, b = env["alice"], env["bob"]
    c = cols(client, a)
    ida, idb = uid(client, a), uid(client, b)
    e1 = mk(client, a, "Epic late", type="epic", start_date="2030-03-01", due_date="2030-06-01")
    e2 = mk(client, a, "Epic early", type="epic", start_date="2030-01-01")
    e3 = mk(client, a, "Epic nodate", type="epic")
    ver = api(client, "post", "/projects/TF/versions", a, json={"name": "1.0"}).json()
    s1 = mk(client, a, "child1", parent_id=e2["id"], story_points=3, assignee_id=idb, original_estimate_min=60,
            fix_version_id=ver["id"])
    mk(client, a, "child2", parent_id=e2["id"], story_points=2, column_id=c["Done"]["id"])
    mk(client, a, "child3", parent_id=e2["id"], column_id=c["Done"]["id"])
    mk(client, a, "solo", assignee_id=ida, story_points=8, due_date=(date.today() + timedelta(days=2)).isoformat())
    rm = api(client, "get", "/projects/TF/roadmap", b).json()
    assert [r["issue"]["title"] for r in rm] == ["Epic early", "Epic late", "Epic nodate"]
    assert rm[0]["children_total"] == 3 and rm[0]["children_done"] == 2 and rm[0]["percent"] == 67
    assert rm[0]["start_date"] == "2030-01-01" and rm[1]["due_date"] == "2030-06-01" and rm[1]["percent"] == 0
    assert e1 and e3 and s1
    # velocity: complete a sprint with one done + one open issue
    sp = api(client, "get", "/projects/TF", a).json()["sprints"][0]["id"]
    api(client, "patch", f"/issues/{s1['key']}", a, json={"sprint_id": sp})
    api(client, "patch", "/issues/TF-5", a, json={"sprint_id": sp})  # child2 (done, 2 pts)
    api(client, "post", f"/sprints/{sp}/start", a, json={})
    assert api(client, "post", f"/sprints/{sp}/complete", a, json={"move_open_to": "backlog"}).status_code == 200
    v = api(client, "get", "/projects/TF/reports/velocity?n=5", b).json()
    assert len(v["sprints"]) == 1 and v["sprints"][0]["committed_points"] == 5
    assert v["sprints"][0]["completed_points"] == 2 and v["average"] == 2 and v["sprints"][0]["sprint"]["state"] == "closed"
    cvr = api(client, "get", "/projects/TF/reports/created-vs-resolved?days=7", b).json()
    assert len(cvr) == 7 and cvr[-1]["created"] == 7 and cvr[-1]["resolved"] == 2
    rt = api(client, "get", "/projects/TF/reports/resolution-time", b).json()
    assert rt["count"] == 2 and rt["avg_days"] >= 0 and rt["median_days"] >= 0 and rt["by_type"][0]["type"] == "task"
    wl = api(client, "get", "/projects/TF/reports/workload", b).json()
    by = {(r["user"] or {}).get("id"): r for r in wl}
    assert by[ida]["open_issues"] == 1 and by[ida]["open_points"] == 8
    assert by[idb]["open_points"] == 3 and by[idb]["remaining_minutes"] == 60
    assert any(r["user"] is None for r in wl)
    flow = api(client, "get", "/projects/TF/reports/cfd?days=5", b).json()
    assert flow["approximate"] is True and len(flow["series"]) == 5
    last = flow["series"][-1]["counts"]
    assert sum(last.values()) == 7 and last[str(c["Done"]["id"])] == 2
    # activity
    feed = api(client, "get", "/projects/TF/activity?limit=100", b).json()
    kinds = {f["type"] for f in feed}
    assert "created" in kinds and "change" in kinds
    api(client, "post", "/issues/TF-4/comments", b, json={"body": "hello feed"})
    feed = api(client, "get", "/activity?limit=3", b).json()
    assert len(feed) == 3 and feed[0]["type"] == "comment" and feed[0]["issue"]["key"] == "TF-4"
    assert feed[0]["text"] == "hello feed" and feed[0]["user"]["name"] == "Alice"
    assert api(client, "get", "/activity", env["dave"]).json() == []
    # dashboard
    api(client, "post", "/issues/TF-7/worklogs", a, json={"minutes": 90})
    api(client, "post", "/issues/TF-4/watch", a)
    dash = api(client, "get", "/dashboard", a).json()
    assert dash["assigned_to_me_open"] == 1
    assert [i["key"] for i in dash["due_soon"]] == ["TF-7"]
    assert len(dash["recently_updated"]) <= 10 and dash["recently_updated"]
    assert [p["key"] for p in dash["my_projects"]] == ["TF"]
    assert "TF-4" in [i["key"] for i in dash["watching"]]
    assert dash["worklog_minutes_week"] == 90
    assert api(client, "get", "/dashboard", env["dave"]).json()["my_projects"] == []


# ------------------------------------------------------------------ 12. bulk, clone, move, import/export
def test_bulk(client, env):
    a, b, c = env["alice"], env["bob"], env["carol"]
    ids = cols(client, a)
    for t in ("a", "b", "c"):
        mk(client, b, t, labels=["old"])
    idb = uid(client, b)
    r = api(client, "post", "/projects/TF/issues/bulk", b, json={
        "issue_keys": ["TF-1", "TF-2", "TF-99", "OT-1"], "action": "update",
        "patch": {"assignee_id": idb, "priority": "high", "labels_add": ["new"], "labels_remove": ["old"],
                  "column_id": ids["In Progress"]["id"]}})
    assert r.status_code == 200 and r.json()["updated"] == 2
    assert {f["key"] for f in r.json()["failed"]} == {"TF-99", "OT-1"}
    i = api(client, "get", "/issues/TF-1", b).json()
    assert i["priority"] == "high" and i["labels"] == ["new"] and i["status_name"] == "In Progress"
    assert i["assignee"]["id"] == idb
    bad = api(client, "post", "/projects/TF/issues/bulk", b, json={"issue_keys": ["TF-1", "TF-3"], "action": "update",
                                                                    "patch": {"assignee_id": 9999}}).json()
    assert bad["updated"] == 0 and len(bad["failed"]) == 2
    assert api(client, "post", "/projects/TF/issues/bulk", c, json={"issue_keys": ["TF-1"], "action": "archive"}
               ).status_code == 403
    assert api(client, "post", "/projects/TF/issues/bulk", b, json={"issue_keys": ["TF-1"], "action": "update"}
               ).status_code == 422
    assert api(client, "post", "/projects/TF/issues/bulk", b, json={"issue_keys": [f"TF-{n}" for n in range(101)],
                                                                    "action": "archive"}).status_code == 422
    assert api(client, "post", "/projects/TF/issues/bulk", b, json={"issue_keys": ["TF-1", "TF-2"],
                                                                    "action": "archive"}).json()["updated"] == 2
    assert [i["key"] for i in api(client, "get", "/projects/TF/issues", b).json()] == ["TF-3"]
    api(client, "post", "/projects/TF/issues/bulk", b, json={"issue_keys": ["TF-1"], "action": "unarchive"})
    assert api(client, "post", "/projects/TF/issues/bulk", b, json={"issue_keys": ["TF-3", "TF-1"],
                                                                    "action": "delete"}).json()["updated"] == 2
    assert api(client, "get", "/issues/TF-3", b).status_code == 404


def test_clone_and_move_project(client, env):
    a, b = env["alice"], env["bob"]
    ids = cols(client, a)
    comp = api(client, "post", "/projects/TF/components", a, json={"name": "API"}).json()
    e = mk(client, a, "Epic", type="epic")
    s = mk(client, a, "Story", type="story", parent_id=e["id"], labels=["x"], story_points=3,
           component_ids=[comp["id"]], assignee_id=uid(client, b), original_estimate_min=30,
           column_id=ids["In Progress"]["id"])
    mk(client, a, "Sub 1", type="subtask", parent_id=s["id"])
    mk(client, a, "Sub 2", type="subtask", parent_id=s["id"])
    r = api(client, "post", f"/issues/{s['key']}/clone", b, json={"include_subtasks": True})
    assert r.status_code == 201
    cl = r.json()
    assert cl["title"] == "CLONE - Story" and cl["key"] == "TF-5" and cl["status_name"] == "To Do"
    assert cl["labels"] == ["x"] and cl["story_points"] == 3 and cl["parent"]["key"] == "TF-1"
    assert cl["component_ids"] == [comp["id"]] and cl["subtask_count"] == 2 and cl["reporter"]["name"] == "Alice"
    assert cl["links"][0]["direction_label"] == "clones" and cl["links"][0]["issue"]["key"] == "TF-2"
    assert any(l["direction_label"] == "is cloned by" for l in api(client, "get", "/issues/TF-2", a).json()["links"])
    plain = api(client, "post", f"/issues/{s['key']}/clone", b, json={"title_prefix": "Copy: "}).json()
    assert plain["title"] == "Copy: Story" and plain["subtask_count"] == 0
    assert api(client, "post", "/issues/TF-1/clone", env["carol"], json={}).status_code == 403
    # move project
    api(client, "post", "/projects", b, json={"key": "OT", "name": "Other"})
    assert api(client, "post", "/issues/TF-2/move-project", b, json={"project_key": "TF"}).status_code == 422
    assert api(client, "post", "/issues/TF-2/move-project", b, json={"project_key": "NOPE"}).status_code == 404
    assert api(client, "post", "/issues/TF-3/move-project", b, json={"project_key": "OT"}).status_code == 422  # subtask
    ot_before = mk(client, b, "existing", key="OT")
    r = api(client, "post", "/issues/TF-2/move-project", b, json={"project_key": "OT"})
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["key"] == "OT-2" and m["project_key"] == "OT" and m["status_name"] == "In Progress"
    assert m["parent"] is None and m["sprint_id"] is None and m["components"] == [] and m["fix_version"] is None
    assert m["subtask_count"] == 2 and m["assignee"]["name"] == "Alice"  # bob is in OT -> kept
    assert any(h["field"] == "project" and h["old_value"] == "TF-2" and h["new_value"] == "OT-2"
               for h in api(client, "get", "/issues/OT-2/history", b).json())
    assert api(client, "get", "/issues/TF-2", a).status_code == 404 and ot_before["key"] == "OT-1"
    subs = api(client, "get", "/issues/OT-2", b).json()["subtasks"]
    assert [x["key"] for x in subs] == ["OT-3", "OT-4"]
    # alice is not a member of OT -> cannot move into it
    assert api(client, "post", "/issues/TF-1/move-project", a, json={"project_key": "OT"}).status_code == 404
    # moving an epic detaches its children
    r = api(client, "post", "/issues/TF-1/move-project", b, json={"project_key": "OT"})
    assert r.status_code == 200 and r.json()["type"] == "epic"
    assert api(client, "get", "/issues/TF-5", b).json()["parent"] is None


def test_export_import_csv(client, env):
    a, b = env["alice"], env["bob"]
    mk(client, b, "=cmd|' /C calc'!A0", labels=["l1", "l2"], story_points=2, assignee_id=uid(client, b))
    mk(client, b, "plain, with comma", description="line1\nline2", type="bug", priority="high")
    r = client.get("/api/jira/projects/TF/issues/export?format=csv", headers=b)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    text = r.text.lstrip("﻿")
    assert text.splitlines()[0].startswith("key,type,title,description,priority,assignee_email,labels,story_points")
    assert "'=cmd" in text and "l1;l2" in text and '"plain, with comma"' in text and "bob@example.com" in text
    only = client.get("/api/jira/projects/TF/issues/export", params={"jql": "type = bug"}, headers=b).text
    assert "plain" in only and "cmd" not in only
    assert client.get("/api/jira/projects/TF/issues/export?format=xlsx", headers=b).status_code == 422
    assert client.get("/api/jira/projects/TF/issues/export", headers=env["dave"]).status_code == 404
    assert client.get("/api/jira/projects/TF/issues/export", params={"jql": "bad ="}, headers=b).status_code == 422
    # import
    csv_text = ("type,title,description,priority,assignee_email,labels,story_points,due_date,status\n"
                "story,Imported one,desc,high,bob@example.com,\"a,b\",5,2030-01-01,In Progress\n"
                "bug,Imported two,,,,,,,\n"
                ",,missing title,,,,,,\n"
                "task,Bad assignee,,,nobody@example.com,,,,\n"
                "task,Bad status,,,,,,,Nope\n"
                "task,Bad points,,,,,abc,,\n"
                "wat,Bad type,,,,,,,\n"
                "subtask,Orphan sub,,,,,,,\n")
    imp = lambda h, data: client.post("/api/jira/projects/TF/issues/import", headers=h,
                                      files={"file": ("x.csv", data.encode(), "text/csv")})
    r = imp(b, csv_text)
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["created"] == 2
    assert [e["row"] for e in res["errors"]] == [4, 5, 6, 7, 8, 9] and all(e["detail"] for e in res["errors"])
    one = api(client, "get", "/issues/TF-3", b).json()
    assert one["title"] == "Imported one" and one["labels"] == ["a", "b"] and one["story_points"] == 5
    assert one["status_name"] == "In Progress" and one["assignee"]["name"] == "Alice"
    assert imp(env["carol"], csv_text).status_code == 403
    assert imp(b, "nothing,here\n1,2\n").status_code == 422
    big = "title\n" + "\n".join(f"t{n}" for n in range(501))
    assert imp(b, big).status_code == 422
    # round trip: exported CSV can be imported
    again = imp(b, r_csv := client.get("/api/jira/projects/TF/issues/export", headers=b).text.lstrip("﻿")).json()
    assert again["created"] >= 4 and r_csv


# ------------------------------------------------------------------ 13. optional email
def test_email_optional(client, env, monkeypatch):
    from app.services import mailer
    sent = []
    monkeypatch.setattr(mailer, "_run", lambda fn: fn())
    monkeypatch.setattr(mailer, "_deliver", lambda to, subject, body: sent.append((to, subject, body)))
    a, b = env["alice"], env["bob"]
    # off by default
    monkeypatch.delenv("SMTP_HOST", raising=False)
    assert mailer.enabled() is False
    mk(client, a, "quiet", assignee_id=uid(client, b))
    api(client, "post", "/projects/TF/members", a, json={"email": "x1@example.com", "role": "member"})
    assert sent == []
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    assert mailer.enabled() is True
    # invited
    api(client, "post", "/projects/TF/members", a, json={"email": "x2@example.com", "role": "member"})
    assert [s[0] for s in sent] == ["x2@example.com"] and "invited" in sent[0][1]
    # assigned
    sent.clear()
    mk(client, a, "loud", assignee_id=uid(client, b))
    assert [(s[0], "assigned" in s[1]) for s in sent] == [("bob@example.com", True)]
    # mentioned
    sent.clear()
    idb = uid(client, b)
    api(client, "post", "/issues/TF-2/comments", a, json={"body": f"hi @[user:{idb}]"})
    assert any(s[0] == "bob@example.com" and "mentioned" in s[1] for s in sent)
    # opt-out via settings
    assert client.get("/api/settings", headers=b).json()["jira_email_notifications"] is True
    r = client.patch("/api/settings", headers=b, json={"jira_email_notifications": False})
    assert r.status_code == 200 and r.json()["jira_email_notifications"] is False
    sent.clear()
    mk(client, a, "after optout", assignee_id=idb)
    assert sent == []
    # a failing SMTP server never breaks the request
    monkeypatch.setattr(mailer, "_deliver", lambda *a_, **k: (_ for _ in ()).throw(RuntimeError("smtp down")))
    r = api(client, "post", "/projects/TF/members", a, json={"email": "x3@example.com", "role": "member"})
    assert r.status_code == 201


def test_migration_head_matches_models():
    """alembic 0003 exists and chains from 0002."""
    import importlib.util
    import pathlib
    p = pathlib.Path(__file__).resolve().parent.parent / "alembic" / "versions" / "0003_jira_v2.py"
    spec = importlib.util.spec_from_file_location("m0003", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert (m.revision, m.down_revision) == ("0003", "0002")
