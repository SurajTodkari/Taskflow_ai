"""Shared stats: day stats, productivity, analytics payload."""
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models import Task, TimeEntry
from .tasks import OPEN_STATUSES, aware, scheduled_date

DEFINITIONS = {
    "productivity": "completed / (tasks scheduled for the day excluding cancelled) x 100; 0 when nothing was scheduled.",
    "scheduled": "A task belongs to a day when start_date (or due_date if no start) is that day, or it was added to that day.",
    "overdue": "Open task whose due date is before today. Never stored; derived.",
    "cancelled": "Cancelled tasks are excluded from totals and productivity.",
}


def productivity(completed: int, total: int) -> float:
    return round(completed * 100.0 / total, 1) if total else 0.0


def tasks_by_day(db: Session, user_id: int, start: date, end: date) -> dict[date, list[Task]]:
    rows = db.query(Task).filter(
        Task.user_id == user_id,
        or_(Task.start_date.between(start, end), Task.due_date.between(start, end),
            Task.queued_date.between(start, end))).all()
    out: dict[date, list[Task]] = defaultdict(list)
    for t in rows:
        days = set()
        sd = scheduled_date(t)
        if sd and start <= sd <= end:
            days.add(sd)
        if t.queued_date and start <= t.queued_date <= end:
            days.add(t.queued_date)
        for d in days:
            out[d].append(t)
    return out


def stats_for(tasks: list[Task], today: date) -> dict:
    live = [t for t in tasks if t.status != "cancelled"]
    completed = sum(1 for t in live if t.status == "completed")
    opened = [t for t in live if t.status in OPEN_STATUSES]
    return {
        "total": len(live), "completed": completed, "pending": len(opened),
        "in_progress": sum(1 for t in opened if t.status == "in_progress"),
        "overdue": sum(1 for t in opened if t.due_date and t.due_date < today),
        "cancelled": len(tasks) - len(live),
        "productivity": productivity(completed, len(live)),
    }


def local_day_bounds(d: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    s = datetime.combine(d, time.min).replace(tzinfo=tz).astimezone(timezone.utc)
    e = datetime.combine(d + timedelta(days=1), time.min).replace(tzinfo=tz).astimezone(timezone.utc)
    return s, e


def time_by_day(db: Session, user_id: int, start: date, end: date, tz: ZoneInfo) -> dict[date, int]:
    s, _ = local_day_bounds(start, tz)
    _, e = local_day_bounds(end, tz)
    now = datetime.now(timezone.utc)
    out: dict[date, int] = defaultdict(int)
    for en in db.query(TimeEntry).filter(TimeEntry.user_id == user_id, TimeEntry.started_at >= s,
                                         TimeEntry.started_at < e).all():
        secs = en.seconds or 0
        if en.ended_at is None:
            secs = max(0, int((now - aware(en.started_at)).total_seconds()))
        out[aware(en.started_at).astimezone(tz).date()] += secs
    return out


def build_analytics(db: Session, user_id: int, today: date, tz: ZoneInfo, rng: int) -> dict:
    start = today - timedelta(days=rng - 1)
    by_day = tasks_by_day(db, user_id, start, today)
    tmap = time_by_day(db, user_id, start, today, tz)
    daily, workload, tt, overdue_trend = [], [], [], []
    weekly: dict[str, dict] = {}
    monthly: dict[str, dict] = {}
    proj: dict[str, dict] = {}
    prio: dict[str, int] = defaultdict(int)
    agg = {"completed": 0, "pending": 0, "overdue": 0, "cancelled": 0}
    seen: set[int] = set()
    for i in range(rng):
        d = start + timedelta(days=i)
        ts = by_day.get(d, [])
        st = stats_for(ts, today)
        daily.append({"date": d.isoformat(), "total": st["total"], "completed": st["completed"],
                      "productivity": st["productivity"]})
        iso = d.isocalendar()
        w = weekly.setdefault(f"{iso[0]}-W{iso[1]:02d}", {"total": 0, "completed": 0})
        w["total"] += st["total"]; w["completed"] += st["completed"]
        m = monthly.setdefault(d.strftime("%Y-%m"), {"total": 0, "completed": 0})
        m["total"] += st["total"]; m["completed"] += st["completed"]
        live_open = [t for t in ts if t.status in OPEN_STATUSES]
        workload.append({"date": d.isoformat(), "tasks": len(live_open),
                         "estimated_minutes": sum(t.estimated_minutes or 0 for t in live_open)})
        tt.append({"date": d.isoformat(), "seconds": tmap.get(d, 0)})
        overdue_trend.append({"date": d.isoformat(), "count": st["overdue"]})
        for t in ts:
            if t.id in seen:
                continue
            seen.add(t.id)
            if t.status == "cancelled":
                agg["cancelled"] += 1
                continue
            if t.status == "completed":
                agg["completed"] += 1
            elif t.due_date and t.due_date < today:
                agg["overdue"] += 1
            else:
                agg["pending"] += 1
            pn = t.project.name if t.project else "No project"
            p = proj.setdefault(pn, {"project": pn, "total": 0, "completed": 0})
            p["total"] += 1
            p["completed"] += 1 if t.status == "completed" else 0
            prio[t.priority] += 1
    return {
        "daily": daily,
        "weekly": [{"week": k, **v} for k, v in sorted(weekly.items())],
        "monthly": [{"month": k, **v, "productivity": productivity(v["completed"], v["total"])}
                    for k, v in sorted(monthly.items())],
        "completed_vs_pending": agg,
        "by_project": [{**p, "productivity": productivity(p["completed"], p["total"])} for p in proj.values()],
        "priority_distribution": [{"priority": k, "count": prio[k]} for k in ("critical", "high", "medium", "low")],
        "overdue_trend": overdue_trend,
        "workload": workload,
        "time_tracking": tt,
        "definitions": DEFINITIONS,
    }
