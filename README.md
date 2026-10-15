# Kold

**Cold outreach, warm replies.** · [Open Kold Lite](https://jiviteshkumar.github.io/kold/app/) · [Home page](https://jiviteshkumar.github.io/kold/)

 Kold reads your resume, finds genuine opportunities you can actually take from India (on-site, or remote with US/UK/EU/global companies that accept Indian candidates), and runs polite, tailored cold-email outreach. You approve every single email.

```
web/   Next.js 16 PWA (installable on Android + iPhone, no app stores)
api/   FastAPI backend: sources, matching, contact discovery, Gmail, local AI
```

## Two versions

| | **Kold Lite** (open the link) | **Kold Full** (your own free server) |
|---|---|---|
| Install | Nothing. Open the link, *Add to Home Screen* | One command on a free Oracle server, or your PC |
| Job feed | Scanned daily from official boards by GitHub Actions; matched on your phone every time you open the app | Scanned every few hours on your server |
| AI | Optional on-device model (Qwen3.5 0.8B–4B via WebGPU), downloaded only if you agree. Works without it | Qwen3.5 4B via Ollama |
| Email | Your Gmail, sent from your phone while Kold is open | Your Gmail, sent and checked around the clock |
| Data | Only on your device (export a backup anytime) | Your server, all your devices |

**How Lite works:** `.github/workflows/pages.yml` runs once a day (06:00 IST). It crawls the same official sources as the server (`api/scripts/export_feed.py`), keeps listings that pass the trust and India-eligibility checks, and publishes them with the app to GitHub Pages at `/kold/data/`. When you open the app it downloads the feed only if it changed, then scores every listing against your profile on your device, drafts the day's emails, checks reminders and looks for replies. It repeats every 15 minutes while open. Everything you do in Lite runs through `web/src/local/`, which mirrors the server's API so both versions share the same screens.

**Lite + real Gmail:** create a Google OAuth *Web* client (see Gmail setup), add `https://jiviteshkumar.github.io` to its **Authorized JavaScript origins**, then set the repository variable `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (Settings → Secrets and variables → Actions → Variables) and re-run the workflow. Until then Lite offers a demo mailbox. Note: GitHub pauses scheduled workflows after 60 days without repository activity; re-enable it from the Actions tab if that happens.

## How it works

| Step | What Kold does | What keeps it genuine |
|---|---|---|
| Resume → profile | Local model structures your resume; you edit everything | Every extracted fact is checked against the resume text; anything not found is dropped |
| Discover | Pulls listings from employers' **official** careers boards (Greenhouse, Lever, Ashby) and public remote-job feeds (Remotive, Remote OK, Himalayas, Arbeitnow) | No LinkedIn/Indeed/Naukri scraping. Each card shows its source, a trust score with reasons, and scam warnings. Listings the employer removes are closed automatically |
| Match | Explainable score (role, skills, level, location, freshness) | Each card says *why* it matched; roles abroad that aren't open to India are filtered out |
| Contacts | Finds emails published on the posting or the company's own site | robots.txt respected; no guessed addresses; MX-verified; shows the exact page each address came from |
| Tailored resume | Reorders and lightly rephrases for the role, outputs a PDF | Rephrases are rejected if they add numbers, skills or claim words not in the original |
| Today | Drafts first emails and follow-ups into a daily review queue | **Nothing sends without your tap.** Pre-send check flags placeholders, spam phrases and any sentence about you that your resume doesn't back |
| Send | From your Gmail, now or at the recipient's morning (timezone-aware) | 25/day cap, max 2 follow-ups, follow-ups thread under the first email |
| Inbox | One conversation per company: your emails and every reply, labeled. Reads only threads Kold started plus new emails from companies you contacted (about your application) | Any human reply stops follow-ups. "Annoyed"/"declined" pauses and asks you. Out-of-office pauses until they're back. Bounces stop |
| Reply | "I'll reply myself" or "Draft a reply"; drafts are editable | Unknowns are left as `[placeholders]` that block sending until you fill them |

**Home** is the first stop: replies that need you, emails to approve, deadlines this week, new matches, your pipeline and what Kold just did, on one screen.

**Inbox** keeps one conversation per company with the complete back-and-forth: your first email and follow-ups, every reply they send (including replies sent as a *new* email or from a colleague at the same company), and replies you sent through Kold or from Gmail. Filter by Needs you, Interested, Questions, Not now/No, Auto-replies, Bounced or No reply yet.

Every automated action is written to the activity log (bell icon): the full record of what Kold did.

## Run it locally (Windows)

Prereqs: Python 3.12+, Node 20+, [Ollama](https://ollama.com) with a model pulled (`ollama pull qwen3.5:4b`).

```bash
cd api
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
cp .env.example .env            # then fill in Google OAuth (see below)
.venv/Scripts/python -m uvicorn kold.main:app --port 8000
```

```bash
cd web
npm install
npm run dev                     # http://localhost:3000
```

The first scan takes about a minute (60+ sources). Tests: `cd api && .venv/Scripts/python -m pytest`.

## Sandbox mode (try everything without real email)

`KOLD_GMAIL_SANDBOX=1` in `api/.env` simulates Gmail with a local file: sends, follow-ups and replies all work, nothing leaves your computer, and a yellow banner says so. Run the full end-to-end test against it with `python -m tests.e2e_live`.

## Gmail setup (Google OAuth)

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project → enable **Gmail API**.
2. **OAuth consent screen** → External → add scopes `gmail.send`, `gmail.readonly`, `userinfo.email` → add yourself (and up to 100 testers) as **test users**.
3. **Credentials** → OAuth client ID → *Web application* → Authorized redirect URI: `http://localhost:3000/api/gmail/callback` (and your HTTPS domain later).
4. Put the client ID and secret in `api/.env`, set `KOLD_WEB_ORIGIN` to the web app's URL, and remove `KOLD_GMAIL_SANDBOX=1`.
5. Run `python -m scripts.check_gmail_setup` (from `api/`). It confirms everything and prints the exact redirect URI to register.

In **testing** mode Google allows up to 100 users with no review, but sign-ins expire every 7 days. `gmail.readonly` is a *restricted* scope, so a public launch needs Google verification plus an annual CASA security assessment. Budget for this before opening Kold to everyone.

## Put Kold online for free (runs by itself, no PC needed)

Kold runs 24/7 on Oracle Cloud's **Always Free** server, with no monthly cost. It starts on boot, restarts on crashes, serves `https`, refreshes job listings and backs up nightly.

> The free allowance is 2–4 ARM cores and 12–24 GB RAM (Oracle reportedly reduced it in 2026). Kold's AI runs on the processor there, so drafting an email takes about 1–2 minutes instead of seconds. Oracle asks for a card to verify you; Always Free resources are not charged.

1. **Server:** sign up at [cloud.oracle.com](https://cloud.oracle.com) (pick a home region near you, e.g. Mumbai or Hyderabad). Then **Compute → Instances → Create instance**:
   - Image: **Ubuntu 24.04** (Canonical). Shape: **Ampere VM.Standard.A1.Flex** with the most OCPUs/memory the "Always Free" label allows.
   - Under *Add SSH keys*, choose **Generate a key pair** and **download the private key** (you need it to log in).
   - If you see "Out of capacity", try another availability domain or try again later.
2. **Open the web ports:** on the instance page → its **Subnet → Security list → Add ingress rules**: source `0.0.0.0/0`, TCP, destination port `80`, and again for `443`.
3. **Free web address:** at [duckdns.org](https://www.duckdns.org), sign in, create a subdomain (e.g. `kold-yourname`) and set its IP to your instance's **public IP**.
4. **Install:** connect to the server (Oracle's *Cloud Shell*, or `ssh -i <private-key> ubuntu@<public-ip>`) and run:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/JiviteshKumar/kold/main/deploy/setup.sh | sudo bash -s -- kold-yourname.duckdns.org
   ```

   Takes ~15 minutes (it downloads the AI model). Then open `https://kold-yourname.duckdns.org`.
5. **Gmail:** create the Google OAuth client (below) with redirect URI `https://kold-yourname.duckdns.org/api/gmail/callback`, paste the ID and secret into `/opt/kold/api/.env` on the server, and run `sudo systemctl restart kold-api`.

Update to the latest code anytime by running the same `setup.sh` command again.

## Put it on your phone (no Play Store / App Store)

Kold is a PWA. It needs HTTPS to install.

- **To try it now:** run both servers, then expose the web app with a free HTTPS tunnel, for example `cloudflared tunnel --url http://localhost:3000`. Open the URL on your phone:
  - **Android (Chrome):** menu → *Install app*.
  - **iPhone (Safari):** Share → *Add to Home Screen*. Notifications work on iOS 16.4+ once it's on the Home Screen.
  - Add the tunnel URL's callback to your Google OAuth redirect URIs.
- **For real users:** follow *Put Kold online for free* above, then open your `https://…duckdns.org` address on the phone and install it. As usage grows, move to a server with a GPU for faster drafting, and switch `KOLD_DATABASE_URL` to Postgres.

Push notifications: generate keys with `python -m scripts.gen_vapid`, then add them to `.env`.

## Honest limitations (next steps)

- **Contacts:** many companies don't publish an email on their site. Kold then says so and lets you add one you know (from a referral, LinkedIn or an event). It never guesses.
- **Writing model:** `qwen3.5:4b` is fast on a laptop GPU but can over-reach. The claim check catches unsupported first-person sentences and shows them to you; still read every draft. A larger model (set `KOLD_LLM_MODEL`) writes better but slower.
- **Reply classifier:** starts with rules plus the local model. After you've confirmed about 30 reply labels in the Inbox, run `python -m scripts.train_classifier` to train Kold's own model on *your real data* (nothing synthetic).
- **Sources:** 86 verified employer boards (Greenhouse, Lever, Ashby, SmartRecruiters) plus 4 feeds. Add more with `python -m scripts.check_sources <greenhouse|lever|ashby|smartrecruiters> <slug>`, then list them in `api/kold/sources/companies.json`.
- **Not yet:** Outlook support, Postgres migrations. (On a new device, "Sign in with Google" opens your existing account.)
