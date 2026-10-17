from datetime import date, datetime, time
from typing import Literal, Optional
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

Priority = Literal["critical", "high", "medium", "low"]
Status = Literal["not_started", "in_progress", "on_hold", "completed", "cancelled"]
BoardCol = Literal["backlog", "todo", "in_progress", "review", "completed"]


def _check_tz(v: str) -> str:
    try:
        ZoneInfo(v)
    except Exception:
        raise ValueError("Invalid IANA timezone")
    return v


# ---------- auth
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    timezone: str = "UTC"

    _tz = field_validator("timezone")(_check_tz)

    @field_validator("name")
    @classmethod
    def _n(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("name required")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshIn(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    name: str
    timezone: str = "UTC"


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- tasks
class RecurrenceIn(BaseModel):
    freq: Literal["daily", "weekly", "monthly"]
    interval: int = Field(1, ge=1, le=365)
    by_weekday: list[int] = []
    end_date: Optional[date] = None

    @field_validator("by_weekday")
    @classmethod
    def _wd(cls, v):
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("by_weekday values must be 0-6")
        return sorted(set(v))


class TaskBase(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=10000)
    project_id: Optional[int] = None
    category: Optional[str] = Field(None, max_length=60)
    priority: Priority = "medium"
    status: Status = "not_started"
    board_column: Optional[BoardCol] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    estimated_minutes: Optional[int] = Field(None, ge=0, le=100000)
    reminder_at: Optional[datetime] = None
    tags: list[str] = []
    notes: Optional[str] = Field(None, max_length=10000)
    recurrence: Optional[RecurrenceIn] = None

    @field_validator("title")
    @classmethod
    def _title(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("title must not be blank")
        return v

    @field_validator("tags")
    @classmethod
    def _tags(cls, v):
        out = []
        for t in v:
            t = t.strip()
            if t and len(t) <= 40 and t not in out:
                out.append(t)
        return out[:20]


def _check_dates(start_date, due_date, start_time, end_time):
    if start_date and due_date and due_date < start_date:
        raise ValueError("due_date must be on or after start_date")
    if start_time and end_time and end_time <= start_time:
        raise ValueError("end_time must be after start_time")


class TaskCreate(TaskBase):
    @model_validator(mode="after")
    def _v(self):
        _check_dates(self.start_date, self.due_date, self.start_time, self.end_time)
        return self


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=10000)
    project_id: Optional[int] = None
    category: Optional[str] = Field(None, max_length=60)
    priority: Optional[Priority] = None
    status: Optional[Status] = None
    board_column: Optional[BoardCol] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    estimated_minutes: Optional[int] = Field(None, ge=0, le=100000)
    reminder_at: Optional[datetime] = None
    tags: Optional[list[str]] = None
    notes: Optional[str] = Field(None, max_length=10000)
    recurrence: Optional[RecurrenceIn] = None

    @field_validator("title")
    @classmethod
    def _title(cls, v):
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("title must not be blank")
        return v

    @model_validator(mode="after")
    def _v(self):
        _check_dates(self.start_date, self.due_date, self.start_time, self.end_time)
        return self


class RescheduleIn(BaseModel):
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None

    @model_validator(mode="after")
    def _v(self):
        _check_dates(self.start_date, self.due_date, self.start_time, self.end_time)
        return self


class BoardIn(BaseModel):
    board_column: BoardCol


class ItemIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class ItemUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    done: Optional[bool] = None


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


# ---------- projects
class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=5000)
    color: str = Field("#6366f1", max_length=20)
    status: Literal["active", "on_hold", "completed", "archived"] = "active"
    start_date: Optional[date] = None
    due_date: Optional[date] = None

    @model_validator(mode="after")
    def _v(self):
        _check_dates(self.start_date, self.due_date, None, None)
        return self


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=5000)
    color: Optional[str] = Field(None, max_length=20)
    status: Optional[Literal["active", "on_hold", "completed", "archived"]] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None


class MilestoneIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    due_date: Optional[date] = None
    done: bool = False


class MilestoneUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    due_date: Optional[date] = None
    done: Optional[bool] = None


# ---------- settings
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


class SettingsUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    timezone: Optional[str] = None
    morning_time: Optional[str] = Field(None, pattern=HHMM)
    evening_time: Optional[str] = Field(None, pattern=HHMM)
    tomorrow_time: Optional[str] = Field(None, pattern=HHMM)
    default_reminder_minutes: Optional[int] = Field(None, ge=0, le=10080)
    theme: Optional[Literal["light", "dark", "system"]] = None
    work_start: Optional[str] = Field(None, pattern=HHMM)
    work_end: Optional[str] = Field(None, pattern=HHMM)
    weekend_days: Optional[list[int]] = None
    notify_morning: Optional[bool] = None
    notify_evening: Optional[bool] = None
    notify_tomorrow: Optional[bool] = None
    notify_reminders: Optional[bool] = None
    notify_overdue: Optional[bool] = None
    recurring_defaults: Optional[dict] = None
    jira_email_notifications: Optional[bool] = None

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v):
        return _check_tz(v) if v is not None else v

    @field_validator("weekend_days")
    @classmethod
    def _wd(cls, v):
        if v is not None and any(d < 0 or d > 6 for d in v):
            raise ValueError("weekend_days values must be 0-6")
        return sorted(set(v)) if v is not None else v


# ---------- jira-style module
import re as _re  # noqa: E402

JiraRole = Literal["admin", "member", "viewer"]
JiraIssueType = Literal["epic", "story", "task", "bug", "subtask"]
JiraPriority = Literal["highest", "high", "medium", "low", "lowest"]
JiraCategory = Literal["todo", "in_progress", "done"]


def _clean_labels(v):
    if v is None:
        return []
    out = []
    for x in v:
        x = str(x).strip()
        if not x:
            continue
        if len(x) > 40:
            raise ValueError("label too long (max 40)")
        if x not in out:
            out.append(x)
    if len(out) > 20:
        raise ValueError("too many labels (max 20)")
    return out


class JiraProjectCreate(BaseModel):
    key: str
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=5000)
    board_type: Literal["scrum", "kanban"] = "scrum"

    @field_validator("key")
    @classmethod
    def _key(cls, v):
        v = v.strip().upper()
        if not _re.fullmatch(r"[A-Z0-9]{2,10}", v):
            raise ValueError("key must be 2-10 characters, A-Z and 0-9 only")
        return v

    @field_validator("name")
    @classmethod
    def _name(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("name required")
        return v


class JiraProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=5000)
    lead_id: Optional[int] = None
    board_type: Optional[Literal["scrum", "kanban"]] = None
    enforce_workflow: Optional[bool] = None
    default_assignee_id: Optional[int] = None
    archived: Optional[bool] = None


class JiraMemberAdd(BaseModel):
    email: EmailStr
    role: JiraRole = "member"


class JiraMemberUpdate(BaseModel):
    role: JiraRole


class JiraColumnCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    category: JiraCategory = "todo"


class JiraColumnUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    category: Optional[JiraCategory] = None
    position: Optional[int] = Field(default=None, ge=0)
    wip_limit: Optional[int] = Field(default=None, ge=1, le=1000)


class JiraIssueCreate(BaseModel):
    type: JiraIssueType = "task"
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=50000)
    column_id: Optional[int] = None
    priority: JiraPriority = "medium"
    assignee_id: Optional[int] = None
    parent_id: Optional[int] = None
    sprint_id: Optional[int] = None
    story_points: Optional[int] = Field(default=None, ge=0, le=1000)
    labels: list[str] = Field(default_factory=list)
    due_date: Optional[date] = None
    start_date: Optional[date] = None
    original_estimate_min: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    remaining_estimate_min: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    flagged: bool = False
    archived: bool = False
    fix_version_id: Optional[int] = None
    component_ids: list[int] = Field(default_factory=list)
    custom_fields: dict = Field(default_factory=dict)
    environment: Optional[str] = Field(default=None, max_length=20000)

    _labels = field_validator("labels")(_clean_labels)

    @field_validator("title")
    @classmethod
    def _title(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("title required")
        return v


class JiraIssueUpdate(BaseModel):
    type: Optional[JiraIssueType] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=50000)
    column_id: Optional[int] = None
    priority: Optional[JiraPriority] = None
    assignee_id: Optional[int] = None
    parent_id: Optional[int] = None
    sprint_id: Optional[int] = None
    story_points: Optional[int] = Field(default=None, ge=0, le=1000)
    labels: Optional[list[str]] = None
    due_date: Optional[date] = None
    start_date: Optional[date] = None
    original_estimate_min: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    remaining_estimate_min: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    flagged: Optional[bool] = None
    archived: Optional[bool] = None
    fix_version_id: Optional[int] = None
    component_ids: Optional[list[int]] = None
    custom_fields: Optional[dict] = None
    environment: Optional[str] = Field(default=None, max_length=20000)

    _labels = field_validator("labels")(_clean_labels)

    @field_validator("title")
    @classmethod
    def _title(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("title required")
        return v


class JiraMoveIn(BaseModel):
    column_id: int
    before_issue_id: Optional[int] = None
    after_issue_id: Optional[int] = None


class JiraRankIn(BaseModel):
    sprint_id: Optional[int] = None
    before_issue_id: Optional[int] = None
    after_issue_id: Optional[int] = None


class JiraCommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=20000)

    @field_validator("body")
    @classmethod
    def _b(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("body required")
        return v


class JiraSprintCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    goal: Optional[str] = Field(default=None, max_length=2000)
    start_date: Optional[date] = None
    end_date: Optional[date] = None

    @model_validator(mode="after")
    def _dates(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class JiraSprintUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    goal: Optional[str] = Field(default=None, max_length=2000)
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class JiraSprintStart(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class JiraSprintComplete(BaseModel):
    move_open_to: str | int = "backlog"


# ---------- jira v2
JiraLinkType = Literal["blocks", "relates", "duplicates", "clones"]
JiraFieldType = Literal["text", "number", "select", "date", "checkbox"]


class JiraLinkIn(BaseModel):
    link_type: JiraLinkType
    target_key: str


class JiraComponentIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    description: Optional[str] = Field(default=None, max_length=2000)
    lead_id: Optional[int] = None


class JiraComponentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    description: Optional[str] = Field(default=None, max_length=2000)
    lead_id: Optional[int] = None


class JiraVersionIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    description: Optional[str] = Field(default=None, max_length=2000)
    start_date: Optional[date] = None
    release_date: Optional[date] = None


class JiraVersionUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    description: Optional[str] = Field(default=None, max_length=2000)
    start_date: Optional[date] = None
    release_date: Optional[date] = None


class JiraVersionRelease(BaseModel):
    move_open_to_version_id: Optional[int] = None


class JiraWorklogIn(BaseModel):
    minutes: int = Field(ge=1, le=100_000)
    started_at: Optional[datetime] = None
    comment: Optional[str] = Field(default=None, max_length=5000)


class JiraWorklogUpdate(BaseModel):
    minutes: Optional[int] = Field(default=None, ge=1, le=100_000)
    started_at: Optional[datetime] = None
    comment: Optional[str] = Field(default=None, max_length=5000)


class JiraFilterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    jql: str = Field(default="", max_length=4000)
    shared: bool = False
    project_key: Optional[str] = None


class JiraFilterUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    jql: Optional[str] = Field(default=None, max_length=4000)
    shared: Optional[bool] = None


class JiraTransitionPair(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    from_: int = Field(alias="from")
    to: int


class JiraWorkflowIn(BaseModel):
    transitions: list[JiraTransitionPair]


class JiraCustomFieldIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    field_type: JiraFieldType
    options: list[str] = Field(default_factory=list)
    required: bool = False


class JiraCustomFieldUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    options: Optional[list[str]] = None
    required: Optional[bool] = None
    position: Optional[int] = Field(default=None, ge=0)


class JiraBulkPatch(BaseModel):
    assignee_id: Optional[int] = None
    priority: Optional[JiraPriority] = None
    column_id: Optional[int] = None
    sprint_id: Optional[int] = None
    labels_add: Optional[list[str]] = None
    labels_remove: Optional[list[str]] = None
    fix_version_id: Optional[int] = None
    component_ids: Optional[list[int]] = None


class JiraBulkIn(BaseModel):
    issue_keys: list[str] = Field(min_length=1, max_length=100)
    action: Literal["update", "delete", "archive", "unarchive"]
    patch: Optional[JiraBulkPatch] = None


class JiraCloneIn(BaseModel):
    include_subtasks: bool = False
    title_prefix: Optional[str] = Field(default=None, max_length=50)


class JiraMoveProjectIn(BaseModel):
    project_key: str
    column_id: Optional[int] = None
