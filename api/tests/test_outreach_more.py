"""More outreach edge cases: scheduling, races, duplicates, stopped campaigns, reminders."""
import threading
from datetime import timedelta

import pytest
from sqlmodel import Session, select

from kold.db import engine
from kold.models import Campaign, InboxMessage, OutboxEmail, Reminder, UserJob, utcnow
from kold.services import outreach

from .test_outreach import reply, world  # noqa: F401  (fixture)


def first_draft(s, camp):
    return s.exec(select(OutboxEmail).where(OutboxEmail.campaign_id == camp.id, OutboxEmail.status == "pending")).one()


def test_scheduled_send_goes_out_when_due(world):
    s, user, uj, fake = world
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    ob = first_draft(s, camp)
    ob.status, ob.scheduled_for = "scheduled", utcnow() + timedelta(hours=3)
    s.add(ob)
    s.commit()
    outreach.send_due_scheduled(s)
    assert fake.sent == []  # not yet
    ob.scheduled_for = utcnow() - timedelta(minutes=1)
    s.add(ob)
    s.commit()
    outreach.send_due_scheduled(s)
    assert len(fake.sent) == 1 and s.get(OutboxEmail, ob.id).status == "sent"


def test_scheduled_send_for_paused_campaign_returns_to_review(world):
    s, user, uj, fake = world
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    ob = first_draft(s, camp)
    ob.status, ob.scheduled_for = "scheduled", utcnow() - timedelta(minutes=1)
    camp.status = "paused"
    s.add(ob)
    s.add(camp)
    s.commit()
    outreach.send_due_scheduled(s)
    s.refresh(ob)
    assert fake.sent == [] and ob.status == "pending" and "paused" in ob.error


def test_concurrent_sends_only_one_goes_out(world):
    s, user, uj, fake = world
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    oid = first_draft(s, camp).id
    unexpected = []

    def go():
        with Session(engine) as s2:
            try:
                outreach.send_now(s2, s2.get(type(user), user.id), s2.get(OutboxEmail, oid))
            except outreach.OutreachError:
                pass  # lost the race: correct
            except Exception as e:  # e.g. "database is locked" would be a real bug
                unexpected.append(repr(e))

    ts = [threading.Thread(target=go) for _ in range(5)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(fake.sent) == 1, fake.sent
    assert not unexpected, unexpected


def test_skipped_draft_cannot_be_sent(world):
    s, user, uj, fake = world
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    ob = first_draft(s, camp)
    ob.status = "skipped"
    s.add(ob)
    s.commit()
    with pytest.raises(ValueError):
        outreach.send_now(s, user, ob)
    assert fake.sent == []


def test_no_duplicate_sequences_to_same_inbox(world):
    s, user, uj, fake = world
    outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    other = UserJob(user_id=user.id, job_id=uj.job_id, status="liked")
    s.add(other)
    s.commit()
    with pytest.raises(outreach.OutreachError):
        outreach.start(s, user, other, "careers@acme.test", [4, 7], 2)


def test_reply_after_stop_is_recorded_but_stays_stopped(world):
    s, user, uj, fake = world
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    outreach.send_now(s, user, first_draft(s, camp))
    camp.status = "stopped"
    s.add(camp)
    s.commit()
    reply(fake, "late", "Sorry for the delay! Can we schedule a call next week?")
    assert outreach.check_replies(s, user) == 1
    s.refresh(camp)
    assert camp.status == "stopped"
    assert s.exec(select(InboxMessage).where(InboxMessage.campaign_id == camp.id)).one().label == "positive"


def test_reply_sent_from_gmail_marks_handled(world):
    s, user, uj, fake = world
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    outreach.send_now(s, user, first_draft(s, camp))
    reply(fake, "q1", "Thanks. What is your notice period and expected stipend?")
    outreach.check_replies(s, user)
    fake.thread.append({"id": "mine2", "thread_id": "t1", "from_email": "alias@other.com", "from_name": "", "subject": "Re: x",
                        "snippet": "", "headers": {}, "body": "Immediate joining, stipend flexible.", "label_ids": ["SENT"],
                        "internal_date": 1_790_000_100_000, "message_id_header": "<mine2@x>"})
    assert outreach.check_replies(s, user) == 0  # an alias send is still ours (Gmail's SENT label)
    m = s.exec(select(InboxMessage).where(InboxMessage.campaign_id == camp.id)).one()
    assert m.handled and m.reply_mode == "self"


def test_reminders_warn_then_alert_once(world):
    s, user, uj, fake = world
    r = Reminder(user_id=user.id, user_job_id=uj.id, title="Apply: test", due_at=utcnow() + timedelta(days=2, hours=12))
    s.add(r)
    s.commit()
    outreach.check_reminders(s, user)
    s.refresh(r)
    assert r.notified_stage == 1
    outreach.check_reminders(s, user)
    s.refresh(r)
    assert r.notified_stage == 1  # no repeat
    r.due_at = utcnow() + timedelta(hours=5)
    s.add(r)
    s.commit()
    outreach.check_reminders(s, user)
    s.refresh(r)
    assert r.notified_stage == 2


def test_followup_not_drafted_for_stopped_or_completed(world):
    s, user, uj, fake = world
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    outreach.send_now(s, user, first_draft(s, camp))
    camp.status, camp.next_due = "stopped", outreach.user_today(user)
    s.add(camp)
    s.commit()
    assert outreach.build_daily_queue(s, user) == 0
    assert outreach.draft_step(s, user, s.get(Campaign, camp.id)) is None


def fresh(fake, mid, frm, subject, body, headers=None):
    fake.fresh.append({"id": mid, "thread_id": f"new-{mid}", "from_email": frm, "from_name": "Someone", "subject": subject,
                       "snippet": body[:80], "headers": headers or {}, "body": body, "label_ids": ["INBOX"],
                       "internal_date": 1_790_000_200_000, "message_id_header": f"<{mid}@x>"})


def test_reply_in_a_brand_new_email_is_caught(world):
    s, user, uj, fake = world
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    outreach.send_now(s, user, first_draft(s, camp))
    fresh(fake, "n1", "careers@acme.test", "Interview availability", "Hi Test, we'd like to schedule an interview. Are you free Monday?")
    assert outreach.check_replies(s, user) == 1
    m = s.exec(select(InboxMessage).where(InboxMessage.gmail_message_id == "n1")).one()
    assert m.new_thread and m.label == "positive" and m.thread_id == "new-n1"
    assert s.get(Campaign, camp.id).status == "replied"


def test_colleague_at_same_company_about_application_is_caught(world):
    s, user, uj, fake = world
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    outreach.send_now(s, user, first_draft(s, camp))
    fresh(fake, "n2", "rahul.k@acme.test", "Following up", "Hi Test, my colleague forwarded your resume. Can we chat this week?")
    assert outreach.check_replies(s, user) == 1


def test_company_newsletters_and_unrelated_mail_are_ignored(world):
    s, user, uj, fake = world
    camp = outreach.start(s, user, uj, "careers@acme.test", [4, 7], 2)
    outreach.send_now(s, user, first_draft(s, camp))
    fresh(fake, "n3", "news@acme.test", "Acme product update", "Our new release is here!", {"list-unsubscribe": "<mailto:x>"})
    fresh(fake, "n4", "no-reply@acme.test", "Your invoice", "Invoice #123 attached.")
    fresh(fake, "n5", "sales@acme.test", "Quick question", "Would your company like a demo of our analytics suite?")
    assert outreach.check_replies(s, user) == 0
    assert outreach.check_replies(s, user) == 0  # and they aren't re-examined every poll
