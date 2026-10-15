"""Daily job feed for Kold Lite (the serverless app).

Runs once a day on GitHub Actions (free for public repos): scans every official source with the same crawler the
server uses, keeps only genuine listings workable from India, finds contact emails the companies publish themselves,
and writes compact JSON files that the app downloads. Only public job data is involved; no user data ever.

Usage: python -m scripts.export_feed --out ../site/data
"""
import argparse
import concurrent.futures as cf
import gzip
import json
import os
import tempfile
import time
from datetime import timezone
from pathlib import Path

# Fresh, throwaway database for this run (set before importing kold).
_tmp = tempfile.mkdtemp(prefix="kold-feed-")
os.environ.setdefault("KOLD_DATABASE_URL", f"sqlite:///{_tmp}/feed.db".replace("\\", "/"))
os.environ.setdefault("KOLD_DATA_DIR", _tmp)

from sqlmodel import select  # noqa: E402

from kold.db import init_db, session_scope  # noqa: E402
from kold.models import Job, utcnow  # noqa: E402
from kold.serialize import _summary  # noqa: E402
from kold.services import contacts, crawler  # noqa: E402

DESC_LIMIT = 3000


def iso(dt):
    return dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z") if dt else None


def job_row(j: Job) -> dict:
    return {
        "id": j.fingerprint[:16], "source": j.source, "source_label": j.source_label, "source_url": j.source_url,
        "company": j.company, "domain": j.company_domain, "title": j.title, "department": j.department,
        "location": j.location_raw, "workplace": j.workplace, "region": j.region, "open_to_india": j.open_to_india,
        "job_type": j.job_type, "seniority": j.seniority, "posted_at": iso(j.posted_at), "deadline": iso(j.deadline),
        "salary": j.salary_text, "tags": (j.tags or [])[:8], "trust_score": j.trust_score, "trust_flags": j.trust_flags,
        "url": j.url, "apply_url": j.apply_url, "summary": _summary(j.description),
        "description": (j.description or "")[:DESC_LIMIT],
        "emails": posting_emails(j),
    }


def posting_emails(j: Job) -> list[dict]:
    """Addresses the employer wrote in the posting itself (e.g. 'send your CV to careers@...')."""
    out = []
    for e in contacts.extract_emails(j.description or ""):
        host = e.split("@")[1]
        if host in contacts.FREE_MAIL or contacts.SKIP.search(e):
            continue
        if j.company_domain and not contacts._belongs(e, j.company_domain):
            continue
        role, _ = contacts.classify(e)
        if role != "other":
            out.append({"email": e, "role": role, "source_url": j.url})
    return out


def domain_contacts(domain: str) -> tuple[str, list[dict]]:
    try:
        found = contacts.crawl_domain(domain)
    except Exception:
        return domain, []
    rows = []
    for email, src in found.items():
        if not contacts._belongs(email, domain) or contacts.SKIP.search(email):
            continue
        role, _ = contacts.classify(email)
        if role != "other":
            rows.append({"email": email, "role": role, "source_url": src})
    if rows and not contacts.mx_ok(domain):
        return domain, []  # domain can't receive mail: every address would bounce
    order = {"recruiting": 0, "general": 1, "person": 2}
    return domain, sorted(rows, key=lambda r: order.get(r["role"], 9))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--skip-contacts", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    init_db()
    with session_scope() as s:
        run = crawler.run(s)
        jobs = s.exec(select(Job).where(Job.active == True, Job.region != "abroad")).all()  # noqa: E712
        rows = [job_row(j) for j in jobs if j.trust_score >= 45 and (j.region == "india" or j.open_to_india or j.region == "unknown")]
    ok = sum(1 for v in run.stats.values() if v.get("ok"))
    print(f"crawl: {len(rows)} listings from {ok}/{len(run.stats)} sources in {time.time() - t0:.0f}s")

    domains = sorted({r["domain"] for r in rows if r["domain"]})
    contact_map: dict[str, list[dict]] = {}
    if not args.skip_contacts:
        t1 = time.time()
        with cf.ThreadPoolExecutor(8) as ex:
            for domain, found in ex.map(domain_contacts, domains):
                if found:
                    contact_map[domain] = found
        print(f"contacts: {sum(len(v) for v in contact_map.values())} published addresses on {len(contact_map)}/{len(domains)} sites in {time.time() - t1:.0f}s")

    generated = utcnow().replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    meta = {"generated_at": generated, "jobs": len(rows), "sources_ok": ok, "sources_total": len(run.stats),
            "companies": len({r["company"] for r in rows}), "contacts_domains": len(contact_map), "version": 1}
    files = {"jobs.json": {"meta": meta, "jobs": rows}, "contacts.json": contact_map, "meta.json": meta}
    for name, data in files.items():
        raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
        (out / name).write_bytes(raw)
        print(f"wrote {name}: {len(raw) / 1e6:.2f} MB ({len(gzip.compress(raw)) / 1e6:.2f} MB compressed)")


if __name__ == "__main__":
    main()
