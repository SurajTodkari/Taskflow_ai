"""Daily report snapshot, PDF and CSV export."""
import csv
import io
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..deps import get_prefs, get_tz, user_today
from ..models import DailyReport, User
from .analytics import productivity, stats_for, tasks_by_day, time_by_day
from .tasks import day_tasks


def build_report(db: Session, user: User, d: date) -> dict:
    prefs = get_prefs(db, user)
    tz = get_tz(prefs)
    today = user_today(prefs)
    ts = tasks_by_day(db, user.id, d, d).get(d, [])
    st = stats_for(ts, today)
    proj: dict[str, dict] = {}
    for t in ts:
        if t.status == "cancelled":
            continue
        n = t.project.name if t.project else "No project"
        p = proj.setdefault(n, {"project": n, "total": 0, "completed": 0})
        p["total"] += 1
        p["completed"] += 1 if t.status == "completed" else 0
    nxt = d + timedelta(days=1)
    planned = [t for t in day_tasks(db, user.id, nxt) if t.status in ("not_started", "in_progress", "on_hold")]
    return {
        "date": d.isoformat(), "total": st["total"], "completed": st["completed"],
        "pending": st["pending"], "overdue": st["overdue"], "cancelled": st["cancelled"],
        "completion_percent": productivity(st["completed"], st["total"]),
        "time_spent_seconds": time_by_day(db, user.id, d, d, tz).get(d, 0),
        "by_project": list(proj.values()),
        "tomorrow_planned": [{"id": t.id, "title": t.title, "priority": t.priority,
                              "due_date": t.due_date.isoformat() if t.due_date else None} for t in planned],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def save_snapshot(db: Session, user: User, d: date, data: dict | None = None) -> dict:
    data = data or build_report(db, user, d)
    row = db.query(DailyReport).filter_by(user_id=user.id, report_date=d).first()
    if row:
        row.data = data
        row.updated_at = datetime.now(timezone.utc)
    else:
        try:
            with db.begin_nested():
                db.add(DailyReport(user_id=user.id, report_date=d, data=data))
                db.flush()
        except IntegrityError:
            row = db.query(DailyReport).filter_by(user_id=user.id, report_date=d).first()
            if row:
                row.data = data
    return data


def get_report(db: Session, user: User, d: date) -> dict:
    """Live for today/future (refreshes snapshot); stored snapshot for past days when present."""
    today = user_today(get_prefs(db, user))
    if d < today:
        row = db.query(DailyReport).filter_by(user_id=user.id, report_date=d).first()
        if row and row.data:
            return row.data
    data = save_snapshot(db, user, d)
    db.commit()
    return data


def report_csv(r: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Daily report", r["date"]])
    for k in ("total", "completed", "pending", "overdue", "cancelled", "completion_percent", "time_spent_seconds"):
        w.writerow([k, r[k]])
    w.writerow([])
    w.writerow(["project", "total", "completed"])
    for p in r["by_project"]:
        w.writerow([p["project"], p["total"], p["completed"]])
    w.writerow([])
    w.writerow(["tomorrow_planned", "priority", "due_date"])
    for t in r["tomorrow_planned"]:
        w.writerow([t["title"], t["priority"], t["due_date"] or ""])
    return buf.getvalue()


def report_pdf(r: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title=f"Daily report {r['date']}")
    ss = getSampleStyleSheet()
    el = [Paragraph(f"Daily Report - {r['date']}", ss["Title"]), Spacer(1, 12)]
    hrs = r["time_spent_seconds"] // 3600
    mins = (r["time_spent_seconds"] % 3600) // 60
    rows = [["Metric", "Value"], ["Total tasks", r["total"]], ["Completed", r["completed"]],
            ["Pending", r["pending"]], ["Overdue", r["overdue"]], ["Cancelled", r["cancelled"]],
            ["Completion", f"{r['completion_percent']}%"], ["Time tracked", f"{hrs}h {mins}m"]]

    def style():
        return TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#6366f1")),
                           ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                           ("GRID", (0, 0), (-1, -1), 0.5, colors.grey)])
    t = Table(rows); t.setStyle(style()); el += [t, Spacer(1, 14)]
    if r["by_project"]:
        el.append(Paragraph("By project", ss["Heading2"]))
        t = Table([["Project", "Total", "Completed"]] + [[p["project"], p["total"], p["completed"]]
                                                         for p in r["by_project"]])
        t.setStyle(style()); el += [t, Spacer(1, 14)]
    el.append(Paragraph("Planned for tomorrow", ss["Heading2"]))
    if r["tomorrow_planned"]:
        for x in r["tomorrow_planned"]:
            el.append(Paragraph(f"- {x['title']} ({x['priority']})".replace("&", "&amp;").replace("<", "&lt;"),
                                ss["Normal"]))
    else:
        el.append(Paragraph("Nothing planned yet.", ss["Normal"]))
    doc.build(el)
    return buf.getvalue()
