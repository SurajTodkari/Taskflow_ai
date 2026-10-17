from datetime import datetime, timedelta, timezone

from app.config import settings
from app.db import SessionLocal
from app.models import Project, User

TODAY = datetime.now(timezone.utc).date()


def mk(client, h, **kw):
    r = client.post("/api/tasks", json={"title": "t", **kw}, headers=h)
    assert r.status_code in (200, 201), r.text
    return r.json()


def seed(client, h):
    p = client.post("/api/projects", json={"name": "Proj"}, headers=h).json()
    a = mk(client, h, title="Write spec", start_date=TODAY.isoformat(), project_id=p["id"], priority="high",
           estimated_minutes=60)
    b = mk(client, h, title="Fix bug", start_date=TODAY.isoformat(), priority="critical")
    c = mk(client, h, title="Old thing", start_date=(TODAY - timedelta(days=3)).isoformat(),
           due_date=(TODAY - timedelta(days=1)).isoformat())
    d = mk(client, h, title="Cancelled one", start_date=TODAY.isoformat())
    mk(client, h, title="Plan trip", start_date=(TODAY + timedelta(days=1)).isoformat())
    client.post(f"/api/tasks/{a['id']}/complete", headers=h)
    client.patch(f"/api/tasks/{d['id']}", json={"status": "cancelled"}, headers=h)


def test_daily_report_numbers_and_exports(client, auth_headers):
    seed(client, auth_headers)
    r = client.get("/api/reports/daily", headers=auth_headers)
    assert r.status_code == 200
    j = r.json()
    assert (j["total"], j["completed"], j["pending"], j["cancelled"]) == (2, 1, 1, 1)
    assert j["completion_percent"] == 50.0
    assert j["date"] == TODAY.isoformat()
    assert {p["project"]: p["completed"] for p in j["by_project"]} == {"Proj": 1, "No project": 0}
    assert [t["title"] for t in j["tomorrow_planned"]][0] == "Plan trip"
    csv = client.get("/api/reports/daily/export", params={"format": "csv"}, headers=auth_headers)
    assert csv.status_code == 200 and "text/csv" in csv.headers["content-type"] and "completed,1" in csv.text
    pdf = client.get("/api/reports/daily/export", params={"format": "pdf"}, headers=auth_headers)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    assert client.get("/api/reports/daily/export", params={"format": "xml"}, headers=auth_headers).status_code == 422
    assert TODAY.isoformat() in client.get("/api/reports", headers=auth_headers).json()


def test_ai_without_key_uses_db_only(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    seed(client, auth_headers)
    assert client.get("/api/ai/status", headers=auth_headers).json()["enabled"] is False
    r = client.post("/api/ai/chat", json={"message": "What is planned for tomorrow?"}, headers=auth_headers).json()
    assert r["source"] == "rules" and "Plan trip" in r["answer"] and "Fix bug" not in r["answer"].split("carried")[0]
    r = client.post("/api/ai/chat", json={"message": "Show overdue tasks"}, headers=auth_headers).json()
    assert "Old thing" in r["answer"]
    r = client.post("/api/ai/chat", json={"message": "what should I prioritize?"}, headers=auth_headers).json()
    assert r["answer"].index("Fix bug") < r["answer"].index("Old thing") or "Fix bug" in r["answer"]
    for q in ("anything", "pending today", "weekly progress", "workload", "delayed"):
        ans = client.post("/api/ai/chat", json={"message": q}, headers=auth_headers).json()["answer"]
        assert ans


def test_ai_never_invents_tasks_when_empty(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    r = client.post("/api/ai/chat", json={"message": "what is pending?"}, headers=auth_headers).json()
    assert "- " not in r["answer"]
    r = client.post("/api/ai/chat", json={"message": "tomorrow"}, headers=auth_headers).json()
    assert "Nothing" in r["answer"]
    ins = client.get("/api/ai/insights", headers=auth_headers).json()
    assert ins["suggested_priorities"] == [] and ins["tomorrow_plan"] == []


def test_ai_llm_failure_falls_back(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "bad-key")
    from app.services import ai
    monkeypatch.setattr(ai.httpx, "post", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("net")))
    seed(client, auth_headers)
    r = client.post("/api/ai/chat", json={"message": "overdue?"}, headers=auth_headers).json()
    assert r["source"] == "rules" and "Old thing" in r["answer"]


def test_analytics_calendar_notifications_ws(client, auth_headers):
    seed(client, auth_headers)
    a = client.get("/api/analytics", params={"range": 30}, headers=auth_headers).json()
    assert len(a["daily"]) == 30 and a["completed_vs_pending"]["cancelled"] == 1
    assert client.get("/api/analytics", params={"range": 5}, headers=auth_headers).status_code == 422
    cal = client.get("/api/calendar", params={"start": (TODAY - timedelta(days=7)).isoformat(),
                                              "end": (TODAY + timedelta(days=7)).isoformat()}, headers=auth_headers)
    assert cal.status_code == 200 and len(cal.json()) == 5
    assert client.post("/api/notifications/test", headers=auth_headers).status_code == 200
    assert client.get("/api/notifications/unread-count", headers=auth_headers).json()["count"] == 1
    n = client.get("/api/notifications", headers=auth_headers).json()[0]
    assert client.post(f"/api/notifications/{n['id']}/read", headers=auth_headers).json()["read"] is True
    assert client.post("/api/notifications/read-all", headers=auth_headers).status_code == 200
    assert client.get("/api/push/public-key", headers=auth_headers).status_code == 200
    s = client.post("/api/push/subscribe", json={"endpoint": "https://x/y", "keys": {"p256dh": "a", "auth": "b"}},
                    headers=auth_headers)
    assert s.status_code == 200
    assert client.post("/api/push/unsubscribe", json={"endpoint": "https://x/y"}, headers=auth_headers).status_code == 200
    assert client.get("/api/ai/insights", headers=auth_headers).status_code == 200
