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
