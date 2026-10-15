"use client";

/**
 * Kold Lite engine: answers the same requests as the Python server, in the same JSON shapes, but entirely on the
 * user's device. lib/api.ts routes every call here when the app is the Lite (static) build.
 */
import { onAiStatus, type AiStatus } from "./ai";
import { all, del, get, kvGet, kvSet, nowIso, put, where, wipe, type Row } from "./db";
import { allJobs, currentMeta, getJob, publishedContacts, syncFeed, type FeedJob } from "./feed";
import * as gmail from "./gmail";
import { scoreJob, MIN_SCORE } from "./matching";
import * as O from "./outreach";
import { check } from "./quality";
import { extractText, parseResume } from "./resume";
import { addDays, todayLocal } from "./text";
import { shortRole, supportText } from "./writer";
import type { Preferences, Profile } from "@/lib/types";

export class LocalApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const fail = (status: number, msg: string): never => {
  throw new LocalApiError(status, msg);
};

const DEFAULT_PREFS: Preferences = {
  job_types: ["internship", "full_time"], roles: [], cities: [], onsite_india: true, remote_india: true, remote_global: true,
  include_unclear_remote: false, experience_level: "", exclude_companies: [], exclude_keywords: [],
};
const TYPE_LABEL: Record<string, string> = { internship: "Internship", full_time: "Full-time", part_time: "Part-time", contract: "Contract" };
const STAGES = ["liked", "applied", "reaching_out", "replied", "interview", "offer", "rejected", "archived"];
type User = { name: string; email: string; timezone: string; onboarded: boolean };
type Contact = Row & { email: string; domain: string; role_hint: string; source_url: string; confidence: string; mx_ok: boolean; bounced?: boolean; found_at: string; user_job_id?: number | null };
type Reminder = Row & { user_job_id?: number | null; kind: string; title: string; due_at: string; done: boolean; notified_stage: number };

let aiState: AiStatus | null = null;
if (typeof window !== "undefined") onAiStatus((s) => (aiState = s));

const user = () => kvGet<User | null>("user", null);
const prefs = () => kvGet<Preferences>("prefs", DEFAULT_PREFS);

// ------------------------------------------------------------------------------------------- time zones (for hints)
const TZ: [RegExp, string][] = [
  [/san francisco|bay area|seattle|los angeles|palo alto|mountain view|san jose|sunnyvale|portland|san diego|menlo park|san mateo|oakland/i, "America/Los_Angeles"],
  [/denver|boulder|salt lake|phoenix/i, "America/Denver"], [/chicago|austin|dallas|houston|minneapolis/i, "America/Chicago"],
  [/new york|nyc|boston|atlanta|miami|washington|philadelphia|toronto|montreal/i, "America/New_York"], [/vancouver/i, "America/Vancouver"],
  [/london|manchester|edinburgh|\buk\b|united kingdom|england|cardiff/i, "Europe/London"], [/dublin|ireland/i, "Europe/Dublin"],
  [/berlin|munich|hamburg|germany/i, "Europe/Berlin"], [/paris|france/i, "Europe/Paris"], [/amsterdam|netherlands/i, "Europe/Amsterdam"],
  [/madrid|barcelona|spain/i, "Europe/Madrid"], [/lisbon|portugal/i, "Europe/Lisbon"], [/warsaw|krakow|poland/i, "Europe/Warsaw"],
  [/tel aviv|israel/i, "Asia/Jerusalem"], [/dubai|abu dhabi|uae/i, "Asia/Dubai"], [/singapore/i, "Asia/Singapore"], [/tokyo|japan/i, "Asia/Tokyo"],
  [/sydney|melbourne|australia/i, "Australia/Sydney"], [/canada/i, "America/Toronto"], [/\bus\b|\busa\b|united states|america/i, "America/New_York"],
  [/europe|emea|\beu\b/i, "Europe/Berlin"],
];
function tzFor(j: FeedJob): string {
  if (j.region === "india" || /india|bengaluru|bangalore|mumbai|delhi|gurugram|gurgaon|noida|hyderabad|pune|chennai|kolkata/i.test(j.location)) return "Asia/Kolkata";
  return TZ.find(([re]) => re.test(j.location))?.[1] ?? (j.region === "unknown" ? "Asia/Kolkata" : "UTC");
}
function recommended(j: FeedJob): string {
  const tz = tzFor(j);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", weekday: "short", hour12: false })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = !["Sat", "Sun"].includes(parts.weekday);
  if (weekday && mins >= 570 && mins <= 990) return new Date().toISOString();
  const offsetMin = (d: Date) => {
    const local = new Date(d.toLocaleString("en-US", { timeZone: tz }));
    return (local.getTime() - d.getTime()) / 60000;
  };
  const d = new Date();
  for (let i = 0; i < 8; i++) {
    const cand = new Date(d.getTime() + i * 86400000);
    const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(cand);
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(cand);
    const at = new Date(`${ymd}T09:30:00Z`);
    const target = new Date(at.getTime() - offsetMin(at) * 60000);
    if (!["Sat", "Sun"].includes(day) && target.getTime() > Date.now()) return target.toISOString();
  }
  return new Date().toISOString();
}

// ------------------------------------------------------------------------------------------- serializers
function summaryOf(j: FeedJob) {
  return j.summary || j.description.slice(0, 320);
}
function jobCard(j: FeedJob, uj?: O.UJ, full = false) {
  const d: Record<string, unknown> = {
    id: j.id, company: j.company, company_domain: j.domain, title: j.title, department: j.department, location: j.location, workplace: j.workplace,
    region: j.region, open_to_india: j.open_to_india, job_type: j.job_type, job_type_label: TYPE_LABEL[j.job_type] ?? j.job_type, seniority: j.seniority,
    url: j.url, apply_url: j.apply_url, source: j.source, source_label: j.source_label, source_url: j.source_url, posted_at: j.posted_at,
    deadline: j.deadline, salary: j.salary, tags: (j.tags ?? []).slice(0, 8), trust_score: j.trust_score, trust_flags: j.trust_flags,
    active: j.active !== false, summary: summaryOf(j),
  };
  if (full) d.description = j.description + (j.description.length >= 2990 ? "\n\n(Read the full posting on the employer's site.)" : "");
  if (uj) Object.assign(d, { user_job_id: uj.id, status: uj.status, match_score: uj.match_score, match_reasons: uj.match_reasons, notes: uj.notes,
    my_deadline: uj.deadline ?? j.deadline, updated_at: uj.updated_at });
  return d;
}
function campSummary(c?: O.Camp | null) {
  return c ? { id: c.id, status: c.status, to: c.to_email, steps_sent: c.steps_sent, max_followups: c.max_followups, gaps: c.gaps,
    next_due: c.next_due, paused_until: c.paused_until, stop_reason: c.stop_reason } : null;
}
const threadUrl = (tid: string) => (tid.startsWith("demo-") ? "#" : `https://mail.google.com/mail/u/0/#all/${tid}`);
function serInbox(m: O.In, j: FeedJob, c: O.Camp) {
  return { id: m.id, campaign_id: m.campaign_id, campaign_status: c.status, from_email: m.from_email, from_name: m.from_name, subject: m.subject,
    snippet: m.snippet, body: m.body, received_at: m.received_at, label: m.label, confidence: m.label_confidence, label_source: m.label_source,
    label_reason: m.label_reason, return_date: m.return_date, handled: m.handled, reply_mode: m.reply_mode, suggested_reply: m.suggested_reply,
    company: j.company, job_title: j.title, job_id: j.id, user_job_id: c.user_job_id, thread_url: threadUrl(m.thread_id) };
}
async function serOutbox(o: O.Ob, j: FeedJob, c: O.Camp) {
  const tr = o.has_attachment ? (await where<Row & { job_id: string; pdf_name: string }>("tailored", (t) => t.job_id === j.id))[0] : null;
  return { id: o.id, campaign_id: o.campaign_id, step: o.step, to: o.to_email, subject: o.subject, body: o.body, attachment: tr?.pdf_name ?? "",
    status: o.status === "sending" ? "pending" : o.status, queue_date: o.queue_date, recommended_send_at: recommended(j), recipient_tz: tzFor(j),
    scheduled_for: null, sent_at: o.sent_at, error: o.error, quality: o.quality, generated_by: o.generated_by, company: j.company, job_title: j.title,
    job_id: j.id, user_job_id: c.user_job_id, max_followups: c.max_followups };
}

// ------------------------------------------------------------------------------------------- matching / feed
let refreshing: Promise<unknown> | null = null;

export async function buildFeed(): Promise<number> {
  const u = await user();
  const p = await kvGet<Profile | null>("profile", null);
  if (!u || !p) return 0;
  const pr = await prefs();
  const seen = new Set((await all<O.UJ>("userjobs")).map((x) => x.job_id));
  let added = 0;
  for (const j of await allJobs()) {
    if (seen.has(j.id) || j.active === false) continue;
    const r = scoreJob(j, p, pr);
    if (!r || r.score < MIN_SCORE) continue;
    await put("userjobs", { job_id: j.id, status: "new", match_score: r.score, match_reasons: r.reasons, deadline: j.deadline, notes: "", created_at: nowIso(), updated_at: nowIso() });
    added++;
  }
  return added;
}

const MATCHER_VERSION = 2;

async function rescoreNew() {
  for (const uj of await where<O.UJ>("userjobs", (x) => x.status === "new")) await del("userjobs", uj.id);
  await buildFeed();
}

/** The routine that runs every time the app opens (and every 15 minutes while it stays open). */
export async function runDaily(opts: { forceFeed?: boolean } = {}): Promise<{ newListings: number; matches: number; replies: number; drafts: number }> {
  const out = { newListings: 0, matches: 0, replies: 0, drafts: 0 };
  const u = await user();
  try {
    const synced = await syncFeed(!!opts.forceFeed);
    if (synced) out.newListings = synced.added;
  } catch (e) {
    await kvSet("feed.error", String((e as Error).message));
  }
  if (!u?.onboarded) return out;
  // When the matching rules improve, unswiped cards are scored again once so nobody keeps stale matches.
  if ((await kvGet<number>("matcher.version", 1)) !== MATCHER_VERSION) {
    await rescoreNew();
    await kvSet("matcher.version", MATCHER_VERSION);
  }
  out.matches = await buildFeed();
  if (out.matches) await O.record("match", `${out.matches} new match${out.matches > 1 ? "es" : ""} from today's scan of official sources`, "/discover", true);
  out.drafts = await O.buildDailyQueue();
  await O.checkReminders();
  await O.settleOutcomes();
  if (await gmail.ready()) {
    try {
      out.replies = await O.checkReplies();
    } catch {}
  }
  await kvSet("daily.last_run", nowIso());
  return out;
}

// ------------------------------------------------------------------------------------------- endpoints
type Handler = (m: RegExpMatchArray, body: unknown) => Promise<unknown>;
const routes: [string, RegExp, Handler][] = [];
const on = (method: string, path: string, h: Handler) => routes.push([method, new RegExp(`^${path.replace(/:(\w+)/g, "([^/?]+)")}(?:\\?.*)?$`), h]);
const num = (s: string) => Number(s);

async function ownUJ(id: number): Promise<{ uj: O.UJ; job: FeedJob }> {
  const uj = await get<O.UJ>("userjobs", id);
  if (!uj) fail(404, "Not found");
  const job = await getJob(uj!.job_id);
  if (!job) fail(404, "This listing is no longer available");
  return { uj: uj!, job: job! };
}

async function jobContacts(uj: O.UJ, job: FeedJob): Promise<Contact[]> {
  const pub = (await all<Contact>("contacts")).filter((c) => !c.bounced && ((c.user_job_id == null && c.domain === job.domain && job.domain) || c.user_job_id === uj.id));
  const order: Record<string, number> = { "user-added": 0, recruiting: 1, general: 2, person: 3 };
  const seen = new Set<string>();
  return pub.sort((a, b) => (order[a.role_hint] ?? 9) - (order[b.role_hint] ?? 9)).filter((c) => !seen.has(c.email) && seen.add(c.email));
}
const serContact = (c: Contact) => ({ id: c.id, email: c.email, role: c.role_hint, source_url: c.source_url, confidence: c.confidence, mx_ok: c.mx_ok, found_at: c.found_at });

async function mxOk(domain: string): Promise<boolean> {
  for (const url of [`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`]) {
    try {
      const r = await fetch(url, { headers: { accept: "application/dns-json" } });
      if (r.ok) return ((await r.json()).Answer ?? []).length > 0;
    } catch {}
  }
  throw new LocalApiError(503, "Couldn't check that domain's mail server right now. Check your connection and try again.");
}

function cadence(j: FeedJob) {
  const [gaps, why] = j.job_type === "internship" ? [[3, 6], "Internship hiring moves fast: follow up after 3 days, then 6 days later."]
    : ["senior", "lead"].includes(j.seniority) ? [[5, 9], "Senior roles take longer to review: give it 5 days, then 9."]
    : [[4, 7], "Most replies arrive in the first week: follow up after 4 days, then 7 days later."];
  return { gaps, max_followups: 2, why: `${why} One follow-up alone lifts replies by about two-thirds in large outreach studies; two is the maximum, more tends to annoy.` };
}

on("GET", "/me", async () => {
  const u = await user();
  const conn = await gmail.connection();
  const gm = { configured: true, google: gmail.googleConfigured(), connected: !!conn, email: conn?.email ?? "", demo: conn?.mode === "demo",
    session_ok: await gmail.ready(),
    scopes: [
      { name: "Send email (gmail.send)", why: "To send the emails you approve, from your own address." },
      { name: "Read email (gmail.readonly)", why: "To spot replies: only the threads Kold started, plus new emails from companies you contacted that are about your application. The rest of your inbox is never read or stored." },
    ] };
  const meta = await currentMeta();
  const base = { lite: true, sandbox: conn?.mode === "demo", gmail: gm, feed: meta,
    engine: { local_model: aiState?.chosen ?? "", local_model_online: !!aiState?.ready, reply_model_trained: false },
    limits: { max_emails_per_day: O.MAX_PER_DAY, max_followups: O.MAX_FOLLOWUPS } };
  if (!u) return { user: null, ...base };
  const resumes = await all<Row & { filename: string; uploaded_at: string }>("resumes");
  const r = resumes[resumes.length - 1];
  return { ...base, user: { id: 1, name: u.name, email: u.email, timezone: u.timezone, onboarded: u.onboarded },
    profile: await kvGet<Profile | null>("profile", null), preferences: await prefs(), resume: r ? { filename: r.filename, uploaded_at: r.uploaded_at } : null };
});

on("POST", "/resume", async (_m, body) => {
  const file = (body as FormData).get("file") as File;
  if (!file || !/\.(pdf|docx|txt)$/i.test(file.name)) fail(400, "Upload a PDF, DOCX or TXT resume");
  if (file.size > 8 * 1024 * 1024) fail(413, "That file is over 8 MB. Please upload a smaller resume.");
  let text = "";
  try {
    text = await extractText(file);
  } catch {
    fail(422, "That file looks damaged or isn't really a PDF/DOCX. Try exporting it again.");
  }
  if (text.length < 100) fail(422, "We couldn't read text from that file. If it's a scanned image, upload a text-based PDF or DOCX.");
  const { profile, method } = await parseResume(text);
  const pr = { ...(await prefs()) };
  if (!pr.roles.length) pr.roles = profile.suggested_roles.slice(0, 5);
  if (!pr.experience_level && profile.experience_level) pr.experience_level = profile.experience_level;
  await kvSet("profile", profile);
  await kvSet("prefs", pr);
  const u = (await user()) ?? { name: "", email: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, onboarded: false };
  await kvSet("user", { ...u, name: profile.name || u.name, email: u.email || profile.email });
  await put("resumes", { filename: file.name, text, uploaded_at: nowIso() });
  await O.record("profile", `Read your resume (${file.name}) on your device using ${method === "rules" ? "Kold's resume reader" : method}`, "/profile");
  return { profile, preferences: pr, method };
});

on("PUT", "/profile", async (_m, body) => {
  if (!(await kvGet("profile", null))) fail(404, "Upload a resume first");
  const p = body as Profile;
  for (const k of ["links", "skills", "experience", "education", "projects", "certifications", "achievements", "suggested_roles"] as const) {
    if (!Array.isArray(p[k])) (p as unknown as Record<string, unknown>)[k] = p[k] ? [p[k]] : [];
  }
  await kvSet("profile", p);
  const u = await user();
  if (u) await kvSet("user", { ...u, name: p.name || u.name });
  return { ok: true };
});

on("PUT", "/preferences", async (_m, body) => {
  const b = body as Preferences & { timezone?: string };
  await kvSet("prefs", { ...DEFAULT_PREFS, ...Object.fromEntries(Object.entries(b).filter(([k]) => k in DEFAULT_PREFS)) });
  const u = await user();
  if (u && b.timezone) await kvSet("user", { ...u, timezone: b.timezone });
  await rescoreNew();
  return { ok: true };
});

on("POST", "/onboarding/complete", async () => {
  const u = await user();
  if (!u || !(await kvGet("profile", null))) fail(400, "Upload your resume first");
  await kvSet("user", { ...u!, onboarded: true });
  await runDaily();
  return { ok: true, matches: (await where<O.UJ>("userjobs", (x) => x.status === "new")).length };
});

on("POST", "/gmail/disconnect", async () => {
  await gmail.disconnect();
  await O.record("gmail", "Disconnected Gmail", "/profile");
  return { ok: true };
});

on("DELETE", "/me", async () => {
  await gmail.disconnect().catch(() => {});
  await wipe();
  return { ok: true };
});

on("GET", "/feed", async () => {
  const jobs = new Map((await allJobs()).map((j) => [j.id, j]));
  const fresh = (await where<O.UJ>("userjobs", (x) => x.status === "new")).filter((x) => jobs.get(x.job_id)?.active !== false);
  fresh.sort((a, b) => b.match_score - a.match_score || String(jobs.get(b.job_id)?.posted_at ?? "").localeCompare(String(jobs.get(a.job_id)?.posted_at ?? "")));
  const meta = await currentMeta();
  return {
    cards: fresh.slice(0, 40).map((uj) => jobCard(jobs.get(uj.job_id)!, uj)), remaining: fresh.length, refreshing: !!refreshing,
    last_scan: meta ? { at: meta.generated_at, new: 0, closed: 0, sources_ok: meta.sources_ok, sources: meta.sources_total } : null,
    active_jobs: [...jobs.values()].filter((j) => j.active !== false).length,
  };
});

on("POST", "/feed/refresh", async () => {
  if (!refreshing) refreshing = runDaily({ forceFeed: false }).finally(() => (refreshing = null));
  return { started: true, running: true };
});
on("GET", "/feed/refresh", async () => ({ running: !!refreshing }));

on("POST", "/feed/:id/swipe", async (m, body) => {
  const { uj, job } = await ownUJ(num(m[1]));
  const dir = (body as { direction: string }).direction;
  if (dir === "right") {
    uj.status = "liked";
    if (job.deadline && !(await where<Reminder>("reminders", (r) => r.user_job_id === uj.id && r.kind === "deadline")).length) {
      await put("reminders", { user_job_id: uj.id, kind: "deadline", title: `Apply: ${job.title} at ${job.company}`, due_at: job.deadline, done: false, notified_stage: 0 });
    }
    await O.record("match", `Saved ${job.title} at ${job.company}`, `/tracker?job=${uj.id}`);
  } else if (dir === "left") uj.status = "passed";
  else if (dir === "undo") uj.status = "new";
  else fail(400, "direction must be right, left or undo");
  await put("userjobs", { ...uj, updated_at: nowIso() });
  return { ok: true, status: uj.status };
});

on("GET", "/tracker", async () => {
  const camps = new Map((await all<O.Camp>("campaigns")).sort((a, b) => a.id - b.id).map((c) => [c.user_job_id, c]));
  const items = [];
  for (const uj of (await where<O.UJ>("userjobs", (x) => STAGES.includes(x.status))).sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
    const j = await getJob(uj.job_id);
    if (j) items.push({ ...jobCard(j, uj), campaign: campSummary(camps.get(uj.id)) });
  }
  return { stages: STAGES, items };
});

on("GET", "/jobs/:id", async (m) => {
  const { uj, job } = await ownUJ(num(m[1]));
  const camp = (await where<O.Camp>("campaigns", (c) => c.user_job_id === uj.id)).sort((a, b) => b.id - a.id)[0];
  const emails = camp ? (await where<O.Ob>("outbox", (o) => o.campaign_id === camp.id)).sort((a, b) => a.id - b.id)
    .map((o) => ({ id: o.id, step: o.step, to: o.to_email, subject: o.subject, body: o.body, status: o.status, sent_at: o.sent_at, error: o.error })) : [];
  const replies = camp ? (await where<O.In>("inbox", (x) => x.campaign_id === camp.id)).sort((a, b) => a.received_at.localeCompare(b.received_at)).map((x) => serInbox(x, job, camp)) : [];
  const tr = (await where<Row & { job_id: string; changes: string[]; created_at: string }>("tailored", (t) => t.job_id === job.id))[0];
  const reminders = (await where<Reminder>("reminders", (r) => r.user_job_id === uj.id)).sort((a, b) => a.due_at.localeCompare(b.due_at));
  return { ...jobCard(job, uj, true), campaign: campSummary(camp), emails, replies,
    tailored: tr ? { changes: tr.changes, created_at: tr.created_at } : null, contacts: (await jobContacts(uj, job)).map(serContact),
    reminders: reminders.map((r) => ({ id: r.id, title: r.title, due_at: r.due_at, kind: r.kind, done: r.done })), recipient_tz: tzFor(job), suggested_cadence: cadence(job) };
});

on("PATCH", "/jobs/:id", async (m, body) => {
  const { uj, job } = await ownUJ(num(m[1]));
  const b = body as { status?: string; notes?: string; deadline?: string | null };
  if (b.status !== undefined) {
    if (![...STAGES, "new", "passed"].includes(b.status)) fail(400, "bad status");
    if (b.status !== uj.status) await O.record("tracker", `Moved ${job.title} at ${job.company} to ${b.status.replace("_", " ")}`, `/tracker?job=${uj.id}`);
    uj.status = b.status;
  }
  if (b.notes !== undefined) uj.notes = String(b.notes).slice(0, 5000);
  if (b.deadline !== undefined) {
    const d = b.deadline ? new Date(b.deadline) : null;
    if (d && isNaN(d.getTime())) fail(400, "Invalid date");
    uj.deadline = d ? d.toISOString() : null;
    const r = (await where<Reminder>("reminders", (x) => x.user_job_id === uj.id && x.kind === "deadline"))[0];
    if (d) await put("reminders", { ...(r ?? {}), user_job_id: uj.id, kind: "deadline", title: `Apply: ${job.title} at ${job.company}`, due_at: d.toISOString(), done: false, notified_stage: 0 });
    else if (r) await del("reminders", r.id);
  }
  await put("userjobs", { ...uj, updated_at: nowIso() });
  return { ok: true };
});

on("POST", "/jobs/:id/contacts/find", async (m) => {
  const { uj, job } = await ownUJ(num(m[1]));
  const found = [...(job.emails ?? []).map((e) => ({ ...e, src: e.source_url, conf: "high" })),
    ...(job.domain ? (await publishedContacts(job.domain)).map((e) => ({ ...e, src: e.source_url, conf: e.role === "recruiting" ? "high" : "medium" })) : [])];
  const have = new Set((await all<Contact>("contacts")).filter((c) => c.user_job_id == null).map((c) => c.email));
  for (const f of found) {
    if (have.has(f.email)) continue;
    have.add(f.email);
    await put("contacts", { email: f.email, domain: job.domain || f.email.split("@")[1], role_hint: f.role, source_url: f.src, confidence: f.conf, mx_ok: true, bounced: false, found_at: nowIso(), user_job_id: null });
  }
  if (!job.domain && found[0]) job.domain = found[0].email.split("@")[1];
  const list = await jobContacts(uj, job);
  await O.record("contact", list.length ? `Found ${list.length} published address${list.length > 1 ? "es" : ""} for ${job.company}` : `No published email found for ${job.company}`, `/tracker?job=${uj.id}`);
  return { contacts: list.map(serContact), domain: job.domain };
});

on("POST", "/jobs/:id/contacts", async (m, body) => {
  const { uj } = await ownUJ(num(m[1]));
  const email = String((body as { email?: string }).email ?? "").trim().toLowerCase();
  if (!/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(email)) fail(400, "That doesn't look like an email address");
  const existing = (await where<Contact>("contacts", (c) => c.user_job_id === uj.id && c.email === email))[0];
  if (existing) return serContact(existing);
  const domain = email.split("@")[1];
  if (!(await mxOk(domain))) fail(400, `${domain} has no mail server (MX record), so emails to it would bounce.`);
  const c = await put("contacts", { email, domain, role_hint: "user-added", source_url: "Added by you", confidence: "user", mx_ok: true, bounced: false, found_at: nowIso(), user_job_id: uj.id });
  return serContact(c as Contact);
});

on("POST", "/jobs/:id/tailor", async (m) => {
  const { job } = await ownUJ(num(m[1]));
  for (const t of await where<Row & { job_id: string }>("tailored", (x) => x.job_id === job.id)) await del("tailored", t.id);
  const tr = await O.ensureTailored(job);
  return { changes: tr.changes, data: tr.data };
});

on("POST", "/jobs/:id/outreach", async (m, body) => {
  const { uj, job } = await ownUJ(num(m[1]));
  const b = body as { to_email?: string; gaps?: number[]; max_followups?: number };
  const to = String(b.to_email ?? "").trim().toLowerCase();
  if (!to) fail(400, "Choose who to email");
  const contact = (await jobContacts(uj, job)).find((c) => c.email === to);
  if (!contact) fail(400, "Pick a verified contact for this job (published by the company, or added by you)");
  const sug = cadence(job);
  const maxf = Math.max(0, Math.min(O.MAX_FOLLOWUPS, Number(b.max_followups ?? sug.max_followups)));
  let gaps = (b.gaps?.length ? b.gaps : sug.gaps).map((g) => Math.max(2, Math.min(21, Number(g) || 5)));
  while (gaps.length < maxf) gaps = [...gaps, gaps[gaps.length - 1] ?? 5];
  try {
    const camp = await O.start(uj, to, contact!.role_hint === "user-added" ? "person" : contact!.role_hint, gaps, maxf);
    return { campaign_id: camp.id };
  } catch (e) {
    if (e instanceof O.OutreachError) fail(e.status, e.message);
    throw e;
  }
});

on("POST", "/campaigns/:id/decision", async (m, body) => {
  const camp = await get<O.Camp>("campaigns", num(m[1]));
  if (!camp) fail(404, "Not found");
  const action = (body as { action: string }).action;
  if (action === "stop") {
    Object.assign(camp!, { status: "stopped", stop_reason: "Stopped by you", next_due: null });
    for (const o of await where<O.Ob>("outbox", (x) => x.campaign_id === camp!.id && ["pending", "failed"].includes(x.status))) await put("outbox", { ...o, status: "skipped", error: "Outreach stopped" });
    await put("campaigns", camp!);
    await O.record("stop", `Stopped outreach to ${camp!.to_email}. No more emails will be drafted.`, "/tracker");
  } else if (action === "resume") {
    if (camp!.stop_reason === "Address bounced") fail(400, "That address bounced. Pick another contact instead.");
    if (camp!.steps_sent > camp!.max_followups) fail(400, "All follow-ups have already been sent");
    if (camp!.status !== "active") {
      Object.assign(camp!, { status: "active", stop_reason: "", paused_until: null, next_due: camp!.next_due ?? todayLocal() });
      await put("campaigns", camp!);
      await O.record("campaign", `Resumed outreach to ${camp!.to_email}`, "/today");
      if (camp!.next_due! <= todayLocal()) await O.draftStep(camp!);
    }
  } else fail(400, "action must be stop or resume");
  return { ok: true, status: camp!.status };
});

on("GET", "/reminders", async () => (await where<Reminder>("reminders", (r) => !r.done)).sort((a, b) => a.due_at.localeCompare(b.due_at))
  .map((r) => ({ id: r.id, title: r.title, due_at: r.due_at, kind: r.kind, user_job_id: r.user_job_id })));
on("POST", "/reminders", async (_m, body) => {
  const b = body as { title?: string; due_at?: string; kind?: string; user_job_id?: number };
  if (!b.title?.trim() || !b.due_at) fail(400, "A reminder needs a title and a date");
  const r = await put("reminders", { user_job_id: b.user_job_id ?? null, kind: b.kind ?? "custom", title: b.title!.slice(0, 200), due_at: new Date(b.due_at!).toISOString(), done: false, notified_stage: 0 });
  return { id: r.id };
});
on("PATCH", "/reminders/:id", async (m, body) => {
  const r = await get<Reminder>("reminders", num(m[1]));
  if (!r) fail(404, "Not found");
  await put("reminders", { ...r!, done: !!(body as { done?: boolean }).done });
  return { ok: true };
});

on("GET", "/today", async () => {
  const day = todayLocal();
  const rows = (await where<O.Ob>("outbox", (o) => ["pending", "failed", "sending"].includes(o.status) || o.queue_date === day)).sort((a, b) => a.id - b.id);
  const emails = [];
  for (const o of rows) {
    const camp = await get<O.Camp>("campaigns", o.campaign_id);
    const uj = camp && (await get<O.UJ>("userjobs", camp.user_job_id));
    const job = uj && (await getJob(uj.job_id));
    if (camp && job) emails.push(await serOutbox(o, job, camp));
  }
  const conn = await gmail.connection();
  return { date: day, emails, sent_today: await O.sentToday(), daily_limit: O.MAX_PER_DAY, gmail_connected: !!conn };
});

on("PUT", "/outbox/:id", async (m, body) => {
  const o = await get<O.Ob>("outbox", num(m[1]));
  if (!o) fail(404, "Not found");
  if (!["pending", "failed"].includes(o!.status)) fail(409, "This email can't be edited anymore (it was sent, skipped or replaced)");
  const b = body as { subject?: string; body?: string };
  const camp = (await get<O.Camp>("campaigns", o!.campaign_id))!;
  const job = (await getJob(((await get<O.UJ>("userjobs", camp.user_job_id))!).job_id))!;
  const tr = (await where<Row & { job_id: string; data: Profile }>("tailored", (t) => t.job_id === job.id))[0];
  const subject = String(b.subject ?? o!.subject).split(/\s+/).join(" ").slice(0, 300);
  const text = String(b.body ?? o!.body).slice(0, 10000);
  const quality = check(subject, text, job.company, o!.step, o!.has_attachment, supportText(tr?.data ?? (await O.profile()), job));
  await put("outbox", { ...o!, subject, body: text, quality });
  return { quality, status: o!.status };
});

on("POST", "/outbox/:id/send", async (m) => {
  const o = await get<O.Ob>("outbox", num(m[1]));
  if (!o) fail(404, "Not found");
  if (!(await gmail.connection())) fail(400, "Connect Gmail in Profile before sending");
  try {
    await O.sendNow(o!.id);
  } catch (e) {
    if (e instanceof O.OutreachError) fail(e.status, e.message);
    if (e instanceof gmail.NeedsReconnect) fail(401, e.message);
    throw e;
  }
  return { status: "sent" };
});

on("POST", "/outbox/:id/skip", async (m) => {
  const o = await get<O.Ob>("outbox", num(m[1]));
  if (!o) fail(404, "Not found");
  if (!["pending", "failed"].includes(o!.status)) fail(409, "This email is no longer waiting to be sent");
  const camp = (await get<O.Camp>("campaigns", o!.campaign_id))!;
  await put("outbox", { ...o!, status: "skipped", error: "Skipped by you" });
  if (o!.step === 0) Object.assign(camp, { status: "stopped", stop_reason: "First email skipped" });
  else {
    camp.steps_sent = o!.step + 1;
    if (camp.steps_sent <= camp.max_followups && o!.step < camp.gaps.length) camp.next_due = addDays(todayLocal(), camp.gaps[o!.step]);
    else Object.assign(camp, { status: "completed", next_due: null });
  }
  await put("campaigns", camp);
  await O.record("skip", `Skipped email to ${o!.to_email}`, "/today");
  return { ok: true };
});

on("POST", "/outbox/:id/regenerate", async (m) => {
  const o = await get<O.Ob>("outbox", num(m[1]));
  if (!o) fail(404, "Not found");
  if (!["pending", "failed"].includes(o!.status)) fail(409, "This email is no longer waiting to be sent");
  const camp = (await get<O.Camp>("campaigns", o!.campaign_id))!;
  if (camp.status !== "active") fail(409, "This outreach is paused or stopped.");
  await put("outbox", { ...o!, status: "skipped", error: "Replaced by a new draft" });
  const n = await O.draftStep(camp);
  return { id: n?.id ?? null };
});

async function conversation(camp: O.Camp) {
  const sent = await where<O.Ob>("outbox", (o) => o.campaign_id === camp.id && o.status === "sent");
  const recv = await where<O.In>("inbox", (x) => x.campaign_id === camp.id);
  if (!sent.length && !recv.length) return null;
  const uj = (await get<O.UJ>("userjobs", camp.user_job_id))!;
  const job = (await getJob(uj.job_id))!;
  const tr = (await where<Row & { job_id: string; pdf_name: string }>("tailored", (t) => t.job_id === job.id))[0];
  const msgs: Record<string, unknown>[] = [
    ...sent.map((o) => ({ kind: "sent", key: `o${o.id}`, at: o.sent_at, from_email: o.to_email, subject: o.subject, body: o.body, step: o.step, attachment: o.has_attachment ? tr?.pdf_name ?? "" : "" })),
    ...recv.map((x) => ({ ...serInbox(x, job, camp), kind: "received", key: `i${x.id}`, at: x.received_at, new_thread: x.new_thread })),
    ...(await where<Row & { campaign_id: number; sent_at: string; to_email: string; subject: string; body: string; via: string }>("sentreplies", (s) => s.campaign_id === camp.id))
      .map((s) => ({ kind: "sent", key: `r${s.id}`, at: s.sent_at, from_email: s.to_email, subject: s.subject, body: s.body, step: -1, attachment: "", via: s.via })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const latest = [...recv].sort((a, b) => b.received_at.localeCompare(a.received_at))[0];
  return { campaign_id: camp.id, user_job_id: uj.id, company: job.company, job_title: job.title, to: camp.to_email, status: camp.status, stop_reason: camp.stop_reason,
    steps_sent: camp.steps_sent, max_followups: camp.max_followups, next_due: camp.next_due, paused_until: camp.paused_until,
    needs_you: recv.filter((x) => !x.handled).length, replies: recv.length, you_sent: msgs.filter((x) => x.kind === "sent").length,
    latest_label: latest?.label ?? "", last_at: msgs[msgs.length - 1].at, messages: msgs };
}

on("GET", "/conversations", async () => {
  const out = [];
  for (const c of await all<O.Camp>("campaigns")) {
    const conv = await conversation(c);
    if (conv) out.push(conv);
  }
  out.sort((a, b) => (Number(b.needs_you > 0) - Number(a.needs_you > 0)) || String(b.last_at).localeCompare(String(a.last_at)));
  return { conversations: out, gmail_connected: !!(await gmail.connection()) };
});

on("GET", "/inbox", async () => {
  const msgs = [];
  for (const x of (await all<O.In>("inbox")).sort((a, b) => b.received_at.localeCompare(a.received_at))) {
    const camp = (await get<O.Camp>("campaigns", x.campaign_id))!;
    const job = (await getJob(((await get<O.UJ>("userjobs", camp.user_job_id))!).job_id))!;
    msgs.push(serInbox(x, job, camp));
  }
  return { messages: msgs, gmail_connected: !!(await gmail.connection()) };
});

on("POST", "/inbox/check", async () => {
  if (!(await gmail.connection())) fail(400, "Connect Gmail first");
  try {
    return { new: await O.checkReplies() };
  } catch (e) {
    if (e instanceof gmail.NeedsReconnect) fail(401, e.message);
    throw e;
  }
});

on("POST", "/inbox/:id/mode", async (m, body) => {
  const x = await get<O.In>("inbox", num(m[1]));
  if (!x) fail(404, "Not found");
  const mode = (body as { mode: string }).mode;
  if (mode === "self") {
    await put("inbox", { ...x!, reply_mode: "self" });
    return { suggested_reply: x!.suggested_reply, quality: null };
  }
  if (mode !== "assisted") fail(400, "mode must be self or assisted");
  const d = await O.draftReply(x!.id);
  const camp = (await get<O.Camp>("campaigns", x!.campaign_id))!;
  const job = (await getJob(((await get<O.UJ>("userjobs", camp.user_job_id))!).job_id))!;
  return { suggested_reply: d, quality: check(`Re: ${x!.subject}`, d, job.company, 1, false) };
});

on("POST", "/inbox/:id/send", async (m, body) => {
  const text = String((body as { body?: string }).body ?? "").trim();
  if (!text) fail(400, "Reply is empty");
  if (/\[[^\]]{2,60}\]/.test(text)) fail(400, "Fill in the [bracketed] parts before sending");
  try {
    await O.sendReply(num(m[1]), text);
  } catch (e) {
    if (e instanceof gmail.NeedsReconnect) fail(401, e.message);
    fail(502, `Gmail refused the send: ${(e as Error).message.slice(0, 200)}`);
  }
  return { ok: true };
});

on("POST", "/inbox/:id/label", async (m, body) => {
  const label = (body as { label: string }).label;
  if (!["positive", "question", "not_now", "negative", "annoyed", "auto_reply", "out_of_office", "bounce", "unclear"].includes(label)) fail(400, "unknown label");
  await O.relabel(num(m[1]), label);
  return { ok: true };
});

on("POST", "/inbox/:id/handled", async (m) => {
  const x = await get<O.In>("inbox", num(m[1]));
  if (!x) fail(404, "Not found");
  await put("inbox", { ...x!, handled: true });
  return { ok: true };
});

on("GET", "/activity", async () => (await all<Row & { at: string; kind: string; message: string; url: string; seen: boolean }>("activity"))
  .sort((a, b) => b.id - a.id).slice(0, 200).map((a) => ({ id: a.id, at: a.at, kind: a.kind, message: a.message, url: a.url, seen: a.seen })));
on("POST", "/activity/seen", async () => {
  for (const a of await where<Row & { seen: boolean }>("activity", (x) => !x.seen)) await put("activity", { ...a, seen: true });
  return { ok: true };
});

on("GET", "/stats", async () => {
  const ujs = await all<O.UJ>("userjobs");
  const obs = await all<O.Ob>("outbox");
  const ins = await all<O.In>("inbox");
  return {
    to_review: ujs.filter((x) => x.status === "new").length, saved: ujs.filter((x) => !["new", "passed"].includes(x.status)).length,
    awaiting_approval: obs.filter((o) => o.status === "pending").length, sent: obs.filter((o) => o.status === "sent").length,
    replies: ins.filter((x) => !["auto_reply", "bounce", "out_of_office"].includes(x.label)).length, positive: ins.filter((x) => x.label === "positive").length,
    needs_attention: ins.filter((x) => !x.handled && x.label !== "auto_reply").length, interviews: ujs.filter((x) => x.status === "interview").length,
    unseen_activity: (await where<Row & { seen: boolean }>("activity", (a) => !a.seen)).length,
  };
});

on("GET", "/home", async () => {
  const u = await user();
  const ins = (await where<O.In>("inbox", (x) => !x.handled)).sort((a, b) => b.received_at.localeCompare(a.received_at));
  const replies = [];
  for (const x of ins.slice(0, 6)) {
    const camp = (await get<O.Camp>("campaigns", x.campaign_id))!;
    const job = (await getJob(((await get<O.UJ>("userjobs", camp.user_job_id))!).job_id))!;
    replies.push({ id: x.id, campaign_id: camp.id, company: job.company, job_title: job.title, from: x.from_name || x.from_email, snippet: x.snippet, label: x.label, at: x.received_at });
  }
  const approvals = (await where<O.Ob>("outbox", (o) => ["pending", "failed"].includes(o.status))).sort((a, b) => a.id - b.id);
  const approvalCards = [];
  for (const o of approvals.slice(0, 4)) {
    const camp = (await get<O.Camp>("campaigns", o.campaign_id))!;
    const job = (await getJob(((await get<O.UJ>("userjobs", camp.user_job_id))!).job_id))!;
    approvalCards.push({ id: o.id, company: job.company, to: o.to_email, step: o.step, status: o.status });
  }
  const soon = Date.now() + 7 * 86400000;
  const deadlines = (await where<Reminder>("reminders", (r) => !r.done && new Date(r.due_at).getTime() <= soon)).sort((a, b) => a.due_at.localeCompare(b.due_at));
  const jobs = new Map((await allJobs()).map((j) => [j.id, j]));
  const fresh = (await where<O.UJ>("userjobs", (x) => x.status === "new")).filter((x) => jobs.get(x.job_id)?.active !== false).sort((a, b) => b.match_score - a.match_score);
  const pipe = ["liked", "applied", "reaching_out", "replied", "interview", "offer"];
  const ujs = await all<O.UJ>("userjobs");
  const meta = await currentMeta();
  const acts = (await all<Row & { at: string; kind: string; message: string; url: string }>("activity")).sort((a, b) => b.id - a.id).slice(0, 6);
  return {
    name: (u?.name ?? "").split(" ")[0], gmail_connected: !!(await gmail.connection()), replies, replies_waiting: ins.length,
    approvals: approvalCards, approvals_waiting: approvals.length, scheduled: 0, sent_today: await O.sentToday(), daily_limit: O.MAX_PER_DAY,
    deadlines: deadlines.map((r) => ({ id: r.id, title: r.title, due_at: r.due_at, user_job_id: r.user_job_id ?? null })),
    matches_waiting: fresh.length, top_matches: fresh.slice(0, 3).map((x) => ({ user_job_id: x.id, company: jobs.get(x.job_id)!.company, title: jobs.get(x.job_id)!.title, score: x.match_score })),
    pipeline: Object.fromEntries(pipe.map((s) => [s, ujs.filter((x) => x.status === s).length])),
    last_scan: meta ? { at: meta.generated_at, new: 0 } : null,
    activity: acts.map((a) => ({ id: a.id, at: a.at, kind: a.kind, message: a.message, url: a.url })),
  };
});

on("GET", "/push/key", async () => ({ key: "" }));

// ------------------------------------------------------------------------------------------- entry point
export async function handle(method: string, path: string, body?: unknown): Promise<unknown> {
  for (const [m, re, h] of routes) {
    if (m !== method) continue;
    const match = path.match(re);
    if (match) return h(match, body);
  }
  throw new LocalApiError(404, `Not available in Kold Lite: ${method} ${path}`);
}

/** The tailored resume for a job, as a downloadable file. */
export async function tailoredPdf(userJobId: number): Promise<{ name: string; blob: Blob }> {
  const { job } = await ownUJ(userJobId);
  const tr = await O.ensureTailored(job);
  return { name: tr.pdf_name, blob: tr.pdf };
}

void shortRole;
