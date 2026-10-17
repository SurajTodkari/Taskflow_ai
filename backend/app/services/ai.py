"""AI assistant: DB-grounded context, rule-based answers, optional Anthropic call (falls back to rules)."""
import json
import logging
from datetime import date, timedelta

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..deps import get_prefs, user_today
from ..models import User
from .analytics import stats_for, tasks_by_day
from .tasks import PRIORITY_RANK, carried_forward, day_tasks, overdue_tasks

log = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are the assistant inside a personal task manager. Answer ONLY using the JSON context provided "
    "(the user's real tasks from their database). Never invent, rename or assume tasks, dates, projects or "
    "numbers that are not in the context. If the context does not contain the answer, say so plainly. "
    "Be concise and actionable; refer to tasks by their exact titles.")


def ai_enabled() -> bool:
    return bool(settings.ANTHROPIC_API_KEY)


def _brief(t, today: date) -> dict:
    return {"id": t.id, "title": t.title, "priority": t.priority, "status": t.status,
            "due_date": t.due_date.isoformat() if t.due_date else None,
            "start_date": t.start_date.isoformat() if t.start_date else None,
            "estimated_minutes": t.estimated_minutes, "reschedule_count": t.reschedule_count,
            "project": t.project.name if t.project else None}


def _rank(t):
    return (PRIORITY_RANK.get(t.priority, 9), t.due_date or date.max, t.id)


def build_context(db: Session, user: User) -> dict:
    prefs = get_prefs(db, user)
    today = user_today(prefs)
    tomorrow = today + timedelta(days=1)
    today_tasks = day_tasks(db, user.id, today)
    carried = carried_forward(db, user.id, today)
    overdue = overdue_tasks(db, user.id, today)
    tmr = [t for t in day_tasks(db, user.id, tomorrow) if t.status in ("not_started", "in_progress", "on_hold")]
    week_start = today - timedelta(days=6)
    by_day = tasks_by_day(db, user.id, week_start, today)
    weekly = []
    for i in range(7):
        d = week_start + timedelta(days=i)
        s = stats_for(by_day.get(d, []), today)
        weekly.append({"date": d.isoformat(), "total": s["total"], "completed": s["completed"],
                       "productivity": s["productivity"]})
    open_today = [t for t in today_tasks if t.status in ("not_started", "in_progress", "on_hold")]
    open_all = {t.id: t for t in open_today + carried + overdue}
    delayed = [t for t in open_all.values() if (t.reschedule_count or 0) >= 2 or t in overdue]
    return {
        "today": today.isoformat(), "tomorrow": tomorrow.isoformat(),
        "today_stats": stats_for(today_tasks, today),
        "today_tasks": [_brief(t, today) for t in today_tasks],
        "carried_forward": [_brief(t, today) for t in carried],
        "overdue": [_brief(t, today) for t in overdue],
        "tomorrow_planned": [_brief(t, today) for t in tmr],
        "priorities": [_brief(t, today) for t in sorted(open_all.values(), key=_rank)[:5]],
        "delayed": [_brief(t, today) for t in sorted(delayed, key=_rank)],
        "workload_today_minutes": sum(t.estimated_minutes or 0 for t in open_today),
        "workload_tomorrow_minutes": sum(t.estimated_minutes or 0 for t in tmr),
        "work_hours_minutes": _work_minutes(prefs),
        "weekly": weekly,
    }


def _work_minutes(prefs) -> int:
    ws, we = prefs.work_start, prefs.work_end
    return max(0, (we.hour * 60 + we.minute) - (ws.hour * 60 + ws.minute))


def _lst(items: list[dict], limit: int = 10) -> str:
    return "\n".join(f"- {i['title']} ({i['priority']}"
                     + (f", due {i['due_date']}" if i["due_date"] else "") + ")" for i in items[:limit])


def overload(ctx: dict) -> dict:
    cap = ctx["work_hours_minutes"] or 480
    for key, label in (("workload_today_minutes", "today"), ("workload_tomorrow_minutes", "tomorrow")):
        if ctx[key] > cap:
            return {"flag": True, "message": f"Estimated work for {label} is {ctx[key]} min, above your "
                                              f"{cap} min working day. Consider rescheduling lower-priority tasks."}
    return {"flag": False, "message": "Your estimated workload fits within your working hours."}


def weekly_summary(ctx: dict) -> str:
    tot = sum(d["total"] for d in ctx["weekly"])
    done = sum(d["completed"] for d in ctx["weekly"])
    pct = round(done * 100 / tot, 1) if tot else 0
    return f"Last 7 days: {done} of {tot} scheduled tasks completed ({pct}%)."


def rule_answer(message: str, ctx: dict) -> tuple[str, str]:
    m = message.lower()
    if any(k in m for k in ("tomorrow", "next day")):
        items = ctx["tomorrow_planned"]
        extra = ctx["carried_forward"]
        if not items and not extra:
            return "Nothing is planned for tomorrow yet.", "tomorrow"
        txt = f"Planned for tomorrow ({ctx['tomorrow']}):\n{_lst(items)}" if items else "Nothing is scheduled for tomorrow."
        if extra:
            txt += f"\n\nStill carried forward from earlier days:\n{_lst(extra)}"
        return txt, "tomorrow"
    if any(k in m for k in ("overdue", "late", "missed")):
        o = ctx["overdue"]
        return (f"You have {len(o)} overdue task(s):\n{_lst(o)}" if o else "You have no overdue tasks."), "overdue"
    if any(k in m for k in ("delay", "postpon", "resched", "stuck")):
        d = ctx["delayed"]
        return (f"{len(d)} task(s) are delayed or repeatedly rescheduled:\n{_lst(d)}" if d
                else "No delayed tasks found."), "delayed"
    if any(k in m for k in ("priorit", "focus", "first", "important", "urgent", "should i")):
        p = ctx["priorities"]
        return (f"Focus on these first:\n{_lst(p)}" if p else "You have no open tasks to prioritise."), "priorities"
    if any(k in m for k in ("workload", "overload", "busy", "capacity", "too much")):
        o = overload(ctx)
        return (f"{o['message']} Today: {ctx['workload_today_minutes']} min, tomorrow: "
                f"{ctx['workload_tomorrow_minutes']} min estimated."), "workload"
    if any(k in m for k in ("week", "productiv", "summary", "progress")):
        return weekly_summary(ctx), "weekly"
    if any(k in m for k in ("pending", "remaining", "left", "todo", "to do", "open", "today")):
        s = ctx["today_stats"]
        open_t = [t for t in ctx["today_tasks"] if t["status"] in ("not_started", "in_progress", "on_hold")]
        txt = (f"Today: {s['completed']} of {s['total']} done, {s['pending']} pending, {s['overdue']} overdue.")
        if open_t:
            txt += f"\nPending today:\n{_lst(open_t)}"
        if ctx["carried_forward"]:
            txt += f"\n\nCarried forward ({len(ctx['carried_forward'])}):\n{_lst(ctx['carried_forward'])}"
        return txt, "pending"
    s = ctx["today_stats"]
    return (f"Here is your snapshot: {s['pending']} pending today, {len(ctx['overdue'])} overdue, "
            f"{len(ctx['carried_forward'])} carried forward, {len(ctx['tomorrow_planned'])} planned for tomorrow. "
            "Ask about tomorrow, pending, overdue, priorities, workload, weekly progress or delayed tasks."), "summary"


def llm_answer(message: str, ctx: dict) -> str | None:
    if not ai_enabled():
        return None
    try:
        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": settings.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
            json={"model": settings.AI_MODEL, "max_tokens": 700, "system": SYSTEM_PROMPT,
                  "messages": [{"role": "user", "content":
                                f"Context (JSON, authoritative):\n{json.dumps(ctx, default=str)}\n\nQuestion: {message}"}]},
            timeout=20.0)
        r.raise_for_status()
        parts = [b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text"]
        text = "".join(parts).strip()
        return text or None
    except Exception as e:
        log.warning("LLM call failed, using rules: %s", e)
        return None


def chat(db: Session, user: User, message: str) -> dict:
    ctx = build_context(db, user)
    rule_text, intent = rule_answer(message, ctx)
    text = llm_answer(message, ctx)
    if text:
        return {"answer": text, "source": "llm", "data_used": {"intent": intent, "context": ctx}}
    return {"answer": rule_text, "source": "rules", "data_used": {"intent": intent, "context": ctx}}


def insights(db: Session, user: User) -> dict:
    ctx = build_context(db, user)
    today = date.fromisoformat(ctx["today"])
    from .tasks import OPEN_STATUSES, base_query
    from ..models import Task
    q = (base_query(db, user.id).filter(Task.status.in_(OPEN_STATUSES), Task.due_date >= today,
                                        Task.due_date <= today + timedelta(days=3))
         .order_by(Task.due_date, Task.id).all())
    soon = [_brief(t, today) for t in q]
    return {"suggested_priorities": ctx["priorities"], "approaching_deadlines": soon,
            "tomorrow_plan": ctx["tomorrow_planned"], "overload": overload(ctx),
            "delayed_tasks": ctx["delayed"], "weekly_summary": weekly_summary(ctx)}
