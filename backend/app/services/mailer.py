"""Optional plain-text email via any SMTP server. Off unless SMTP_HOST is set. Never blocks or raises."""
import logging
import os
import smtplib
import threading
from email.message import EmailMessage

from sqlalchemy.orm import Session

log = logging.getLogger(__name__)


def enabled() -> bool:
    return bool(os.environ.get("SMTP_HOST", "").strip())


def _deliver(to: str, subject: str, body: str):
    host = os.environ["SMTP_HOST"].strip()
    port = int(os.environ.get("SMTP_PORT", "587") or 587)
    user = os.environ.get("SMTP_USER", "")
    pw = os.environ.get("SMTP_PASSWORD", "")
    sender = os.environ.get("SMTP_FROM") or user or "taskflow@localhost"
    tls = os.environ.get("SMTP_TLS", "1").strip().lower() in ("1", "true", "yes", "on")
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, to, subject
    msg.set_content(body)
    if port == 465 and tls:
        with smtplib.SMTP_SSL(host, port, timeout=15) as s:
            if user:
                s.login(user, pw)
            s.send_message(msg)
        return
    with smtplib.SMTP(host, port, timeout=15) as s:
        if tls:
            s.starttls()
        if user:
            s.login(user, pw)
        s.send_message(msg)


def _run(fn):
    threading.Thread(target=fn, daemon=True).start()


def send_raw(to: str, subject: str, body: str):
    """Fire-and-forget; swallows every error."""
    if not enabled() or not to:
        return

    def job():
        try:
            _deliver(to, subject, body)
        except Exception as e:
            log.warning("email to %s failed: %s", to, e)

    try:
        _run(job)
    except Exception as e:  # pragma: no cover
        log.warning("email thread failed: %s", e)


def notify_user(db: Session, user_id: int, subject: str, body: str):
    """Email a registered user unless they opted out (UserPreferences.jira_email_notifications)."""
    if not enabled():
        return
    try:
        from ..models import User, UserPreferences
        u = db.get(User, user_id)
        if not u or not u.is_active:
            return
        pref = db.query(UserPreferences).filter_by(user_id=user_id).first()
        if pref is not None and pref.jira_email_notifications is False:
            return
        send_raw(u.email, subject, body)
    except Exception as e:
        log.warning("email notify failed: %s", e)
