"""Probe many company slugs on Greenhouse, Lever and Ashby; print the ones that are live with open jobs.

Usage: python -m scripts.probe_boards  (results are reviewed by hand before adding to companies.json)
"""
import concurrent.futures as cf
import json
import sys
from collections import Counter

import httpx

CANDIDATES = sys.argv[1:] or """
swiggy zomato razorpay phonepe cars24 sharechat unacademy urbancompany olacabs jar pocketfm nobroker dailyhunt vedantu
upgrad physicswallah lenskart nykaa myntra flipkart zerodha licious bigbasket rapido spinny acko godigit policybazaar
navi slice jupiter khatabook okcredit setu m2p perfios signzy hasura postman browserstack freshworks chargebee zoho
icertis innovaccer leadsquared darwinbox keka zluri spotdraft rocketlane sprinto scaler masaischool newtonschool cleartax
practo pharmeasy cultfit healthifyme upstox angelone indmoney smallcase coindcx coinswitch polygon dream11 mpl games24x7
winzo moengage webengage clevertap netcore gupshup yellowai haptik uniphore ather bounce yulu blinkit zepto instamojo
cashfree juspay bharatpe pinelabs whatfix gojek grab sharechat-1 meesho cred zeta paytm groww inmobi druva glance observeai
mindtickle fampay sarvam atlan hackerrank hackerearth unstop internshala apna workindia naukri infoedge ixigo makemytrip
easemytrip oyo treebo yatra delhivery shiprocket blackbuck rivigo porter dunzo bluestone caratlane boat noise mamaearth
sugar purplle pepperfry livspace urbanladder curefit stashfin kreditbee moneyview fibe lendingkart ofbusiness zetwerk
infra-market moglix udaan jumbotail dealshare citymall bikayi khatabook vyapar mobikwik freecharge simpl lazypay paysense
tala epifi niyo open fi-money onecard uni kissht credgenics leegality digio perfios karza idfy hyperverge bureau signeasy
thoughtspot postman sprinklr freshworks chargebee clevertap browserstack druva icertis innovaccer zenoti capillary
yellow-ai verloop exotel ozonetel knowlarity servify zinc-search tracxn inc42 yourstory ampere-computing
gitlab automattic zapier doist toggl hotjar buffer ghost basecamp invisionapp wikimedia mozilla canonical elastic
hashicorp netlify vercel supabase replit posthog linear ramp notion deel remote oyster papayaglobal rippling gusto
airtable figma canva miro loom calendly typeform webflow framer retool mercury plaid stripe brex wise revolut monzo
n26 klarna adyen checkout grafana-labs grafanalabs cockroachlabs timescale clickhouse redis mongodb confluent databricks
snowflake dbt-labs dbtlabs fivetran airbyte prefect dagster astronomer hex modal-labs anyscale huggingface cohere mistral
perplexity elevenlabs runwayml synthesia deepgram assemblyai pinecone weaviate qdrant langchain llamaindex scale scaleai
labelbox snorkel weightsandbiases wandb discord reddit pinterest duolingo coursera udemy chegg khanacademy quizlet
""".split()

URLS = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{}/jobs",
    "lever": "https://api.lever.co/v0/postings/{}?mode=json",
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{}",
}


def probe(ats_slug):
    ats, slug = ats_slug
    try:
        r = httpx.get(URLS[ats].format(slug), timeout=20)
        if r.status_code != 200:
            return None
        d = r.json()
        jobs = d if isinstance(d, list) else d.get("jobs", [])
        if not jobs:
            return None
        if ats == "greenhouse":
            locs = [(j.get("location") or {}).get("name", "") for j in jobs]
            name = jobs[0].get("company_name") or slug
        elif ats == "lever":
            locs = [(j.get("categories") or {}).get("location", "") for j in jobs]
            name = slug
        else:
            locs = [j.get("location", "") for j in jobs]
            name = slug
        india = sum(1 for l in locs if any(k in (l or "").lower() for k in ("india", "bengaluru", "bangalore", "mumbai", "delhi", "gurgaon", "gurugram", "noida", "hyderabad", "pune", "chennai")))
        remote = sum(1 for l in locs if "remote" in (l or "").lower())
        return {"ats": ats, "slug": slug, "name": name, "jobs": len(jobs), "india": india, "remote": remote,
                "top_locations": Counter(locs).most_common(3)}
    except Exception:
        return None


if __name__ == "__main__":
    tasks = [(ats, s) for s in dict.fromkeys(CANDIDATES) for ats in URLS]
    with cf.ThreadPoolExecutor(24) as ex:
        found = [r for r in ex.map(probe, tasks) if r]
    for r in sorted(found, key=lambda r: (-r["india"], -r["remote"])):
        print(json.dumps(r, ensure_ascii=False))
