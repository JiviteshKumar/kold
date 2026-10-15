"use client";

/**
 * The daily job feed. A free GitHub Actions job scans every official source once a day and publishes verified
 * listings next to this app. The app downloads the new file when it changes (about 1.3 MB) and keeps it on the device.
 */
import { db, kvGet, kvSet } from "./db";

export type FeedJob = {
  id: string; source: string; source_label: string; source_url: string; company: string; domain: string; title: string;
  department: string; location: string; workplace: "onsite" | "hybrid" | "remote"; region: string; open_to_india: boolean;
  job_type: string; seniority: string; posted_at: string | null; deadline: string | null; salary: string; tags: string[];
  trust_score: number; trust_flags: { level: "ok" | "warn" | "bad"; text: string }[]; url: string; apply_url: string;
  summary: string; description: string; emails: { email: string; role: string; source_url: string }[];
  active?: boolean;
};
export type FeedMeta = { generated_at: string; jobs: number; sources_ok: number; sources_total: number; companies: number; contacts_domains: number };
export type PublishedContact = { email: string; role: string; source_url: string };

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
// The feed lives one level above the app (…/kold/data/). Overridable for local testing.
const FEED_URL = process.env.NEXT_PUBLIC_FEED_URL ?? `${base.replace(/\/app$/, "")}/data`;

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(`${FEED_URL}/${path}?v=${Date.now() / 3600000 | 0}`, { cache: "no-cache" });
  if (!r.ok) throw new Error(`Couldn't download ${path} (${r.status})`);
  return r.json() as Promise<T>;
}

export async function currentMeta(): Promise<FeedMeta | null> {
  return kvGet<FeedMeta | null>("feed.meta", null);
}

/**
 * Download the newest daily feed if it changed. Listings that disappeared from the feed (the employer took them
 * down) are marked closed rather than deleted, so anything the user saved keeps its history.
 * Returns how many new listings arrived, or null when the feed hasn't changed.
 */
export async function syncFeed(force = false): Promise<{ added: number; closed: number; meta: FeedMeta } | null> {
  const remote = await fetchJson<FeedMeta>("meta.json");
  const local = await currentMeta();
  if (!force && local && local.generated_at === remote.generated_at) return null;
  const [{ jobs }, contacts] = await Promise.all([
    fetchJson<{ meta: FeedMeta; jobs: FeedJob[] }>("jobs.json"),
    fetchJson<Record<string, PublishedContact[]>>("contacts.json"),
  ]);
  const d = await db();
  const tx = d.transaction("jobs", "readwrite");
  const existing = new Map((await tx.store.getAll()).map((j) => [String(j.id), j as FeedJob]));
  const fresh = new Set(jobs.map((j) => j.id));
  let added = 0;
  let closed = 0;
  for (const j of jobs) {
    if (!existing.has(j.id)) added++;
    await tx.store.put({ ...j, active: true }, j.id);
  }
  for (const [id, j] of existing) {
    if (!fresh.has(id) && j.active !== false) {
      closed++;
      await tx.store.put({ ...j, active: false }, id);
    }
  }
  await tx.done;
  await kvSet("feed.contacts", contacts);
  await kvSet("feed.meta", remote);
  await kvSet("feed.synced_at", new Date().toISOString());
  return { added, closed, meta: remote };
}

export async function allJobs(): Promise<FeedJob[]> {
  return (await (await db()).getAll("jobs")) as FeedJob[];
}

export async function getJob(id: string): Promise<FeedJob | undefined> {
  return (await (await db()).get("jobs", id)) as FeedJob | undefined;
}

export async function publishedContacts(domain: string): Promise<PublishedContact[]> {
  const map = await kvGet<Record<string, PublishedContact[]>>("feed.contacts", {});
  return map[domain] ?? [];
}
