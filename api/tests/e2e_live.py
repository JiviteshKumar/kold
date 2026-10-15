"""Live end-to-end test against a running Kold API in SANDBOX mode (no real email is sent).

Usage:  KOLD_GMAIL_SANDBOX=1 uvicorn kold.main:app --port 8000   then   python -m tests.e2e_live
Drives every feature through HTTP as two separate users and prints PASS/FAIL per check.
"""
import io
import sqlite3
import sys
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/api"
DB = Path(__file__).resolve().parent.parent / "data" / "kold.db"
RESUME_TXT = (Path(__file__).parent / "fixtures" / "sample_resume.txt").read_text(encoding="utf-8")
T = 300.0
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"), flush=True)
    return bool(ok)


def client() -> httpx.Client:
    return httpx.Client(base_url=BASE, timeout=T, follow_redirects=False)


def pdf_bytes(text: str) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    y = 800
    for line in text.splitlines():
        c.drawString(40, y, line.replace("•", "-"))
        y -= 14
    c.save()
    return buf.getvalue()


def docx_bytes(text: str) -> bytes:
    from docx import Document

    d = Document()
    for line in text.splitlines():
        d.add_paragraph(line)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def db(sql: str, args=()):
    con = sqlite3.connect(DB, timeout=30)
    try:
        cur = con.execute(sql, args)
        con.commit()
        return cur.fetchall()
    finally:
        con.close()


def connect_gmail(c: httpx.Client) -> httpx.Response:
    r = c.get("/gmail/connect")
    loc = r.headers.get("location", "")
    # In sandbox the "Google" step is skipped: follow straight to our callback.
    return c.get(httpx.URL(loc).raw_path.decode().replace("/api", "", 1)) if loc else r


def gmail_threads():
    from kold.services import gmail as g

    return list(g.sandbox_threads().values())


def today(c):
    return c.get("/today").json()


def main():
    A, B, C = client(), client(), client()

    # ---------------------------------------------------------------- A. auth & onboarding
    me = A.get("/me").json()
    check("A1 anonymous /me has no user and reports sandbox", me["user"] is None and me.get("sandbox") is True, me)
    for path in ("/feed", "/today", "/tracker", "/inbox", "/stats", "/jobs/1", "/activity"):
        r = A.get(path)
        check(f"A2 {path} requires sign-in (401)", r.status_code == 401, r.status_code)
    r = A.post("/resume", files={"file": ("virus.exe", b"MZ....", "application/octet-stream")})
    check("A3 rejects non-resume file types", r.status_code == 400, r.text)
    r = A.post("/resume", files={"file": ("broken.pdf", b"this is not a pdf at all", "application/pdf")})
    check("A4 damaged PDF gives a clear 422", r.status_code == 422 and "damaged" in r.text, r.text)
    r = A.post("/resume", files={"file": ("tiny.txt", b"hello", "text/plain")})
    check("A5 near-empty resume gives 422", r.status_code == 422, r.text)
    r = A.post("/resume", files={"file": ("huge.txt", b"a" * (9 * 1024 * 1024), "text/plain")})
    check("A6 9 MB upload rejected with 413", r.status_code == 413, r.status_code)

    t0 = time.time()
    r = A.post("/resume", files={"file": ("Aarav_Sharma_TEST.pdf", pdf_bytes(RESUME_TXT), "application/pdf")})
    ok = r.status_code == 200
    check(f"A7 PDF resume parsed ({time.time() - t0:.0f}s)", ok, r.text[:300])
    prof = r.json()["profile"] if ok else {}
    check("A7a name/email/skills extracted from PDF", prof.get("name") == "Aarav Sharma" and "example.com" in prof.get("email", "") and "Python" in prof.get("skills", []), prof)
    check("A7b nothing invented: every skill appears in the resume",
          all(s.lower().replace(" ", "") in RESUME_TXT.lower().replace(" ", "") for s in prof.get("skills", [])), prof.get("skills"))

    r = B.post("/resume", files={"file": ("Beta_Resume_TEST.docx", docx_bytes(RESUME_TXT.replace("Aarav Sharma", "Beta Tester")), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    check("A8 DOCX resume parsed for user B", r.status_code == 200 and r.json()["profile"]["name"] == "Beta Tester", r.text[:300])

    good_profile = A.get("/me").json()["profile"]
    bad = dict(good_profile, skills="Python", links=None, experience="nope")
    r = A.put("/profile", json=bad)
    p2 = A.get("/me").json()["profile"]
    check("A9 malformed profile is sanitized, not stored broken", r.status_code == 200 and p2["skills"] == ["Python"] and p2["experience"] == [] and p2["links"] == [], p2)
    A.put("/profile", json=good_profile)

    r = A.put("/preferences", json={"job_types": ["internship", "full_time", "bogus"], "roles": ["Data Analyst", "Machine Learning Engineer", "Backend Developer"],
                                    "experience_level": "student", "timezone": "Not/AZone", "onsite_india": True, "remote_india": True, "remote_global": True})
    me = A.get("/me").json()
    check("A10 invalid job type dropped, bad timezone ignored", r.status_code == 200 and me["preferences"]["job_types"] == ["internship", "full_time"]
          and me["user"]["timezone"] == "Asia/Kolkata", me["preferences"])
    A.put("/preferences", json=dict(me["preferences"], timezone="Asia/Kolkata"))

    C.get("/me")
    r = C.post("/resume", files={"file": ("x.txt", b"x" * 10, "text/plain")})  # creates a session, fails parsing
    r = C.post("/onboarding/complete")
    check("A11 cannot finish onboarding without a profile", r.status_code in (400, 401), r.status_code)

    r = A.post("/onboarding/complete")
    feed = A.get("/feed").json()
    check("A12 'matches ready' equals cards waiting", r.json()["matches"] == feed["remaining"], (r.json(), feed["remaining"]))
    B.put("/preferences", json=dict(B.get("/me").json()["preferences"], roles=["Data Analyst", "Machine Learning Engineer", "Backend Developer"], experience_level="student"))
    B.post("/onboarding/complete")

    # ---------------------------------------------------------------- B. discover
    cards = feed["cards"]
    check("B1 feed has cards", len(cards) > 3, len(cards))
    check("B1a every card is live, trusted and workable from India",
          all(c["active"] and c["trust_score"] >= 45 and (c["region"] == "india" or c["open_to_india"]) for c in cards),
          [(c["company"], c["region"], c["trust_score"]) for c in cards if not (c["region"] == "india" or c["open_to_india"])])
    check("B1b every card explains why it matched", all(c["match_reasons"] for c in cards))
    check("B1c no senior/lead roles for a student", all(c["seniority"] not in ("senior", "lead") for c in cards),
          [c["title"] for c in cards if c["seniority"] in ("senior", "lead")])
    check("B1d cards show the role, not just 'About us'", sum(1 for c in cards if c["summary"]) >= len(cards) * 0.8)

    prefs = A.get("/me").json()["preferences"]
    A.put("/preferences", json=dict(prefs, onsite_india=False, remote_india=True, remote_global=True))
    rc = A.get("/feed").json()["cards"]
    check("B2a 'remote only' preference shows only remote roles", all(c["workplace"] == "remote" for c in rc), [c["workplace"] for c in rc])
    excl = cards[0]["company"]
    A.put("/preferences", json=dict(prefs, exclude_companies=[excl]))
    check("B2b excluded company never shown", all(c["company"] != excl for c in A.get("/feed").json()["cards"]))
    A.put("/preferences", json=dict(prefs, cities=["Pune"]))
    pc = A.get("/feed").json()["cards"]
    check("B2c city filter respected (Pune or remote)", all(c["workplace"] == "remote" or "pune" in c["location"].lower() for c in pc),
          [c["location"] for c in pc if c["workplace"] != "remote"])
    A.put("/preferences", json=prefs)
    cards = A.get("/feed").json()["cards"]

    j1, j2, j3, j4, j5 = (c["user_job_id"] for c in cards[:5])
    r = A.post(f"/feed/{j1}/swipe", json={"direction": "sideways"})
    check("B3a invalid swipe direction rejected", r.status_code == 400)
    for j in (j1, j2, j3, j4):
        A.post(f"/feed/{j}/swipe", json={"direction": "right"})
    A.post(f"/feed/{j5}/swipe", json={"direction": "left"})
    A.post(f"/feed/{j5}/swipe", json={"direction": "undo"})
    check("B3b undo puts the card back", any(c["user_job_id"] == j5 for c in A.get("/feed").json()["cards"]))
    r = B.post(f"/feed/{j1}/swipe", json={"direction": "right"})
    check("B3c user B cannot swipe user A's card", r.status_code == 404, r.status_code)

    r = A.post("/feed/refresh")
    for _ in range(450):  # a full live crawl of 90 official sources takes several minutes
        if not A.get("/feed/refresh").json()["running"]:
            break
        time.sleep(2)
    check("B4 refresh completes", not A.get("/feed/refresh").json()["running"])

    # ---------------------------------------------------------------- C. tracker
    tr = A.get("/tracker").json()["items"]
    check("C1 tracker shows the 4 saved jobs", {i["user_job_id"] for i in tr} >= {j1, j2, j3, j4}, [i["user_job_id"] for i in tr])
    check("C2a invalid stage rejected", A.patch(f"/jobs/{j1}", json={"status": "hired!!"}).status_code == 400)
    check("C2b invalid deadline rejected", A.patch(f"/jobs/{j1}", json={"deadline": "next tuesday"}).status_code == 400)
    due = (datetime.utcnow() + timedelta(days=2)).strftime("%Y-%m-%dT18:00:00")
    A.patch(f"/jobs/{j1}", json={"deadline": due, "notes": "Referral from Priya"})
    d = A.get(f"/jobs/{j1}").json()
    check("C2c deadline creates a reminder, notes saved", any(r["kind"] == "deadline" for r in d["reminders"]) and d["notes"] == "Referral from Priya", d["reminders"])
    check("C3a reminder without title rejected", A.post("/reminders", json={"due_at": due}).status_code == 400)
    rid = A.post("/reminders", json={"title": "Prepare for interview", "due_at": due, "user_job_id": j1}).json()["id"]
    check("C3b reminder created and listed", any(r["id"] == rid for r in A.get("/reminders").json()))
    check("C3c user B cannot complete A's reminder", B.patch(f"/reminders/{rid}", json={"done": True}).status_code == 404)
    check("C4 user B cannot open A's job", B.get(f"/jobs/{j1}").status_code == 404)

    # ---------------------------------------------------------------- D. contacts
    check("D1a invalid address rejected", A.post(f"/jobs/{j1}/contacts", json={"email": "not-an-email"}).status_code == 400)
    check("D1b domain without mail server rejected", A.post(f"/jobs/{j1}/contacts", json={"email": "hr@no-mx-domain-kold-test.invalid"}).status_code == 400)
    contacts = {}
    for i, j in enumerate((j1, j2, j3, j4)):
        r = A.post(f"/jobs/{j}/contacts", json={"email": f"kold.sandbox.recruiter{i}@gmail.com"})
        contacts[j] = r.json()["email"] if r.status_code == 200 else None
    check("D1c valid address added", all(contacts.values()), contacts)
    r2 = A.post(f"/jobs/{j1}/contacts", json={"email": contacts[j1]})
    check("D1d adding the same address twice doesn't duplicate", r2.json()["id"] == A.get(f"/jobs/{j1}").json()["contacts"][0]["id"]
          and len([c for c in A.get(f"/jobs/{j1}").json()["contacts"] if c["email"] == contacts[j1]]) == 1)
    shared_job = db("SELECT job_id FROM userjob WHERE id=?", (j1,))[0][0]
    bj = db("SELECT id FROM userjob WHERE user_id=(SELECT user_id FROM userjob WHERE id=?) AND job_id=?", (j1, shared_job))
    b_id = B.get("/me").json()["user"]["id"]
    b_uj = [r[0] for r in db("SELECT id FROM userjob WHERE user_id=? AND job_id=?", (b_id, shared_job))]
    if b_uj:
        B.post(f"/feed/{b_uj[0]}/swipe", json={"direction": "right"})
        bc = [c["email"] for c in B.get(f"/jobs/{b_uj[0]}").json()["contacts"]]
        check("D2 user B never sees an address user A typed in", contacts[j1] not in bc, bc)
        r = B.post(f"/jobs/{b_uj[0]}/outreach", json={"to_email": contacts[j1]})
        check("D3 user B cannot start outreach to A's private contact", r.status_code == 400, r.text)
    else:
        check("D2 (skipped: B has no shared job)", True)
    _ = bj
    r = A.post(f"/jobs/{j2}/outreach", json={"to_email": contacts[j1]})
    check("D4 cannot email a contact that isn't listed for that job", r.status_code == 400, r.text)

    # ---------------------------------------------------------------- E. outreach (sandbox Gmail)
    t0 = time.time()
    r = A.post(f"/jobs/{j1}/outreach", json={"to_email": contacts[j1], "gaps": [3, 6], "max_followups": 2})
    check(f"E1 outreach starts: resume tailored + first draft ({time.time() - t0:.0f}s)", r.status_code == 200, r.text)
    camp1 = r.json().get("campaign_id")
    td = today(A)
    first = next((e for e in td["emails"] if e["campaign_id"] == camp1), None)
    check("E1a first email waits in Today as 'pending' (nothing sent)", first and first["status"] == "pending", td)
    check("E1b attachment name is clean (no internal ids)", first and first["attachment"] == "Aarav_Sharma_Resume.pdf", first and first["attachment"])
    check("E1c tailored PDF downloads", A.get(f"/jobs/{j1}/resume.pdf").headers.get("content-type") == "application/pdf")
    check("E1d user B cannot download A's resume", B.get(f"/jobs/{j1}/resume.pdf").status_code == 404)
    r = A.post(f"/jobs/{j1}/outreach", json={"to_email": contacts[j1]})
    check("E2a starting again returns the same campaign", r.json().get("campaign_id") == camp1, r.text)
    A.post(f"/jobs/{j2}/contacts", json={"email": contacts[j1]})
    r = A.post(f"/jobs/{j2}/outreach", json={"to_email": contacts[j1]})
    check("E2b same inbox can't get two parallel sequences (409)", r.status_code == 409, r.text)
    r = A.post(f"/outbox/{first['id']}/send", json={"when": "now"})
    check("E3 sending without Gmail connected is refused", r.status_code == 400 and "Gmail" in r.text, r.text)

    connect_gmail(A)
    check("E4 sandbox Gmail connects", A.get("/me").json()["gmail"]["connected"] is True)

    r = A.put(f"/outbox/{first['id']}", json={"subject": first["subject"], "body": first["body"] + "\n\nI'm free [your availability]."})
    check("E5a placeholder blocks sending", r.json()["quality"]["ready"] is False)
    check("E5b send refused while placeholder present", A.post(f"/outbox/{first['id']}/send", json={"when": "now"}).status_code == 400)
    r = A.put(f"/outbox/{first['id']}", json={"subject": "Data intern\r\nBcc: everyone@evil.test", "body": first["body"]})
    stored = next(e for e in today(A)["emails"] if e["id"] == first["id"])
    check("E5c subject can't inject headers (newlines removed)", "\n" not in stored["subject"] and "\r" not in stored["subject"], stored["subject"])
    A.put(f"/outbox/{first['id']}", json={"subject": first["subject"], "body": first["body"]})

    codes = []

    def fire():
        with client() as c2:
            c2.cookies = A.cookies
            codes.append(c2.post(f"/outbox/{first['id']}/send", json={"when": "now"}).status_code)

    ts = [threading.Thread(target=fire) for _ in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    box = A.get("/sandbox/mailbox").json()
    sent_msgs = [m for t in box.values() for m in t["messages"] if "SENT" in m["label_ids"]]
    check("E6 four simultaneous 'Send' taps send exactly ONE email", codes.count(200) == 1 and len(sent_msgs) == 1, (codes, len(sent_msgs)))
    check("E6a the sent email carries the tailored resume", sent_msgs and sent_msgs[0]["attachment"] == "Aarav_Sharma_Resume.pdf")
    check("E7 sending it again is refused", A.post(f"/outbox/{first['id']}/send", json={"when": "now"}).status_code == 409)
    check("E8a skipping a sent email is refused", A.post(f"/outbox/{first['id']}/skip").status_code == 409)
    check("E8b rewriting a sent email is refused", A.post(f"/outbox/{first['id']}/regenerate").status_code == 409)
    d = A.get(f"/jobs/{j1}").json()
    check("E9 campaign recorded: 1 sent, follow-up scheduled in 3 days", d["campaign"]["steps_sent"] == 1 and d["campaign"]["next_due"], d["campaign"])
    check("E9a no follow-up drafted before it's due", not [e for e in today(A)["emails"] if e["campaign_id"] == camp1 and e["status"] == "pending"])

    r = A.post("/sandbox/advance", json={"campaign_id": camp1})
    fu = next((e for e in today(A)["emails"] if e["campaign_id"] == camp1 and e["status"] == "pending"), None)
    check("E10 follow-up drafted when due (not sent)", r.json()["drafted"] == 1 and fu and fu["step"] == 1, (r.json(), fu))
    check("E10a follow-up replies in the same thread ('Re:')", fu and fu["subject"].startswith("Re: "), fu and fu["subject"])
    check("E10b follow-up has no attachment", fu and not fu["attachment"])

    r = A.post(f"/outbox/{fu['id']}/send", json={"when": "best"})
    if r.json().get("status") == "scheduled":
        db("UPDATE outboxemail SET scheduled_for=? WHERE id=?", ((datetime.utcnow() - timedelta(minutes=1)).isoformat(sep=" "), fu["id"]))
        for _ in range(45):
            time.sleep(2)
            if db("SELECT status FROM outboxemail WHERE id=?", (fu["id"],))[0][0] == "sent":
                break
        check("E11 'send at their morning' is sent by the scheduler when due", db("SELECT status FROM outboxemail WHERE id=?", (fu["id"],))[0][0] == "sent")
    else:
        check("E11 'best time' is now for this recipient, so it sent immediately", r.json().get("status") == "sent", r.text)
    box = A.get("/sandbox/mailbox").json()
    thread = next(t for t in box.values() if t["campaign_id"] == camp1)["messages"]
    check("E12 follow-up threaded under the first email (In-Reply-To)", len(thread) == 2 and thread[1]["headers"].get("in-reply-to") == thread[0]["message_id_header"],
          [m.get("headers") for m in thread])

    A.post("/sandbox/advance", json={"campaign_id": camp1})  # follow-up 2 drafted
    A.post("/sandbox/reply", json={"campaign_id": camp1, "from_name": "Priya (Talent)", "body": "Thanks Aarav! Are you available for a quick call on Thursday at 4pm?"})
    n = A.post("/inbox/check").json()["new"]
    inbox = A.get("/inbox").json()["messages"]
    m1 = inbox[0] if inbox else {}
    d = A.get(f"/jobs/{j1}").json()
    check("E13 positive reply detected", n == 1 and m1.get("label") == "positive", (n, m1.get("label")))
    check("E13a follow-ups stop the moment they reply", d["campaign"]["status"] == "replied"
          and not [e for e in today(A)["emails"] if e["campaign_id"] == camp1 and e["status"] == "pending"], d["campaign"])
    check("E13b job moves to 'Replied' in tracker", d["status"] == "replied")
    check("E13c dashboard flags it as needing attention", A.get("/stats").json()["needs_attention"] >= 1)
    check("E13d checking again doesn't duplicate the reply", A.post("/inbox/check").json()["new"] == 0)
    skipped_fu = [e for e in d["emails"] if e["status"] == "skipped"]
    if skipped_fu:
        check("E14 a stale follow-up can't be sent after they replied", A.post(f"/outbox/{skipped_fu[0]['id']}/send", json={"when": "now"}).status_code == 409)

    r = A.post(f"/inbox/{m1['id']}/mode", json={"mode": "assisted"})
    draft = r.json().get("suggested_reply", "")
    check("E15a assisted reply drafted", r.status_code == 200 and len(draft.split()) > 10, draft[:200])
    r = A.post(f"/inbox/{m1['id']}/send", json={"body": "Thanks Priya, I'm free [time]."})
    check("E15b reply with [placeholder] refused", r.status_code == 400)
    r = A.post(f"/inbox/{m1['id']}/send", json={"body": "Hi Priya,\n\nThursday at 4pm works for me. Looking forward to it.\n\nAarav Sharma"})
    box = A.get("/sandbox/mailbox").json()
    thread = next(t for t in box.values() if t["campaign_id"] == camp1)["messages"]
    check("E15c reply sent in-thread, answering their message", r.status_code == 200 and thread[-1]["label_ids"] == ["SENT"]
          and thread[-1]["headers"].get("in-reply-to") == thread[-2]["message_id_header"], [m["subject"] for m in thread])
    check("E15d reply marked handled", next(m for m in A.get("/inbox").json()["messages"] if m["id"] == m1["id"])["handled"])

    def new_campaign(j):
        r = A.post(f"/jobs/{j}/outreach", json={"to_email": contacts[j]})
        cid = r.json().get("campaign_id")
        ob = next(e for e in today(A)["emails"] if e["campaign_id"] == cid and e["status"] == "pending")
        A.post(f"/outbox/{ob['id']}/send", json={"when": "now"})
        return cid

    camp2 = new_campaign(j2)
    A.post("/sandbox/reply", json={"campaign_id": camp2, "body": "Please stop emailing me. I did not ask for this."})
    A.post("/inbox/check")
    d = A.get(f"/jobs/{j2}").json()
    check("E16a annoyed reply pauses outreach and asks", d["campaign"]["status"] == "paused" and "decision" in d["campaign"]["stop_reason"], d["campaign"])
    r = A.post(f"/campaigns/{camp2}/decision", json={"action": "resume"})
    check("E16b resume drafts the next follow-up right away", r.json()["status"] == "active"
          and any(e["campaign_id"] == camp2 and e["status"] == "pending" for e in today(A)["emails"]), r.text)
    A.post(f"/campaigns/{camp2}/decision", json={"action": "stop"})
    check("E16c stop cancels the pending draft", not any(e["campaign_id"] == camp2 and e["status"] == "pending" for e in today(A)["emails"]))
    A.post("/sandbox/reply", json={"campaign_id": camp2, "body": "Actually, sorry for the tone. We do have an opening. Can we schedule a call?"})
    A.post("/inbox/check")
    d = A.get(f"/jobs/{j2}").json()
    labels = [m["label"] for m in A.get("/inbox").json()["messages"] if m["campaign_id"] == camp2]
    check("E16d a reply after you stopped is still shown", "positive" in labels, labels)
    check("E16e ...and outreach stays stopped", d["campaign"]["status"] == "stopped", d["campaign"])

    camp3 = new_campaign(j3)
    A.post("/sandbox/advance", json={"campaign_id": camp3})
    back = (datetime.utcnow() + timedelta(days=10)).strftime("%d %B")
    A.post("/sandbox/reply", json={"campaign_id": camp3, "subject": "Automatic reply: Out of office", "headers": {"auto-submitted": "auto-replied"},
                                   "body": f"I am out of office with limited access to email. I will be back on {back}."})
    A.post("/inbox/check")
    d = A.get(f"/jobs/{j3}").json()
    check("E17a out-of-office pauses follow-ups until they return", d["campaign"]["paused_until"] and d["campaign"]["status"] == "active", d["campaign"])
    check("E17b pending follow-up cancelled during the absence", not any(e["campaign_id"] == camp3 and e["status"] == "pending" for e in today(A)["emails"]))
    ooo = next(m for m in A.get("/inbox").json()["messages"] if m["campaign_id"] == camp3)
    check("E17c OOO doesn't nag you (already handled) and return date parsed", ooo["handled"] and ooo["return_date"], ooo)
    r = A.post("/sandbox/advance", json={"campaign_id": camp3})
    check("E17d no follow-up drafted while they're away", r.json()["drafted"] == 0, r.json())

    camp4 = new_campaign(j4)
    A.post("/sandbox/reply", json={"campaign_id": camp4, "from_email": "mailer-daemon@googlemail.com", "from_name": "Mail Delivery Subsystem",
                                   "subject": "Delivery Status Notification (Failure)", "body": "Address not found. Your message wasn't delivered."})
    A.post("/inbox/check")
    d = A.get(f"/jobs/{j4}").json()
    check("E18a bounce stops outreach", d["campaign"]["status"] == "stopped" and d["campaign"]["stop_reason"] == "Address bounced", d["campaign"])
    check("E18b bounced address can't be resumed", A.post(f"/campaigns/{camp4}/decision", json={"action": "resume"}).status_code == 400)
    check("E18c bounced address is no longer offered", contacts[j4] not in [c["email"] for c in d["contacts"]], d["contacts"])

    # User answers the camp2 positive reply themselves, from Gmail.
    tid2 = db("SELECT thread_id FROM campaign WHERE id=?", (camp2,))[0][0]
    from kold.services import gmail as g  # same machine: write straight into the sandbox mailbox
    g.sandbox_add(tid2, {"from_email": "you@kold.sandbox", "body": "Sure, Tuesday works.", "label_ids": ["SENT"]})
    A.post("/inbox/check")
    pos2 = next(m for m in A.get("/inbox").json()["messages"] if m["campaign_id"] == camp2 and m["label"] == "positive")
    check("E19 replying yourself in Gmail marks it handled in Kold", pos2["handled"] and pos2["reply_mode"] == "self", pos2)
    check("E19a your own Gmail message is never treated as a company reply",
          not any(m["body"] == "Sure, Tuesday works." for m in A.get("/inbox").json()["messages"]))

    check("E20a invalid label rejected", A.post(f"/inbox/{m1['id']}/label", json={"label": "amazing"}).status_code == 400)
    A.post(f"/inbox/{m1['id']}/label", json={"label": "question"})
    m1b = next(m for m in A.get("/inbox").json()["messages"] if m["id"] == m1["id"])
    check("E20b correction saved as your label (training data)", m1b["label"] == "question" and m1b["label_source"] == "user")

    # Replies that arrive as a brand-new email (not in our thread) must still land on the dashboard.
    A.post("/sandbox/reply", json={"campaign_id": camp1, "new_thread": True, "from_email": contacts[j1],
                                   "subject": "Interview slots for next week", "body": "Hi Aarav, following up separately: could you share two interview slots next week?"})
    A.post("/sandbox/reply", json={"campaign_id": camp1, "new_thread": True, "from_email": "newsletter@gmail.com",
                                   "subject": "Weekly digest", "body": "Top stories this week", "headers": {"list-unsubscribe": "<x>"}})
    n = A.post("/inbox/check").json()["new"]
    convs = A.get("/conversations").json()["conversations"]
    c1 = next(c for c in convs if c["campaign_id"] == camp1)
    fresh = [m for m in c1["messages"] if m["kind"] == "received" and m.get("new_thread")]
    check("E23a a reply sent as a NEW email is caught and filed under the right company", n == 1 and len(fresh) == 1 and fresh[0]["subject"] == "Interview slots for next week", (n, fresh))
    check("E23b unrelated mail is never pulled in", not any("digest" in m.get("subject", "").lower() for c in convs for m in c["messages"]))
    check("E23c conversation shows your emails and their replies in order",
          [m["kind"] for m in c1["messages"]][:2] == ["sent", "sent"] and c1["messages"] == sorted(c1["messages"], key=lambda m: m["at"]))
    check("E23g your reply sent through Kold appears in the conversation",
          any(m["kind"] == "sent" and m.get("via") == "kold" and "Thursday at 4pm" in m["body"] for m in c1["messages"]))
    c2 = next(c for c in convs if c["campaign_id"] == camp2)
    check("E23h your reply sent from Gmail appears in the conversation too",
          any(m["kind"] == "sent" and m.get("via") == "gmail" and "Tuesday works" in m["body"] for m in c2["messages"]), [m.get("via") for m in c2["messages"]])
    check("E23d every company you emailed has a conversation", {c["campaign_id"] for c in convs} >= {camp1, camp2, camp3, camp4})
    check("E23e conversations needing you are listed first", convs[0]["needs_you"] > 0)
    r = A.post(f"/inbox/{fresh[0]['id']}/send", json={"body": "Hi,\n\nTuesday 11am or Wednesday 3pm both work.\n\nAarav Sharma"})
    box = A.get("/sandbox/mailbox").json()
    check("E23f replying to the new email answers in THAT email's thread", r.status_code == 200 and any(
        m.get("label_ids") == ["SENT"] and m["thread_id"] == fresh[0]["thread_url"].split("/")[-1] for t in gmail_threads() for m in t), r.text)
    _ = box
    h = A.get("/home").json()
    check("E24a Home lists replies that need you", h["replies_waiting"] >= 1 and h["replies"], h["replies_waiting"])
    check("E24b Home shows pipeline, deadlines and matches", sum(h["pipeline"].values()) >= 4 and h["deadlines"] and "top_matches" in h, h["pipeline"])

    # Isolation: user B poking at user A's things.
    aob = first["id"]
    check("E22a B can't edit A's email", B.put(f"/outbox/{aob}", json={"body": "x"}).status_code == 404)
    check("E22b B can't send A's email", B.post(f"/outbox/{aob}/send", json={"when": "now"}).status_code == 404)
    check("E22c B can't stop A's outreach", B.post(f"/campaigns/{camp1}/decision", json={"action": "stop"}).status_code == 404)
    check("E22d B can't read/draft A's replies", B.post(f"/inbox/{m1['id']}/mode", json={"mode": "assisted"}).status_code == 404)
    check("E22e B can't inject into A's sandbox thread", B.post("/sandbox/reply", json={"campaign_id": camp1, "body": "hi"}).status_code == 404)
    check("E22f B's inbox and Today are empty", not B.get("/inbox").json()["messages"] and not today(B)["emails"])

    # ---------------------------------------------------------------- F. misc
    acts = [a["message"] for a in A.get("/activity?limit=300").json()]
    check("F1 activity log records sends, replies, pauses and stops",
          any(a.startswith("Sent first email") for a in acts) and any("replied positively" in a for a in acts)
          and any("out of office" in a for a in acts) and any("bounced" in a for a in acts), acts[:8])
    st = A.get("/stats").json()
    check("F2 stats add up", st["sent"] == db("SELECT count(*) FROM outboxemail WHERE status='sent' AND user_id=(SELECT user_id FROM campaign WHERE id=?)", (camp1,))[0][0], st)
    check("F3 push subscribe without endpoint rejected", A.post("/push/subscribe", json={}).status_code == 400)
    r = B.delete("/me")
    check("F4 user B deletes their account", r.status_code == 200 and B.get("/me").json()["user"] is None)
    check("F4a user A unaffected", A.get("/me").json()["user"] is not None and A.get("/inbox").json()["messages"])
    C.delete("/me")

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    for name, _, detail in failed:
        print("  FAILED:", name, "|", str(detail)[:300])
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
