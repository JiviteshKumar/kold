"""End-to-end outreach state machine with Gmail faked out: nothing is ever really sent."""
import secrets
from datetime import timedelta

import pytest
from sqlmodel import select

from kold.db import init_db, session_scope
from kold.models import Campaign, Contact, InboxMessage, Job, OutboxEmail, Profile, User, UserJob
from kold.services import gmail, outreach

PROFILE = {
    "name": "Test Person", "email": "test@example.com", "skills": ["Python", "SQL"],
    "experience": [{"title": "Data Intern", "company": "Acme Analytics", "bullets": ["Built 3 dashboards in Power BI"]}],
    "education": [{"degree": "B.Tech", "institution": "Test Institute", "end": "2026"}], "projects": [], "links": [],
    "experience_level": "student",
}


class FakeGmail:
    def __init__(self):
        self.sent = []
        self.thread = []
        self.fresh = []  # emails the company sent as a brand-new thread

    def messages_from(self, session, user, senders, after_ts, skip_ids):
        return [m for m in self.fresh if m["id"] not in skip_ids]

    def send(self, session, user, to, subject, body, attachment="", thread_id="", in_reply_to=""):
        self.sent.append({"to": to, "subject": subject, "thread_id": thread_id, "in_reply_to": in_reply_to, "attachment": attachment})
        return {"id": f"m{len(self.sent)}", "thread_id": thread_id or "t1", "message_id_header": f"<m{len(self.sent)}@mail>"}

    def thread_messages(self, session, user, thread_id):
        return self.thread


@pytest.fixture()
def world(monkeypatch):
    init_db()
    fake = FakeGmail()
    monkeypatch.setattr(gmail, "send", fake.send)
    monkeypatch.setattr(gmail, "thread_messages", fake.thread_messages)
    monkeypatch.setattr(gmail, "messages_from", fake.messages_from)
    with session_scope() as s:
        user = User(session_token=secrets.token_hex(8), name="Test Person", onboarded=True, gmail_email="me@example.com", timezone="Asia/Kolkata")
        s.add(user)
        s.commit()
        s.refresh(user)
        s.add(Profile(user_id=user.id, data=PROFILE, preferences={}))
        job = Job(fingerprint=secrets.token_hex(8), source="greenhouse", company="Acme", company_domain="acme.test",
                  title="Data Analyst Intern", location_raw="Bengaluru", region="india", description="Python SQL dashboards " * 30)
        s.add(job)
        s.commit()
        s.refresh(job)
        uj = UserJob(user_id=user.id, job_id=job.id, status="liked")
        contact = Contact(company_domain="acme.test", email="careers@acme.test", role_hint="recruiting", mx_ok=True, confidence="high")
        s.add(uj)
        s.add(contact)
        s.commit()
        s.refresh(uj)
        yield s, user, uj, fake


def reply(fake, mid, body, frm="hr@acme.test", subject="Re: Data Analyst Intern", headers=None):
    fake.thread.append({"id": mid, "thread_id": "t1", "from_email": frm, "from_name": "HR", "subject": subject, "snippet": body[:80],
                        "headers": headers or {}, "body": body, "internal_date": 1_790_000_000_000, "message_id_header": f"<{mid}@x>"})


def test_nothing_is_sent_without_approval_and_followups_thread(world):
    s, user, uj, fake = world
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    first = s.exec(select(OutboxEmail).where(OutboxEmail.campaign_id == camp.id)).one()
    assert first.status == "pending" and fake.sent == []  # drafted, waiting for the user
    assert first.attachment_path.endswith(".pdf")

    outreach.send_now(s, user, first)
    assert fake.sent[0]["to"] == "careers@acme.test" and fake.sent[0]["attachment"]
    s.refresh(camp)
    assert camp.steps_sent == 1 and camp.next_due == outreach.user_today(user) + timedelta(days=4)

    # Follow-up isn't drafted early...
    assert outreach.build_daily_queue(s, user) == 0
    # ...but is drafted (not sent) when due, in the same thread.
    camp.next_due = outreach.user_today(user)
    s.add(camp)
    s.commit()
    assert outreach.build_daily_queue(s, user) == 1
    fu = s.exec(select(OutboxEmail).where(OutboxEmail.campaign_id == camp.id, OutboxEmail.status == "pending")).one()
    assert fu.step == 1 and fu.subject.startswith("Re: ") and len(fake.sent) == 1
    outreach.send_now(s, user, fu)
    assert fake.sent[1]["thread_id"] == "t1" and fake.sent[1]["in_reply_to"] == "<m1@mail>"


def test_positive_reply_stops_followups(world):
    s, user, uj, fake = world
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    outreach.send_now(s, user, s.exec(select(OutboxEmail).where(OutboxEmail.campaign_id == camp.id)).one())
    camp.next_due = outreach.user_today(user)
    s.add(camp)
    s.commit()
    outreach.build_daily_queue(s, user)  # a follow-up draft is waiting
    reply(fake, "r1", "Thanks! Are you available for a call on Thursday?")
    assert outreach.check_replies(s, user) == 1
    s.refresh(camp)
    msg = s.exec(select(InboxMessage)).one()
    assert msg.label == "positive" and camp.status == "replied"
    assert all(o.status != "pending" for o in s.exec(select(OutboxEmail).where(OutboxEmail.campaign_id == camp.id)))
    assert s.get(UserJob, uj.id).status == "replied"
    assert outreach.check_replies(s, user) == 0  # idempotent


def test_annoyed_reply_pauses_and_asks(world):
    s, user, uj, fake = world
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    outreach.send_now(s, user, s.exec(select(OutboxEmail).where(OutboxEmail.campaign_id == camp.id)).one())
    reply(fake, "r2", "Please stop emailing me.")
    outreach.check_replies(s, user)
    s.refresh(camp)
    assert camp.status == "paused" and "decision" in camp.stop_reason
    with pytest.raises(ValueError):  # nothing more can go out while paused
        ob = OutboxEmail(user_id=user.id, campaign_id=camp.id, step=1, to_email="careers@acme.test", subject="x", body="y",
                         queue_date=outreach.user_today(user))
        s.add(ob)
        s.commit()
        outreach.send_now(s, user, ob)


def test_out_of_office_pauses_until_return(world):
    s, user, uj, fake = world
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    outreach.send_now(s, user, s.exec(select(OutboxEmail).where(OutboxEmail.campaign_id == camp.id)).one())
    reply(fake, "r3", "I am out of office with limited access to email.", subject="Automatic reply: Out of Office",
          headers={"auto-submitted": "auto-replied"})
    outreach.check_replies(s, user)
    s.refresh(camp)
    assert camp.status == "active" and camp.paused_until and camp.paused_until > outreach.user_today(user)


def test_bounce_stops_and_marks_contact(world):
    s, user, uj, fake = world
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    outreach.send_now(s, user, s.exec(select(OutboxEmail).where(OutboxEmail.campaign_id == camp.id)).one())
    reply(fake, "r4", "Address not found", frm="mailer-daemon@googlemail.com", subject="Delivery Status Notification (Failure)")
    outreach.check_replies(s, user)
    s.refresh(camp)
    assert camp.status == "stopped"
    assert s.get(Contact, camp.contact_id).mx_ok is False


def test_daily_limit(world, monkeypatch):
    s, user, uj, fake = world
    monkeypatch.setattr(outreach.settings, "max_cold_emails_per_day", 0)
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    with pytest.raises(ValueError, match="Daily limit"):
        outreach.send_now(s, user, s.exec(select(OutboxEmail).where(OutboxEmail.campaign_id == camp.id)).one())
    assert fake.sent == []


def test_own_messages_are_not_replies(world):
    s, user, uj, fake = world
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    outreach.send_now(s, user, s.exec(select(OutboxEmail).where(OutboxEmail.campaign_id == camp.id)).one())
    reply(fake, "mine", "my own sent email", frm="me@example.com")
    assert outreach.check_replies(s, user) == 0
    assert s.get(Campaign, camp.id).status == "active"
