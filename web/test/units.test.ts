/** Kold Lite's building blocks: matching, the email writer, the pre-send check and the reply reader. */
import { describe, expect, it } from "vitest";
import { classify, learn, returnDate } from "@/local/classifier";
import { scoreJob } from "@/local/matching";
import { check } from "@/local/quality";
import { firstEmail, followUp, replyDraft, supportText } from "@/local/writer";
import { FEED_JOBS, job, prefs, profile } from "./helpers";

const byId = (id: string) => FEED_JOBS.find((j) => j.id === id)!;

describe("matching: only jobs the user can take, with reasons", () => {
  const p = profile();
  it("matches the role, skills and place, and says why", () => {
    const r = scoreJob(byId("acme-da"), p, prefs())!;
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.reasons).toEqual(expect.arrayContaining(["Title matches “Data Analyst”", "On-site in Bengaluru, India", "Your skills appear in it: Python, SQL, Tableau"]));
  });
  it("keeps a remote role in India and a related role", () => {
    expect(scoreJob(byId("razor-ds"), p, prefs())!.reasons).toEqual(expect.arrayContaining(["Related to “Data Scientist”", "Remote, based in India"]));
  });
  it("does not offer another function that only shares a word (Benefits Analyst)", () => {
    const r = scoreJob(byId("gitlab-ben"), p, prefs());
    expect(r === null || !r.reasons.some((x) => x.startsWith("Related to") || x.startsWith("Title matches"))).toBe(true);
  });
  it("filters out what the user can't or shouldn't take", () => {
    expect(scoreJob(byId("big-lead"), p, prefs())).toBeNull(); // lead role for a student
    expect(scoreJob(byId("shady"), p, prefs())).toBeNull(); // low trust
    expect(scoreJob(byId("us-only"), p, prefs())).toBeNull(); // remote, not open to India
    expect(scoreJob(byId("acme-da"), p, prefs({ cities: ["Mumbai"] }))).toBeNull(); // other city
    expect(scoreJob(byId("acme-da"), p, prefs({ exclude_companies: ["acme analytics"] }))).toBeNull();
    expect(scoreJob(byId("acme-da"), p, prefs({ job_types: ["internship"] }))).toBeNull();
  });
  it("knows Gurgaon is Gurugram and Bangalore is Bengaluru", () => {
    expect(scoreJob(job({ id: "g", location: "Gurgaon, Haryana" }), p, prefs({ cities: ["Gurugram"] }))).not.toBeNull();
    expect(scoreJob(job({ id: "b", location: "Bangalore" }), p, prefs({ cities: ["Bengaluru"] }))).not.toBeNull();
  });
});

describe("pre-send check", () => {
  const support = supportText(profile(), byId("acme-da"));
  it("passes a short, specific, grounded email", () => {
    const body = "Hi Priya,\n\nI'm writing about the Data Analyst role at Acme Analytics. I'm a B.E. in Computer Science student at RV College of Engineering.\n\nAt Zeta Suite, I cleaned and joined 12 million card transactions in SQL to find the top reasons for failed payments.\n\nWould you be open to a 10-minute call next week? My resume is attached.\n\nAnanya Iyer";
    const q = check("Data Analyst at Acme Analytics: SQL + Tableau", body, "Acme Analytics", 0, true, support);
    expect(q.checks.filter((c) => c.blocking)).toEqual([]);
    expect(q.score).toBeGreaterThanOrEqual(80);
  });
  it("blocks placeholders and numbers the resume doesn't back", () => {
    const q = check("Data Analyst role", "Hi [Name], I improved revenue by 40% at Zeta Suite. Can we talk?", "Acme Analytics", 0, true, support);
    expect(q.checks.filter((c) => c.blocking).map((c) => c.text).join(" ")).toMatch(/placeholder|number/i);
  });
  it("flags spam phrases and shouting", () => {
    const q = check("URGENT!!! Guaranteed hire", "Act now!!! This is a once in a lifetime opportunity. Click here.", "Acme Analytics", 0, false, support);
    expect(q.checks.some((c) => !c.ok && /spam|calm/i.test(c.text))).toBe(true);
  });
});

describe("the email writer", () => {
  const p = profile();
  const j = byId("acme-da");
  it("writes a first email that passes its own check, from the resume only", async () => {
    const d = await firstEmail(p, j, "priya.menon@acme.com", "person");
    const words = d.body.split(/\s+/).length;
    expect(d.body).toMatch(/^Hi Priya,/);
    expect(d.body).toContain("Acme Analytics");
    expect(d.body).toMatch(/\?/);
    expect(words).toBeLessThanOrEqual(140);
    expect(d.subject.length).toBeGreaterThanOrEqual(20);
    expect(d.subject.length).toBeLessThanOrEqual(65);
    const q = check(d.subject, d.body, j.company, 0, true, supportText(p, j));
    expect(q.checks.filter((c) => c.blocking)).toEqual([]);
  });
  it("greets a shared inbox without a made-up name", async () => {
    const d = await firstEmail(p, j, "careers@acme.com", "recruiting");
    expect(d.body).not.toMatch(/^Hi Careers/);
  });
  it("adds something new in the follow-up and asks if the role is open", async () => {
    const first = await firstEmail(p, j, "priya.menon@acme.com", "person");
    const f = await followUp(p, j, 1, 2, "priya.menon@acme.com", "person", first.usedFacts);
    expect(f.body).toMatch(/still open/i);
    expect(f.body.split(/\s+/).length).toBeLessThan(first.body.split(/\s+/).length + 10);
  });
  it("leaves things only the user knows as [placeholders] in reply drafts", async () => {
    const d = await replyDraft(p, j, "Priya", "Are you free for a call this week?", "positive");
    expect(d).toMatch(/\[[^\]]+\]/);
    expect(d).toMatch(/\?/);
  });
});

describe("reading replies", () => {
  const c = (body: string, headers: Record<string, string> = {}, subject = "Re: Data Analyst role", from = "priya@acme.com") => classify(headers, from, subject, body);
  it.each([
    ["Thanks for reaching out! Are you free for a call on Thursday?", "positive"],
    ["Could you share your expected compensation and notice period?", "question"],
    ["We have decided to move forward with other candidates. We wish you the best in your search.", "negative"],
    ["Unfortunately the position has been filled.", "negative"],
    ["We'll keep your resume on file for future openings.", "not_now"],
    ["Please stop emailing me.", "annoyed"],
  ])("“%s” is %s", async (body, label) => {
    expect((await c(body)).label).toBe(label);
  });
  it("reads out-of-office replies and their return date", async () => {
    const back = new Date(Date.now() + 7 * 86400000);
    const r = await c(`I am out of the office until ${back.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} with limited access to email.`, { "auto-submitted": "auto-replied" }, "Automatic reply");
    expect(r.label).toBe("out_of_office");
    expect(r.return_date).toBe(`${back.getFullYear()}-${String(back.getMonth() + 1).padStart(2, "0")}-${String(back.getDate()).padStart(2, "0")}`);
    expect(returnDate("I'm back on 3 January.")).toMatch(/-01-03$/);
  });
  it("recognises bounces and automatic acknowledgements", async () => {
    expect((await c("Address not found", {}, "Delivery Status Notification (Failure)", "mailer-daemon@googlemail.com")).label).toBe("bounce");
    expect((await c("We have received your application.", { "auto-submitted": "auto-generated" }, "Thank you for applying")).label).toBe("auto_reply");
  });
  it("doesn't guess on mixed or tiny replies", async () => {
    expect((await c("ok")).label).toBe("unclear");
    // Mixed signals are left for the user to read rather than guessed (and never read as a rejection).
    expect((await c("Unfortunately I'm busy Monday, but let's talk Thursday.")).label).toBe("unclear");
  });
  it("learns from the user's own corrections", async () => {
    for (let i = 0; i < 12; i++) await learn(`Subject\nPlease send your portfolio and two writing samples ${i}`, "question");
    for (let i = 0; i < 12; i++) await learn(`Subject\nLovely, let us meet at the office on day ${i}`, "positive");
    const r = await c("Please send your portfolio and two writing samples");
    expect(r.label).toBe("question");
  });
});
