"""Probe SmartRecruiters and Workable public job feeds for companies hiring in India."""
import concurrent.futures as cf
import json
import sys

import httpx

NAMES = sys.argv[1:] or """
Freshworks Visa Bosch Swiggy Zomato Myntra Flipkart PhonePe Razorpay Ola Paytm Infosys Wipro TCS HCLTech TechMahindra
Capgemini Accenture Deloitte EY KPMG PwC Ubisoft Siemens Philips Schneider ABB Bayer Novartis IKEA Sodexo Square Yards
NoBroker Byjus Unacademy upGrad Vedantu Nykaa Lenskart Licious Zepto Dunzo Meesho Groww Zerodha CRED Juspay Cashfree
InMobi MakeMyTrip OYO Delhivery Shiprocket Ather Bounce Yulu Rapido Practo PharmEasy Cultfit Tata1mg Policybazaar Acko
Digit Navi Slice Jupiter Fi Niyo Khatabook OkCredit Vyapar Mobikwik BharatPe PineLabs Rupeek Jar Smallcase Upstox
AngelOne Dhan INDmoney Coinswitch CoinDCX WazirX Polygon Dream11 MPL Games24x7 WinZO Nazara Glance ShareChat Dailyhunt
Josh Moj Pratilipi PocketFM KukuFM Spotify Gaana JioSaavn Hotstar ZEE5 SonyLIV Airtel Jio Vodafone Idea Exotel
Haptik Yellow Gupshup Uniphore Observe Sprinklr Postman BrowserStack Chargebee Zoho Freshdesk Darwinbox Keka Zenoti
Icertis Innovaccer MindTickle LeadSquared WebEngage MoEngage CleverTap Netcore Capillary Zluri Rocketlane SpotDraft
Sprinto Atlan Hasura Signzy Perfios IDfy HyperVerge Setu M2P Zeta Pinelabs Instamojo
""".split()


def slugs(name):
    n = name.lower()
    return list(dict.fromkeys([n, n.replace(" ", ""), n.replace(" ", "-")]))


def smart(name):
    for s in slugs(name) + [name]:
        try:
            r = httpx.get(f"https://api.smartrecruiters.com/v1/companies/{s}/postings?limit=100", timeout=20)
            if r.status_code == 200:
                d = r.json()
                jobs = d.get("content", [])
                if jobs:
                    india = sum(1 for j in jobs if (j.get("location") or {}).get("country", "").lower() in ("in", "india"))
                    remote = sum(1 for j in jobs if (j.get("location") or {}).get("remote"))
                    if india or remote:
                        return {"ats": "smartrecruiters", "slug": s, "jobs": d.get("totalFound", len(jobs)), "india": india, "remote": remote,
                                "company": (jobs[0].get("company") or {}).get("name", s)}
        except Exception:
            pass
    return None


def workable(name):
    for s in slugs(name):
        try:
            r = httpx.get(f"https://apply.workable.com/api/v1/widget/accounts/{s}", timeout=20)
            if r.status_code == 200:
                d = r.json()
                jobs = d.get("jobs", [])
                if jobs:
                    india = sum(1 for j in jobs if (j.get("country") or "").lower() == "india")
                    remote = sum(1 for j in jobs if j.get("telecommuting"))
                    if india or remote:
                        return {"ats": "workable", "slug": s, "jobs": len(jobs), "india": india, "remote": remote, "company": d.get("name", s)}
        except Exception:
            pass
    return None


if __name__ == "__main__":
    with cf.ThreadPoolExecutor(16) as ex:
        res = list(ex.map(smart, NAMES)) + list(ex.map(workable, NAMES))
    for r in res:
        if r:
            print(json.dumps(r, ensure_ascii=True))
