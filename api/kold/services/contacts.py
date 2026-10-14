"""Finds real, published email addresses to reach a company.

Rules that keep this genuine:
* We only read the job posting itself and pages on the company's own domain.
* We respect robots.txt and fetch a small, fixed number of pages.
* We only keep addresses that are actually published (no guessing firstname@company.com).
* Every address keeps the exact URL where it was found, shown to the user.
* The domain must have working mail servers (MX record).
"""
import logging
import re
from datetime import timedelta
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import dns.resolver
import httpx
from bs4 import BeautifulSoup
from sqlmodel import Session, select

from ..config import settings
from ..models import Contact, Job, utcnow

log = logging.getLogger(__name__)

EMAIL = re.compile(r"\b[a-zA-Z0-9][\w.+-]*@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}\b")
FREE_MAIL = {"gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "rediffmail.com", "protonmail.com", "icloud.com"}
SKIP = re.compile(r"no-?reply|do-?not-?reply|privacy|legal|abuse|security|dpo|gdpr|unsubscribe|billing|invoice|"
                  r"accounts?payable|example|sentry|wixpress|noc@|postmaster|webmaster|support|help@|sales@|"
                  r"partners?@|investor|ir@|media@|press@|grievance|complaint|nodal|compliance|escalation|"
                  r"refund|cs@|care@|\.(png|jpg|jpeg|gif|svg|webp)$", re.I)
RECRUITING = re.compile(r"career|jobs?@|hiring|talent|recruit|^hr[@.]|people@|join|internship|campus|work@|apply", re.I)
GENERAL = re.compile(r"^(hello|hi|hey|contact|contactus|info|team|founders?|ceo|enquiries|enquiry|inquiries|inquiry|future|office)$", re.I)
PATHS = ["", "/careers", "/jobs", "/join", "/contact", "/contact-us", "/about", "/about-us", "/team", "/company", "/impressum"]
LINK_HINT = re.compile(r"career|job|join|contact|about|team|company|impressum", re.I)
MAX_PAGES = 12
CACHE_DAYS = 30


def mx_ok(domain: str) -> bool:
    try:
        return len(dns.resolver.resolve(domain, "MX", lifetime=5)) > 0
    except Exception:
        return False


def _decode_cf(hexstr: str) -> str:
    key = int(hexstr[:2], 16)
    return "".join(chr(int(hexstr[i:i + 2], 16) ^ key) for i in range(2, len(hexstr), 2))


def extract_emails(html: str) -> set[str]:
    found: set[str] = set()
    soup = BeautifulSoup(html, "html.parser")
    for a in soup.select("a[href^=mailto]"):
        addr = a["href"][7:].split("?")[0].strip()
        if EMAIL.fullmatch(addr):
            found.add(addr)
    for el in soup.select("[data-cfemail]"):
        try:
            found.add(_decode_cf(el["data-cfemail"]))
        except Exception:
            pass
    # Many sites (Next.js, Gatsby…) ship their page content as embedded JSON. It is still published content.
    for script in soup.select('script[type="application/json"], script#__NEXT_DATA__, script[type="application/ld+json"]'):
        found.update(EMAIL.findall(script.get_text()))
    for script in soup(["script", "style"]):
        script.decompose()
    text = soup.get_text(" ")
    text = re.sub(r"\s*[\[(]\s*at\s*[\])]\s*", "@", text, flags=re.I)
    text = re.sub(r"\s*[\[(]\s*dot\s*[\])]\s*", ".", text, flags=re.I)
    found.update(EMAIL.findall(text))
    return {e.lower().strip(".") for e in found}


def _belongs(email: str, domain: str) -> bool:
    host = email.split("@")[1]
    return host == domain or host.endswith("." + domain)


def classify(email: str) -> tuple[str, int]:
    local = email.split("@")[0]
    if RECRUITING.search(email):
        return "recruiting", 3
    if GENERAL.search(local):
        return "general", 2
    if re.fullmatch(r"[a-z]+[._][a-z]+", local):
        return "person", 1  # first.last: a named individual
    return "other", 0


def _robots(client: httpx.Client, base: str) -> RobotFileParser:
    rp = RobotFileParser()
    try:
        r = client.get(urljoin(base, "/robots.txt"))
        rp.parse(r.text.splitlines() if r.status_code == 200 else [])
    except Exception:
        rp.parse([])
    return rp


def crawl_domain(domain: str) -> dict[str, str]:
    """Returns {email: source_url} for addresses published on the company's own site."""
    results: dict[str, str] = {}
    base = f"https://{domain}"
    with httpx.Client(timeout=10, follow_redirects=True, headers={"User-Agent": settings.user_agent}) as c:
        rp = _robots(c, base)
        queue = [base + p for p in PATHS]
        visited: set[str] = set()
        while queue and len(visited) < MAX_PAGES:
            url = queue.pop(0)
            if url in visited or not rp.can_fetch(settings.user_agent, url):
                continue
            visited.add(url)
            try:
                r = c.get(url)
            except Exception:
                continue
            if r.status_code != 200 or "html" not in r.headers.get("content-type", ""):
                continue
            final_host = urlparse(str(r.url)).hostname or ""
            if not (final_host == domain or final_host.endswith("." + domain)):
                continue  # redirected off the company's domain
            for e in extract_emails(r.text):
                results.setdefault(e, str(r.url))
            if url == base:  # follow relevant links from the homepage only
                soup = BeautifulSoup(r.text, "html.parser")
                for a in soup.select("a[href]"):
                    href = urljoin(str(r.url), a["href"]).split("#")[0]
                    host = urlparse(href).hostname or ""
                    if (host == domain or host.endswith("." + domain)) and LINK_HINT.search(href) and href not in visited:
                        queue.append(href)
    return results


def find_for_job(session: Session, job: Job, force: bool = False) -> list[Contact]:
    domain = (job.company_domain or "").lower()
    candidates: dict[str, str] = {}

    # 1. The posting itself. If the employer wrote "send your CV to x@y.com", that's the best address.
    for e in extract_emails(job.description or ""):
        host = e.split("@")[1]
        if host in FREE_MAIL:
            continue
        if not domain or _belongs(e, domain):
            candidates[e] = job.url
            domain = domain or host

    if not domain:
        return []
    if not job.company_domain:
        # The employer's own posting told us their domain: remember it on the (shared) job.
        job.company_domain = domain
        session.add(job)

    cached = list(session.exec(select(Contact).where(Contact.company_domain == domain, Contact.user_id == None)))  # noqa: E711
    fresh = [c for c in cached if c.found_at > utcnow() - timedelta(days=CACHE_DAYS)]
    if fresh and not force and not candidates:
        return _rank(fresh)

    # 2. The company's own website.
    try:
        for e, src in crawl_domain(domain).items():
            if _belongs(e, domain):
                candidates.setdefault(e, src)
    except Exception as ex:
        log.info("contact crawl failed for %s: %s", domain, ex)

    has_mx = mx_ok(domain) if candidates else False
    known = {c.email: c for c in cached}
    for email, src in candidates.items():
        if SKIP.search(email):
            continue
        role, rank = classify(email)
        if role == "other":
            continue
        c = known.get(email) or Contact(company_domain=domain, email=email)
        if c.bounced:
            continue  # it bounced before: the address doesn't exist, whatever the website still says
        c.role_hint, c.source_url, c.mx_ok, c.found_at = role, src, has_mx, utcnow()
        c.confidence = "high" if (src == job.url or role == "recruiting") and has_mx else "medium"
        session.add(c)
        known[email] = c
    session.commit()
    return _rank([c for c in known.values() if c.mx_ok or c.confidence == "user"])


def _rank(contacts: list[Contact]) -> list[Contact]:
    order = {"user": 5, "recruiting": 3, "general": 2, "person": 1}
    return sorted(contacts, key=lambda c: (order.get(c.confidence if c.confidence == "user" else c.role_hint, 0)), reverse=True)
