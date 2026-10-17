from datetime import date, datetime, time, timedelta, timezone

from app import worker
from app.db import SessionLocal
from app.models import Notification, Task, TaskReminder, User, UserPreferences
from app.services import notifications as notif

TODAY = datetime.now(timezone.utc).date()


def mk(client, h, **kw):
    body = {"title": "t", **kw}
    r = client.post("/api/tasks", json=body, headers=h)
    assert r.status_code in (200, 201), r.text
    return r.json()


def uid():
    with SessionLocal() as db:
        return db.query(User).first().id


def test_rollover_carries_three_without_changing_dates(client, auth_headers):
    y = TODAY - timedelta(days=1)
    ids = [mk(client, auth_headers, title=f"c{i}", start_date=y.isoformat(), due_date=(TODAY + timedelta(days=2)).isoformat())["id"]
           for i in range(3)]
    mk(client, auth_headers, title="done", start_date=y.isoformat(), due_date=y.isoformat())
    # yesterday: nothing carried; today: 3 carried
    d = client.get("/api/dashboard", headers=auth_headers).json()
    assert {t["id"] for t in d["carried_forward"]} == set(ids)
    assert len(d["carried_forward"]) == 3
    for t in d["carried_forward"]:
        assert t["start_date"] == y.isoformat()
    # next-day view (tomorrow) also shows them as carried
    tm = client.get("/api/tomorrow", headers=auth_headers).json()
    assert {t["id"] for t in tm["carried"]} == set(ids)
    nxt = client.get("/api/dashboard", params={"date": (TODAY + timedelta(days=1)).isoformat()}, headers=auth_headers).json()
    assert len(nxt["carried_forward"]) == 3
    with SessionLocal() as db:
        assert all(db.get(Task, i).start_date == y for i in ids)


def test_productivity_and_cancelled_excluded(client, auth_headers):
    a = mk(client, auth_headers, title="a", start_date=TODAY.isoformat())
    mk(client, auth_headers, title="b", start_date=TODAY.isoformat())
    c = mk(client, auth_headers, title="c", start_date=TODAY.isoformat())
    d = mk(client, auth_headers, title="d", start_date=TODAY.isoformat())
    client.post(f"/api/tasks/{a['id']}/complete", headers=auth_headers)
    client.patch(f"/api/tasks/{c['id']}", json={"status": "cancelled"}, headers=auth_headers)
    client.post(f"/api/tasks/{d['id']}/complete", headers=auth_headers)
    dash = client.get("/api/dashboard", headers=auth_headers).json()
    assert dash["today"]["total"] == 3
    assert dash["today"]["completed"] == 2
    assert dash["today"]["productivity"] == 66.7
    assert dash["weekly"][-1]["productivity"] == 66.7
    assert client.get("/api/today", headers=auth_headers).json()["today"]["total"] == 3


def test_reminder_dedupe_and_retry(client, auth_headers, monkeypatch):
    t = mk(client, auth_headers, title="rem", start_date=TODAY.isoformat())
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        r = TaskReminder(task_id=t["id"], user_id=uid(), kind="custom", remind_at=now - timedelta(minutes=1))
        db.add(r); db.commit(); rid = r.id
    with SessionLocal() as db:
        worker.run_once(db, now)
        worker.run_once(db, now)
        worker.run_once(db, now + timedelta(minutes=1))
    with SessionLocal() as db:
        assert db.query(Notification).filter_by(dedupe_key=f"reminder:{rid}").count() == 1
        assert db.get(TaskReminder, rid).status == "sent"

    # retries with backoff, max 5 -> failed
    with SessionLocal() as db:
        r = TaskReminder(task_id=t["id"], user_id=uid(), kind="custom", remind_at=now - timedelta(minutes=5))
        db.add(r); db.commit(); rid2 = r.id

    def boom(*a, **k):
        raise RuntimeError("push down")
    monkeypatch.setattr(notif, "create_notification", boom)
    clock = now
    with SessionLocal() as db:
        worker.run_once(db, clock)
        r = db.get(TaskReminder, rid2)
        assert r.attempts == 1 and r.status == "pending" and r.next_attempt_at is not None
        worker.run_once(db, clock)  # before backoff elapsed: untouched
        assert db.get(TaskReminder, rid2).attempts == 1
        for _ in range(6):
            clock += timedelta(hours=2)
            worker.run_once(db, clock)
        r = db.get(TaskReminder, rid2)
        assert r.status == "failed" and r.attempts == 5


def test_create_notification_dedupe(client, auth_headers):
    with SessionLocal() as db:
        u = uid()
        assert notif.create_notification(db, u, "x", "t", dedupe_key="k1") is not None
        assert notif.create_notification(db, u, "x", "t", dedupe_key="k1") is None
        db.commit()
        assert db.query(Notification).filter_by(user_id=u, dedupe_key="k1").count() == 1


def test_summaries_at_configured_times(client, auth_headers):
    mk(client, auth_headers, title="x", start_date=TODAY.isoformat())
    day = datetime.combine(TODAY, time(0, 0), tzinfo=timezone.utc)
    with SessionLocal() as db:
        s = worker.run_once(db, day + timedelta(hours=7))
        assert s["summaries"] == 0
        s = worker.run_once(db, day + timedelta(hours=8, minutes=1))
        assert s["summaries"] == 1
        s = worker.run_once(db, day + timedelta(hours=8, minutes=2))
        assert s["summaries"] == 0
        s = worker.run_once(db, day + timedelta(hours=21, minutes=5))
        assert s["summaries"] == 2  # evening + tomorrow
        keys = {n.dedupe_key for n in db.query(Notification).all()}
        assert {f"morning:{TODAY}", f"evening:{TODAY}", f"tomorrow:{TODAY}"} <= keys


def test_summary_respects_timezone_and_overdue_alert(client, auth_headers):
    client.patch("/api/settings", json={"timezone": "Asia/Kolkata"}, headers=auth_headers)
    old = TODAY - timedelta(days=3)
    mk(client, auth_headers, title="late", start_date=old.isoformat(), due_date=old.isoformat())
    # 02:00 UTC = 07:30 IST -> before 08:00 morning
    with SessionLocal() as db:
        base = datetime.combine(TODAY, time(2, 0), tzinfo=timezone.utc)
        assert worker.run_once(db, base)["summaries"] == 0
        s = worker.run_once(db, base + timedelta(minutes=45))  # 08:15 IST
        assert s["summaries"] >= 1 and s["overdue"] == 1
        assert worker.run_once(db, base + timedelta(minutes=50))["overdue"] == 0


def test_worker_generates_report_snapshot(client, auth_headers):
    with SessionLocal() as db:
        worker.run_once(db)
    assert client.get("/api/reports", headers=auth_headers).json()
