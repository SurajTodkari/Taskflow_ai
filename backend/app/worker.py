"""One-shot worker: `python -m app.worker`. Safe to run every minute (idempotent)."""
import logging
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import Task, TaskReminder, User, UserPreferences
from .services import notifications as notif
from .services import reports
from .services import tasks as svc
from .services.analytics import stats_for, tasks_by_day

log = logging.getLogger("taskflow.worker")
MAX_ATTEMPTS = 5
MAX_OVERDUE_ALERTS = 20


def backoff(attempts: int) -> timedelta:
    return timedelta(minutes=min(60, 2 ** attempts))  # 2,4,8,16 ...


def _tz(prefs) -> ZoneInfo:
    try:
        return ZoneInfo(prefs.timezone)
    except Exception:
        return ZoneInfo("UTC")


def process_reminders(db: Session, now: datetime) -> dict:
    out = {"sent": 0, "retried": 0, "failed": 0, "skipped": 0}
    due = (db.query(TaskReminder).filter(TaskReminder.status == "pending", TaskReminder.remind_at <= now)
           .order_by(TaskReminder.remind_at, TaskReminder.id).limit(500).all())
    for r in due:
        na = svc.aware(r.next_attempt_at)
        if na and na > now:
            continue
        task = db.get(Task, r.task_id)
        prefs = db.query(UserPreferences).filter_by(user_id=r.user_id).first()
        if not task or task.status not in svc.OPEN_STATUSES or (prefs and not prefs.notify_reminders):
            r.status, r.last_error = "sent", "skipped"
            out["skipped"] += 1
            continue
        try:
            n = notif.create_notification(
                db, r.user_id, "reminder", f"Reminder: {task.title}",
                f"Due {task.due_date.isoformat()}" if task.due_date else "Task reminder",
                {"task_id": task.id, "reminder_id": r.id}, dedupe_key=f"reminder:{r.id}")
            r.status, r.sent_at, r.last_error = "sent", now, None
            r.attempts = (r.attempts or 0) + 1
            out["sent"] += 1 if n else 0
            out["skipped"] += 0 if n else 1
        except Exception as e:
            r.attempts = (r.attempts or 0) + 1
            r.last_error = str(e)[:500]
            if r.attempts >= MAX_ATTEMPTS:
                r.status = "failed"
                out["failed"] += 1
            else:
                r.next_attempt_at = now + backoff(r.attempts)
                out["retried"] += 1
        db.commit()
    db.commit()
    return out


def _summary(db, user: User, prefs, kind: str, today, local_now) -> tuple[str, str, dict] | None:
    from datetime import timedelta as td
    if kind == "morning":
        day = svc.day_tasks(db, user.id, today)
        st = stats_for(day, today)
        carried = svc.carried_forward(db, user.id, today)
        return ("Good morning", f"{st['pending']} task(s) today, {len(carried)} carried forward, "
                f"{len(svc.overdue_tasks(db, user.id, today))} overdue.", {"date": today.isoformat()})
    if kind == "evening":
        st = stats_for(svc.day_tasks(db, user.id, today), today)
        return ("Evening summary", f"Completed {st['completed']} of {st['total']} tasks "
                f"({st['productivity']}%). {st['pending']} still pending.", {"date": today.isoformat()})
    tm = today + td(days=1)
    planned = [t for t in svc.day_tasks(db, user.id, tm) if t.status in svc.OPEN_STATUSES]
    carried = svc.carried_forward(db, user.id, tm)
    return ("Tomorrow's plan", f"{len(planned)} planned and {len(carried)} carried forward for tomorrow.",
            {"date": tm.isoformat()})


def process_user(db: Session, user: User, prefs: UserPreferences, now: datetime) -> dict:
    tz = _tz(prefs)
    local_now = now.astimezone(tz)
    today = local_now.date()
    res = {"summaries": 0, "overdue": 0}
    for kind, flag, at in (("morning", prefs.notify_morning, prefs.morning_time),
                           ("evening", prefs.notify_evening, prefs.evening_time),
                           ("tomorrow", prefs.notify_tomorrow, prefs.tomorrow_time)):
        if not flag or local_now.time().replace(tzinfo=None) < at:
            continue
        key = f"{kind}:{today.isoformat()}"
        if notif.notification_exists(db, user.id, key):
            continue
        title, body, data = _summary(db, user, prefs, kind, today, local_now)
        if notif.create_notification(db, user.id, kind, title, body, data, dedupe_key=key):
            res["summaries"] += 1
    if prefs.notify_overdue and local_now.time().replace(tzinfo=None) >= prefs.morning_time:
        for t in svc.overdue_tasks(db, user.id, today)[:MAX_OVERDUE_ALERTS]:
            key = f"overdue:{t.id}:{today.isoformat()}"
            if notif.notification_exists(db, user.id, key):
                continue
            if notif.create_notification(db, user.id, "overdue", f"Overdue: {t.title}",
                                         f"Was due {t.due_date.isoformat()}",
                                         {"task_id": t.id}, dedupe_key=key):
                res["overdue"] += 1
    reports.save_snapshot(db, user, today)
    y = today - timedelta(days=1)
    from .models import DailyReport
    if not db.query(DailyReport.id).filter_by(user_id=user.id, report_date=y).first():
        reports.save_snapshot(db, user, y)
    db.commit()
    return res


def run_once(db: Session, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    summary = {"recurring_created": 0, "reminders": {}, "summaries": 0, "overdue": 0, "users": 0, "errors": 0}
    try:
        summary["recurring_created"] = svc.materialize_rules(db)
    except Exception:
        db.rollback()
        summary["errors"] += 1
        log.exception("materialize failed")
    try:
        summary["reminders"] = process_reminders(db, now)
    except Exception:
        db.rollback()
        summary["errors"] += 1
        log.exception("reminders failed")
    users = db.query(User).filter(User.is_active.is_(True)).all()
    for u in users:
        try:
            prefs = db.query(UserPreferences).filter_by(user_id=u.id).first()
            if prefs is None:
                prefs = UserPreferences(user_id=u.id, timezone="UTC")
                db.add(prefs)
                db.flush()
            r = process_user(db, u, prefs, now)
            summary["summaries"] += r["summaries"]
            summary["overdue"] += r["overdue"]
            summary["users"] += 1
        except Exception:
            db.rollback()
            summary["errors"] += 1
            log.exception("worker failed for user %s", u.id)
    return summary


def start_background(interval: float = 60.0):
    """Run run_once() every `interval` seconds in a daemon thread (free Render plan has no cron).
    Returns a threading.Event; set it to stop. Failures are logged, never raised."""
    import threading

    stop = threading.Event()

    def loop():
        while not stop.wait(interval):
            try:
                with SessionLocal() as db:
                    run_once(db)
            except Exception:
                log.exception("in-process worker iteration failed")

    threading.Thread(target=loop, name="taskflow-worker", daemon=True).start()
    return stop


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    with SessionLocal() as db:
        s = run_once(db)
    log.info("worker run complete: %s", s)
    return 1 if s["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
