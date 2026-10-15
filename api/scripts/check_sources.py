"""Check that a company's official job board exists before adding it to kold/sources/companies.json.

Usage: python -m scripts.check_sources greenhouse groww
"""
import sys

import httpx

URLS = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{}/jobs",
    "lever": "https://api.lever.co/v0/postings/{}?mode=json",
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{}",
    "smartrecruiters": "https://api.smartrecruiters.com/v1/companies/{}/postings",
}

if __name__ == "__main__":
    ats, slug = sys.argv[1], sys.argv[2]
    r = httpx.get(URLS[ats].format(slug), timeout=20)
    if r.status_code != 200:
        sys.exit(f"Not found ({r.status_code}). Check the slug in the company's careers page URL.")
    data = r.json()
    jobs = data if isinstance(data, list) else data.get("jobs", data.get("content", []))
    print(f"OK: {len(jobs)} open postings on {ats}/{slug}")
