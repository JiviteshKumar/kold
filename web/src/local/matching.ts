/**
 * Explainable matching (same rules as the server's matching.py): every score comes with the reasons behind it.
 */
import type { FeedJob } from "./feed";
import type { Preferences, Profile } from "@/lib/types";
import { termRe } from "./text";

export const MIN_SCORE = 30;
export const MIN_TRUST = 45;

const LEVEL_FIT: Record<string, Record<string, number>> = {
  student: { intern: 1, entry: 0.7, mid: 0, senior: 0, lead: 0 },
  fresher: { intern: 0.8, entry: 1, mid: 0.4, senior: 0, lead: 0 },
  "1-3": { intern: 0.2, entry: 1, mid: 1, senior: 0.2, lead: 0 },
  "3-5": { intern: 0, entry: 0.4, mid: 1, senior: 0.9, lead: 0.3 },
  "5+": { intern: 0, entry: 0.1, mid: 0.7, senior: 1, lead: 1 },
};
const TYPE_LABEL: Record<string, string> = { internship: "Internship", full_time: "Full-time", part_time: "Part-time", contract: "Contract" };

// A user who wants "Data Analyst" should also see "Analytics Intern" or "BI Associate".
const ROLE_FAMILIES: [RegExp, string[]][] = [
  [/data analy|business analy|analytics|\bbi\b|business intelligence/i, ["data analyst", "business analyst", "product analyst", "analytics", "business intelligence", "bi analyst", "bi developer", "insights analyst", "reporting analyst", "data analysis"]],
  [/data scien|machine learning|\bml\b|\bai\b|deep learning|nlp|computer vision/i, ["machine learning", "ml", "ai", "data scientist", "data science", "applied scientist", "deep learning", "nlp", "computer vision", "llm"]],
  [/data engineer/i, ["data engineer", "data platform", "etl", "analytics engineer"]],
  [/back-?end|server|api/i, ["backend", "back-end", "back end", "software engineer", "sde", "software developer", "platform engineer", "api"]],
  [/front-?end|ui engineer|web dev/i, ["frontend", "front-end", "front end", "ui engineer", "web developer", "web engineer"]],
  [/full-?stack/i, ["full stack", "full-stack", "fullstack", "software engineer", "web developer", "sde"]],
  [/software (engineer|developer)|\bsde\b|programmer/i, ["software engineer", "software developer", "sde", "developer", "engineer"]],
  [/android|ios|mobile|flutter/i, ["android", "ios", "mobile", "flutter", "react native"]],
  [/devops|\bsre\b|site reliability|cloud|infra/i, ["devops", "sre", "site reliability", "cloud", "infrastructure", "platform"]],
  [/design|\bux\b|\bui\b/i, ["designer", "design", "ux", "ui", "visual"]],
  [/product manag|\bapm\b|\bpm\b/i, ["product manager", "product management", "apm", "product owner", "product"]],
  [/marketing|growth|seo|content|social media|brand/i, ["marketing", "growth", "seo", "content", "social media", "brand", "community"]],
  [/sales|business development|account exec|\bsdr\b|\bbdr\b/i, ["sales", "business development", "account executive", "sdr", "bdr", "account manager"]],
  [/recruit|talent|\bhr\b|human resources|people/i, ["recruiter", "recruiting", "talent", "hr", "people"]],
  [/financ|account|audit|fp&a/i, ["finance", "accounting", "accountant", "audit", "fp&a", "treasury"]],
  [/operation|supply chain|logistics/i, ["operations", "ops", "supply chain", "logistics"]],
  [/support|customer success|customer experience/i, ["support", "customer success", "customer experience"]],
  [/\bqa\b|quality|test|sdet/i, ["qa", "quality", "test", "sdet"]],
  [/security|cyber/i, ["security", "cyber", "appsec"]],
];

// A family match ("Related to ...") is refused when the title is plainly another function the user never asked for,
// so a Data Analyst is not shown "Benefits Analyst" and an ML engineer is not shown "Marketing AI Engineer".
const OTHER_FUNCTIONS = ["benefits", "payable", "receivable", "payroll", "accounting", "tax", "legal", "marketing", "sales",
  "recruit", "recruiting", "talent", "procurement", "credit", "compliance", "facilities", "clinical"];
const otherFunction = (role: string, title: string) => OTHER_FUNCTIONS.some((w) => termRe(w).test(title) && !termRe(w).test(role));

function roleMatch(roles: string[], title: string): [number, string] {
  for (const r of roles) if (termRe(r).test(title)) return [40, r];
  for (const r of roles) {
    const ws = (r.toLowerCase().match(/[a-z0-9+#]+/g) ?? []).filter((w) => w.length > 2);
    if (ws.length && ws.every((w) => termRe(w).test(title))) return [32, r];
  }
  for (const r of roles) for (const [fam, terms] of ROLE_FAMILIES) if (fam.test(r) && terms.some((t) => termRe(t).test(title)) && !otherFunction(r, title)) return [25, r];
  return [0, ""];
}

function locationOk(j: FeedJob, p: Preferences): [boolean, string] {
  const cities = (p.cities ?? []).map((c) => c.toLowerCase());
  if (j.workplace === "remote") {
    if (j.region === "india" && p.remote_india) return [true, "Remote, based in India"];
    if (j.open_to_india && p.remote_global) return [true, "Remote and open to candidates in India"];
    if (j.region === "unknown" && p.remote_global && p.include_unclear_remote) return [true, "Remote (India eligibility not stated)"];
    return [false, ""];
  }
  if (j.region === "india" && p.onsite_india) {
    const loc = j.location.toLowerCase();
    if (!cities.length || cities.some((c) => loc.includes(c) || (c === "bengaluru" && loc.includes("bangalore")) || (c === "gurugram" && loc.includes("gurgaon")))) {
      return [true, `${j.workplace === "hybrid" ? "Hybrid" : "On-site"} in ${j.location.split(/[;|]/)[0]}`];
    }
  }
  return [false, ""];
}

export function scoreJob(j: FeedJob, profile: Profile, p: Preferences): { score: number; reasons: string[] } | null {
  if (j.trust_score < MIN_TRUST || j.active === false) return null;
  if ((p.exclude_companies ?? []).some((c) => c.toLowerCase() === j.company.toLowerCase())) return null;
  if (p.job_types?.length && !p.job_types.includes(j.job_type)) return null;
  const [ok, locReason] = locationOk(j, p);
  if (!ok) return null;
  const level = p.experience_level;
  const fit = j.seniority ? LEVEL_FIT[level]?.[j.seniority] ?? 0.6 : 0.5;
  if (level && j.seniority && fit === 0) return null;
  if ((p.exclude_keywords ?? []).filter((w) => w.trim()).some((w) => termRe(w).test(j.title))) return null;

  const reasons: string[] = [];
  const hay = `${j.title}\n${j.department}\n${(j.tags ?? []).join(" ")}\n${j.description}`;
  const roles = (p.roles ?? []).filter((r) => r.trim());
  const [roleScore, role] = roleMatch(roles, j.title);
  let rolePts = roleScore;
  if (role) reasons.push(rolePts >= 32 ? `Title matches “${role}”` : `Related to “${role}”`);
  else if (roles.length) rolePts = -15;

  const hits = (profile.skills ?? []).filter((s) => s && s.length <= 40 && termRe(s).test(hay));
  const skillPts = Math.min(35, hits.length * 7);
  if (hits.length) reasons.push(`Your skills appear in it: ${hits.slice(0, 6).join(", ")}`);
  const levelPts = Math.round(15 * fit);
  if (level && j.seniority && fit >= 0.7) reasons.push(`Fits your experience level (${j.seniority})`);
  let freshPts = 0;
  if (j.posted_at && Date.now() - new Date(j.posted_at).getTime() < 10 * 86400000) {
    freshPts = 10;
    reasons.push("Posted in the last 10 days");
  }
  reasons.push(locReason);
  if (p.job_types?.length) reasons.push(`${TYPE_LABEL[j.job_type] ?? j.job_type}, as you asked`);
  if (!roles.length && !hits.length) return null;
  return { score: Math.max(0, Math.min(100, rolePts + skillPts + levelPts + freshPts)), reasons };
}
