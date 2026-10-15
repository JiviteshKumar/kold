"""Explainable matching of jobs to a user's profile and preferences.

Every score comes with the reasons behind it so the user always knows *why* a card is in their deck.
"""
import re
from datetime import timedelta

from sqlmodel import Session, select

from ..models import Job, Profile, UserJob, utcnow

MIN_SCORE = 30
MIN_TRUST = 45

LEVEL_FIT = {
    "student": {"intern": 1.0, "entry": 0.7, "mid": 0.0, "senior": 0.0, "lead": 0.0},
    "fresher": {"intern": 0.8, "entry": 1.0, "mid": 0.4, "senior": 0.0, "lead": 0.0},
    "1-3": {"intern": 0.2, "entry": 1.0, "mid": 1.0, "senior": 0.2, "lead": 0.0},
    "3-5": {"intern": 0.0, "entry": 0.4, "mid": 1.0, "senior": 0.9, "lead": 0.3},
    "5+": {"intern": 0.0, "entry": 0.1, "mid": 0.7, "senior": 1.0, "lead": 1.0},
}
TYPE_LABEL = {"internship": "Internship", "full_time": "Full-time", "part_time": "Part-time", "contract": "Contract"}


# Role families: a user who wants "Data Analyst" should also see "Analytics Intern" or "BI Associate".
ROLE_FAMILIES: list[tuple[str, list[str]]] = [
    (r"data analy|business analy|analytics|\bbi\b|business intelligence", ["data analyst", "business analyst", "product analyst", "analytics", "business intelligence", "bi analyst", "bi developer", "insights analyst", "reporting analyst", "data analysis"]),
    (r"data scien|machine learning|\bml\b|\bai\b|deep learning|nlp|computer vision", ["machine learning", "ml", "ai", "data scientist", "data science", "applied scientist", "deep learning", "nlp", "computer vision", "llm"]),
    (r"data engineer", ["data engineer", "data platform", "etl", "analytics engineer"]),
    (r"back-?end|server|api", ["backend", "back-end", "back end", "software engineer", "sde", "software developer", "platform engineer", "api"]),
    (r"front-?end|ui engineer|web dev", ["frontend", "front-end", "front end", "ui engineer", "web developer", "web engineer"]),
    (r"full-?stack", ["full stack", "full-stack", "fullstack", "software engineer", "web developer", "sde"]),
    (r"software (engineer|developer)|\bsde\b|programmer", ["software engineer", "software developer", "sde", "developer", "engineer"]),
    (r"android|ios|mobile|flutter", ["android", "ios", "mobile", "flutter", "react native"]),
    (r"devops|\bsre\b|site reliability|cloud|infra", ["devops", "sre", "site reliability", "cloud", "infrastructure", "platform"]),
    (r"design|\bux\b|\bui\b", ["designer", "design", "ux", "ui", "visual"]),
    (r"product manag|\bapm\b|\bpm\b", ["product manager", "product management", "apm", "product owner", "product"]),
    (r"marketing|growth|seo|content|social media|brand", ["marketing", "growth", "seo", "content", "social media", "brand", "community"]),
    (r"sales|business development|account exec|\bsdr\b|\bbdr\b", ["sales", "business development", "account executive", "sdr", "bdr", "account manager"]),
    (r"recruit|talent|\bhr\b|human resources|people", ["recruiter", "recruiting", "talent", "hr", "people"]),
    (r"financ|account|audit|fp&a", ["finance", "accounting", "accountant", "audit", "fp&a", "treasury"]),
    (r"operation|supply chain|logistics", ["operations", "ops", "supply chain", "logistics"]),
    (r"support|customer success|customer experience", ["support", "customer success", "customer experience"]),
    (r"\bqa\b|quality|test|sdet", ["qa", "quality", "test", "sdet"]),
    (r"security|cyber", ["security", "cyber", "appsec"]),
]


# A family match ("Related to ...") is refused when the title is plainly another function the user never asked for,
# so a Data Analyst is not shown "Benefits Analyst" and an ML engineer is not shown "Marketing AI Engineer".
OTHER_FUNCTIONS = ["benefits", "payable", "receivable", "payroll", "accounting", "tax", "legal", "marketing", "sales",
                   "recruit", "recruiting", "talent", "procurement", "credit", "compliance", "facilities", "clinical"]


def _other_function(role: str, title: str) -> bool:
    return any(_term_re(w).search(title) and not _term_re(w).search(role) for w in OTHER_FUNCTIONS)


def role_match(roles: list[str], title: str) -> tuple[int, str]:
    """(points, which role matched). Exact role in title = 40; same role family = 25."""
    for r in roles:
        if _term_re(r).search(title):
            return 40, r
    for r in roles:
        words = [w for w in re.findall(r"[a-z0-9+#]+", r.lower()) if len(w) > 2]
        if words and all(_term_re(w).search(title) for w in words):
            return 32, r
    for r in roles:
        for family, terms in ROLE_FAMILIES:
            if re.search(family, r, re.I) and any(_term_re(t).search(title) for t in terms) and not _other_function(r, title):
                return 25, r
    return 0, ""


def _term_re(term: str) -> re.Pattern:
    esc = re.escape(term.strip().lower())
    return re.compile(rf"(?<![a-z0-9+#]){esc}(?![a-z0-9+#])", re.I)


def location_ok(job: Job, prefs: dict) -> tuple[bool, str]:
    cities = [c.lower() for c in prefs.get("cities") or []]
    want_onsite = prefs.get("onsite_india", True)
    want_remote_in = prefs.get("remote_india", True)
    want_remote_global = prefs.get("remote_global", True)
    if job.workplace == "remote":
        if job.region == "india" and want_remote_in:
            return True, "Remote, based in India"
        if job.open_to_india and want_remote_global:
            return True, "Remote and open to candidates in India"
        if job.region == "unknown" and want_remote_global and prefs.get("include_unclear_remote", False):
            return True, "Remote (India eligibility not stated)"
        return False, ""
    if job.region == "india" and want_onsite:
        loc = job.location_raw.lower()
        if not cities or any(c in loc for c in cities):
            label = "Hybrid" if job.workplace == "hybrid" else "On-site"
            return True, f"{label} in {job.location_raw}"
    return False, ""


def score_job(job: Job, profile: dict, prefs: dict) -> tuple[int, list[str]] | None:
    """Return (score 0–100, reasons) or None if the job fails a hard filter."""
    if job.trust_score < MIN_TRUST:
        return None
    if any(c.lower() == job.company.lower() for c in prefs.get("exclude_companies") or []):
        return None
    types = prefs.get("job_types") or []
    if types and job.job_type not in types:
        return None
    ok, loc_reason = location_ok(job, prefs)
    if not ok:
        return None
    level = prefs.get("experience_level") or ""
    # Unstated seniority: allowed, but scores lower than a confirmed fit.
    fit = LEVEL_FIT.get(level, {}).get(job.seniority, 0.5) if job.seniority else 0.5
    if level and fit == 0.0:
        return None
    exclude = [w for w in prefs.get("exclude_keywords") or [] if w.strip()]
    title_low = job.title.lower()
    if any(_term_re(w).search(title_low) for w in exclude):
        return None

    reasons: list[str] = []
    haystack = f"{job.title}\n{job.department}\n{' '.join(job.tags or [])}\n{job.description}"

    roles = [r for r in prefs.get("roles") or [] if r.strip()]
    role_pts, role = role_match(roles, job.title)
    if role:
        reasons.append(f"Title matches “{role}”" if role_pts >= 32 else f"Related to “{role}”")
    elif roles:
        # The user named roles and this title matches none of them. Allow only very strong skill matches.
        role_pts = -15

    skills = [s for s in profile.get("skills") or [] if s and len(s) <= 40]
    hits = [s for s in skills if _term_re(s).search(haystack)]
    skill_pts = min(35, len(hits) * 7)
    if hits:
        reasons.append("Your skills appear in it: " + ", ".join(hits[:6]))

    level_pts = round(15 * fit)
    if level and job.seniority and fit >= 0.7:
        reasons.append(f"Fits your experience level ({job.seniority})")

    fresh_pts = 0
    if job.posted_at and job.posted_at > utcnow() - timedelta(days=10):
        fresh_pts = 10
        reasons.append("Posted in the last 10 days")

    reasons.append(loc_reason)
    if types:
        reasons.append(f"{TYPE_LABEL.get(job.job_type, job.job_type)}, as you asked")

    total = max(0, min(100, role_pts + skill_pts + level_pts + fresh_pts))
    if not roles and not hits:
        return None
    return total, reasons


def build_feed(session: Session, user_id: int) -> int:
    """Score every active job the user hasn't seen yet. Returns how many new cards were added."""
    profile = session.get(Profile, user_id)
    if not profile:
        return 0
    seen_ids = set(session.exec(select(UserJob.job_id).where(UserJob.user_id == user_id)))
    added = 0
    for job in session.exec(select(Job).where(Job.active == True)):  # noqa: E712
        if job.id in seen_ids:
            continue
        result = score_job(job, profile.data, profile.preferences)
        if not result or result[0] < MIN_SCORE:
            continue
        s, reasons = result
        session.add(UserJob(user_id=user_id, job_id=job.id, match_score=s, match_reasons=reasons, deadline=job.deadline))
        added += 1
    session.commit()
    return added


def rescore_new(session: Session, user_id: int) -> None:
    """After preferences change, drop unswiped cards that no longer fit and rebuild the deck."""
    for uj in session.exec(select(UserJob).where(UserJob.user_id == user_id, UserJob.status == "new")):
        session.delete(uj)
    session.commit()
    build_feed(session, user_id)
