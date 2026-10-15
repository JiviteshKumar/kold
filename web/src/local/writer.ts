"use client";

/**
 * Kold's outreach writer (Lite). Built to work well with no AI at all, and to only ever get better with it.
 *
 * Research the structure is based on (benchmarks, not guarantees):
 *  - ~50–125 words gets the most replies; simple language beats complex (Boomerang, ~40M emails).
 *  - Personalized subject lines got ~30% more replies; ~36–50 characters performed best; one follow-up raised replies
 *    by ~66% (Backlinko × Pitchbox, 12M outreach emails).
 *  - Specific, role-relevant messages to the right person outperform generic templates (recruiting outreach benchmarks).
 *
 * Every sentence about the user is assembled from facts in their own resume, ranked by how well they fit the job.
 * The on-device model may polish wording; its version is used only if it passes the same grounding checks.
 * Kold also learns, per user and on their device, which subject and ask styles get replies (Thompson sampling).
 */
import { aiLabel, aiReady, generate } from "./ai";
import { kvGet, kvSet } from "./db";
import type { FeedJob } from "./feed";
import { check, grounded, unsupportedClaims } from "./quality";
import { capitalize, findSkills, keywords, numbers, termRe, words } from "./text";
import type { Profile } from "@/lib/types";

type Fact = { text: string; kind: "exp" | "project" | "achievement"; context: string; score: number; id: string };
export type Variant = { subject: string; ask: string };

const VERBS = new Set(("built led created designed developed implemented automated analyzed analysed wrote improved reduced increased " +
  "launched managed shipped optimized optimised trained deployed migrated organized organised won delivered researched tested " +
  "coordinated mentored taught presented integrated scaled maintained refactored modeled modelled cleaned visualized visualised " +
  "conducted drove grew saved cut raised published contributed collaborated owned established initiated streamlined").split(" "));

export function supportText(profile: Profile, job: Pick<FeedJob, "title" | "company" | "department" | "location">): string {
  return `${JSON.stringify(profile)} ${job.title} ${job.department} ${job.company} ${job.location}`;
}

/** "Software Engineer - Cloud: Azure (L3) | Bangalore" → "Software Engineer, Cloud: Azure" style short role. */
export function shortRole(title: string): string {
  let t = title.replace(/\((?:[^)]*\d[^)]*|L\d|req[^)]*)\)/gi, "").replace(/\s*\|.*$/, "").replace(/\s+-\s+(remote|hybrid|on-?site|india|bangalore|bengaluru|mumbai|delhi|pune|hyderabad|chennai).*$/i, "");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t.length > 42 ? t.split(/\s[-–,:]\s|,\s/)[0].trim() : t;
}

function firstName(email: string, role: string): string {
  if (role !== "person") return "";
  const local = email.split("@")[0];
  const m = local.match(/^([a-z]{2,})[._]/i);
  return m ? capitalize(m[1].toLowerCase()) : "";
}

function asSentence(raw: string): string {
  let s = raw.trim().replace(/[.;]+$/, "");
  const first = (s.split(/\s/)[0] ?? "").toLowerCase();
  if (VERBS.has(first) || /ed$/.test(first)) s = `I ${first}${s.slice(first.length)}`;
  else s = `I worked on ${s[0].toLowerCase()}${s.slice(1)}`;
  return `${s}.`;
}

function rankFacts(profile: Profile, job: FeedJob): Fact[] {
  const jk = keywords(`${job.title} ${job.title} ${job.description}`);
  const jobSkills = findSkills(`${job.title}\n${job.description}`).map((s) => s.toLowerCase());
  const facts: Fact[] = [];
  (profile.experience ?? []).forEach((e, i) => (e.bullets ?? []).forEach((b, j) =>
    facts.push({ text: b, kind: "exp", context: e.company || e.title, score: 0, id: `e${i}.${j}` })));
  (profile.projects ?? []).forEach((p, i) => p.description && facts.push({ text: p.description, kind: "project", context: p.name, score: 0, id: `p${i}` }));
  (profile.achievements ?? []).forEach((a, i) => facts.push({ text: a, kind: "achievement", context: "", score: 0, id: `a${i}` }));
  for (const f of facts) {
    const fk = new Set(words(f.text));
    const overlap = [...fk].filter((w) => jk.has(w)).length;
    const skillHits = jobSkills.filter((s) => termRe(s).test(f.text)).length;
    f.score = overlap * 2 + skillHits * 4 + (numbers(f.text).size ? 3 : 0) + (f.kind === "exp" ? 1 : 0) + (f.text.length > 40 ? 1 : 0);
  }
  return facts.sort((a, b) => b.score - a.score);
}

function proofSentence(f: Fact, first: boolean): string {
  if (f.kind === "exp") return first && f.context ? `At ${f.context}, ${asSentence(f.text).replace(/^I /, "I ")}` : asSentence(f.text);
  if (f.kind === "project") {
    const s = asSentence(f.text);
    return /^I worked on/.test(s) ? `I also built ${f.context}: ${f.text.replace(/[.;]+$/, "")}.` : `For ${f.context}, ${s}`;
  }
  return `I was ${f.text.replace(/[.;]+$/, "").replace(/^[A-Z]/, (c) => c.toLowerCase())}.`.replace(/^I was (winner|finalist|runner)/i, "I was a $1");
}

function whoSentence(profile: Profile): string {
  const edu = profile.education?.[0];
  const exp = profile.experience?.[0];
  if (profile.experience_level === "student" && edu?.degree && edu.institution) {
    return `I'm a ${edu.degree} student at ${edu.institution}${edu.end ? ` (graduating ${edu.end.match(/\d{4}/)?.[0] ?? edu.end})` : ""}.`;
  }
  if (profile.experience_level === "fresher" && edu?.degree && edu.institution) return `I recently completed my ${edu.degree} at ${edu.institution}.`;
  if (exp?.title && exp.company) return /present|current/i.test(exp.end ?? "") ? `I'm a ${exp.title} at ${exp.company}.` : `I most recently worked as a ${exp.title} at ${exp.company}.`;
  return profile.headline ? `I'm a ${profile.headline}.` : "";
}

function teamHint(job: FeedJob): string {
  const m = job.description.match(/\b(?:join|on|in)\s+(?:our|the)\s+([A-Z][\w&\- ]{2,40}?)\s+team\b/);
  return m ? `the ${m[1].trim()} team` : "";
}

const SUBJECTS: Record<string, (c: Ctx) => string> = {
  credential: (c) => `${c.role} at ${c.company}: ${c.cred}`,
  question: (c) => `${c.company} ${c.role} role: a quick question`,
  profile: (c) => `${c.status} for your ${c.role} role`,
};
const ASKS: Record<string, (c: Ctx) => string> = {
  call: () => "Would you be open to a 10-minute call next week?",
  consider: () => "Could you consider me for this role, or point me to the right person on the hiring team?",
  forward: (c) => `Could you forward this to the hiring manager for the ${c.role} role?`,
};
type Ctx = { role: string; company: string; cred: string; status: string };

/** Thompson sampling over styles, learned from this user's own reply outcomes. */
async function pick(dim: "subject" | "ask", options: string[]): Promise<string> {
  const stats = await kvGet<Record<string, Record<string, { a: number; b: number }>>>("writer.stats", {});
  const s = stats[dim] ?? {};
  let best = options[0];
  let bestDraw = -1;
  for (const o of options) {
    const { a = 1, b = 1 } = s[o] ?? {};
    const draw = betaSample(a, b);
    if (draw > bestDraw) [best, bestDraw] = [o, draw];
  }
  return best;
}

function betaSample(a: number, b: number): number {
  const g = (k: number) => { // Marsaglia–Tsang gamma sampler (k >= 1 here)
    const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x = 0, v = 0;
      do { x = gauss(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };
  const x = g(a), y = g(b);
  return x / (x + y);
}
function gauss() {
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export async function recordOutcome(variant: Variant | undefined, replied: boolean): Promise<void> {
  if (!variant) return;
  const stats = await kvGet<Record<string, Record<string, { a: number; b: number }>>>("writer.stats", {});
  for (const [dim, arm] of Object.entries(variant)) {
    stats[dim] = stats[dim] ?? {};
    const cur = stats[dim][arm] ?? { a: 1, b: 1 };
    stats[dim][arm] = replied ? { ...cur, a: cur.a + 1 } : { ...cur, b: cur.b + 1 };
  }
  await kvSet("writer.stats", stats);
}

export async function writerStats() {
  return kvGet<Record<string, Record<string, { a: number; b: number }>>>("writer.stats", {});
}

function signature(profile: Profile): string {
  const links = (profile.links ?? []).sort((a, b) => Number(/linkedin/.test(b)) - Number(/linkedin/.test(a))).slice(0, 2);
  return [profile.name, ...links].filter(Boolean).join("\n");
}

function wc(s: string) {
  return (s.match(/\w+/g) ?? []).length;
}

export type Draft = { subject: string; body: string; by: string; variant?: Variant; usedFacts: string[] };

/** First email. `contactRole`: recruiting | general | person | user-added. */
export async function firstEmail(profile: Profile, job: FeedJob, contactEmail: string, contactRole: string): Promise<Draft> {
  const role = shortRole(job.title);
  const facts = rankFacts(profile, job);
  const top = facts.filter((f, i) => i === 0 || f.context !== facts[0].context || f.kind !== facts[0].kind).slice(0, 2);
  const jobSkills = findSkills(`${job.title}\n${job.description}`);
  const mine = jobSkills.filter((s) => (profile.skills ?? []).some((p) => p.toLowerCase() === s.toLowerCase()));
  const edu = profile.education?.[0];
  const ctx: Ctx = {
    role, company: job.company,
    cred: mine.slice(0, 2).join(" + ") || (profile.skills ?? []).slice(0, 2).join(" + ") || "my background",
    status: profile.experience_level === "student" && edu?.degree ? `${edu.degree.replace(/\s+in\s+.*$/i, "")} student` : (profile.experience?.[0]?.title || profile.headline || "Candidate"),
  };
  const subjectArm = await pick("subject", mine.length ? ["credential", "question", "profile"] : ["question", "profile"]);
  const askOptions = contactRole === "general" ? ["forward", "consider"] : contactRole === "person" ? ["call", "consider"] : ["consider", "call"];
  const askArm = await pick("ask", askOptions);

  let subject = SUBJECTS[subjectArm](ctx);
  if (subject.length > 62) subject = SUBJECTS[subjectArm]({ ...ctx, role: role.split(/\s[-–,:]\s|,\s/)[0] });
  if (subject.length > 65) subject = `${job.company}: ${role}`.slice(0, 65);

  const name = firstName(contactEmail, contactRole);
  const greeting = name ? `Hi ${name},` : `Hi ${job.company} team,`;
  const team = teamHint(job);
  const hook = `I'm writing about the ${role} role${team ? ` on ${team}` : ""} at ${job.company}. ${whoSentence(profile)}`.trim();
  const proofs = top.map((f, i) => proofSentence(f, i === 0));
  const mentioned = proofs.join(" ").toLowerCase();
  const extraSkills = mine.filter((s) => !mentioned.includes(s.toLowerCase())).slice(0, 2);
  const skillsLine = extraSkills.length === 2 ? `I've also worked with ${extraSkills[0]} and ${extraSkills[1]}, which the role asks for.` : "";
  const ask = ASKS[askArm](ctx);
  const close = "My resume is attached. Thank you for your time.";

  let parts = [hook, ...proofs, skillsLine, ask, close].filter(Boolean);
  const bodyOf = (ps: string[]) => `${greeting}\n\n${ps[0]}\n\n${ps.slice(1, -2).join(" ")}\n\n${ps.slice(-2).join(" ")}`.replace(/\n\n\n+/g, "\n\n");
  while (wc(bodyOf(parts)) > 125 && parts.length > 4) parts = parts.filter((p, i) => !(i === parts.length - 3 && p !== ask));
  let body = `${bodyOf(parts)}\n\n${signature(profile)}`;
  let by = "Kold writer";
  const support = supportText(profile, job);

  // Optional polish by the on-device model; only kept if it passes every check the original passes.
  if (aiReady()) {
    const polished = await generate(
      "You polish job-search cold emails. Keep every fact exactly; add no new claims, skills, numbers or flattery. " +
        "Keep it 60-120 words, plain and warm, with one clear question at the end. Keep the greeting and signature lines. Return only the email body.",
      `JOB: ${job.title} at ${job.company}\n\nDRAFT:\n${body}`, { temperature: 0.5, maxTokens: 400 });
    if (polished) {
      const p = polished.replace(/^subject:.*\n+/i, "").trim();
      const baseClaims = unsupportedClaims(body, support).length;
      if (wc(p) >= 45 && wc(p) <= 150 && /\?/.test(p) && p.includes(job.company) && grounded(p, support) &&
          unsupportedClaims(p, support).length <= baseClaims && (!profile.name || p.includes(profile.name.split(" ")[0]))) {
        body = p;
        by = `Kold writer + ${aiLabel()}`;
      }
    }
  }
  return { subject, body, by, variant: { subject: subjectArm, ask: askArm }, usedFacts: top.map((f) => f.id) };
}

export async function followUp(profile: Profile, job: FeedJob, step: number, maxFollowups: number, contactEmail: string, contactRole: string, usedFacts: string[]): Promise<Draft> {
  const role = shortRole(job.title);
  const name = firstName(contactEmail, contactRole);
  const greeting = name ? `Hi ${name},` : "Hi,";
  let body: string;
  const used = new Set(usedFacts);
  if (step >= maxFollowups) {
    body = `${greeting}\n\nI'll close the loop on my note about the ${role} role at ${job.company}. If someone else handles hiring for it, could you point me to them? Thanks again for your time.\n\n${profile.name}`;
  } else {
    const extra = rankFacts(profile, job).find((f) => !used.has(f.id));
    const add = extra ? ` One more thing that may be relevant: ${proofSentence(extra, true).replace(/^At /, "at ").replace(/^I /, "I ")}` : "";
    body = `${greeting}\n\nFollowing up on my note about the ${role} role at ${job.company}.${add}\n\nIs the role still open? I'd be glad to share more.\n\nThank you,\n${profile.name}`;
    if (extra) usedFacts.push(extra.id);
  }
  let by = "Kold writer";
  if (aiReady()) {
    const p = await generate("Polish this short follow-up email. Keep every fact, no new claims or numbers, 30-80 words, end with one question. Return only the body.",
      body, { temperature: 0.4, maxTokens: 250 });
    const support = supportText(profile, job);
    if (p && wc(p) >= 20 && wc(p) <= 90 && /\?/.test(p) && grounded(p, support) && unsupportedClaims(p, support).length <= unsupportedClaims(body, support).length) {
      body = p.trim();
      by = `Kold writer + ${aiLabel()}`;
    }
  }
  return { subject: "", body, by, usedFacts };
}

export async function replyDraft(profile: Profile, job: FeedJob, theirName: string, theirBody: string, label: string): Promise<string> {
  const hi = /^[A-Z][a-z]+$/.test(theirName.split(" ")[0] ?? "") ? `Hi ${theirName.split(" ")[0]},` : "Hi,";
  const me = profile.name;
  const base: Record<string, string> = {
    positive: `${hi}\n\nThank you for getting back to me. I'd be glad to talk about the ${shortRole(job.title)} role. I'm available [your availability, e.g. Tue–Thu after 2 PM IST]. Please let me know what works for you.\n\nBest,\n${me}`,
    question: `${hi}\n\nThank you for your reply. [answer their question here]\n\nHappy to share anything else that helps.\n\nBest,\n${me}`,
    not_now: `${hi}\n\nThank you for letting me know. I'd love to be considered when a suitable role opens up. Would it be all right if I checked back in a few months?\n\nBest,\n${me}`,
    negative: `${hi}\n\nThank you for the update and for taking the time to reply. I wish you and the team all the best.\n\nBest,\n${me}`,
    annoyed: `${hi}\n\nApologies for the extra emails. I won't contact you again. Thank you for your time.\n\n${me}`,
  };
  let draft = base[label] ?? `${hi}\n\nThank you for getting back to me. [your reply]\n\nBest,\n${me}`;
  if (aiReady() && ["positive", "question", "not_now"].includes(label)) {
    const p = await generate(
      "You help a job seeker reply to a company. Use ONLY facts from the profile and their message. Never invent availability, salary, " +
        "notice period or experience: write [placeholders] in square brackets for anything the user must supply. 40-110 words, warm, plain. Sign with the candidate's name.",
      `THEIR MESSAGE:\n${theirBody.slice(0, 1500)}\n\nGOAL: ${label}\n\nPROFILE:\n${JSON.stringify({ name: me, skills: profile.skills, experience: profile.experience, projects: profile.projects }).slice(0, 3000)}`,
      { temperature: 0.4, maxTokens: 350 });
    if (p && grounded(p, `${JSON.stringify(profile)} ${theirBody}`) && wc(p) >= 20) draft = p.trim();
  }
  return draft;
}

export { check };
