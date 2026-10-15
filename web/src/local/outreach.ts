"use client";

/**
 * Outreach engine (Lite). Same safety rules as the server version:
 *  - every email waits for the user's tap; each email can only be sent once;
 *  - one sequence per contact at a time, never re-email someone about the same role;
 *  - any human reply stops follow-ups; annoyed/declined pauses and asks; out-of-office pauses; bounces stop;
 *  - replies sent as a NEW email (or by a colleague at the same company) are caught too.
 * Runs whenever the app is open (there is no server in Lite).
 */
import { classify, learn } from "./classifier";
import { all, get, kvGet, nowIso, put, where, type Row } from "./db";
import { getJob, type FeedJob } from "./feed";
import * as gmail from "./gmail";
import { check } from "./quality";
import { renderPdf, tailor } from "./tailor";
import { addDays, todayLocal } from "./text";
import { firstEmail, followUp, recordOutcome, replyDraft, supportText, type Variant } from "./writer";
import type { Profile } from "@/lib/types";

export const MAX_PER_DAY = 25;
export const MAX_FOLLOWUPS = 2;
const SENDABLE = ["pending", "failed"];
const WATCH_DAYS = 90;

export type Camp = Row & {
  user_job_id: number; to_email: string; contact_role: string; status: string; gaps: number[]; max_followups: number; steps_sent: number;
  thread_id: string; last_message_id_header: string; first_subject: string; next_due: string | null; paused_until: string | null;
  stop_reason: string; created_at: string; variant?: Variant; used_facts: string[]; outcome_recorded?: boolean; last_sent_at?: string;
};
export type Ob = Row & {
  campaign_id: number; step: number; to_email: string; subject: string; body: string; has_attachment: boolean; queue_date: string;
  status: string; sent_at: string | null; gmail_message_id: string; error: string; quality: ReturnType<typeof check>; generated_by: string; created_at: string;
};
export type In = Row & {
  campaign_id: number; gmail_message_id: string; thread_id: string; new_thread: boolean; message_id_header: string; from_email: string;
  from_name: string; subject: string; snippet: string; body: string; received_at: string; label: string; label_confidence: number;
  label_source: string; label_reason: string; return_date: string | null; handled: boolean; reply_mode: string; suggested_reply: string;
};
export type UJ = Row & { job_id: string; status: string; match_score: number; match_reasons: string[]; deadline: string | null; notes: string; created_at: string; updated_at: string };

export class OutreachError extends Error {
  status: number;
  constructor(msg: string, status = 400) {
    super(msg);
    this.status = status;
  }
}

export async function profile(): Promise<Profile> {
  return kvGet<Profile>("profile", {} as Profile);
}

export async function record(kind: string, message: string, url = "/", notifyUser = false): Promise<void> {
  await put("activity", { at: nowIso(), kind, message, url, seen: false });
  if (notifyUser && typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
    try { new Notification("Kold", { body: message }); } catch {}
  }
}

async function ctx(campaignId: number): Promise<{ camp: Camp; uj: UJ; job: FeedJob }> {
  const camp = (await get<Camp>("campaigns", campaignId))!;
  const uj = (await get<UJ>("userjobs", camp.user_job_id))!;
  const job = (await getJob(uj.job_id))!;
  return { camp, uj, job };
}

export async function sentToday(): Promise<number> {
  const today = todayLocal();
  return (await where<Ob>("outbox", (o) => o.status === "sent" && (o.sent_at ?? "").length > 0 && localDate(o.sent_at!) === today)).length;
}
const localDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export async function ensureTailored(job: FeedJob): Promise<Row & { data: Profile; changes: string[]; pdf: Blob; pdf_name: string }> {
  const existing = (await where<Row & { job_id: string; data: Profile; changes: string[]; pdf: Blob; pdf_name: string }>("tailored", (t) => t.job_id === job.id))[0];
  if (existing?.pdf) return existing;
  const { data, changes } = await tailor(await profile(), job);
  const { name, blob } = await renderPdf(data);
  const row = await put("tailored", { ...(existing ?? {}), job_id: job.id, data, changes, pdf: blob, pdf_name: name, created_at: nowIso() });
  await record("resume", `Tailored your resume for ${job.title} at ${job.company}`);
  return row as Row & { data: Profile; changes: string[]; pdf: Blob; pdf_name: string };
}

export async function start(uj: UJ, toEmail: string, contactRole: string, gaps: number[], maxFollowups: number): Promise<Camp> {
  const job = (await getJob(uj.job_id))!;
  const to = toEmail.toLowerCase();
  const camps = await all<Camp>("campaigns");
  const existing = camps.find((c) => c.user_job_id === uj.id && ["active", "paused"].includes(c.status));
  if (existing) return existing;
  if (camps.some((c) => c.user_job_id === uj.id && c.to_email === to && c.stop_reason !== "First email skipped")) {
    throw new OutreachError(`You've already emailed ${to} about this role.`, 409);
  }
  const busy = camps.find((c) => c.to_email === to && ["active", "paused"].includes(c.status));
  if (busy) {
    const other = await getJob(((await get<UJ>("userjobs", busy.user_job_id))!).job_id);
    throw new OutreachError(`You're already emailing ${to} about ${other?.title ?? "another role"}. Wait for that to finish, or mention both roles in one email, so you don't flood their inbox.`, 409);
  }
  await ensureTailored(job);
  const camp = (await put("campaigns", {
    user_job_id: uj.id, to_email: to, contact_role: contactRole, status: "active", gaps: gaps.slice(0, maxFollowups), max_followups: maxFollowups,
    steps_sent: 0, thread_id: "", last_message_id_header: "", first_subject: "", next_due: todayLocal(), paused_until: null, stop_reason: "",
    created_at: nowIso(), used_facts: [],
  })) as Camp;
  await put("userjobs", { ...uj, status: "reaching_out", updated_at: nowIso() });
  await record("campaign", `Started outreach to ${to} for ${job.title} at ${job.company}`, "/today");
  await draftStep(camp);
  return camp;
}

export async function draftStep(camp: Camp): Promise<Ob | null> {
  if (camp.status !== "active" || camp.steps_sent > camp.max_followups) return null;
  if ((await where<Ob>("outbox", (o) => o.campaign_id === camp.id && [...SENDABLE, "sending"].includes(o.status))).length) return null;
  const { uj, job } = await ctx(camp.id);
  void uj;
  const tr = await ensureTailored(job);
  const facts = tr.data;
  const step = camp.steps_sent;
  let subject: string, body: string, by: string;
  if (step === 0) {
    const d = await firstEmail(facts, job, camp.to_email, camp.contact_role);
    ({ subject, body, by } = d);
    camp.variant = d.variant;
    camp.used_facts = d.usedFacts;
  } else {
    const d = await followUp(facts, job, step, camp.max_followups, camp.to_email, camp.contact_role, camp.used_facts ?? []);
    body = d.body;
    by = d.by;
    camp.used_facts = d.usedFacts;
    subject = camp.first_subject.toLowerCase().startsWith("re:") ? camp.first_subject : `Re: ${camp.first_subject}`;
  }
  await put("campaigns", camp);
  const ob = (await put("outbox", {
    campaign_id: camp.id, step, to_email: camp.to_email, subject, body, has_attachment: step === 0, queue_date: todayLocal(), status: "pending",
    sent_at: null, gmail_message_id: "", error: "", generated_by: by, created_at: nowIso(),
    quality: check(subject, body, job.company, step, step === 0, supportText(facts, job)),
  })) as Ob;
  await record("draft", `Drafted ${step === 0 ? "first email" : `follow-up ${step}`} to ${camp.to_email} (${job.company}). Waiting for your review.`, "/today");
  return ob;
}

export async function buildDailyQueue(): Promise<number> {
  const today = todayLocal();
  let made = 0;
  for (const camp of await where<Camp>("campaigns", (c) => c.status === "active")) {
    if (camp.paused_until && camp.paused_until > today) continue;
    if (camp.next_due && camp.next_due <= today && camp.steps_sent <= camp.max_followups && (await draftStep(camp))) made++;
  }
  if (made) await record("queue", `${made} email${made > 1 ? "s" : ""} ready for your review today`, "/today", true);
  return made;
}

const sending = new Set<number>();

export async function sendNow(obId: number): Promise<Ob> {
  const ob = (await get<Ob>("outbox", obId))!;
  if (ob.status === "sent") return ob;
  if (!SENDABLE.includes(ob.status)) throw new OutreachError("This draft is no longer waiting to be sent (it was skipped, replaced, or is already sending).", 409);
  if (!ob.quality?.ready) throw new OutreachError("Fix the highlighted issues (like placeholders) first");
  const { camp, uj, job } = await ctx(ob.campaign_id);
  if (camp.status !== "active") throw new OutreachError("This outreach is paused or stopped.", 409);
  if (camp.paused_until && camp.paused_until > todayLocal()) throw new OutreachError(`They're out of office until ${camp.paused_until}. Sending is paused until then.`);
  if ((await sentToday()) >= MAX_PER_DAY) throw new OutreachError(`Daily limit of ${MAX_PER_DAY} emails reached. This protects your Gmail reputation. Try again tomorrow.`);
  if (sending.has(ob.id)) throw new OutreachError("This email is already being sent.", 409);
  sending.add(ob.id);
  try {
    await put("outbox", { ...ob, status: "sending" });
    const tr = ob.has_attachment ? await ensureTailored(job) : null;
    const p = await profile();
    let res;
    try {
      res = await gmail.send({ fromName: p.name, to: ob.to_email, subject: ob.subject, body: ob.body, attachment: tr ? { name: tr.pdf_name, blob: tr.pdf } : undefined,
        threadId: camp.thread_id || undefined, inReplyTo: camp.last_message_id_header || undefined });
    } catch (e) {
      const reconnect = e instanceof gmail.NeedsReconnect;
      await put("outbox", { ...ob, status: reconnect ? "pending" : "failed", error: reconnect ? "" : String((e as Error).message).slice(0, 300) });
      throw e instanceof OutreachError ? e : new OutreachError((e as Error).message);
    }
    const sent: Ob = { ...ob, status: "sent", sent_at: nowIso(), gmail_message_id: res.id, error: "" };
    await put("outbox", sent);
    camp.thread_id = camp.thread_id || res.thread_id;
    camp.last_message_id_header = res.message_id_header || camp.last_message_id_header;
    if (ob.step === 0) camp.first_subject = ob.subject;
    camp.steps_sent = ob.step + 1;
    camp.last_sent_at = nowIso();
    if (camp.steps_sent <= camp.max_followups && ob.step < camp.gaps.length) camp.next_due = addDays(todayLocal(), camp.gaps[ob.step]);
    else [camp.next_due, camp.status] = [null, "completed"];
    await put("campaigns", camp);
    void uj;
    await record("send", `Sent ${ob.step === 0 ? "first email" : `follow-up ${ob.step}`} to ${ob.to_email} (${job.company}).${camp.next_due ? ` Next follow-up will be drafted on ${camp.next_due} for your review.` : " That was the last one. Kold keeps watching for a reply."}`, "/tracker");
    return sent;
  } finally {
    sending.delete(ob.id);
  }
}

async function skipPending(campId: number, reason: string) {
  for (const o of await where<Ob>("outbox", (x) => x.campaign_id === campId && SENDABLE.includes(x.status))) await put("outbox", { ...o, status: "skipped", error: reason });
}

const LABEL_TEXT: Record<string, string> = {
  positive: "replied positively 🎉", question: "asked a question", not_now: "said not right now", negative: "declined",
  annoyed: "seems unhappy about the emails", auto_reply: "sent an automatic reply", out_of_office: "is out of office", bounce: "address bounced",
  unclear: "replied (please read it)",
};

export async function applyLabel(camp: Camp, msg: In): Promise<void> {
  const { uj, job } = await ctx(camp.id);
  const who = `${job.company} (${msg.from_email})`;
  const url = `/inbox?c=${camp.id}`;
  const label = msg.label;
  if (camp.status === "stopped" && label !== "bounce") {
    if (!["auto_reply", "out_of_office"].includes(label)) await put("userjobs", { ...uj, status: "replied", updated_at: nowIso() });
    await record("reply", `${who} ${LABEL_TEXT[label] ?? "replied"} (outreach was already stopped).`, url, ["positive", "question"].includes(label));
    return;
  }
  if (label === "auto_reply") return record("reply", `${who} sent an automatic reply. Nothing changes.`, url);
  if (label === "out_of_office") {
    const until = addDays(msg.return_date ?? addDays(todayLocal(), 7), 1);
    camp.paused_until = until;
    if (camp.next_due && camp.next_due < until) camp.next_due = until;
    await skipPending(camp.id, "Recipient out of office");
    await put("campaigns", camp);
    return record("pause", `${who} is out of office. Follow-ups paused until ${until}.`, url);
  }
  if (label === "bounce") {
    Object.assign(camp, { status: "stopped", stop_reason: "Address bounced", next_due: null });
    await skipPending(camp.id, "Address bounced");
    await put("campaigns", camp);
    for (const c of await where<Row & { email: string }>("contacts", (x) => x.email === camp.to_email)) await put("contacts", { ...c, bounced: true });
    return record("stop", `${camp.to_email} bounced. Outreach stopped. Pick another contact for ${job.company}.`, url, true);
  }
  await skipPending(camp.id, "They replied");
  camp.next_due = null;
  if (["negative", "annoyed"].includes(label)) {
    Object.assign(camp, { status: "paused", stop_reason: `Awaiting your decision (${label})` });
    await record("reply", `${who} ${LABEL_TEXT[label]}. Outreach is paused. Stop for good?`, url, true);
  } else {
    camp.status = "replied";
    await record("reply", `${who} ${LABEL_TEXT[label] ?? "replied"}. Follow-ups stopped; your move.`, url, true);
  }
  if (["positive", "question", "not_now"].includes(label) && !camp.outcome_recorded) {
    await recordOutcome(camp.variant, true);
    camp.outcome_recorded = true;
  }
  await put("campaigns", camp);
  await put("userjobs", { ...uj, status: "replied", updated_at: nowIso() });
}

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "rediffmail.com", "protonmail.com", "proton.me", "aol.com", "zoho.com"]);
const NOT_A_PERSON = /no-?reply|do-?not-?reply|notification|newsletter|marketing|news@|updates?@|billing|receipts?|invoice|alerts?@|digest|promo|offers?@|support@|help@/i;

function aboutApplication(m: gmail.MailMsg, me: string, camp: Camp, job: FeedJob): boolean {
  if (NOT_A_PERSON.test(m.from_email) || "list-unsubscribe" in m.headers || ["bulk", "list"].includes((m.headers.precedence ?? "").toLowerCase())) return false;
  const text = `${m.subject}\n${m.body.slice(0, 4000)}`.toLowerCase();
  const first = (me.split(" ")[0] ?? "").toLowerCase();
  const tw = (job.title.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !["senior", "junior", "engineer", "manager"].includes(w));
  return (first.length > 2 && new RegExp(`\\b${first}\\b`).test(text)) || (!!camp.first_subject && text.includes(camp.first_subject.toLowerCase().replace(/^re: /, "").slice(0, 40))) ||
    text.includes(job.title.toLowerCase()) || tw.filter((w) => text.includes(w)).length >= 2 ||
    /\b(your (application|resume|cv|profile|email)|you (reached|wrote)|thanks for (reaching|writing|your email)|interview)\b/.test(text);
}

async function storeReply(camp: Camp, m: gmail.MailMsg, newThread: boolean): Promise<void> {
  const c = await classify(m.headers, m.from_email, m.subject, m.body);
  const msg = (await put("inbox", {
    campaign_id: camp.id, gmail_message_id: m.id, thread_id: m.thread_id, new_thread: newThread, message_id_header: m.message_id_header,
    from_email: m.from_email, from_name: m.from_name, subject: m.subject, snippet: m.snippet, body: m.body,
    received_at: new Date(m.internal_date || Date.now()).toISOString(), label: c.label, label_confidence: c.confidence, label_source: c.source,
    label_reason: c.reason, return_date: c.return_date, handled: ["auto_reply", "out_of_office"].includes(c.label), reply_mode: "", suggested_reply: "",
  })) as In;
  if (!newThread) camp.last_message_id_header = m.message_id_header || camp.last_message_id_header;
  await put("campaigns", camp);
  await applyLabel(camp, msg);
}

async function processThread(camp: Camp, threadId: string, newThread: boolean, known: Set<string>, me: string): Promise<number> {
  const msgs = (await gmail.threadMessages(threadId)).sort((a, b) => a.internal_date - b.internal_date);
  const ours = new Set([...(await where<Ob>("outbox", (o) => o.campaign_id === camp.id)).map((o) => o.gmail_message_id),
    ...(await where<Row & { campaign_id: number; gmail_message_id: string }>("sentreplies", (s) => s.campaign_id === camp.id)).map((s) => s.gmail_message_id)]);
  let found = 0;
  for (const m of msgs) {
    if (m.label_ids.includes("SENT") || m.label_ids.includes("DRAFT") || m.from_email === me) {
      if (!ours.has(m.id) && m.internal_date >= new Date(camp.created_at).getTime()) {
        await put("sentreplies", { campaign_id: camp.id, gmail_message_id: m.id, thread_id: m.thread_id, to_email: m.to ?? "", subject: m.subject, body: m.body, sent_at: new Date(m.internal_date).toISOString(), via: "gmail" });
        ours.add(m.id);
      }
      for (const e of await where<In>("inbox", (x) => x.campaign_id === camp.id && !x.handled && new Date(x.received_at).getTime() <= m.internal_date)) {
        await put("inbox", { ...e, handled: true, reply_mode: e.reply_mode || "self" });
      }
      continue;
    }
    if (known.has(m.id)) continue;
    known.add(m.id);
    await storeReply(camp, m, newThread);
    found++;
  }
  return found;
}

/** Read replies: our threads, conversations that moved to new threads, and fresh emails from contacted companies. */
export async function checkReplies(): Promise<number> {
  const conn = await gmail.connection();
  if (!conn) return 0;
  const me = conn.email;
  const cutoff = Date.now() - WATCH_DAYS * 86400000;
  const camps = await where<Camp>("campaigns", (c) => !!c.thread_id && new Date(c.created_at).getTime() >= cutoff);
  const known = new Set((await all<In>("inbox")).map((m) => m.gmail_message_id));
  let found = 0;
  for (const camp of camps) found += await processThread(camp, camp.thread_id, false, known, me);
  // Brand-new emails from the companies we contacted.
  const live = camps.filter((c) => c.steps_sent > 0);
  if (live.length) {
    const byAddr = new Map<string, Camp>(), byDomain = new Map<string, Camp>();
    for (const c of [...live].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      byAddr.set(c.to_email, c);
      const d = c.to_email.split("@")[1];
      if (!FREE_MAIL.has(d)) byDomain.set(d, c);
    }
    const threads = new Set(live.map((c) => c.thread_id));
    const after = Math.floor(Math.min(...live.map((c) => new Date(c.created_at).getTime())) / 1000);
    const rejected = new Set(await kvGet<string[]>("replies.rejected", []));
    const msgs = await gmail.messagesFrom([...new Set([...byAddr.keys(), ...byDomain.keys()])], after, new Set([...known, ...rejected]));
    const p = await profile();
    for (const m of msgs.sort((a, b) => a.internal_date - b.internal_date)) {
      if (threads.has(m.thread_id) || m.label_ids.includes("SENT") || m.from_email === me || known.has(m.id)) continue;
      let camp = byAddr.get(m.from_email);
      if (!camp) {
        camp = byDomain.get(m.from_email.split("@")[1]);
        const job = camp ? await getJob(((await get<UJ>("userjobs", camp.user_job_id))!).job_id) : undefined;
        if (!camp || !job || !aboutApplication(m, p.name ?? "", camp, job)) {
          rejected.add(m.id);
          continue;
        }
      }
      known.add(m.id);
      await storeReply(camp, m, true);
      found++;
    }
    const { kvSet } = await import("./db");
    await kvSet("replies.rejected", [...rejected].slice(-2000));
    // Keep following conversations that moved to a new thread.
    const moved = new Map<string, number>();
    for (const m of await where<In>("inbox", (x) => x.new_thread)) moved.set(m.thread_id, m.campaign_id);
    for (const [tid, cid] of moved) {
      const camp = live.find((c) => c.id === cid);
      if (camp) found += await processThread(camp, tid, true, known, me);
    }
  }
  return found;
}

export async function sendReply(msgId: number, body: string): Promise<void> {
  const msg = (await get<In>("inbox", msgId))!;
  const { camp } = await ctx(msg.campaign_id);
  const p = await profile();
  const subject = msg.subject.toLowerCase().startsWith("re:") ? msg.subject : `Re: ${msg.subject}`;
  const res = await gmail.send({ fromName: p.name, to: msg.from_email, subject, body, threadId: msg.thread_id, inReplyTo: msg.message_id_header || camp.last_message_id_header });
  if (!msg.new_thread) camp.last_message_id_header = res.message_id_header || camp.last_message_id_header;
  await put("campaigns", camp);
  await put("inbox", { ...msg, handled: true, reply_mode: msg.reply_mode || "assisted" });
  await put("sentreplies", { campaign_id: camp.id, gmail_message_id: res.id, thread_id: res.thread_id, to_email: msg.from_email, subject, body, sent_at: nowIso(), via: "kold" });
  await record("send", `Sent your reply to ${msg.from_email}`, `/inbox?c=${camp.id}`);
}

export async function draftReply(msgId: number): Promise<string> {
  const msg = (await get<In>("inbox", msgId))!;
  const { job } = await ctx(msg.campaign_id);
  const d = await replyDraft(await profile(), job, msg.from_name, msg.body, msg.label);
  await put("inbox", { ...msg, reply_mode: "assisted", suggested_reply: d });
  return d;
}

export async function relabel(msgId: number, label: string): Promise<void> {
  const msg = (await get<In>("inbox", msgId))!;
  const changed = label !== msg.label;
  const updated = { ...msg, label, label_source: "user", label_confidence: 1, label_reason: "Confirmed by you" };
  await put("inbox", updated);
  await learn(`${msg.subject}\n${msg.body}`, label);
  if (changed) await applyLabel((await get<Camp>("campaigns", msg.campaign_id))!, updated);
}

export async function checkReminders(): Promise<void> {
  const now = Date.now();
  for (const r of await where<Row & { done: boolean; due_at: string; notified_stage: number; title: string; user_job_id?: number }>("reminders", (x) => !x.done)) {
    const left = new Date(r.due_at).getTime() - now;
    const url = r.user_job_id ? `/tracker?job=${r.user_job_id}` : "/tracker";
    if (r.notified_stage < 1 && left > 86400000 && left <= 3 * 86400000) {
      await put("reminders", { ...r, notified_stage: 1 });
      await record("reminder", `${r.title}: due in ${Math.round(left / 86400000)} days`, url, true);
    } else if (r.notified_stage < 2 && left <= 86400000) {
      await put("reminders", { ...r, notified_stage: 2 });
      await record("reminder", `${r.title}: ${left > 0 ? "due within a day" : "deadline has passed"}`, url, true);
    }
  }
}

/** Sequences that ended with no reply after 14 days count as "no reply" for the writer's learning. */
export async function settleOutcomes(): Promise<void> {
  for (const c of await where<Camp>("campaigns", (x) => x.status === "completed" && !x.outcome_recorded && !!x.last_sent_at)) {
    if (Date.now() - new Date(c.last_sent_at!).getTime() > 14 * 86400000) {
      await recordOutcome(c.variant, false);
      await put("campaigns", { ...c, outcome_recorded: true });
    }
  }
}
