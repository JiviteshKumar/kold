"use client";

/**
 * Reply understanding (same rules as the server's classifier.py, all covered by its tests):
 *  1. rules: mail headers + unmistakable phrases; mixed signals are NOT guessed;
 *  2. a small Naive Bayes model trained on this user's own confirmed labels (on their device);
 *  3. the on-device AI for anything still ambiguous; otherwise "unclear" so the user reads it.
 */
import { aiReady, generateJson } from "./ai";
import { kvGet, kvSet } from "./db";

export const LABELS = ["positive", "question", "not_now", "negative", "annoyed", "auto_reply", "out_of_office", "bounce", "unclear"];

const PHRASES: [string, number, RegExp][] = [
  ["annoyed", 0.95, /stop (e-?mailing|contacting|sending)|remove me|unsubscribe|do not (contact|email)|don'?t (contact|email) me|this is spam|reported as spam|harass|leave me alone|please stop|how did you get (my|this) (e-?mail|address)/i],
  ["negative", 0.85, /not (currently )?hiring|no (open )?(positions|openings|vacancies)|position (has been|is) (filled|closed)|(won'?t|will not|not) be (moving|proceeding) forward|decided to (move forward|proceed) with other|not a (good )?(fit|match)|unable to (offer|consider)|regret to inform|we'?ll pass|unfortunately/i],
  ["not_now", 0.8, /keep (your )?(resume|cv|profile) on file|future (openings|opportunities|roles)|check back|reach out (again )?in (a few|\d+) (weeks|months)|not (right )?now|later this year|next quarter/i],
  ["positive", 0.85, /\b(schedule|set up|book) (a )?(call|time|chat|meeting|interview)|calendly\.com|cal\.com|(are|would) you (be )?(available|free)|let'?s (talk|chat|connect)|next steps?|(happy|glad|love) to (chat|talk|connect|speak)|move (you )?forward|shortlisted|interview|forward(ed)? your (profile|resume|cv)|send (over )?(a )?(take[- ]home|assignment)/i],
];
const OOO = /out of (the )?office|\booo\b|on (annual |parental |sick )?leave|on vacation|limited access to (my )?e-?mail|away (from|until)|currently (travelling|traveling)/i;
const AUTO = /automatic reply|auto-?reply|autoresponder|this is an automated|we (have )?received your (e-?mail|application|message)|do not reply to this/i;

export type Classified = { label: string; confidence: number; source: string; reason: string; return_date: string | null };

function autoHeader(h: Record<string, string>): boolean {
  return (h["auto-submitted"] ?? "no").toLowerCase() !== "no" && (h["auto-submitted"] ?? "") !== "" || "x-autoreply" in h || "x-autorespond" in h || (h["precedence"] ?? "").toLowerCase() === "auto_reply";
}

export function returnDate(text: string): string | null {
  const re = /(back|return(?:ing)?|in the office|available)\s+(?:on|from|after|by)?\s*(?:[A-Z][a-z]+,?\s+)?([^.\n]{3,30})/gi;
  const now = new Date();
  for (const m of text.matchAll(re)) {
    const d = new Date(`${m[2].replace(/(\d+)(st|nd|rd|th)/, "$1")} ${now.getFullYear()}`);
    if (isNaN(d.getTime())) continue;
    if (d < now && d.getMonth() < now.getMonth()) d.setFullYear(now.getFullYear() + 1);
    const days = (d.getTime() - now.getTime()) / 86400000;
    if (days >= -1 && days <= 120) return d.toISOString().slice(0, 10);
  }
  return null;
}

function rules(h: Record<string, string>, from: string, subject: string, body: string): [string, number, string] | null {
  if (/mailer-daemon|postmaster/i.test(from) || /delivery status notification|undeliverable|address not found/i.test(subject)) return ["bounce", 0.99, "Delivery failure notice from the mail server"];
  const text = `${subject}\n${body.slice(0, 3000)}`;
  const hits = new Map<string, [number, string]>();
  for (const [label, conf, re] of PHRASES) {
    const m = text.match(re);
    if (m) hits.set(label, [conf, m[0]]);
  }
  const humanPositive = hits.has("positive");
  const auto = autoHeader(h);
  const ooo = text.match(OOO);
  if (ooo && (auto || AUTO.test(subject) || /out of (the )?office/i.test(subject) || !humanPositive)) return ["out_of_office", auto ? 0.95 : 0.85, `Says “${ooo[0]}”`];
  if ((auto || AUTO.test(subject)) && !humanPositive) return ["auto_reply", 0.9, "Automatic reply (marked by their mail system)"];
  if (hits.has("annoyed")) return ["annoyed", hits.get("annoyed")![0], `Contains “${hits.get("annoyed")![1].slice(0, 60)}”`];
  const human = [...hits.entries()].filter(([k]) => ["negative", "not_now", "positive"].includes(k));
  if (human.length === 1) return [human[0][0], human[0][1][0], `Contains “${human[0][1][1].slice(0, 60)}”`];
  return null;
}

// ---- Naive Bayes trained on the user's own confirmed labels (kept on the device)
type NB = { counts: Record<string, Record<string, number>>; docs: Record<string, number>; total: number };
const tok = (s: string) => (s.toLowerCase().match(/[a-z']{3,}/g) ?? []).slice(0, 400);

export async function learn(text: string, label: string): Promise<void> {
  const nb = await kvGet<NB>("classifier.nb", { counts: {}, docs: {}, total: 0 });
  nb.counts[label] = nb.counts[label] ?? {};
  for (const t of tok(text)) nb.counts[label][t] = (nb.counts[label][t] ?? 0) + 1;
  nb.docs[label] = (nb.docs[label] ?? 0) + 1;
  nb.total += 1;
  await kvSet("classifier.nb", nb);
}

async function model(text: string): Promise<[string, number] | null> {
  const nb = await kvGet<NB>("classifier.nb", { counts: {}, docs: {}, total: 0 });
  const labels = Object.keys(nb.docs);
  if (nb.total < 20 || labels.length < 2) return null; // not enough of the user's own data yet
  const vocab = new Set(labels.flatMap((l) => Object.keys(nb.counts[l])));
  const scores = labels.map((l) => {
    const n = Object.values(nb.counts[l]).reduce((a, b) => a + b, 0);
    let s = Math.log(nb.docs[l] / nb.total);
    for (const t of tok(text)) s += Math.log(((nb.counts[l][t] ?? 0) + 1) / (n + vocab.size));
    return [l, s] as [string, number];
  });
  const max = Math.max(...scores.map((s) => s[1]));
  const exps = scores.map(([l, s]) => [l, Math.exp(s - max)] as [string, number]);
  const z = exps.reduce((a, [, e]) => a + e, 0);
  const [best, e] = exps.sort((a, b) => b[1] - a[1])[0];
  return [best, e / z];
}

export function freshPart(body: string): string {
  return body.split(/\n\s*On .{5,120}wrote:|\n-{2,} ?Original Message|\n>/)[0];
}

export async function classify(headers: Record<string, string>, from: string, subject: string, body: string): Promise<Classified> {
  const fresh = freshPart(body);
  const out = (label: string, confidence: number, source: string, reason: string): Classified =>
    ({ label, confidence: Math.round(confidence * 100) / 100, source, reason, return_date: label === "out_of_office" ? returnDate(fresh) : null });
  const r = rules(headers, from, subject, fresh);
  if (r && r[1] >= 0.9) return out(r[0], r[1], "rules", r[2]);
  const m = await model(`${subject}\n${fresh}`);
  if (m && m[1] >= Math.max(0.75, r?.[1] ?? 0)) return out(m[0], m[1], "model", "Kold's classifier, trained on your confirmed replies");
  if (r) return out(r[0], r[1], "rules", r[2]);
  if ((fresh.match(/\w+/g) ?? []).length < 4) return out("unclear", 0.5, "rules", "Very short reply. Please read it and set the label.");
  if (aiReady()) {
    const d = await generateJson<{ label: string; reason: string }>(
      "Classify a company's reply to a job seeker's cold email. positive = wants to talk/interview/next step; question = asks for info before deciding; " +
        "not_now = no role now but open later; negative = polite no; annoyed = irritated about being contacted; unclear = too ambiguous to tell. reason: one short sentence quoting their words.",
      `SUBJECT: ${subject}\n\nREPLY:\n${fresh.slice(0, 2500)}`,
      { type: "object", properties: { label: { type: "string", enum: ["positive", "question", "not_now", "negative", "annoyed", "unclear"] }, reason: { type: "string" } }, required: ["label", "reason"] });
    if (d && LABELS.includes(d.label)) return out(d.label, 0.7, "local-llm", d.reason);
  }
  return out("unclear", 0.3, "rules", "Couldn't tell what they mean. Please read it and set the label.");
}
