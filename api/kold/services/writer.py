"""Writes cold emails, follow-ups and reply drafts with the local model.

The prompt encodes proven cold-outreach practice: short, specific, one clear ask, grounded only in
facts from the user's resume. If the local model is offline we use a clear template instead and label it.
"""
import json
import re

from .. import llm
from ..models import Job
from .quality import unsupported_claims

EMAIL_SCHEMA = {
    "type": "object",
    "properties": {"subject": {"type": "string"}, "body": {"type": "string"}},
    "required": ["subject", "body"],
}

SYSTEM = """You are an expert at job-search cold outreach. You write emails that busy hiring managers actually answer.

Rules you never break:
- Use ONLY facts present in the candidate profile. Never invent experience, numbers, employers, skills or links.
- Plain text. No emoji, no markdown, no exclamation-heavy tone, no flattery clichés.
- Never write "I hope this email finds you well", "To whom it may concern", "Dear Sir/Madam".
- Subject: 3 to 8 words, specific to the role, no clickbait, no ALL CAPS.
- One clear, low-friction ask (a short call, or consideration for the role, or a pointer to the right person).
- Sign off with the candidate's name and at most two links from the profile.

First email (90 to 150 words): open with why this specific company and role; give the 1 to 2 most relevant
accomplishments from the profile, matched to the job description; mention the resume is attached; make the ask.
Every email starts with a short greeting line (e.g. "Hi <Company> team,") and ends with the candidate's name.
Never merge separate facts into one (an award and a project stay separate unless the profile links them).
Follow-up 1 (40 to 70 words): reply in the same thread; add one new, relevant point from the profile; polite, no guilt.
Final follow-up (30 to 50 words): close the loop gracefully; ask if someone else is the right person; no pressure."""


def _profile_brief(profile: dict) -> str:
    keep = {k: profile.get(k) for k in ("name", "headline", "summary", "skills", "experience", "projects", "education", "achievements", "links")}
    return json.dumps(keep, ensure_ascii=False)[:6000]


def _job_brief(job: Job) -> str:
    return (f"Company: {job.company}\nRole: {job.title}\nLocation: {job.location_raw} ({job.workplace})\n"
            f"Team: {job.department}\nJob description (excerpt):\n{job.description[:3500]}")


def _clean(d: dict) -> tuple[str, str]:
    """Repair the common small-model failure of putting the whole email in the subject field."""
    subject, body = (d.get("subject") or "").strip(), (d.get("body") or "").strip()
    if "\n" in subject:
        first, rest = subject.split("\n", 1)
        subject, body = first.strip(), rest.strip() if len(rest.split()) > len(body.split()) else body
    body = re.sub(r"\n\s*[}\]]\s*\n.*$", "", body, flags=re.S).strip()  # stray JSON / commentary after the sign-off
    return subject.removeprefix("Subject:").strip(), body


def signed(body: str, profile: dict) -> str:
    """Make sure every email ends with the candidate's name."""
    name = (profile.get("name") or "").strip()
    if name and name.lower() not in body[-200:].lower():
        body = body.rstrip() + f"\n\n{name}"
    return body


def support_text(profile: dict, job: Job) -> str:
    """What the email is allowed to claim: the user's resume, plus the role it's about."""
    return json.dumps(profile, ensure_ascii=False) + f" {job.title} {job.department} {job.company} {job.location_raw}"


def grounded(text: str, profile: dict, job: Job) -> bool:
    """Every number in the email must come from the profile or the job posting: no invented metrics."""
    allowed = set(re.findall(r"\d+", json.dumps(profile) + job.title + job.description))
    return set(re.findall(r"\d+", text)) <= allowed


def first_email(profile: dict, job: Job, recipient_role: str) -> tuple[str, str, str]:
    to_whom = {"recruiting": "the company's recruiting/careers inbox", "person": "a person at the company",
               "general": "the company's general inbox (ask them to forward to the hiring team)"}.get(recipient_role, "the company")
    prompt = (f"Write the FIRST cold email. It goes to {to_whom}. Put ONLY the subject line in 'subject' and the full "
              f"email in 'body'. Write numbers as digits exactly as they appear in the profile.\n\nJOB:\n{_job_brief(job)}\n\n"
              f"CANDIDATE PROFILE (only source of facts):\n{_profile_brief(profile)}")
    best = None
    for attempt in range(3):
        try:
            subject, body = _clean(llm.generate_json(SYSTEM, prompt, EMAIL_SCHEMA, temperature=0.4 + 0.2 * attempt))
        except (llm.LLMUnavailable, KeyError):
            break
        if not (subject and 40 <= len(body.split()) <= 220 and grounded(subject + body, profile, job)):
            continue
        claims = len(unsupported_claims(body, support_text(profile, job)))
        if best is None or claims < best[0]:
            best = (claims, subject, body)
        if claims == 0:
            break
    if best:
        # Any remaining unsupported sentence is flagged to the user by the pre-send check.
        return best[1], signed(best[2], profile), llm.model_label()
    return _template_first(profile, job)


def follow_up(profile: dict, job: Job, step: int, max_followups: int, previous: list[str]) -> tuple[str, str]:
    kind = "Final follow-up" if step >= max_followups else "Follow-up 1"
    prompt = (f"Write the {kind}. It is sent in the same thread, so no subject is needed (return the empty string).\n\n"
              f"JOB:\n{_job_brief(job)}\n\nEMAILS ALREADY SENT (do not repeat their points):\n" + "\n---\n".join(previous)
              + f"\n\nCANDIDATE PROFILE:\n{_profile_brief(profile)}")
    for attempt in range(3):
        try:
            subject, body = _clean(llm.generate_json(SYSTEM, prompt, EMAIL_SCHEMA, temperature=0.4 + 0.2 * attempt))
        except (llm.LLMUnavailable, KeyError):
            break
        body = body or subject
        if (15 <= len(body.split()) <= 120 and grounded(body, profile, job)
                and not unsupported_claims(body, support_text(profile, job))):
            return signed(body, profile), llm.model_label()
    name = profile.get("name", "")
    if step >= max_followups:
        return (f"Hi,\n\nClosing the loop on my note about the {job.title} role. If someone else at {job.company} "
                f"handles this, I'd be grateful for a pointer. Thanks for your time.\n\n{name}"), "template"
    return (f"Hi,\n\nFollowing up on my email about the {job.title} role at {job.company}. My resume is attached "
            f"there. Happy to share more if it's useful.\n\nThanks,\n{name}"), "template"


REPLY_SYSTEM = """You help a job seeker reply to a company that answered their outreach.
Rules: use ONLY facts from the candidate profile and the thread. Never invent availability, salary numbers,
notice periods or experience. Where the candidate must supply something you don't know, write a short
placeholder in square brackets like [your availability this week]; the user will fill it in.
Plain text, warm, concise (40 to 120 words), professional. Answer every question they asked. Sign with the candidate's name."""


def draft_reply(profile: dict, job: Job, thread: list[dict], label: str) -> tuple[str, str]:
    convo = "\n\n".join(f"FROM {m['from']}:\n{m['body'][:2000]}" for m in thread[-6:])
    goal = {
        "positive": "They are interested. Thank them and move toward the next step (call/interview).",
        "question": "They asked questions. Answer them directly.",
        "not_now": "They said not right now. Thank them graciously and ask to stay in touch.",
        "negative": "They declined. Thank them graciously in 2 to 3 sentences. No pushback.",
        "annoyed": "They are unhappy about being contacted. Apologize briefly, confirm you'll stop. 1 to 2 sentences.",
    }.get(label, "Reply helpfully.")
    prompt = f"GOAL: {goal}\n\nJOB: {job.title} at {job.company}\n\nTHREAD (latest last):\n{convo}\n\nCANDIDATE PROFILE:\n{_profile_brief(profile)}"
    try:
        return llm.generate(REPLY_SYSTEM, prompt, temperature=0.4).strip(), llm.model_label()
    except llm.LLMUnavailable:
        name = profile.get("name", "")
        return f"Hi,\n\nThank you for getting back to me about the {job.title} role. [your reply]\n\nBest,\n{name}", "template"


def _template_first(profile: dict, job: Job) -> tuple[str, str, str]:
    name = profile.get("name", "")
    skills = ", ".join((profile.get("skills") or [])[:3])
    exp = (profile.get("experience") or [{}])[0]
    proj = (profile.get("projects") or [{}])[0]
    highlight = (exp.get("bullets") or [None])[0] or proj.get("description") or ""
    links = "\n".join((profile.get("links") or [])[:2])
    body = (
        f"Hi {job.company} team,\n\n"
        f"I'm writing about the {job.title} role. "
        + (f"I work with {skills}" + (", and most recently: " + highlight.rstrip(".") + "." if highlight else ".") if skills else "")
        + f"\n\nI've attached my resume. Would you be open to a short call, or could you point me to the right person on the hiring team?\n\n"
        f"Thanks,\n{name}\n{links}"
    ).strip()
    return f"{job.title} at {job.company}: {name}".strip(": "), body, "template"
