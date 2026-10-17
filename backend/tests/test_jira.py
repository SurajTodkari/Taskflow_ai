import pytest

from app.db import SessionLocal
from app.models import Notification


def H(make_headers, email):
    return make_headers(email)


@pytest.fixture
def env(client, make_headers):
    """alice = admin, bob = member, carol = viewer, dave = non-member."""
    h = {n: make_headers(f"{n}@example.com") for n in ("alice", "bob", "carol", "dave")}
    r = client.post("/api/jira/projects", json={"key": "TF", "name": "TaskFlow"}, headers=h["alice"])
    assert r.status_code == 201, r.text
    for n, role in (("bob", "member"), ("carol", "viewer")):
        r = client.post("/api/jira/projects/TF/members", json={"email": f"{n}@example.com", "role": role},
                        headers=h["alice"])
        assert r.status_code == 201, r.text
    return h


def mk(client, h, title="Issue", key="TF", **kw):
    r = client.post(f"/api/jira/projects/{key}/issues", json={"title": title, **kw}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def uid(client, h):
    return client.get("/api/auth/me", headers=h).json()["id"]


def cols(client, h, key="TF"):
    return {c["name"]: c for c in client.get(f"/api/jira/projects/{key}", headers=h).json()["columns"]}


# ------------------------------------------------------------------ projects
def test_requires_auth(client):
    assert client.get("/api/jira/projects").status_code == 401


def test_create_project_defaults(client, env):
    r = client.get("/api/jira/projects/TF", headers=env["alice"])
    p = r.json()
    assert p["my_role"] == "admin" and p["lead"]["name"] == "Alice"
    assert [(c["name"], c["category"]) for c in p["columns"]] == [
        ("To Do", "todo"), ("In Progress", "in_progress"), ("In Review", "in_progress"), ("Done", "done")]
    assert [s["name"] for s in p["sprints"]] == ["Sprint 1"] and p["sprints"][0]["state"] == "planned"
    assert {m["email"]: m["role"] for m in p["members"]} == {
        "alice@example.com": "admin", "bob@example.com": "member", "carol@example.com": "viewer"}
    lst = client.get("/api/jira/projects", headers=env["alice"]).json()
    assert lst[0]["member_count"] == 3 and lst[0]["issue_count"] == 0 and lst[0]["active_sprint"] is None


def test_project_key_validation_and_conflict(client, env):
    for bad in ("a", "T-F", "TOOLONGKEY12", "t f", ""):
        assert client.post("/api/jira/projects", json={"key": bad, "name": "x"},
                           headers=env["alice"]).status_code == 422
    assert client.post("/api/jira/projects", json={"key": "tf", "name": "dup"},
                       headers=env["bob"]).status_code == 409
    r = client.post("/api/jira/projects", json={"key": "ab1", "name": "Lower"}, headers=env["bob"])
    assert r.status_code == 201 and r.json()["key"] == "AB1"


def test_non_member_gets_404(client, env):
    d = env["dave"]
    assert client.get("/api/jira/projects", headers=d).json() == []
    assert client.get("/api/jira/projects/TF", headers=d).status_code == 404
    assert client.get("/api/jira/projects/TF/issues", headers=d).status_code == 404
    assert client.post("/api/jira/projects/TF/issues", json={"title": "x"}, headers=d).status_code == 404
    i = mk(client, env["alice"])
    assert client.get(f"/api/jira/issues/{i['key']}", headers=d).status_code == 404
    assert client.get("/api/jira/projects/NOPE", headers=d).status_code == 404


def test_project_patch_delete_admin_only(client, env):
    assert client.patch("/api/jira/projects/TF", json={"name": "X"}, headers=env["bob"]).status_code == 403
    assert client.delete("/api/jira/projects/TF", headers=env["bob"]).status_code == 403
    r = client.patch("/api/jira/projects/TF", json={"name": "Renamed", "description": "d"}, headers=env["alice"])
    assert r.status_code == 200 and r.json()["name"] == "Renamed"
    bob_id = uid(client, env["bob"])
    assert client.patch("/api/jira/projects/TF", json={"lead_id": bob_id}, headers=env["alice"]).json()["lead"]["id"] == bob_id
    assert client.patch("/api/jira/projects/TF", json={"lead_id": uid(client, env["dave"])},
                        headers=env["alice"]).status_code == 422
    mk(client, env["alice"])
    assert client.delete("/api/jira/projects/TF", headers=env["alice"]).status_code == 204
    assert client.get("/api/jira/projects/TF", headers=env["alice"]).status_code == 404


# ------------------------------------------------------------------ members
def test_members_management(client, env):
    a = env["alice"]
    # v2: unregistered emails get a pending invite instead of a 404
    r = client.post("/api/jira/projects/TF/members", json={"email": "ghost@example.com", "role": "member"},
                    headers=a)
    assert r.status_code == 201 and r.json() == {"invited": True, "email": "ghost@example.com", "role": "member"}
    assert client.post("/api/jira/projects/TF/members", json={"email": "bob@example.com", "role": "member"},
                       headers=a).status_code == 409
    assert client.post("/api/jira/projects/TF/members", json={"email": "dave@example.com", "role": "member"},
                       headers=env["bob"]).status_code == 403
    bob = uid(client, env["bob"])
    assert client.patch(f"/api/jira/projects/TF/members/{bob}", json={"role": "viewer"}, headers=a).json()["role"] == "viewer"
    assert client.patch(f"/api/jira/projects/TF/members/{bob}", json={"role": "bogus"}, headers=a).status_code == 422
    assert client.patch(f"/api/jira/projects/TF/members/{uid(client, env['dave'])}", json={"role": "viewer"},
                        headers=a).status_code == 404


def test_last_admin_protected(client, env):
    a = env["alice"]
    alice = uid(client, a)
    assert client.patch(f"/api/jira/projects/TF/members/{alice}", json={"role": "member"}, headers=a).status_code == 409
    assert client.delete(f"/api/jira/projects/TF/members/{alice}", headers=a).status_code == 409
    bob = uid(client, env["bob"])
    client.patch(f"/api/jira/projects/TF/members/{bob}", json={"role": "admin"}, headers=a)
    assert client.patch(f"/api/jira/projects/TF/members/{alice}", json={"role": "member"}, headers=a).status_code == 200


def test_remove_member_unassigns_and_leave(client, env):
    a, b = env["alice"], env["bob"]
    bob = uid(client, b)
    i = mk(client, a, assignee_id=bob)
    assert i["assignee"]["id"] == bob
    # bob cannot remove others, but can leave
    assert client.delete(f"/api/jira/projects/TF/members/{uid(client, a)}", headers=b).status_code == 403
    assert client.delete(f"/api/jira/projects/TF/members/{bob}", headers=b).status_code == 204
    assert client.get("/api/jira/projects/TF", headers=b).status_code == 404
    assert client.get(f"/api/jira/issues/{i['key']}", headers=a).json()["assignee"] is None
    # admin removes viewer
    carol = uid(client, env["carol"])
    assert client.delete(f"/api/jira/projects/TF/members/{carol}", headers=a).status_code == 204


# ------------------------------------------------------------------ permissions
def test_viewer_is_read_only(client, env):
    v, a = env["carol"], env["alice"]
    i = mk(client, a)
    k = i["key"]
    assert client.get(f"/api/jira/issues/{k}", headers=v).status_code == 200
    assert client.get("/api/jira/projects/TF/issues", headers=v).status_code == 200
    assert client.get("/api/jira/projects/TF/board?sprint_id=all", headers=v).status_code == 200
    assert client.post("/api/jira/projects/TF/issues", json={"title": "x"}, headers=v).status_code == 403
    assert client.patch(f"/api/jira/issues/{k}", json={"title": "x"}, headers=v).status_code == 403
    assert client.delete(f"/api/jira/issues/{k}", headers=v).status_code == 403
    assert client.post(f"/api/jira/issues/{k}/comments", json={"body": "x"}, headers=v).status_code == 403
    assert client.post(f"/api/jira/issues/{k}/move", json={"column_id": 1}, headers=v).status_code == 403
    assert client.post("/api/jira/projects/TF/sprints", json={"name": "S"}, headers=v).status_code == 403


def test_member_cannot_admin(client, env):
    b = env["bob"]
    assert client.post("/api/jira/projects/TF/columns", json={"name": "QA", "category": "todo"},
                       headers=b).status_code == 403
    c = cols(client, env["alice"])["To Do"]
    assert client.patch(f"/api/jira/columns/{c['id']}", json={"name": "x"}, headers=b).status_code == 403
    assert client.delete(f"/api/jira/columns/{c['id']}", headers=b).status_code == 403
    s = client.get("/api/jira/projects/TF/sprints", headers=b).json()[0]
    assert client.delete(f"/api/jira/sprints/{s['id']}", headers=b).status_code == 403
    # but a member can create a sprint
    assert client.post("/api/jira/projects/TF/sprints", json={"name": "S2"}, headers=b).status_code == 201


def test_column_non_member_404(client, env):
    c = cols(client, env["alice"])["To Do"]
    assert client.patch(f"/api/jira/columns/{c['id']}", json={"name": "x"}, headers=env["dave"]).status_code == 404


# ------------------------------------------------------------------ issues
def test_issue_key_generation(client, env):
    keys = [mk(client, env["alice"], title=f"i{n}")["key"] for n in range(3)]
    assert keys == ["TF-1", "TF-2", "TF-3"]
    client.delete("/api/jira/issues/TF-3", headers=env["alice"])
    assert mk(client, env["alice"])["key"] == "TF-4"  # numbers are never reused
    client.post("/api/jira/projects", json={"key": "OTHER", "name": "Other"}, headers=env["alice"])
    assert mk(client, env["alice"], key="OTHER")["key"] == "OTHER-1"
    i = client.get("/api/jira/issues/tf-2", headers=env["alice"])
    assert i.status_code == 200 and i.json()["number"] == 2 and i.json()["project_key"] == "TF"
    for bad in ("TF-99", "TF-x", "nodash", "ZZ-1"):
        assert client.get(f"/api/jira/issues/{bad}", headers=env["alice"]).status_code == 404


def test_issue_defaults_and_shape(client, env):
    i = mk(client, env["bob"], title="  Hello  ", labels=["a", "b", "a", " "], story_points=3)
    assert i["title"] == "Hello" and i["type"] == "task" and i["priority"] == "medium"
    assert i["status_name"] == "To Do" and i["status_category"] == "todo"
    assert i["reporter"]["name"] == "Alice"  # reporter is the creator (make_headers users are all named Alice)
    assert i["labels"] == ["a", "b"] and i["story_points"] == 3 and i["sprint_id"] is None
    assert i["subtasks"] == [] and i["epic_children_count"] == 0 and i["comment_count"] == 0
    for k in ("id", "rank", "created_at", "updated_at", "subtask_count", "subtasks_done", "parent", "resolved_at"):
        assert k in i
    assert client.post("/api/jira/projects/TF/issues", json={"title": ""}, headers=env["bob"]).status_code == 422
    assert client.post("/api/jira/projects/TF/issues", json={"title": "x", "type": "nope"},
                       headers=env["bob"]).status_code == 422
    assert client.post("/api/jira/projects/TF/issues", json={"title": "x", "story_points": -1},
                       headers=env["bob"]).status_code == 422


def test_hierarchy_validation(client, env):
    a = env["alice"]
    epic = mk(client, a, type="epic", title="E")
    story = mk(client, a, type="story", parent_id=epic["id"])
    assert story["parent"]["key"] == epic["key"]
    sub = mk(client, a, type="subtask", parent_id=story["id"])
    post = lambda **kw: client.post("/api/jira/projects/TF/issues", json={"title": "x", **kw}, headers=a)
    assert post(type="subtask").status_code == 422
    assert post(type="subtask", parent_id=epic["id"]).status_code == 422
    assert post(type="subtask", parent_id=sub["id"]).status_code == 422
    assert post(type="epic", parent_id=epic["id"]).status_code == 422
    assert post(type="task", parent_id=story["id"]).status_code == 422  # only epics are parents of tasks
    assert post(type="task", parent_id=9999).status_code == 422
    client.post("/api/jira/projects", json={"key": "ZZ", "name": "Z"}, headers=a)
    other = mk(client, a, key="ZZ", type="epic")
    assert post(type="task", parent_id=other["id"]).status_code == 422  # other project
    d = client.get(f"/api/jira/issues/{story['key']}", headers=a).json()
    assert d["subtask_count"] == 1 and [s["key"] for s in d["subtasks"]] == [sub["key"]]
    assert client.get(f"/api/jira/issues/{epic['key']}", headers=a).json()["epic_children_count"] == 1


def test_assignee_must_be_member(client, env):
    dave = uid(client, env["dave"])
    r = client.post("/api/jira/projects/TF/issues", json={"title": "x", "assignee_id": dave}, headers=env["alice"])
    assert r.status_code == 422
    i = mk(client, env["alice"])
    assert client.patch(f"/api/jira/issues/{i['key']}", json={"assignee_id": dave}, headers=env["alice"]).status_code == 422


def test_patch_history_and_resolved(client, env):
    a = env["alice"]
    i = mk(client, a)
    k = i["key"]
    done = cols(client, a)["Done"]["id"]
    r = client.patch(f"/api/jira/issues/{k}", json={"title": "New", "priority": "high", "column_id": done,
                                                    "labels": ["x"], "story_points": 5}, headers=a)
    assert r.status_code == 200
    d = r.json()
    assert d["title"] == "New" and d["resolved_at"] is not None and d["status_category"] == "done"
    todo = cols(client, a)["To Do"]["id"]
    d = client.patch(f"/api/jira/issues/{k}", json={"column_id": todo}, headers=a).json()
    assert d["resolved_at"] is None
    hist = client.get(f"/api/jira/issues/{k}/history", headers=a).json()
    fields = [h["field"] for h in hist]
    assert {"title", "priority", "status", "labels", "story_points"} <= set(fields)
    st = [h for h in hist if h["field"] == "status"]
    assert (st[0]["old_value"], st[0]["new_value"]) == ("Done", "To Do")  # newest first
    assert hist[0]["user"]["name"] == "Alice"
    # no-op patch writes no history
    n = len(hist)
    client.patch(f"/api/jira/issues/{k}", json={"title": "New"}, headers=a)
    assert len(client.get(f"/api/jira/issues/{k}/history", headers=a).json()) == n
    assert client.patch(f"/api/jira/issues/{k}", json={"title": None}, headers=a).status_code == 422
    assert client.patch(f"/api/jira/issues/{k}", json={"column_id": 99999}, headers=a).status_code == 422


def test_type_change_rules(client, env):
    a = env["alice"]
    epic = mk(client, a, type="epic")
    t = mk(client, a, parent_id=epic["id"])
    r = client.patch(f"/api/jira/issues/{t['key']}", json={"type": "epic"}, headers=a)
    assert r.status_code == 422  # still has a parent
    assert client.patch(f"/api/jira/issues/{t['key']}", json={"type": "bug"}, headers=a).json()["type"] == "bug"
    assert client.patch(f"/api/jira/issues/{epic['key']}", json={"type": "task"}, headers=a).status_code == 409
    # detach from epic
    assert client.patch(f"/api/jira/issues/{t['key']}", json={"parent_id": None}, headers=a).json()["parent"] is None


def test_delete_epic_detaches_and_parent_deletes_subtasks(client, env):
    a = env["alice"]
    epic = mk(client, a, type="epic")
    child = mk(client, a, parent_id=epic["id"])
    assert client.delete(f"/api/jira/issues/{epic['key']}", headers=a).status_code == 204
    assert client.get(f"/api/jira/issues/{child['key']}", headers=a).json()["parent"] is None
    sub = mk(client, a, type="subtask", parent_id=child["id"])
    assert client.delete(f"/api/jira/issues/{child['key']}", headers=a).status_code == 204
    assert client.get(f"/api/jira/issues/{sub['key']}", headers=a).status_code == 404


def test_list_filters_search_sort_pagination(client, env):
    a, b = env["alice"], env["bob"]
    bob = uid(client, b)
    done = cols(client, a)["Done"]["id"]
    mk(client, a, title="Login page crashes", type="bug", priority="highest", labels=["web"], assignee_id=bob)
    mk(client, a, title="Write docs", description="documentation for API", priority="low")
    mk(client, a, title="Ship it", priority="high", column_id=done, due_date="2030-01-01")
    base = "/api/jira/projects/TF/issues"
    r = client.get(base, headers=a)
    assert r.headers["X-Total-Count"] == "3" and len(r.json()) == 3
    assert [i["key"] for i in client.get(base + "?q=login", headers=a).json()] == ["TF-1"]
    assert [i["key"] for i in client.get(base + "?q=API", headers=a).json()] == ["TF-2"]
    assert [i["key"] for i in client.get(base + "?q=tf-3", headers=a).json()] == ["TF-3"]
    assert [i["key"] for i in client.get(base + "?type=bug", headers=a).json()] == ["TF-1"]
    assert [i["key"] for i in client.get(base + "?status_category=done", headers=a).json()] == ["TF-3"]
    assert [i["key"] for i in client.get(base + f"?column_id={done}", headers=a).json()] == ["TF-3"]
    assert [i["key"] for i in client.get(base + "?label=web", headers=a).json()] == ["TF-1"]
    assert client.get(base + "?label=we", headers=a).json() == []
    assert [i["key"] for i in client.get(base + f"?assignee={bob}", headers=a).json()] == ["TF-1"]
    assert [i["key"] for i in client.get(base + "?assignee=me", headers=b).json()] == ["TF-1"]
    assert [i["key"] for i in client.get(base + "?assignee=unassigned", headers=a).json()] == ["TF-2", "TF-3"]
    assert client.get(base + "?assignee=zzz", headers=a).status_code == 422
    assert [i["key"] for i in client.get(base + "?priority=low", headers=a).json()] == ["TF-2"]
    assert [i["key"] for i in client.get(base + "?sort=priority", headers=a).json()] == ["TF-1", "TF-3", "TF-2"]
    assert [i["key"] for i in client.get(base + "?sort=created&order=desc", headers=a).json()] == ["TF-3", "TF-2", "TF-1"]
    assert [i["key"] for i in client.get(base + "?sort=due", headers=a).json()][0] == "TF-3"
    r = client.get(base + "?limit=2&offset=2", headers=a)
    assert r.headers["X-Total-Count"] == "3" and len(r.json()) == 1
    assert client.get(base + "?limit=500", headers=a).status_code == 422
    assert client.get(base + "?sort=bogus", headers=a).status_code == 422
    assert client.get(base + "?sprint_id=backlog", headers=a).headers["X-Total-Count"] == "3"
    assert client.get(base + "?sprint_id=active", headers=a).json() == []


# ------------------------------------------------------------------ move / rank
def _order(client, h, column=None, sprint="all"):
    b = client.get(f"/api/jira/projects/TF/board?sprint_id={sprint}", headers=h).json()
    out = {c["name"]: [i["key"] for i in c["issues"]] for c in b["columns"]}
    return out if column is None else out[column]


def test_move_between_columns_and_ranking(client, env):
    a = env["alice"]
    c = cols(client, a)
    i1, i2, i3 = (mk(client, a, title=f"t{n}") for n in range(3))
    assert _order(client, a, "To Do") == ["TF-1", "TF-2", "TF-3"]
    mv = lambda k, col, **kw: client.post(f"/api/jira/issues/{k}/move", json={"column_id": c[col]["id"], **kw}, headers=a)
    r = mv("TF-3", "To Do", before_issue_id=i1["id"])
    assert r.status_code == 200
    assert _order(client, a, "To Do") == ["TF-3", "TF-1", "TF-2"]
    mv("TF-1", "To Do", after_issue_id=i2["id"])
    assert _order(client, a, "To Do") == ["TF-3", "TF-2", "TF-1"]
    r = mv("TF-2", "In Progress")
    assert r.json()["status_name"] == "In Progress" and r.json()["resolved_at"] is None
    assert _order(client, a, "To Do") == ["TF-3", "TF-1"]
    r = mv("TF-1", "Done")
    assert r.json()["resolved_at"] is not None
    mv("TF-3", "Done", before_issue_id=i1["id"])
    assert _order(client, a, "Done") == ["TF-3", "TF-1"]
    r = mv("TF-1", "In Progress")
    assert r.json()["resolved_at"] is None
    assert _order(client, a, "In Progress") == ["TF-2", "TF-1"]  # no neighbour => appended
    # bad neighbour / column
    assert mv("TF-1", "Done", before_issue_id=i2["id"]).status_code == 422
    assert client.post("/api/jira/issues/TF-1/move", json={"column_id": 99999}, headers=a).status_code == 422
    hist = client.get("/api/jira/issues/TF-1/history", headers=a).json()
    assert [h["new_value"] for h in hist if h["field"] == "status"][:2] == ["In Progress", "Done"]


def test_rank_gap_collapse_renumbers(client, env):
    a = env["alice"]
    issues = [mk(client, a, title=f"t{n}") for n in range(2)]
    first, second = issues
    # repeatedly insert right after the first issue: gaps halve until a renumber is required
    new = []
    for n in range(45):
        x = mk(client, a, title=f"n{n}")
        new.append(x["key"])
        client.post(f"/api/jira/issues/{x['key']}/move",
                    json={"column_id": x["column_id"], "after_issue_id": first["id"]}, headers=a)
    order = _order(client, a, "To Do")
    assert order[0] == first["key"] and order[-1] == second["key"]
    assert order[1:-1] == list(reversed(new))
    ranks = [i["rank"] for i in client.get("/api/jira/projects/TF/issues", headers=a).json()]
    assert len(set(ranks)) == len(ranks)


def test_rank_backlog_and_sprints(client, env):
    a = env["alice"]
    s1 = client.get("/api/jira/projects/TF/sprints", headers=a).json()[0]["id"]
    s2 = client.post("/api/jira/projects/TF/sprints", json={"name": "Sprint 2"}, headers=a).json()["id"]
    i1, i2, i3 = (mk(client, a, title=f"t{n}") for n in range(3))
    rk = lambda k, **kw: client.post(f"/api/jira/issues/{k}/rank", json=kw, headers=a)
    assert rk("TF-1", sprint_id=s1).json()["sprint_id"] == s1
    rk("TF-2", sprint_id=s1, before_issue_id=i1["id"])
    rk("TF-3", sprint_id=s1, after_issue_id=i1["id"])
    q = lambda sp: [i["key"] for i in client.get(f"/api/jira/projects/TF/issues?sprint_id={sp}&sort=rank", headers=a).json()]
    assert q(s1) == ["TF-2", "TF-1", "TF-3"]
    assert q("backlog") == []
    rk("TF-1", sprint_id=s2)
    assert q(s1) == ["TF-2", "TF-3"] and q(s2) == ["TF-1"]
    rk("TF-1", sprint_id=None)
    assert q("backlog") == ["TF-1"]
    assert rk("TF-1", sprint_id=99999).status_code == 422
    assert rk("TF-2", sprint_id=s1, before_issue_id=i1["id"]).status_code == 422  # neighbour not in target
    assert [h["field"] for h in client.get("/api/jira/issues/TF-1/history", headers=a).json()].count("sprint") == 3


def test_subtask_inherits_and_follows_sprint(client, env):
    a = env["alice"]
    s1 = client.get("/api/jira/projects/TF/sprints", headers=a).json()[0]["id"]
    p = mk(client, a, sprint_id=s1)
    sub = mk(client, a, type="subtask", parent_id=p["id"])
    assert sub["sprint_id"] == s1
    client.post(f"/api/jira/issues/{p['key']}/rank", json={"sprint_id": None}, headers=a)
    assert client.get(f"/api/jira/issues/{sub['key']}", headers=a).json()["sprint_id"] is None


# ------------------------------------------------------------------ sprints
def test_sprint_start_complete(client, env):
    a = env["alice"]
    s1 = client.get("/api/jira/projects/TF/sprints", headers=a).json()[0]["id"]
    s2 = client.post("/api/jira/projects/TF/sprints", json={"name": "Sprint 2", "goal": "g"}, headers=a).json()["id"]
    c = cols(client, a)
    i1 = mk(client, a, sprint_id=s1, story_points=5)
    i2 = mk(client, a, sprint_id=s1, story_points=3, column_id=c["Done"]["id"])
    i3 = mk(client, a, sprint_id=s1, story_points=2)
    r = client.post(f"/api/jira/sprints/{s1}/start", json={}, headers=a)
    assert r.status_code == 200 and r.json()["state"] == "active"
    assert r.json()["start_date"] and r.json()["end_date"]
    assert r.json()["points_total"] == 10 and r.json()["points_done"] == 3 and r.json()["issue_count"] == 3
    assert client.post(f"/api/jira/sprints/{s1}/start", json={}, headers=a).status_code == 409  # already active
    assert client.post(f"/api/jira/sprints/{s2}/start", json={}, headers=a).status_code == 409  # another active
    proj = client.get("/api/jira/projects", headers=a).json()[0]
    assert proj["active_sprint"] == {"id": s1, "name": "Sprint 1"}
    assert client.post(f"/api/jira/sprints/{s1}/complete", json={"move_open_to": "bogus"}, headers=a).status_code == 422
    assert client.post(f"/api/jira/sprints/{s1}/complete", json={"move_open_to": s1}, headers=a).status_code == 422
    assert client.post(f"/api/jira/sprints/{s1}/complete", json={"move_open_to": 99999}, headers=a).status_code == 422
    assert client.post(f"/api/jira/sprints/{s2}/complete", json={}, headers=a).status_code == 409  # not active
    r = client.post(f"/api/jira/sprints/{s1}/complete", json={"move_open_to": s2}, headers=a)
    assert r.status_code == 200 and r.json()["state"] == "closed" and r.json()["completed_at"]
    sprint_of = lambda k: client.get(f"/api/jira/issues/{k}", headers=a).json()["sprint_id"]
    assert sprint_of(i2["key"]) == s1  # done issue stays in the closed sprint
    assert sprint_of(i1["key"]) == s2 and sprint_of(i3["key"]) == s2
    # closed sprint: cannot add issues, cannot restart, cannot edit
    assert client.post("/api/jira/projects/TF/issues", json={"title": "x", "sprint_id": s1}, headers=a).status_code == 422
    assert client.post(f"/api/jira/sprints/{s1}/start", json={}, headers=a).status_code == 409
    assert client.patch(f"/api/jira/sprints/{s1}", json={"name": "n"}, headers=a).status_code == 409
    # new sprint can be started now; complete to backlog
    assert client.post(f"/api/jira/sprints/{s2}/start", json={"start_date": "2030-01-01", "end_date": "2030-01-10"},
                       headers=a).status_code == 200
    r = client.post(f"/api/jira/sprints/{s2}/complete", json={"move_open_to": "backlog"}, headers=a)
    assert r.status_code == 200
    assert sprint_of(i1["key"]) is None
    assert client.post(f"/api/jira/sprints/{s2}/start", json={"start_date": "2030-02-01", "end_date": "2030-01-01"},
                       headers=a).status_code == 409  # closed => state error first


def test_sprint_start_date_validation(client, env):
    a = env["alice"]
    s1 = client.get("/api/jira/projects/TF/sprints", headers=a).json()[0]["id"]
    assert client.post(f"/api/jira/sprints/{s1}/start", json={"start_date": "2030-02-01", "end_date": "2030-01-01"},
                       headers=a).status_code == 422
    assert client.post("/api/jira/projects/TF/sprints", json={"name": "x", "start_date": "2030-02-01",
                                                              "end_date": "2030-01-01"}, headers=a).status_code == 422


def test_sprint_delete_moves_to_backlog(client, env):
    a = env["alice"]
    s1 = client.get("/api/jira/projects/TF/sprints", headers=a).json()[0]["id"]
    i = mk(client, a, sprint_id=s1)
    assert client.delete(f"/api/jira/sprints/{s1}", headers=a).status_code == 204
    assert client.get(f"/api/jira/issues/{i['key']}", headers=a).json()["sprint_id"] is None
    assert client.get("/api/jira/projects/TF/sprints", headers=a).json() == []


def test_sprint_report(client, env):
    a = env["alice"]
    s1 = client.get("/api/jira/projects/TF/sprints", headers=a).json()[0]["id"]
    done = cols(client, a)["Done"]["id"]
    mk(client, a, sprint_id=s1, story_points=5)
    mk(client, a, sprint_id=s1, story_points=3, column_id=done)
    rp = client.get(f"/api/jira/sprints/{s1}/report", headers=a).json()
    assert rp["committed_points"] == 8 and rp["completed_points"] == 3
    assert rp["issues_total"] == 2 and rp["issues_done"] == 1 and rp["burndown"] == []  # planned
    client.post(f"/api/jira/sprints/{s1}/start", json={}, headers=a)
    rp = client.get(f"/api/jira/sprints/{s1}/report", headers=a).json()
    assert rp["burndown"][-1]["remaining_points"] == 5 and rp["burndown"][0]["remaining_points"] in (5, 8)
    assert client.get(f"/api/jira/sprints/{s1}/report", headers=env["dave"]).status_code == 404
    assert client.get(f"/api/jira/sprints/{s1}/report", headers=env["carol"]).status_code == 200


# ------------------------------------------------------------------ board
def test_board(client, env):
    a, b = env["alice"], env["bob"]
    bob = uid(client, b)
    s1 = client.get("/api/jira/projects/TF/sprints", headers=a).json()[0]["id"]
    mk(client, a, title="in sprint", sprint_id=s1, labels=["x"], assignee_id=bob)
    mk(client, a, title="backlog one")
    r = client.get("/api/jira/projects/TF/board", headers=a).json()
    assert r["sprint"] is None and [c["name"] for c in r["columns"]] == ["To Do", "In Progress", "In Review", "Done"]
    assert all(c["issues"] == [] for c in r["columns"])
    client.post(f"/api/jira/sprints/{s1}/start", json={}, headers=a)
    r = client.get("/api/jira/projects/TF/board", headers=a).json()
    assert r["sprint"]["id"] == s1 and r["sprint"]["state"] == "active"
    assert [i["title"] for i in r["columns"][0]["issues"]] == ["in sprint"]
    assert r["columns"][0]["category"] == "todo" and "position" in r["columns"][0]
    allb = client.get("/api/jira/projects/TF/board?sprint_id=all", headers=a).json()
    assert len(allb["columns"][0]["issues"]) == 2 and allb["sprint"] is None
    assert len(client.get(f"/api/jira/projects/TF/board?sprint_id={s1}", headers=a).json()["columns"][0]["issues"]) == 1
    f = lambda qs: client.get(f"/api/jira/projects/TF/board?sprint_id=all&{qs}", headers=a).json()["columns"][0]["issues"]
    assert [i["title"] for i in f("label=x")] == ["in sprint"]
    assert [i["title"] for i in f(f"assignee={bob}")] == ["in sprint"]
    assert [i["title"] for i in f("q=backlog")] == ["backlog one"]
    assert client.get("/api/jira/projects/TF/board?sprint_id=999", headers=a).status_code == 404
    assert client.get("/api/jira/projects/TF/board?sprint_id=zzz", headers=a).status_code == 422
    # subtasks show up as cards
    p = mk(client, a, sprint_id=s1)
    mk(client, a, type="subtask", parent_id=p["id"])
    cards = client.get("/api/jira/projects/TF/board", headers=a).json()["columns"][0]["issues"]
    assert "subtask" in {c["type"] for c in cards}


# ------------------------------------------------------------------ columns
def test_columns_crud(client, env):
    a = env["alice"]
    r = client.post("/api/jira/projects/TF/columns", json={"name": "QA", "category": "in_progress"}, headers=a)
    assert r.status_code == 201 and r.json()["position"] == 4
    qa = r.json()["id"]
    assert client.post("/api/jira/projects/TF/columns", json={"name": "x", "category": "bad"}, headers=a).status_code == 422
    c = client.patch(f"/api/jira/columns/{qa}", json={"name": "QA2", "position": 0}, headers=a).json()
    assert c["name"] == "QA2" and c["position"] == 0
    names = [x["name"] for x in client.get("/api/jira/projects/TF", headers=a).json()["columns"]]
    assert names == ["QA2", "To Do", "In Progress", "In Review", "Done"]
    i = mk(client, a, column_id=qa)
    # delete with issues requires move_to
    assert client.delete(f"/api/jira/columns/{qa}", headers=a).status_code == 409
    assert client.delete(f"/api/jira/columns/{qa}?move_to={qa}", headers=a).status_code == 422
    done = cols(client, a)["Done"]["id"]
    assert client.delete(f"/api/jira/columns/{qa}?move_to={done}", headers=a).status_code == 204
    d = client.get(f"/api/jira/issues/{i['key']}", headers=a).json()
    assert d["status_name"] == "Done" and d["resolved_at"] is not None
    # category change re-evaluates resolved_at
    client.patch(f"/api/jira/columns/{done}", json={"category": "todo"}, headers=a)
    assert client.get(f"/api/jira/issues/{i['key']}", headers=a).json()["resolved_at"] is None
    # cannot delete the last column
    for name in ("To Do", "In Progress", "In Review", "Done"):
        cid = cols(client, a).get(name)
        if cid and len(cols(client, a)) > 1:
            client.delete(f"/api/jira/columns/{cid['id']}?move_to={cols(client, a)[[n for n in cols(client, a) if n != name][0]]['id']}", headers=a)
    assert len(cols(client, a)) == 1
    last = list(cols(client, a).values())[0]
    assert client.delete(f"/api/jira/columns/{last['id']}", headers=a).status_code == 409


# ------------------------------------------------------------------ comments
def test_comments_permissions(client, env):
    a, b, v = env["alice"], env["bob"], env["carol"]
    i = mk(client, a)
    k = i["key"]
    r = client.post(f"/api/jira/issues/{k}/comments", json={"body": "hello"}, headers=b)
    assert r.status_code == 201 and r.json()["user"]["name"] and r.json()["body"] == "hello"
    cid = r.json()["id"]
    assert client.post(f"/api/jira/issues/{k}/comments", json={"body": "  "}, headers=b).status_code == 422
    assert len(client.get(f"/api/jira/issues/{k}/comments", headers=v).json()) == 1
    assert client.get(f"/api/jira/issues/{k}", headers=a).json()["comment_count"] == 1
    # viewer cannot edit; other non-admin member cannot edit
    assert client.patch(f"/api/jira/comments/{cid}", json={"body": "x"}, headers=v).status_code == 403
    # author edits, admin edits, dave 404
    assert client.patch(f"/api/jira/comments/{cid}", json={"body": "edited"}, headers=b).json()["body"] == "edited"
    assert client.patch(f"/api/jira/comments/{cid}", json={"body": "admin"}, headers=a).status_code == 200
    assert client.patch(f"/api/jira/comments/{cid}", json={"body": "x"}, headers=env["dave"]).status_code == 404
    # another member (not author, not admin)
    client.post("/api/jira/projects/TF/members", json={"email": "dave@example.com", "role": "member"}, headers=a)
    assert client.patch(f"/api/jira/comments/{cid}", json={"body": "x"}, headers=env["dave"]).status_code == 403
    assert client.delete(f"/api/jira/comments/{cid}", headers=env["dave"]).status_code == 403
    assert client.delete(f"/api/jira/comments/{cid}", headers=b).status_code == 204
    assert client.get(f"/api/jira/issues/{k}/comments", headers=a).json() == []
    assert client.delete("/api/jira/comments/99999", headers=a).status_code == 404


# ------------------------------------------------------------------ notifications
def notifs(client, h):
    return client.get("/api/notifications", headers=h).json()


def jira_notifs(client, h):
    data = notifs(client, h)
    data = data["items"] if isinstance(data, dict) else data
    return [n for n in data if n["type"] == "jira"]


def test_notifications(client, env):
    a, b = env["alice"], env["bob"]
    # bob was added to the project by alice
    added = jira_notifs(client, b)
    assert len(added) == 1 and "TF" in added[0]["title"]
    assert jira_notifs(client, a) == []  # alice added herself -> nothing
    bob = uid(client, b)
    # assigning to someone else notifies; self-assign does not
    i = mk(client, a, assignee_id=bob)
    n = jira_notifs(client, b)
    assert len(n) == 2 and any(x["data"] == {"issue_key": i["key"]} for x in n)
    mk(client, b, assignee_id=bob)
    assert len(jira_notifs(client, b)) == 2
    # reassign repeatedly is allowed (dedupe key includes a timestamp)
    alice = uid(client, a)
    client.patch(f"/api/jira/issues/{i['key']}", json={"assignee_id": alice}, headers=b)
    client.patch(f"/api/jira/issues/{i['key']}", json={"assignee_id": bob}, headers=a)
    client.patch(f"/api/jira/issues/{i['key']}", json={"assignee_id": alice}, headers=b)
    client.patch(f"/api/jira/issues/{i['key']}", json={"assignee_id": bob}, headers=a)
    assert len(jira_notifs(client, b)) == 4  # added + 3 assignments by alice (initial + 2 re-assignments)
    assert len(jira_notifs(client, a)) == 2  # bob assigned it to alice twice; both delivered


def test_comment_notifies_assignee_and_reporter_not_author(client, env):
    a, b = env["alice"], env["bob"]
    bob = uid(client, b)
    i = mk(client, a, assignee_id=bob)  # reporter alice, assignee bob
    before_a, before_b = len(jira_notifs(client, a)), len(jira_notifs(client, b))
    client.post(f"/api/jira/issues/{i['key']}/comments", json={"body": "ping"}, headers=b)
    assert len(jira_notifs(client, a)) == before_a + 1  # reporter notified
    assert len(jira_notifs(client, b)) == before_b  # author not notified
    client.post(f"/api/jira/issues/{i['key']}/comments", json={"body": "pong"}, headers=a)
    assert len(jira_notifs(client, b)) == before_b + 1
    assert len(jira_notifs(client, a)) == before_a + 1
    # third party comment notifies both
    client.post("/api/jira/projects/TF/members", json={"email": "dave@example.com", "role": "member"}, headers=a)
    client.post(f"/api/jira/issues/{i['key']}/comments", json={"body": "x"}, headers=env["dave"])
    assert len(jira_notifs(client, a)) == before_a + 2 and len(jira_notifs(client, b)) == before_b + 2
    with SessionLocal() as db:
        assert db.query(Notification).filter_by(type="jira").count() >= 5


# ------------------------------------------------------------------ my-issues / summary
def test_my_issues(client, env):
    a, b = env["alice"], env["bob"]
    bob = uid(client, b)
    done = cols(client, a)["Done"]["id"]
    client.post("/api/jira/projects", json={"key": "ZZ", "name": "Z"}, headers=a)
    client.post("/api/jira/projects/ZZ/members", json={"email": "bob@example.com", "role": "member"}, headers=a)
    mk(client, a, assignee_id=bob)
    mk(client, a, assignee_id=bob, column_id=done)
    mk(client, a, key="ZZ", assignee_id=bob)
    mk(client, a)
    allm = client.get("/api/jira/my-issues", headers=b).json()
    assert len(allm) == 3
    assert len(client.get("/api/jira/my-issues?status_category=open", headers=b).json()) == 2
    assert [i["status_category"] for i in client.get("/api/jira/my-issues?status_category=done", headers=b).json()] == ["done"]
    assert client.get("/api/jira/my-issues?status_category=bad", headers=b).status_code == 422
    assert client.get("/api/jira/my-issues", headers=env["dave"]).json() == []
    # leaving a project drops its issues from my-issues
    client.delete(f"/api/jira/projects/ZZ/members/{bob}", headers=b)
    assert len(client.get("/api/jira/my-issues", headers=b).json()) == 2


def test_summary(client, env):
    a = env["alice"]
    bob = uid(client, env["bob"])
    done = cols(client, a)["Done"]["id"]
    mk(client, a, type="bug", priority="high", assignee_id=bob)
    mk(client, a, column_id=done)
    mk(client, a)
    s = client.get("/api/jira/projects/TF/summary", headers=env["carol"]).json()
    assert s["by_status_category"] == {"todo": 2, "in_progress": 0, "done": 1}
    assert s["by_type"] == {"bug": 1, "task": 2}
    assert s["by_priority"] == {"high": 1, "medium": 2}
    assert {(x["user"]["id"] if x["user"] else None): x["count"] for x in s["by_assignee"]} == {bob: 1, None: 2}
    assert len(s["created_vs_resolved_14d"]) == 14
    last = s["created_vs_resolved_14d"][-1]
    assert last["created"] == 3 and last["resolved"] == 1
    assert client.get("/api/jira/projects/TF/summary", headers=env["dave"]).status_code == 404


def test_existing_routes_unaffected(client, auth_headers):
    assert client.get("/api/projects", headers=auth_headers).status_code == 200
    assert client.get("/health").status_code == 200


def test_worker_disabled_in_tests():
    from app.main import _worker_enabled
    assert _worker_enabled() is False
