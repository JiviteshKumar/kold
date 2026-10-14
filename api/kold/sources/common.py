"""Shared helpers for turning raw postings from any source into one normalized shape."""
import hashlib
import html
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

from bs4 import BeautifulSoup
from dateutil import parser as dateparser


@dataclass
class RawJob:
    source: str
    source_label: str
    source_url: str
    external_id: str
    company: str
    title: str
    url: str
    apply_url: str = ""
    company_domain: str = ""
    department: str = ""
    location: str = ""
    remote_flag: bool | None = None
    workplace_hint: str = ""
    restrictions: list[str] = field(default_factory=list)
    tz_offsets: list[float] = field(default_factory=list)
    country: str = ""
    commitment: str = ""
    description: str = ""
    posted_at: datetime | None = None
    deadline: datetime | None = None
    salary_text: str = ""
    tags: list[str] = field(default_factory=list)

    @property
    def fingerprint(self) -> str:
        return hashlib.sha1(f"{self.source}:{self.company}:{self.external_id}".encode()).hexdigest()


def html_to_text(raw: str, limit: int = 20000) -> str:
    if not raw:
        return ""
    soup = BeautifulSoup(html.unescape(raw), "html.parser")
    for br in soup.find_all(["br"]):
        br.replace_with("\n")
    for block in soup.find_all(["p", "li", "div", "h1", "h2", "h3", "h4"]):
        block.insert_after("\n")
    text = soup.get_text()
    text = re.sub(r"[ \t\xa0]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()[:limit]


def parse_dt(value) -> datetime | None:
    if value in (None, "", 0):
        return None
    try:
        if isinstance(value, (int, float)) or (isinstance(value, str) and value.isdigit()):
            v = float(value)
            if v > 1e12:  # milliseconds
                v /= 1000
            return datetime.fromtimestamp(v, tz=timezone.utc).replace(tzinfo=None)
        dt = dateparser.parse(str(value))
        if dt.tzinfo:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except (ValueError, OverflowError, TypeError):
        return None


def job_type(title: str, commitment: str = "") -> str:
    text = f"{title} {commitment}".lower()
    if re.search(r"\bintern(ship)?s?\b|\bapprentice", text):
        return "internship"
    if re.search(r"part[- ]?time", text):
        return "part_time"
    if re.search(r"\bcontract(or)?\b|freelance|temporary|\btemp\b", text):
        return "contract"
    return "full_time"


YEARS = re.compile(r"(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*(?:\d{1,2})?\s*\+?\s*(?:years|yrs)(?:'|’)?\s*(?:of)?\s*(?:[\w-]+\s){0,4}?(?:experience|exp\b)", re.I)


YEARS_AFTER = re.compile(r"\b(?:experience|exp)\s*[:\-–]?\s*(?:of\s*)?(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*(?:\d{1,2})?\s*(?:years|yrs)", re.I)


def min_years(text: str) -> int | None:
    """Smallest 'N years of experience' (or 'Experience: N-M yrs') requirement in the posting, if any."""
    text = text[:8000]
    found = [int(m.group(1)) for rx in (YEARS, YEARS_AFTER) for m in rx.finditer(text) if int(m.group(1)) <= 20]
    return min(found) if found else None


def seniority(title: str, description: str = "") -> str:
    """intern | entry | mid | senior | lead, or "" when the posting doesn't say."""
    t = title.lower()
    if re.search(r"\bintern", t):
        return "intern"
    if re.search(r"\b(junior|jr\.?|entry|graduate|new grad|fresher|trainee)\b", t):
        return "entry"
    if re.search(r"\b(head|director|vp|vice president|chief|principal)\b", t):
        return "lead"
    if re.search(r"\bmanager\b", t):
        return "lead"
    if re.search(r"\b(lead|staff|senior|sr\.?|iii|iv)\b|\bsde[- ]?(3|iii)\b", t):
        return "senior"
    if re.search(r"\b(sde|engineer|developer)[- ]?(2|ii)\b|\bl[45]\b", t):
        return "mid"
    years = min_years(f"{title}\n{description}")
    if years is None:
        return ""
    return "entry" if years <= 1 else "mid" if years <= 4 else "senior"


def norm_key(company: str, title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", f"{company}{title}".lower())
