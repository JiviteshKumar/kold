"""Pulls fresh postings from every source, keeps only what someone in India can actually take,
deduplicates, and closes listings that the employer has taken down."""
import logging
import re
from collections import defaultdict
from datetime import timedelta

from sqlmodel import Session, select

from ..config import settings
from ..models import CrawlRun, Job, utcnow
from ..sources import fetchers
from ..sources.common import RawJob, job_type, norm_key, seniority
from . import geo, trust

log = logging.getLogger(__name__)


def _scope_key(rj: RawJob) -> str:
    return f"{rj.source}:{rj.company}" if rj.source in trust.EMPLOYER_BOARDS else rj.source


PLACEHOLDER_TITLE = re.compile(r"^\s*(test|testing|dummy|sample|demo|do not apply|ignore|tbd|xxx+|asdf)\b|\b(test (job|posting|role|req))\b", re.I)


def _placeholder(rj: RawJob) -> bool:
    return bool(PLACEHOLDER_TITLE.search(rj.title)) or len((rj.description or "").strip()) < 80


def run(session: Session) -> CrawlRun:
    run = CrawlRun()
    session.add(run)
    session.commit()

    existing = {j.fingerprint: j for j in session.exec(select(Job))}
    employer_keys = {norm_key(j.company, j.title) for j in existing.values() if j.source in trust.EMPLOYER_BOARDS and j.active}
    seen: dict[str, set[str]] = defaultdict(set)
    ok_scopes: set[str] = set()
    stats: dict[str, dict] = {}
    new_count = 0

    for name, result in fetchers.fetch_all():
        if isinstance(result, Exception):
            stats[name] = {"ok": False, "error": str(result)[:200]}
            continue
        kept = 0
        for rj in result:
            ok_scopes.add(_scope_key(rj))
            if not rj.title or not rj.company or _placeholder(rj):
                continue  # test/dummy postings employers forgot to remove are not real openings
            place = geo.classify(rj.location, rj.remote_flag, rj.workplace_hint, rj.restrictions, rj.tz_offsets, rj.country)
            if place.workplace == "remote" and place.region != "india" and geo.description_restricts(rj.description):
                place = geo.Place("remote", "abroad", False, place.city)  # "Worldwide" on the board, "US only" in the text
            if place.region == "abroad" or (place.workplace != "remote" and place.region != "india"):
                # Not workable from India. Never stored if new; if we already have it (someone may have saved it),
                # keep it live but reclassified, because the employer didn't take it down.
                old = existing.get(rj.fingerprint)
                if old:
                    seen[_scope_key(rj)].add(rj.fingerprint)
                    old.workplace, old.region, old.open_to_india = place.workplace, "abroad", False
                    old.active, old.last_seen = True, utcnow()
                    session.add(old)
                continue
            key = norm_key(rj.company, rj.title)
            if rj.source not in trust.EMPLOYER_BOARDS and key in employer_keys:
                continue  # same job is already listed straight from the employer; prefer that
            if rj.source in trust.EMPLOYER_BOARDS:
                employer_keys.add(key)

            seen[_scope_key(rj)].add(rj.fingerprint)
            score, flags = trust.score(rj.source, rj.description, rj.posted_at, rj.company)
            if place.region == "unknown":
                flags.append({"level": "warn", "text": "Remote, but the posting does not say whether candidates in India are eligible."})
            fields = dict(
                source=rj.source, source_label=rj.source_label, source_url=rj.source_url, external_id=rj.external_id,
                company=rj.company, company_domain=rj.company_domain, title=rj.title, department=rj.department,
                location_raw=rj.location or ("Remote" if place.workplace == "remote" else ""),
                workplace=place.workplace, region=place.region, open_to_india=place.open_to_india,
                job_type=job_type(rj.title, rj.commitment), seniority=seniority(rj.title, rj.description),
                description=rj.description, url=rj.url, apply_url=rj.apply_url or rj.url,
                posted_at=rj.posted_at, deadline=rj.deadline, salary_text=rj.salary_text, tags=rj.tags,
                trust_score=score, trust_flags=flags, active=True, last_seen=utcnow(),
            )
            job = existing.get(rj.fingerprint)
            if job:
                for k, v in fields.items():
                    setattr(job, k, v)
            else:
                job = Job(fingerprint=rj.fingerprint, **fields)
                existing[rj.fingerprint] = job
                new_count += 1
            session.add(job)
            kept += 1
        stats[name] = {"ok": True, "fetched": len(result), "kept": kept}
        session.commit()

    # Close listings that are gone, expired or stale. We only close employer-board jobs when that
    # board was fetched successfully this run, so a network blip never hides real jobs.
    closed = 0
    now = utcnow()
    stale_before = now - timedelta(days=settings.stale_job_days)
    all_seen = set().union(*seen.values()) if seen else set()
    for job in existing.values():
        if not job.active:
            continue
        if job.workplace == "remote" and job.region != "india" and job.fingerprint not in all_seen:
            # Feeds only return their newest posts: re-check older ones with the current eligibility rules.
            p = geo.classify(job.location_raw, True, "", [job.location_raw] if job.location_raw else None)
            if p.region == "abroad" or geo.description_restricts(job.description):
                job.region, job.open_to_india = "abroad", False
            elif p.open_to_india != job.open_to_india:
                job.region, job.open_to_india = p.region, p.open_to_india
            session.add(job)
        scope = f"{job.source}:{job.company}" if job.source in trust.EMPLOYER_BOARDS else job.source
        gone = job.source in trust.EMPLOYER_BOARDS and scope in ok_scopes and job.fingerprint not in seen[scope]
        expired = job.deadline is not None and job.deadline < now
        stale = job.source not in trust.EMPLOYER_BOARDS and (job.posted_at or job.first_seen) < stale_before
        if gone or expired or stale:
            job.active = False
            session.add(job)
            closed += 1

    run.finished_at = utcnow()
    run.stats = stats
    run.new_jobs = new_count
    run.closed_jobs = closed
    session.add(run)
    session.commit()
    session.refresh(run)
    log.info("crawl done: %s new, %s closed", new_count, closed)
    return run
