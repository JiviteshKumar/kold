"""Trust scoring. Every point added or removed comes with a plain-English reason shown to the user."""
import re
from datetime import datetime

from ..models import utcnow

# Patterns are deliberately narrow: they must describe something asked *of the candidate*, so that real
# fintech postings that talk about "processing fees" or "OTP flows" are not flagged.
SCAM_PATTERNS = [
    (r"\b(candidates?|applicants?|you)\b.{0,40}\b(pay|deposit)\b.{0,30}\b(registration|training|joining|application|security|refundable)\s+(fee|deposit|amount|charges?)\b"
     r"|\b(registration|training|joining)\s+(fee|charges?)\s+of\s+(rs\.?|₹|inr|\$)", "Asks candidates to pay a fee. Real employers never do this."),
    (r"\b(contact|message|text|apply|reach)\b.{0,25}\b(on|via|through)\s+(whats ?app|telegram)\b", "Asks you to move to WhatsApp or Telegram."),
    (r"\bearn\s+(rs\.?|₹|\$)\s?\d[\d,]*\s?(per|/|a)\s?(day|hour)\b", "Promises fixed earnings per day or hour."),
    (r"\bno (experience|interview) (required|needed)\b.{0,60}\b(high|huge|guaranteed) (pay|income|salary)\b", "Promises high pay with no experience or interview."),
    (r"\b(share|send|provide|submit)\b.{0,20}\b(your )?(bank account (number|details)|aadhaar|pan card|otp)\b", "Asks for bank, Aadhaar, PAN or OTP details."),
    (r"\bguaranteed (job|placement)\b", "Promises a guaranteed job."),
]
FREE_MAIL = re.compile(r"[\w.+-]+@(gmail|yahoo|outlook|hotmail|rediffmail|proton)\.\w+", re.I)
EMPLOYER_BOARDS = {"greenhouse", "lever", "ashby", "smartrecruiters"}


def score(source: str, description: str, posted_at: datetime | None, company: str) -> tuple[int, list[dict]]:
    flags: list[dict] = []
    if source in EMPLOYER_BOARDS:
        s = 85
        flags.append({"level": "ok", "text": f"Posted by {company} on their own official careers board."})
    else:
        s = 70
        flags.append({"level": "ok", "text": "Listed on an established public jobs board. Check the company before applying."})

    text = description or ""
    if len(text) < 300:
        s -= 15
        flags.append({"level": "warn", "text": "Very short description, so there are few details to verify."})
    for pattern, reason in SCAM_PATTERNS:
        if re.search(pattern, text, re.I):
            s -= 35
            flags.append({"level": "bad", "text": reason})
    if FREE_MAIL.search(text):
        s -= 15
        flags.append({"level": "warn", "text": "Uses a personal email address (Gmail/Yahoo) instead of a company domain."})
    if posted_at:
        age = (utcnow() - posted_at).days
        if age > 60:
            s -= 10
            flags.append({"level": "warn", "text": f"Posted {age} days ago, so it may already be filled."})
        elif age <= 7:
            flags.append({"level": "ok", "text": "Fresh: posted in the last week."})
    return max(0, min(100, s)), flags
