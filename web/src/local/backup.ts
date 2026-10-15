"use client";

/** Back up / restore Kold Lite data (everything lives on the device, so this is how users move to a new phone). */
import { all, db, kvGet, put, STORES } from "./db";

// The user's own data. Not included: the Gmail sign-in (never exported) and the daily job feed (downloaded again).
const KV_KEYS = ["user", "profile", "prefs", "writer.stats", "classifier.nb", "demo.mailbox", "ai.tier"];

export async function exportBackup(): Promise<void> {
  const data: Record<string, unknown> = { kold_backup: 1, created_at: new Date().toISOString(), kv: {}, stores: {} };
  for (const k of KV_KEYS) (data.kv as Record<string, unknown>)[k] = await kvGet(k, null);
  for (const s of STORES) {
    const rows = await all(s);
    (data.stores as Record<string, unknown>)[s] = rows.map((r) => ({ ...r, pdf: undefined })); // PDFs are regenerated on demand
  }
  // Listings you saved or acted on, so they survive the move even after they leave the daily feed.
  const kept = new Set((await all<{ job_id: string; status: string }>("userjobs")).filter((u) => u.status !== "new").map((u) => u.job_id));
  const d = await db();
  data.jobs = (await Promise.all([...kept].map((id) => d.get("jobs", id)))).filter(Boolean);
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `kold-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

/** Replaces your data on this device with the backup's. This device's job feed and Gmail connection are kept. */
export async function importBackup(file: File): Promise<void> {
  const data = JSON.parse(await file.text());
  if (data?.kold_backup !== 1) throw new Error("That isn't a Kold backup file");
  const d = await db();
  for (const k of KV_KEYS) await d.delete("kv", k);
  for (const k of KV_KEYS) if (data.kv?.[k] != null) await d.put("kv", data.kv[k], k);
  for (const s of STORES) {
    await d.clear(s);
    for (const row of (data.stores?.[s] ?? []) as { id: number }[]) await put(s, row);
  }
  // Saved listings: add the ones this device doesn't have; never replace a fresher copy from the feed.
  for (const job of (data.jobs ?? []) as { id: string }[]) if (job?.id && !(await d.get("jobs", job.id))) await d.put("jobs", job, job.id); // listings are keyed by their feed id
}
