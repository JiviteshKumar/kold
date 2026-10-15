"""Fetchers for genuine sources only:

* Employer-owned applicant-tracking boards (Greenhouse, Lever, Ashby): the company itself posted the job.
* Established public remote-job feeds that publish an official API and ask for attribution
  (Remotive, Remote OK, Himalayas, Arbeitnow). We always link back to them.

We never scrape LinkedIn, Indeed, Naukri, Glassdoor, etc. Their terms forbid it.
"""
import json
import logging
from collections.abc import Iterator
from pathlib import Path

import httpx

from ..config import settings
from .common import RawJob, html_to_text, parse_dt

log = logging.getLogger(__name__)
REGISTRY = json.loads((Path(__file__).parent / "companies.json").read_text())


def _client() -> httpx.Client:
    return httpx.Client(timeout=30, headers={"User-Agent": settings.user_agent}, follow_redirects=True)


def greenhouse(c: httpx.Client, co: dict) -> Iterator[RawJob]:
    url = f"https://boards-api.greenhouse.io/v1/boards/{co['slug']}/jobs?content=true"
    for j in c.get(url).raise_for_status().json().get("jobs", []):
        yield RawJob(
            source="greenhouse",
            source_label=f"{co['name']}'s official careers board (Greenhouse)",
            source_url=j.get("absolute_url", ""),
            external_id=str(j["id"]),
            company=co["name"],
            company_domain=co["domain"],
            title=j.get("title", "").strip(),
            url=j.get("absolute_url", ""),
            apply_url=j.get("absolute_url", ""),
            department=", ".join(d["name"] for d in j.get("departments") or []),
            location=(j.get("location") or {}).get("name", ""),
            description=html_to_text(j.get("content", "")),
            posted_at=parse_dt(j.get("first_published") or j.get("updated_at")),
            deadline=parse_dt(j.get("application_deadline")),
        )


def lever(c: httpx.Client, co: dict) -> Iterator[RawJob]:
    url = f"https://api.lever.co/v0/postings/{co['slug']}?mode=json"
    for j in c.get(url).raise_for_status().json():
        cats = j.get("categories") or {}
        lists = "\n\n".join(f"{x.get('text', '')}\n{html_to_text(x.get('content', ''))}" for x in j.get("lists") or [])
        yield RawJob(
            source="lever",
            source_label=f"{co['name']}'s official careers board (Lever)",
            source_url=j.get("hostedUrl", ""),
            external_id=j["id"],
            company=co["name"],
            company_domain=co["domain"],
            title=j.get("text", "").strip(),
            url=j.get("hostedUrl", ""),
            apply_url=j.get("applyUrl", "") or j.get("hostedUrl", ""),
            department=cats.get("team") or cats.get("department") or "",
            location=", ".join(cats.get("allLocations") or []) or cats.get("location", ""),
            workplace_hint=j.get("workplaceType", ""),
            country=j.get("country", ""),
            commitment=cats.get("commitment", ""),
            description=(j.get("descriptionPlain", "") + "\n\n" + lists).strip()[:20000],
            posted_at=parse_dt(j.get("createdAt")),
            salary_text=_lever_salary(j.get("salaryRange")),
        )


def _lever_salary(r: dict | None) -> str:
    if not r or not r.get("min"):
        return ""
    return f"{r.get('currency', '')} {r['min']:,}–{r.get('max', r['min']):,} / {r.get('interval', 'year')}".strip()


def ashby(c: httpx.Client, co: dict) -> Iterator[RawJob]:
    url = f"https://api.ashbyhq.com/posting-api/job-board/{co['slug']}?includeCompensation=true"
    for j in c.get(url).raise_for_status().json().get("jobs", []):
        if j.get("isListed") is False:
            continue
        addr = ((j.get("address") or {}).get("postalAddress") or {})
        locs = [j.get("location", "")] + [s.get("location", "") for s in j.get("secondaryLocations") or []]
        comp = (j.get("compensation") or {}).get("compensationTierSummary") or ""
        yield RawJob(
            source="ashby",
            source_label=f"{co['name']}'s official careers board (Ashby)",
            source_url=j.get("jobUrl", ""),
            external_id=j["id"],
            company=co["name"],
            company_domain=co["domain"],
            title=j.get("title", "").strip(),
            url=j.get("jobUrl", ""),
            apply_url=j.get("applyUrl", "") or j.get("jobUrl", ""),
            department=j.get("department", ""),
            location=", ".join(x for x in locs if x),
            remote_flag=bool(j.get("isRemote")),
            workplace_hint=j.get("workplaceType", "") or "",
            country=addr.get("addressCountry", ""),
            commitment=j.get("employmentType", ""),
            description=(j.get("descriptionPlain") or html_to_text(j.get("descriptionHtml", "")))[:20000],
            posted_at=parse_dt(j.get("publishedAt")),
            salary_text=comp if j.get("shouldDisplayCompensationOnJobPostings") else "",
        )


def smartrecruiters(c: httpx.Client, co: dict) -> Iterator[RawJob]:
    """SmartRecruiters' official public postings API (used by e.g. Swiggy and Freshworks)."""
    base = f"https://api.smartrecruiters.com/v1/companies/{co['slug']}/postings"
    offset, seen = 0, 0
    while True:
        page = c.get(f"{base}?limit=100&offset={offset}").raise_for_status().json()
        items = page.get("content", [])
        for j in items:
            loc = j.get("location") or {}
            try:
                det = c.get(j["ref"]).raise_for_status().json()
            except Exception:
                det = {}
            sections = (det.get("jobAd") or {}).get("sections") or {}
            desc = "\n\n".join(html_to_text((sections.get(k) or {}).get("text", "")) for k in ("jobDescription", "qualifications", "additionalInformation", "companyDescription"))
            url = det.get("postingUrl") or f"https://jobs.smartrecruiters.com/{co['slug']}/{j['id']}"
            yield RawJob(
                source="smartrecruiters",
                source_label=f"{co['name']}'s official careers board (SmartRecruiters)",
                source_url=url,
                external_id=str(j["id"]),
                company=co["name"],
                company_domain=co["domain"],
                title=(j.get("name") or "").strip(),
                url=url,
                apply_url=det.get("applyUrl") or url,
                department=(j.get("department") or {}).get("label", "") or (j.get("function") or {}).get("label", ""),
                location=loc.get("fullLocation") or ", ".join(x for x in (loc.get("city"), loc.get("country")) if x),
                remote_flag=bool(loc.get("remote")),
                workplace_hint="hybrid" if loc.get("hybrid") else "",
                country=(loc.get("country") or "").upper(),
                commitment=(j.get("typeOfEmployment") or {}).get("label", ""),
                description=desc.strip()[:20000],
                posted_at=parse_dt(j.get("releasedDate")),
            )
        seen += len(items)
        offset += 100
        if not items or seen >= page.get("totalFound", 0) or offset >= 1000:
            break


def remotive(c: httpx.Client) -> Iterator[RawJob]:
    for j in c.get("https://remotive.com/api/remote-jobs").raise_for_status().json().get("jobs", []):
        loc = j.get("candidate_required_location", "") or ""
        yield RawJob(
            source="remotive",
            source_label="Remotive (curated remote jobs board)",
            source_url=j.get("url", ""),
            external_id=str(j["id"]),
            company=(j.get("company_name") or "").strip(),
            title=(j.get("title") or "").strip(),
            url=j.get("url", ""),
            apply_url=j.get("url", ""),
            department=j.get("category", ""),
            location=loc,
            remote_flag=True,
            restrictions=[loc] if loc else [],
            commitment=j.get("job_type", ""),
            description=html_to_text(j.get("description", "")),
            posted_at=parse_dt(j.get("publication_date")),
            salary_text=j.get("salary", "") or "",
            tags=list(j.get("tags") or [])[:12],
        )


def remoteok(c: httpx.Client) -> Iterator[RawJob]:
    data = c.get("https://remoteok.com/api", headers={"User-Agent": "Mozilla/5.0 " + settings.user_agent}).raise_for_status().json()
    for j in data[1:]:  # first element is their legal notice
        if not j.get("id"):
            continue
        lo, hi = j.get("salary_min") or 0, j.get("salary_max") or 0
        yield RawJob(
            source="remoteok",
            source_label="Remote OK (public remote jobs board)",
            source_url=j.get("url", ""),
            external_id=str(j["id"]),
            company=(j.get("company") or "").strip(),
            title=(j.get("position") or "").strip(),
            url=j.get("url", ""),
            apply_url=j.get("apply_url") or j.get("url", ""),
            location=j.get("location", "") or "",
            remote_flag=True,
            restrictions=[j["location"]] if j.get("location") else [],
            description=html_to_text(j.get("description", "")),
            posted_at=parse_dt(j.get("date")),
            salary_text=f"USD {lo:,}–{hi:,} / year" if lo else "",
            tags=list(j.get("tags") or [])[:12],
        )


def himalayas(c: httpx.Client, pages: int = 5) -> Iterator[RawJob]:
    offset = 0
    for _ in range(pages):
        d = c.get(f"https://himalayas.app/jobs/api?limit=20&offset={offset}").raise_for_status().json()
        jobs = d.get("jobs", [])
        if not jobs:
            break
        for j in jobs:
            restr = list(j.get("locationRestrictions") or [])
            lo, hi, cur = j.get("minSalary"), j.get("maxSalary"), j.get("currency") or ""
            yield RawJob(
                source="himalayas",
                source_label="Himalayas (remote jobs board)",
                source_url=j.get("guid", ""),
                external_id=j.get("guid", ""),
                company=(j.get("companyName") or "").strip(),
                title=(j.get("title") or "").strip(),
                url=j.get("guid", ""),
                apply_url=j.get("applicationLink") or j.get("guid", ""),
                location=", ".join(restr) if restr else "Worldwide",
                remote_flag=True,
                restrictions=restr or ["Worldwide"],
                tz_offsets=list(j.get("timezoneRestrictions") or []),
                commitment=j.get("employmentType", ""),
                description=html_to_text(j.get("description", "")),
                posted_at=parse_dt(j.get("pubDate")),
                deadline=parse_dt(j.get("expiryDate")),
                salary_text=f"{cur} {lo:,}–{hi:,} / {j.get('salaryPeriod', 'year')}" if lo and hi else "",
                tags=list(j.get("categories") or [])[:12],
            )
        offset += len(jobs)


def arbeitnow(c: httpx.Client) -> Iterator[RawJob]:
    for j in c.get("https://www.arbeitnow.com/api/job-board-api").raise_for_status().json().get("data", []):
        if not j.get("remote"):
            continue  # Arbeitnow onsite roles are in Europe and not workable from India.
        yield RawJob(
            source="arbeitnow",
            source_label="Arbeitnow (European jobs board)",
            source_url=j.get("url", ""),
            external_id=j.get("slug", ""),
            company=(j.get("company_name") or "").strip(),
            title=(j.get("title") or "").strip(),
            url=j.get("url", ""),
            apply_url=j.get("url", ""),
            location=j.get("location", "") or "",
            remote_flag=True,
            restrictions=[j.get("location", "")],
            commitment=" ".join(j.get("job_types") or []),
            description=html_to_text(j.get("description", "")),
            posted_at=parse_dt(j.get("created_at")),
            tags=list(j.get("tags") or [])[:12],
        )


ATS = {"greenhouse": greenhouse, "lever": lever, "ashby": ashby, "smartrecruiters": smartrecruiters}
FEEDS = {"remotive": remotive, "remoteok": remoteok, "himalayas": himalayas, "arbeitnow": arbeitnow}


def fetch_all() -> Iterator[tuple[str, list[RawJob] | Exception]]:
    """Yield (source_name, jobs-or-error) for every configured source. One broken source never stops the rest."""
    with _client() as c:
        for ats, fn in ATS.items():
            for co in REGISTRY.get(ats, []):
                name = f"{ats}:{co['slug']}"
                try:
                    yield name, list(fn(c, co))
                except Exception as e:
                    log.warning("source %s failed: %s", name, e)
                    yield name, e
        for name, fn in FEEDS.items():
            try:
                yield name, list(fn(c))
            except Exception as e:
                log.warning("source %s failed: %s", name, e)
                yield name, e
