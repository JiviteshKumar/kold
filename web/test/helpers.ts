/** Shared test data: a small daily feed, a resume, and stand-ins for the network (feed download, DNS). */
import { vi } from "vitest";
import type { FeedJob } from "@/local/feed";
import type { Preferences, Profile } from "@/lib/types";

const recent = new Date(Date.now() - 3 * 86400000).toISOString();

export function job(over: Partial<FeedJob> & { id: string }): FeedJob {
  return {
    source: "greenhouse", source_label: "Official careers board (Greenhouse)", source_url: "https://boards.greenhouse.io/acme", company: "Acme Analytics",
    domain: "acme.com", title: "Data Analyst", department: "Analytics", location: "Bengaluru, India", workplace: "onsite", region: "india",
    open_to_india: true, job_type: "full_time", seniority: "entry", posted_at: recent, deadline: null, salary: "", tags: ["SQL"],
    trust_score: 85, trust_flags: [{ level: "ok", text: "Posted on the employer's own careers board" }], url: "https://acme.com/jobs/1",
    apply_url: "https://acme.com/jobs/1/apply", summary: "Analyse product data.",
    description: "Join our Analytics team. You will write SQL and Python every day, build Tableau dashboards and present findings. 2+ projects with real data preferred.",
    emails: [], ...over,
  };
}

export const FEED_JOBS: FeedJob[] = [
  job({ id: "acme-da", title: "Data Analyst" }),
  job({ id: "razor-ds", company: "Razorpay", domain: "razorpay.com", title: "Data Science Intern", job_type: "internship", seniority: "intern", workplace: "remote", region: "india", location: "Remote, India", description: "Python, SQL, machine learning for fraud models." }),
  job({ id: "gitlab-ben", company: "GitLab", domain: "gitlab.com", title: "Benefits Analyst", department: "People", workplace: "remote", region: "global", location: "Remote", description: "Benefits administration and payroll. Excel, SQL." }),
  job({ id: "big-lead", company: "BigCo", domain: "bigco.com", title: "Lead Data Analyst", seniority: "lead" }),
  job({ id: "shady", company: "QuickJobs", domain: "quickjobs.biz", title: "Data Analyst", trust_score: 30 }),
  job({ id: "us-only", company: "Statefarm", domain: "statefarm.com", title: "Data Analyst", workplace: "remote", region: "us", open_to_india: false, location: "Remote - US" }),
];
export const FEED_CONTACTS = { "acme.com": [{ email: "careers@acme.com", role: "recruiting", source_url: "https://acme.com/careers" }] };

export const RESUME_TXT = `Ananya Iyer
Bengaluru, India | ananya.iyer.dev@example.com | +91 98450 12345 | github.com/ananya-iyer

SUMMARY
Final-year student who builds data products end to end.

EXPERIENCE
Data Analyst Intern | Zeta Suite | Dec 2024 - Feb 2025
- Cleaned and joined 12 million card transactions in SQL to find the top reasons for failed payments.
- Built a Tableau dashboard used by 30 people in the product team.

EDUCATION
B.E. in Computer Science, RV College of Engineering, 2022 - 2026, CGPA 8.9

PROJECTS
Churn Radar: Predicts which subscribers will cancel in the next 30 days, with an AUC of 0.87.

SKILLS
Python, SQL, Tableau, Excel, Pandas
`;

export function profile(over: Partial<Profile> = {}): Profile {
  return {
    name: "Ananya Iyer", headline: "", email: "ananya@example.com", phone: "", location: "Bengaluru, India", links: ["github.com/ananya-iyer"],
    summary: "", skills: ["Python", "SQL", "Tableau", "Excel", "Pandas"],
    experience: [{ title: "Data Analyst Intern", company: "Zeta Suite", start: "Dec 2024", end: "Feb 2025", bullets: ["Cleaned and joined 12 million card transactions in SQL to find the top reasons for failed payments.", "Built a Tableau dashboard used by 30 people in the product team."] }],
    education: [{ degree: "B.E. in Computer Science", institution: "RV College of Engineering", start: "2022", end: "2026", score: "8.9" }],
    projects: [{ name: "Churn Radar", description: "Predicts which subscribers will cancel in the next 30 days, with an AUC of 0.87.", tech: ["Python"] }],
    certifications: [], achievements: [], experience_level: "student", suggested_roles: ["Data Analyst"], ...over,
  };
}

export function prefs(over: Partial<Preferences> = {}): Preferences {
  return {
    job_types: ["internship", "full_time"], roles: ["Data Analyst", "Data Scientist"], cities: [], onsite_india: true, remote_india: true,
    remote_global: true, include_unclear_remote: false, experience_level: "student", exclude_companies: [], exclude_keywords: [], ...over,
  };
}

/** The network as the app sees it: the daily feed next to the app, and DNS-over-HTTPS for mail servers. */
export function mockNetwork(state: { jobs: FeedJob[]; generated_at: string; noMx?: string[] }) {
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const meta = { generated_at: state.generated_at, jobs: state.jobs.length, sources_ok: 90, sources_total: 90, companies: 5, contacts_domains: 1, version: 1 };
    if (url.includes("/data/meta.json")) return json(meta);
    if (url.includes("/data/jobs.json")) return json({ meta, jobs: state.jobs });
    if (url.includes("/data/contacts.json")) return json(FEED_CONTACTS);
    if (url.includes("dns.google") || url.includes("cloudflare-dns")) {
      const name = new URL(url).searchParams.get("name") ?? "";
      return json(state.noMx?.includes(name) ? { Status: 3 } : { Status: 0, Answer: [{ name, type: 15, data: `10 mx.${name}.` }] });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
