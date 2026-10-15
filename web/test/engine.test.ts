/**
 * Kold Lite end to end, through the same API the screens use (lib/api.ts → local/engine.ts), on a real (in-memory)
 * IndexedDB, the demo mailbox, and a stand-in network serving a small daily feed.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { handle, LocalApiError, runDaily } from "@/local/engine";
import { connectDemo } from "@/local/gmail";
import { FEED_JOBS, RESUME_TXT, job, mockNetwork, prefs } from "./helpers";

type Card = { id: string; user_job_id: number; title: string; company: string; match_score: number; match_reasons: string[]; status: string };
type Email = { id: number; campaign_id: number; step: number; to: string; subject: string; body: string; status: string; attachment: string; quality: { score: number; checks: { ok: boolean; blocking?: boolean; text: string }[] } };
type Msg = { id: number; campaign_id: number; label: string; handled: boolean; return_date: string | null; campaign_status: string; suggested_reply: string; from_name: string };

const api = <T>(method: string, path: string, body?: unknown) => handle(method, path, body) as Promise<T>;
const fails = async (p: Promise<unknown>, status: number) => {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(LocalApiError);
  expect((e as LocalApiError).status).toBe(status);
};
const feed = { jobs: [...FEED_JOBS], generated_at: "2026-10-15T00:30:00Z", noMx: ["no-mail.example"] };

let acme: Card;
let campaignId = 0;

beforeAll(() => {
  mockNetwork(feed);
});

describe("onboarding", () => {
  it("starts empty, in Lite mode", async () => {
    const me = await api<{ user: unknown; lite: boolean }>("GET", "/me");
    expect(me.user).toBeNull();
    expect(me.lite).toBe(true);
  });
  it("reads a resume into an editable profile and suggests roles", async () => {
    const form = new FormData();
    form.set("file", new File([RESUME_TXT], "Ananya_Iyer.txt", { type: "text/plain" }));
    const r = await api<{ profile: { name: string; experience: { title: string; company: string }[]; education: { institution: string }[]; skills: string[] }; preferences: { roles: string[] } }>("POST", "/resume", form);
    expect(r.profile.name).toBe("Ananya Iyer");
    expect(r.profile.experience[0]).toMatchObject({ title: "Data Analyst Intern", company: "Zeta Suite" });
    expect(r.profile.education[0].institution).toBe("RV College of Engineering");
    expect(r.profile.skills).toEqual(expect.arrayContaining(["Python", "SQL", "Tableau"]));
    expect(r.preferences.roles[0]).toBe("Data Analyst");
  });
  it("refuses files it can't read", async () => {
    const form = new FormData();
    form.set("file", new File(["x"], "photo.png"));
    await fails(api("POST", "/resume", form), 400);
    const tiny = new FormData();
    tiny.set("file", new File(["too short"], "r.txt"));
    await fails(api("POST", "/resume", tiny), 422);
  });
  it("saves preferences, connects the demo mailbox and finishes onboarding", async () => {
    await api("PUT", "/preferences", prefs());
    await connectDemo();
    await api("POST", "/onboarding/complete");
    const me = await api<{ user: { onboarded: boolean; name: string }; gmail: { connected: boolean; demo: boolean } }>("GET", "/me");
    expect(me.user).toMatchObject({ onboarded: true, name: "Ananya Iyer" });
    expect(me.gmail).toMatchObject({ connected: true, demo: true });
  });
});

describe("daily feed and matching", () => {
  it("downloads today's verified listings and shows only real matches, best first", async () => {
    const f = await api<{ cards: Card[]; last_scan: { sources_ok: number }; active_jobs: number }>("GET", "/feed");
    expect(f.active_jobs).toBe(FEED_JOBS.length);
    expect(f.last_scan.sources_ok).toBe(90);
    const ids = f.cards.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["acme-da", "razor-ds"]));
    for (const bad of ["gitlab-ben", "big-lead", "shady", "us-only"]) expect(ids).not.toContain(bad);
    expect(f.cards[0].match_score).toBeGreaterThanOrEqual(f.cards[f.cards.length - 1].match_score);
    acme = f.cards.find((c) => c.id === "acme-da")!;
    expect(acme.match_reasons[0]).toBe("Title matches “Data Analyst”");
  });
  it("doesn't download the feed again when it hasn't changed", async () => {
    const before = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes("jobs.json")).length;
    await runDaily();
    const after = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes("jobs.json")).length;
    expect(after).toBe(before);
  });
  it("saves a job with a swipe right, passes with a left, and can undo", async () => {
    const razor = (await api<{ cards: Card[] }>("GET", "/feed")).cards.find((c) => c.id === "razor-ds")!;
    expect((await api<{ status: string }>("POST", `/feed/${razor.user_job_id}/swipe`, { direction: "left" })).status).toBe("passed");
    expect((await api<{ status: string }>("POST", `/feed/${razor.user_job_id}/swipe`, { direction: "undo" })).status).toBe("new");
    expect((await api<{ status: string }>("POST", `/feed/${acme.user_job_id}/swipe`, { direction: "right" })).status).toBe("liked");
    const t = await api<{ items: Card[] }>("GET", "/tracker");
    expect(t.items.map((i) => i.id)).toEqual(["acme-da"]);
    await fails(api("POST", `/feed/${acme.user_job_id}/swipe`, { direction: "up" }), 400);
  });
});

describe("contacts", () => {
  it("finds only addresses the company published", async () => {
    const r = await api<{ contacts: { email: string; role: string }[] }>("POST", `/jobs/${acme.user_job_id}/contacts/find`);
    expect(r.contacts.map((c) => c.email)).toEqual(["careers@acme.com"]);
  });
  it("adds an address the user knows after checking the mail server", async () => {
    const c = await api<{ email: string; mx_ok: boolean }>("POST", `/jobs/${acme.user_job_id}/contacts`, { email: "Priya.Menon@acme.com" });
    expect(c).toMatchObject({ email: "priya.menon@acme.com", mx_ok: true });
    await fails(api("POST", `/jobs/${acme.user_job_id}/contacts`, { email: "someone@no-mail.example" }), 400);
    await fails(api("POST", `/jobs/${acme.user_job_id}/contacts`, { email: "not an email" }), 400);
  });
});

describe("outreach: draft, review, send", () => {
  it("only emails a verified contact", async () => {
    await fails(api("POST", `/jobs/${acme.user_job_id}/outreach`, { to_email: "random@acme.com" }), 400);
  });
  it("tailors the resume and drafts the first email for review (nothing is sent yet)", async () => {
    const r = await api<{ campaign_id: number }>("POST", `/jobs/${acme.user_job_id}/outreach`, { to_email: "priya.menon@acme.com" });
    campaignId = r.campaign_id;
    const today = await api<{ emails: Email[]; sent_today: number }>("GET", "/today");
    const e = today.emails.find((x) => x.campaign_id === campaignId)!;
    expect(e).toMatchObject({ step: 0, status: "pending", to: "priya.menon@acme.com", attachment: "Ananya_Iyer_Resume.pdf" });
    expect(e.body).toMatch(/^Hi Priya,/);
    expect(e.body).toContain("Acme Analytics");
    expect(e.quality.checks.filter((c) => c.blocking)).toEqual([]);
    expect(today.sent_today).toBe(0);
  });
  it("starting again while outreach is running just returns it (no second thread)", async () => {
    const again = await api<{ campaign_id: number }>("POST", `/jobs/${acme.user_job_id}/outreach`, { to_email: "priya.menon@acme.com" });
    expect(again.campaign_id).toBe(campaignId);
    expect((await api<{ emails: Email[] }>("GET", "/today")).emails.filter((x) => x.status === "pending")).toHaveLength(1);
  });
  it("re-checks an edited draft and refuses to send placeholders", async () => {
    const e = (await api<{ emails: Email[] }>("GET", "/today")).emails[0];
    const edited = await api<Email>("PUT", `/outbox/${e.id}`, { subject: e.subject, body: e.body.replace("Hi Priya,", "Hi [Name],") });
    expect(edited.quality.checks.some((c) => c.blocking)).toBe(true);
    await fails(api("POST", `/outbox/${e.id}/send`), 400);
    await api("PUT", `/outbox/${e.id}`, { subject: e.subject, body: e.body });
  });
  it("Rewrite replaces the draft without listing the old one as skipped", async () => {
    const e = (await api<{ emails: Email[] }>("GET", "/today")).emails[0];
    const r = await api<{ id: number }>("POST", `/outbox/${e.id}/regenerate`);
    expect(r.id).not.toBe(e.id);
    const ids = (await api<{ emails: Email[] }>("GET", "/today")).emails.map((x) => x.id);
    expect(ids).toEqual([r.id]);
  });
  it("sends on the user's tap, in the demo mailbox", async () => {
    const e = (await api<{ emails: Email[] }>("GET", "/today")).emails[0];
    await api("POST", `/outbox/${e.id}/send`);
    const today = await api<{ emails: Email[]; sent_today: number }>("GET", "/today");
    expect(today.sent_today).toBe(1);
    expect(today.emails.find((x) => x.id === e.id)!.status).toBe("sent");
    const job = await api<{ status: string; campaign: { steps_sent: number } }>("GET", `/jobs/${acme.user_job_id}`);
    expect(job.campaign.steps_sent).toBe(1);
    expect(job.status).toBe("reaching_out");
    await api("POST", `/outbox/${e.id}/send`); // a second tap sends nothing more
    expect((await api<{ sent_today: number }>("GET", "/today")).sent_today).toBe(1);
  });
});

describe("replies", () => {
  const latest = async () => (await api<{ messages: Msg[] }>("GET", "/inbox")).messages[0];
  it("reads an interested reply, stops follow-ups and helps answer it", async () => {
    await api("POST", "/demo/reply", { campaign_id: campaignId, kind: "interested" });
    const m = await latest();
    expect(m).toMatchObject({ label: "positive", handled: false, from_name: "Priya" });
    const d = await api<{ suggested_reply: string }>("POST", `/inbox/${m.id}/mode`, { mode: "assisted" });
    expect(d.suggested_reply).toMatch(/\[[^\]]+\]/); // availability is the user's to fill in
    await fails(api("POST", `/inbox/${m.id}/send`, { body: d.suggested_reply }), 400);
    await api("POST", `/inbox/${m.id}/send`, { body: d.suggested_reply.replace(/\[[^\]]+\]/, "Thursday after 2 PM IST") });
    expect((await latest()).handled).toBe(true);
    const conv = (await api<{ conversations: { messages: { kind: string }[] }[] }>("GET", "/conversations")).conversations[0];
    expect(conv.messages.map((x) => x.kind)).toEqual(["sent", "received", "sent"]);
    const job = await api<{ status: string; campaign: { status: string } }>("GET", `/jobs/${acme.user_job_id}`);
    expect(job.status).toBe("replied");
  });
  it("labels each kind of reply and reacts sensibly", async () => {
    await api("POST", "/demo/reply", { campaign_id: campaignId, kind: "question" });
    expect((await latest()).label).toBe("question");
    await api("POST", "/demo/reply", { campaign_id: campaignId, kind: "declined" });
    expect((await latest()).label).toBe("negative");
    await api("POST", "/demo/reply", { campaign_id: campaignId, kind: "annoyed" });
    const annoyed = await latest();
    expect(annoyed.label).toBe("annoyed");
    expect(annoyed.campaign_status).toBe("paused"); // waits for the user's decision
    await api("POST", "/demo/reply", { campaign_id: campaignId, kind: "out_of_office" });
    const ooo = await latest();
    expect(ooo.label).toBe("out_of_office");
    expect(ooo.return_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ooo.handled).toBe(true); // nothing for the user to do
  });
  it("learns when the user corrects a label", async () => {
    const m = await latest();
    await api("POST", `/inbox/${m.id}/label`, { label: "not_now" });
    expect((await latest()).label).toBe("not_now");
    await fails(api("POST", `/inbox/${m.id}/label`, { label: "maybe" }), 400);
  });
  it("only simulates replies in the demo mailbox", async () => {
    await fails(api("POST", "/demo/reply", { campaign_id: campaignId, kind: "nope" }), 400);
  });
});

describe("follow-ups", () => {
  it("drafts the next follow-up in the same thread once it's due", async () => {
    await api("POST", `/campaigns/${campaignId}/decision`, { action: "resume" });
    await api("POST", "/demo/advance", { campaign_id: campaignId }).catch(() => {});
    const f = (await api<{ emails: Email[] }>("GET", "/today")).emails.find((x) => x.step === 1 && x.status === "pending");
    expect(f).toBeTruthy();
    expect(f!.subject).toMatch(/^Re: /);
    expect(f!.quality.checks.filter((c) => c.blocking)).toEqual([]);
  });
  it("stops for good when the user says so", async () => {
    await api("POST", `/campaigns/${campaignId}/decision`, { action: "stop" });
    expect((await api<{ emails: Email[] }>("GET", "/today")).emails.filter((x) => x.status === "pending")).toEqual([]);
    await fails(api("POST", `/campaigns/${campaignId}/decision`, { action: "pause" }), 400);
    // and won't email the same person about this role again
    await fails(api("POST", `/jobs/${acme.user_job_id}/outreach`, { to_email: "priya.menon@acme.com" }), 409);
  });
});

describe("tracker and reminders", () => {
  it("moves a job through stages and keeps notes", async () => {
    await api("PATCH", `/jobs/${acme.user_job_id}`, { status: "interview", notes: "Panel on Friday" });
    const j = await api<{ status: string; notes: string }>("GET", `/jobs/${acme.user_job_id}`);
    expect(j).toMatchObject({ status: "interview", notes: "Panel on Friday" });
    await fails(api("PATCH", `/jobs/${acme.user_job_id}`, { status: "hired?" }), 400);
  });
  it("creates a deadline reminder and lets it be completed", async () => {
    const due = new Date(Date.now() + 5 * 86400000).toISOString();
    await api("PATCH", `/jobs/${acme.user_job_id}`, { deadline: due });
    const rs = await api<{ id: number; title: string; kind: string }[]>("GET", "/reminders");
    expect(rs).toEqual([expect.objectContaining({ kind: "deadline", title: "Apply: Data Analyst at Acme Analytics" })]);
    await api("PATCH", `/reminders/${rs[0].id}`, { done: true });
    expect(await api("GET", "/reminders")).toEqual([]);
  });
  it("puts what needs the user first on Home, with honest counts", async () => {
    const s = await api<{ sent: number; replies: number; interviews: number }>("GET", "/stats");
    expect(s).toMatchObject({ sent: 1, interviews: 1 }); // the first email; the reply went in the same thread
    expect(s.replies).toBeGreaterThanOrEqual(4);
    const h = await api<{ name: string; replies: unknown[] }>("GET", "/home");
    expect(h.name).toBe("Ananya");
    expect(Array.isArray(h.replies)).toBe(true);
    const log = await api<{ kind: string }[]>("GET", "/activity");
    expect(log.length).toBeGreaterThan(5);
  });
});

describe("the next day's feed", () => {
  it("adds new listings, closes removed ones and keeps saved jobs", async () => {
    feed.jobs = [...FEED_JOBS.filter((j) => j.id !== "acme-da"), job({ id: "new-da", company: "Nova", domain: "nova.com", title: "Junior Data Analyst" })];
    feed.generated_at = "2026-10-16T00:30:00Z";
    const out = await runDaily();
    expect(out.newListings).toBe(1);
    const f = await api<{ cards: Card[] }>("GET", "/feed");
    expect(f.cards.map((c) => c.id)).toContain("new-da");
    const t = await api<{ items: (Card & { active: boolean })[] }>("GET", "/tracker");
    expect(t.items.find((i) => i.id === "acme-da")).toMatchObject({ active: false }); // still there, marked closed
  });
});

describe("backup, restore and delete", () => {
  it("restores everything from a backup after the data is deleted", async () => {
    let saved: Blob | null = null;
    vi.stubGlobal("document", { createElement: () => ({ click() {}, set href(_v: string) {}, get href() { return "blob:x"; }, download: "" }) });
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = (b: Blob) => ((saved = b), "blob:x");
    const { exportBackup, importBackup } = await import("@/local/backup");
    await exportBackup();
    URL.createObjectURL = createObjectURL;
    expect(saved).not.toBeNull();
    const text = await saved!.text();
    expect(text).not.toMatch(/"gmail\.conn"/); // sign-in is never exported

    const before = await api<{ items: Card[] }>("GET", "/tracker");
    await api("DELETE", "/me");
    expect((await api<{ user: unknown }>("GET", "/me")).user).toBeNull();

    await importBackup(new File([text], "kold-backup.json"));
    const after = await api<{ items: Card[] }>("GET", "/tracker");
    expect(after.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id));
    expect((await api<{ user: { name: string } }>("GET", "/me")).user.name).toBe("Ananya Iyer");
    await expect(importBackup(new File(["{}"], "x.json"))).rejects.toThrow(/Kold backup/);
    vi.unstubAllGlobals();
    mockNetwork(feed);
  });
});
