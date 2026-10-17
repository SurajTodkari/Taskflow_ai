from datetime import date, datetime, time, timezone

from sqlalchemy import (JSON, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, LargeBinary, String,
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
    jira_email_notifications: Mapped[bool] = mapped_column(Boolean, default=True)
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


# ---------------------------------------------------------------- Jira-style module
class JiraProject(TS, Base):
    __tablename__ = "jira_projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(10), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    lead_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    issue_seq: Mapped[int] = mapped_column(Integer, default=0)
    board_type: Mapped[str] = mapped_column(String(10), default="scrum")  # scrum | kanban
    enforce_workflow: Mapped[bool] = mapped_column(Boolean, default=False)
    default_assignee_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"),
                                                            nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class JiraMember(TS, Base):
    __tablename__ = "jira_members"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("jira_projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = fk_user()
    role: Mapped[str] = mapped_column(String(10), default="member")  # admin | member | viewer
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_jira_member"),)


class JiraColumn(TS, Base):
    __tablename__ = "jira_columns"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("jira_projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    category: Mapped[str] = mapped_column(String(15), default="todo")  # todo | in_progress | done
    position: Mapped[int] = mapped_column(Integer, default=0)
    wip_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)


class JiraSprint(TS, Base):
    __tablename__ = "jira_sprints"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("jira_projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    goal: Mapped[str | None] = mapped_column(Text, nullable=True)
    state: Mapped[str] = mapped_column(String(10), default="planned")  # planned | active | closed
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class JiraIssue(TS, Base):
    __tablename__ = "jira_issues"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("jira_projects.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(10), default="task")
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    column_id: Mapped[int] = mapped_column(Integer, ForeignKey("jira_columns.id"), index=True)
    priority: Mapped[str] = mapped_column(String(10), default="medium")
    assignee_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"),
                                                    nullable=True, index=True)
    reporter_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"),
                                                    nullable=True)
    parent_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("jira_issues.id", ondelete="SET NULL"),
                                                  nullable=True, index=True)
    sprint_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("jira_sprints.id", ondelete="SET NULL"),
                                                  nullable=True, index=True)
    story_points: Mapped[int | None] = mapped_column(Integer, nullable=True)
    labels: Mapped[list] = mapped_column(JSON, default=list)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    rank: Mapped[float] = mapped_column(Float, default=0.0)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    original_estimate_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    remaining_estimate_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    fix_version_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("jira_versions.id", ondelete="SET NULL"),
                                                       nullable=True, index=True)
    custom_fields: Mapped[dict] = mapped_column(JSON, default=dict)
    environment: Mapped[str | None] = mapped_column(Text, nullable=True)
    __table_args__ = (UniqueConstraint("project_id", "number", name="uq_jira_issue_number"),)


class JiraComment(TS, Base):
    __tablename__ = "jira_comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(Integer, ForeignKey("jira_issues.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = fk_user()
    body: Mapped[str] = mapped_column(Text)


class JiraHistory(TS, Base):
    __tablename__ = "jira_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(Integer, ForeignKey("jira_issues.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = fk_user()
    field: Mapped[str] = mapped_column(String(40))
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)


def _pk():
    return mapped_column(Integer, ForeignKey("jira_projects.id", ondelete="CASCADE"), index=True)


class JiraInvite(TS, Base):
    __tablename__ = "jira_invites"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = _pk()
    email: Mapped[str] = mapped_column(String(255), index=True)
    role: Mapped[str] = mapped_column(String(10), default="member")
    invited_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"),
                                                   nullable=True)
    __table_args__ = (UniqueConstraint("project_id", "email", name="uq_jira_invite"),)


class JiraVersion(TS, Base):
    __tablename__ = "jira_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = _pk()
    name: Mapped[str] = mapped_column(String(60))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    release_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    released: Mapped[bool] = mapped_column(Boolean, default=False)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_jira_version_name"),)


class JiraComponent(TS, Base):
    __tablename__ = "jira_components"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = _pk()
    name: Mapped[str] = mapped_column(String(60))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    lead_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"),
                                                nullable=True)
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_jira_component_name"),)


class JiraIssueComponent(Base):
    __tablename__ = "jira_issue_components"
    issue_id: Mapped[int] = mapped_column(Integer, ForeignKey("jira_issues.id", ondelete="CASCADE"),
                                          primary_key=True)
    component_id: Mapped[int] = mapped_column(Integer, ForeignKey("jira_components.id", ondelete="CASCADE"),
                                              primary_key=True)


class JiraLink(TS, Base):
    __tablename__ = "jira_links"
    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(Integer, ForeignKey("jira_issues.id", ondelete="CASCADE"), index=True)
    target_id: Mapped[int] = mapped_column(Integer, ForeignKey("jira_issues.id", ondelete="CASCADE"), index=True)
    link_type: Mapped[str] = mapped_column(String(15))  # blocks | relates | duplicates | clones
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"),
                                                   nullable=True)
    __table_args__ = (UniqueConstraint("source_id", "target_id", "link_type", name="uq_jira_link"),)


class JiraWatcher(TS, Base):
    __tablename__ = "jira_watchers"
    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(Integer, ForeignKey("jira_issues.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = fk_user()
    __table_args__ = (UniqueConstraint("issue_id", "user_id", name="uq_jira_watcher"),)


class JiraWorklog(TS, Base):
    __tablename__ = "jira_worklogs"
    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(Integer, ForeignKey("jira_issues.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = fk_user()
    seconds: Mapped[int] = mapped_column(Integer)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)


class JiraAttachment(TS, Base):
    __tablename__ = "jira_attachments"
    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(Integer, ForeignKey("jira_issues.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = fk_user()
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)


class JiraFilter(TS, Base):
    __tablename__ = "jira_filters"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    jql: Mapped[str] = mapped_column(Text, default="")
    shared: Mapped[bool] = mapped_column(Boolean, default=False)
    project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("jira_projects.id", ondelete="CASCADE"),
                                                   nullable=True, index=True)


class JiraTransition(Base):
    __tablename__ = "jira_transitions"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = _pk()
    from_column_id: Mapped[int] = mapped_column(Integer, ForeignKey("jira_columns.id", ondelete="CASCADE"))
    to_column_id: Mapped[int] = mapped_column(Integer, ForeignKey("jira_columns.id", ondelete="CASCADE"))
    __table_args__ = (UniqueConstraint("project_id", "from_column_id", "to_column_id", name="uq_jira_transition"),)


class JiraCustomField(TS, Base):
    __tablename__ = "jira_custom_fields"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = _pk()
    name: Mapped[str] = mapped_column(String(60))
    field_type: Mapped[str] = mapped_column(String(10))  # text | number | select | date | checkbox
    options: Mapped[list] = mapped_column(JSON, default=list)
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
