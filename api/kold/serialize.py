"""Shapes rows into the JSON the app renders."""
import re

from .models import Campaign, InboxMessage, Job, OutboxEmail, UserJob

TYPE_LABEL = {"internship": "Internship", "full_time": "Full-time", "part_time": "Part-time", "contract": "Contract"}


def job_card(job: Job, uj: UserJob | None = None, full: bool = False) -> dict:
    d = {
        "id": job.id, "company": job.company, "company_domain": job.company_domain, "title": job.title,
        "department": job.department, "location": job.location_raw, "workplace": job.workplace, "region": job.region,
        "open_to_india": job.open_to_india, "job_type": job.job_type, "job_type_label": TYPE_LABEL.get(job.job_type, job.job_type),
        "seniority": job.seniority, "url": job.url, "apply_url": job.apply_url, "source": job.source,
        "source_label": job.source_label, "source_url": job.source_url,
        "posted_at": job.posted_at.isoformat() + "Z" if job.posted_at else None,
        "deadline": job.deadline.isoformat() + "Z" if job.deadline else None,
        "salary": job.salary_text, "tags": job.tags[:8], "trust_score": job.trust_score, "trust_flags": job.trust_flags,
        "active": job.active, "summary": _summary(job.description),
    }
    if full:
        d["description"] = job.description
    if uj:
        d.update({"user_job_id": uj.id, "status": uj.status, "match_score": uj.match_score, "match_reasons": uj.match_reasons,
                  "notes": uj.notes, "my_deadline": uj.deadline.isoformat() + "Z" if uj.deadline else d["deadline"],
                  "updated_at": uj.updated_at.isoformat() + "Z"})
    return d


ROLE_HEADING = re.compile(
    r"^\s*(what you('|’)ll do|what you will do|what you'll be doing|responsibilities|key responsibilities|"
    r"the role|about the role|role overview|your role|in this role|the opportunity|job description|what we('|’)re looking for)\b.*$",
    re.I | re.M)


def _summary(desc: str) -> str:
    """The role itself, not the company's 'About us' boilerplate: start at 'What you'll do' etc. when present."""
    desc = desc or ""
    m = ROLE_HEADING.search(desc)
    if m and m.start() < len(desc) - 120:
        desc = desc[m.end():]
    paras = [p.strip() for p in desc.split("\n") if len(p.strip()) > 40]
    pick = [p for p in paras if not p.lower().startswith(("about ", "who we are", "our mission"))] or paras
    out = " ".join(pick[:2])
    return out[:320] + ("…" if len(out) > 320 else "")


def outbox(ob: OutboxEmail, job: Job, camp: Campaign, tz: str) -> dict:
    return {
        "id": ob.id, "campaign_id": ob.campaign_id, "step": ob.step, "to": ob.to_email, "subject": ob.subject, "body": ob.body,
        "attachment": ob.attachment_path.replace("\\", "/").split("/")[-1] if ob.attachment_path else "",
        "status": ob.status, "queue_date": ob.queue_date.isoformat(),
        "recommended_send_at": ob.recommended_send_at.isoformat() + "Z" if ob.recommended_send_at else None,
        "recipient_tz": tz, "scheduled_for": ob.scheduled_for.isoformat() + "Z" if ob.scheduled_for else None,
        "sent_at": ob.sent_at.isoformat() + "Z" if ob.sent_at else None, "error": ob.error, "quality": ob.quality,
        "generated_by": ob.generated_by, "company": job.company, "job_title": job.title, "job_id": job.id,
        "user_job_id": camp.user_job_id, "max_followups": camp.max_followups,
    }


def inbox(m: InboxMessage, job: Job, camp: Campaign) -> dict:
    return {
        "id": m.id, "campaign_id": m.campaign_id, "campaign_status": camp.status, "from_email": m.from_email,
        "from_name": m.from_name, "subject": m.subject, "snippet": m.snippet, "body": m.body,
        "received_at": m.received_at.isoformat() + "Z", "label": m.label, "confidence": m.label_confidence,
        "label_source": m.label_source, "label_reason": m.label_reason,
        "return_date": m.return_date.isoformat() if m.return_date else None, "handled": m.handled,
        "reply_mode": m.reply_mode, "suggested_reply": m.suggested_reply, "company": job.company,
        "job_title": job.title, "job_id": job.id, "user_job_id": camp.user_job_id, "thread_url": f"https://mail.google.com/mail/u/0/#all/{m.thread_id}",
    }
