"""Database tables. Every automated action Kold takes is traceable through these rows (see Activity).

All datetimes are stored as naive UTC (NaiveDatetime)."""
from datetime import date, datetime, timezone
from typing import Any, Optional

from pydantic import NaiveDatetime
from sqlalchemy import JSON, Column, Text
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def JSONField(default: Any = None) -> Any:
    factory = (lambda: type(default)()) if isinstance(default, (list, dict)) else (lambda: default)
    return Field(default_factory=factory, sa_column=Column(JSON))


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = ""
    email: str = Field(default="", index=True)
    session_token: str = Field(index=True, unique=True)
    timezone: str = "Asia/Kolkata"
    onboarded: bool = False
    gmail_email: str = ""
    gmail_token: dict = JSONField({})
    created_at: NaiveDatetime = Field(default_factory=utcnow)


class Profile(SQLModel, table=True):
    user_id: int = Field(foreign_key="user.id", primary_key=True)
    data: dict = JSONField({})
    preferences: dict = JSONField({})
    updated_at: NaiveDatetime = Field(default_factory=utcnow)


class Resume(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    filename: str
    path: str
    text: str = Field(default="", sa_column=Column(Text))
    uploaded_at: NaiveDatetime = Field(default_factory=utcnow)


class Job(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    fingerprint: str = Field(index=True, unique=True)
    source: str = Field(index=True)          # greenhouse | lever | ashby | remotive | remoteok | himalayas | arbeitnow
    source_label: str = ""                   # human readable, e.g. "Groww's official careers board (Greenhouse)"
    source_url: str = ""                     # attribution link back to where we found it
    external_id: str = ""
    company: str = Field(index=True)
    company_domain: str = ""
    title: str
    department: str = ""
    location_raw: str = ""
    workplace: str = "onsite"                # onsite | hybrid | remote
    region: str = "unknown"                  # india | global_remote | abroad | unknown
    open_to_india: bool = False
    job_type: str = "full_time"              # internship | full_time | part_time | contract
    seniority: str = ""                      # intern | entry | mid | senior | lead
    description: str = Field(default="", sa_column=Column(Text))
    url: str = ""
    apply_url: str = ""
    posted_at: Optional[NaiveDatetime] = None
    deadline: Optional[NaiveDatetime] = None
    salary_text: str = ""
    tags: list = JSONField([])
    trust_score: int = 0
    trust_flags: list = JSONField([])
    active: bool = True
    first_seen: NaiveDatetime = Field(default_factory=utcnow)
    last_seen: NaiveDatetime = Field(default_factory=utcnow)


class UserJob(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    job_id: int = Field(foreign_key="job.id", index=True)
    # new -> liked | passed ; liked -> applied | reaching_out -> replied -> interview -> offer | rejected
    status: str = Field(default="new", index=True)
    match_score: int = 0
    match_reasons: list = JSONField([])
    deadline: Optional[NaiveDatetime] = None
    notes: str = ""
    created_at: NaiveDatetime = Field(default_factory=utcnow)
    updated_at: NaiveDatetime = Field(default_factory=utcnow)


class Contact(SQLModel, table=True):
    """Published addresses (user_id is None) are public facts shared by everyone.
    Addresses a user typed in are private to that user (user_id set)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, index=True)
    user_job_id: Optional[int] = Field(default=None, index=True)
    company_domain: str = Field(index=True)
    email: str = Field(index=True)
    name: str = ""
    role_hint: str = ""          # recruiting | founder | general | user-added
    source_url: str = ""         # the exact page the address was published on
    confidence: str = "medium"   # high | medium | user
    mx_ok: bool = False
    bounced: bool = False        # a real email to it bounced: never offer it again
    found_at: NaiveDatetime = Field(default_factory=utcnow)


class TailoredResume(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    job_id: int = Field(foreign_key="job.id", index=True)
    data: dict = JSONField({})
    changes: list = JSONField([])  # human readable list of what was changed and why
    pdf_path: str = ""
    created_at: NaiveDatetime = Field(default_factory=utcnow)


class Campaign(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    user_job_id: int = Field(foreign_key="userjob.id", index=True)
    contact_id: Optional[int] = Field(default=None, foreign_key="contact.id")
    to_email: str
    status: str = Field(default="active", index=True)  # active | paused | stopped | replied | completed
    gaps: list = JSONField([])
    max_followups: int = 2
    steps_sent: int = 0
    thread_id: str = ""
    last_message_id_header: str = ""
    first_subject: str = ""
    next_due: Optional[date] = None
    paused_until: Optional[date] = None
    stop_reason: str = ""
    tailored_resume_id: Optional[int] = Field(default=None, foreign_key="tailoredresume.id")
    created_at: NaiveDatetime = Field(default_factory=utcnow)


class OutboxEmail(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    campaign_id: int = Field(foreign_key="campaign.id", index=True)
    step: int = 0                 # 0 = first email, 1.. = follow-ups
    to_email: str
    subject: str
    body: str = Field(sa_column=Column(Text))
    attachment_path: str = ""
    queue_date: date = Field(index=True)
    # pending (awaiting the user's decision) | scheduled | sent | skipped | failed
    status: str = Field(default="pending", index=True)
    recommended_send_at: Optional[NaiveDatetime] = None   # UTC; recipient's local morning
    scheduled_for: Optional[NaiveDatetime] = None         # UTC; set only if the user picks "send at best time"
    sent_at: Optional[NaiveDatetime] = None
    gmail_message_id: str = ""
    error: str = ""
    quality: dict = JSONField({})
    generated_by: str = ""        # "local-model:<name>" or "template"
    created_at: NaiveDatetime = Field(default_factory=utcnow)


class InboxMessage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    campaign_id: int = Field(foreign_key="campaign.id", index=True)
    gmail_message_id: str = Field(index=True)  # unique per mailbox (user), not globally
    thread_id: str = ""
    new_thread: bool = False     # they wrote a fresh email instead of replying in our thread
    message_id_header: str = ""
    from_email: str = ""
    from_name: str = ""
    subject: str = ""
    snippet: str = ""
    body: str = Field(default="", sa_column=Column(Text))
    received_at: NaiveDatetime = Field(default_factory=utcnow)
    # positive | question | not_now | negative | annoyed | auto_reply | out_of_office | bounce
    label: str = ""
    label_confidence: float = 0.0
    label_source: str = ""        # rules | model | local-llm | user
    label_reason: str = ""
    return_date: Optional[date] = None
    handled: bool = False
    reply_mode: str = ""          # self | assisted
    suggested_reply: str = Field(default="", sa_column=Column(Text))


class SentReply(SQLModel, table=True):
    """A reply the user sent in a conversation (through Kold, or themselves from Gmail): keeps the thread complete."""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    campaign_id: int = Field(foreign_key="campaign.id", index=True)
    gmail_message_id: str = Field(default="", index=True)
    thread_id: str = ""
    to_email: str = ""
    subject: str = ""
    body: str = Field(default="", sa_column=Column(Text))
    sent_at: NaiveDatetime = Field(default_factory=utcnow)
    via: str = "kold"  # kold | gmail


class Reminder(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    user_job_id: Optional[int] = Field(default=None, foreign_key="userjob.id")
    kind: str = "deadline"   # deadline | custom | interview
    title: str
    due_at: NaiveDatetime
    done: bool = False
    notified_stage: int = 0  # 0 none, 1 = 3-day warning sent, 2 = day-of sent


class Activity(SQLModel, table=True):
    """The transparency log: one row for everything Kold does on the user's behalf."""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    at: NaiveDatetime = Field(default_factory=utcnow, index=True)
    kind: str            # crawl | match | contact | draft | send | reply | pause | stop | reminder | profile | gmail
    message: str
    ref: dict = JSONField({})
    seen: bool = False


class PushSubscription(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    endpoint: str = Field(unique=True)
    data: dict = JSONField({})


class CrawlRun(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    started_at: NaiveDatetime = Field(default_factory=utcnow)
    finished_at: Optional[NaiveDatetime] = None
    stats: dict = JSONField({})
    new_jobs: int = 0
    closed_jobs: int = 0
