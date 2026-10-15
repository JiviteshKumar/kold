/**
 * Pre-send checks shown next to every email. Thresholds come from published outreach research:
 *  - Length: replies peak at ~50–125 words (Boomerang, ~40M emails).
 *  - Plain language: 3rd-grade reading level got ~36% more replies than college level (Boomerang).
 *  - Subject: personalized subjects ~30% more replies; ~36–50 characters performed best (Backlinko × Pitchbox, 12M emails).
 */
import { numbers, readingEase, sentences } from "./text";
import type { Quality } from "@/lib/types";

const SPAM = /\b(guarantee[d]?|act now|urgent|limited time|free money|100% free|risk[- ]free|click here|buy now|winner|congratulations|no obligation|dear sir\/madam|to whom it may concern|i hope this (e-?mail|message) finds you well)\b/i;
export const PLACEHOLDER = /\[[^\]]{2,60}\]|\{\{.*?\}\}|<[A-Z ]{3,}>/;
const CLAIM = /\b(I|I've|I'm|my|me)\b/;
const COMMON = new Set(`about above after again also although among another apply applying attached available based being brief call
calls chat could connect consider considering currently discuss email excited experience forward from have having help hiring
hope interest interested into just keen kind know learn like look looking love manager more most much next note open
opportunity opportunities person please point position recently regarding resume review right role roles share short should
some team than thank thanks that their them there these they this those through time very want week well were what when where
which while will with would writing your yours also additionally recently currently particularly especially really`.split(/\s+/));

export function unsupportedClaims(body: string, support: string): string[] {
  const sup = support.toLowerCase();
  const out: string[] = [];
  for (const s of body.split(/(?<=[.!?])\s+|\n+/)) {
    if (!CLAIM.test(s)) continue;
    const ws = (s.toLowerCase().match(/[a-z][a-z0-9+#.-]{3,}/g) ?? []).filter((w) => !COMMON.has(w.replace(/[.-]+$/, "")));
    if (ws.length < 4) continue;
    const backed = ws.filter((w) => sup.includes(w.replace(/[.-]+$/, ""))).length;
    if (backed / ws.length < 0.6) out.push(s.trim());
  }
  return out;
}

// Numbers in Kold's own wording (not claims about the user), e.g. "a 10-minute call".
const OWN_WORDING = /\b10-minute\b/g;

/** Every number in an email must come from the resume or the posting: no invented metrics. */
export function grounded(text: string, support: string): boolean {
  const allowed = new Set(support.match(/\d+/g) ?? []);
  return [...(text.replace(OWN_WORDING, "").match(/\d+/g) ?? [])].every((n) => allowed.has(n));
}

export function check(subject: string, body: string, company: string, step: number, hasAttachment: boolean, support = ""): Quality {
  const words = (body.match(/\w+/g) ?? []).length;
  const checks: Quality["checks"] = [];
  const add = (ok: boolean, good: string, bad: string, blocking = false) => checks.push({ ok, text: ok ? good : bad, blocking: blocking && !ok });
  const max = step === 0 ? 125 : 90;
  add(words <= max + 15, `Short and readable (${words} words)`, `${words} words: replies drop after ~${max} words. Trim it.`);
  if (step === 0) add(words >= 45, "Enough detail to be credible", "Very short. Add one concrete achievement.");
  if (step === 0) add(subject.length >= 20 && subject.length <= 65, `Subject length is in the sweet spot (${subject.length} chars)`, subject ? `Subject is ${subject.length} chars. About 36–50 works best.` : "Subject is missing", !subject);
  const ease = readingEase(body);
  add(ease >= 50, "Plain, easy-to-read language", "Simplify: shorter sentences and words get more replies.");
  add(/\?/.test(body), "Ends with a clear question (easy to answer)", "Ask one clear question so it's easy to reply.");
  add(!SPAM.test(`${subject} ${body}`), "No spam-trigger phrases", "Contains phrases that spam filters or recruiters dislike");
  add((body.match(/!/g) ?? []).length <= 1, "Calm tone", "Too many exclamation marks");
  add((body.match(/https?:\/\//g) ?? []).length <= 2, "Two links or fewer", "Too many links can land the email in spam");
  if (step === 0) {
    add(`${subject} ${body}`.toLowerCase().includes(company.toLowerCase()), `Mentions ${company} specifically`, `Doesn't mention ${company}: feels generic`);
    add(hasAttachment, "Resume attached", "No resume attached");
  }
  if (support) {
    const claims = unsupportedClaims(body, support);
    add(!claims.length, "Every claim about you is backed by your resume", `Check this. It's not clearly in your resume: “${claims.slice(0, 2).map((c) => c.slice(0, 110)).join("”, “")}”`);
    add(grounded(`${subject} ${body}`, support), "Every number comes from your resume or the posting", "Contains a number that isn't in your resume or the posting", true);
  }
  const ph = `${subject} ${body}`.match(new RegExp(PLACEHOLDER.source, "g")) ?? [];
  add(!ph.length, "No placeholders left", `Fill in before sending: ${ph.slice(0, 3).join(", ")}`, true);
  void numbers;
  void sentences;
  const passed = checks.filter((c) => c.ok).length;
  return { score: Math.round((100 * passed) / checks.length), checks, ready: !checks.some((c) => c.blocking) };
}
