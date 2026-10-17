from datetime import date, datetime, time, timezone

from sqlalchemy import (JSON, Boolean, Date, DateTime, ForeignKey, Index, Integer, String,
                        Text, Time, UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _now():
    return datetime.now(timezone.utc)


class TS:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


def fk_user():
    return mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)


class User(TS, Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    preferences = relationship("UserPreferences", uselist=False, back_populates="user",
                               cascade="all, delete-orphan")


class UserPreferences(TS, Base):
    __tablename__ = "user_preferences"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    morning_time: Mapped[time] = mapped_column(Time, default=time(8, 0))
    evening_time: Mapped[time] = mapped_column(Time, default=time(20, 0))
    tomorrow_time: Mapped[time] = mapped_column(Time, default=time(21, 0))
    default_reminder_minutes: Mapped[int] = mapped_column(Integer, default=15)
    theme: Mapped[str] = mapped_column(String(10), default="system")
    work_start: Mapped[time] = mapped_column(Time, default=time(9, 0))
    work_end: Mapped[time] = mapped_column(Time, default=time(17, 0))
    weekend_days: Mapped[list] = mapped_column(JSON, default=lambda: [5, 6])
    notify_morning: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_evening: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_tomorrow: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_reminders: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_overdue: Mapped[bool] = mapped_column(Boolean, default=True)
    recurring_defaults: Mapped[dict] = mapped_column(JSON, default=dict)
    user = relationship("User", back_populates="preferences")


class RefreshToken(TS, Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = fk_user()
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Project(TS, Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = fk_user()
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str] = mapped_column(String(20), default="#6366f1")
    status: Mapped[str] = mapped_column(String(20), default="active")
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    milestones = relationship("Milestone", back_populates="project", cascade="all, delete-orphan",
                              order_by="Milestone.due_date")
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_project_user_name"),)


class Milestone(TS, Base):
    __tablename__ = "milestones"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    project = relationship("Project", back_populates="milestones")


class RecurringRule(TS, Base):
    __tablename__ = "recurring_rules"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = fk_user()
    template_task_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("tasks.id", ondelete="SET NULL", use_alter=True, name="fk_rule_template"), nullable=True)
    freq: Mapped[str] = mapped_column(String(10))
    interval: Mapped[int] = mapped_column(Integer, default=1)
    by_weekday: Mapped[list] = mapped_column(JSON, default=list)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    template: Mapped[dict] = mapped_column(JSON, default=dict)


class Task(TS, Base):
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = fk_user()
    project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("projects.id", ondelete="SET NULL"),
                                                   nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(60), nullable=True)
    priority: Mapped[str] = mapped_column(String(10), default="medium")
    status: Mapped[str] = mapped_column(String(20), default="not_started")
    board_column: Mapped[str] = mapped_column(String(20), default="todo")
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    estimated_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reminder_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    queued_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reschedule_count: Mapped[int] = mapped_column(Integer, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recurrence_rule_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("recurring_rules.id", ondelete="SET NULL"), nullable=True, index=True)
    occurrence_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    project = relationship("Project")
    subtasks = relationship("Subtask", cascade="all, delete-orphan", order_by="Subtask.id")
    checklist = relationship("ChecklistItem", cascade="all, delete-orphan", order_by="ChecklistItem.id")
    attachments = relationship("TaskAttachment", cascade="all, delete-orphan", order_by="TaskAttachment.id")

    __table_args__ = (
        UniqueConstraint("recurrence_rule_id", "occurrence_date", name="uq_task_rule_occurrence"),
        Index("ix_tasks_user_due", "user_id", "due_date"),
        Index("ix_tasks_user_start", "user_id", "start_date"),
        Index("ix_tasks_user_status", "user_id", "status"),
        Index("ix_tasks_user_queued", "user_id", "queued_date"),
    )


class Subtask(TS, Base):
    __tablename__ = "subtasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    done: Mapped[bool] = mapped_column(Boolean, default=False)


class ChecklistItem(TS, Base):
    __tablename__ = "checklist_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    done: Mapped[bool] = mapped_column(Boolean, default=False)


class TaskActivity(TS, Base):
    __tablename__ = "task_activity"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = fk_user()
    action: Mapped[str] = mapped_column(String(40))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)


class TaskComment(TS, Base):
    __tablename__ = "task_comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = fk_user()
    body: Mapped[str] = mapped_column(Text)


class TaskAttachment(TS, Base):
    __tablename__ = "task_attachments"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = fk_user()
    filename: Mapped[str] = mapped_column(String(255))
    stored_name: Mapped[str] = mapped_column(String(255), unique=True)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size: Mapped[int] = mapped_column(Integer, default=0)


class TaskReminder(TS, Base):
    __tablename__ = "task_reminders"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = fk_user()
    kind: Mapped[str] = mapped_column(String(20), default="custom")  # custom | default
    remind_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(15), default="pending")  # pending|sent|failed
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    __table_args__ = (UniqueConstraint("task_id", "kind", "remind_at", name="uq_reminder_task_kind_at"),
                      Index("ix_reminders_status_at", "status", "remind_at"))


class Notification(TS, Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = fk_user()
    type: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    dedupe_key: Mapped[str] = mapped_column(String(200))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    __table_args__ = (UniqueConstraint("user_id", "dedupe_key", name="uq_notification_user_dedupe"),)


class PushSubscription(TS, Base):
    __tablename__ = "push_subscriptions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = fk_user()
    endpoint: Mapped[str] = mapped_column(String(600), unique=True)
    p256dh: Mapped[str] = mapped_column(String(255))
    auth: Mapped[str] = mapped_column(String(255))
    failures: Mapped[int] = mapped_column(Integer, default=0)


class DailyReport(TS, Base):
    __tablename__ = "daily_reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = fk_user()
    report_date: Mapped[date] = mapped_column(Date)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (UniqueConstraint("user_id", "report_date", name="uq_report_user_date"),)


class TimeEntry(TS, Base):
    __tablename__ = "time_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = fk_user()
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    seconds: Mapped[int] = mapped_column(Integer, default=0)
    __table_args__ = (Index("ix_time_user_start", "user_id", "started_at"),)
