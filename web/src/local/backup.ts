"use client";

/** Back up / restore Kold Lite data (everything lives on the device, so this is how users move to a new phone). */
import { all, db, kvGet, put, STORES, wipe } from "./db";

const KV_KEYS = ["user", "profile", "prefs", "writer.stats", "classifier.nb", "gmail.conn", "demo.mailbox", "ai.tier"];

export async function exportBackup(): Promise<void> {
  const data: Record<string, unknown> = { kold_backup: 1, created_at: new Date().toISOString(), kv: {}, stores: {} };
  for (const k of KV_KEYS) (data.kv as Record<string, unknown>)[k] = await kvGet(k, null);
  delete (data.kv as Record<string, unknown>)["gmail.conn"]; // never export sign-in tokens
  for (const s of STORES) {
    const rows = await all(s);
    (data.stores as Record<string, unknown>)[s] = rows.map((r) => ({ ...r, pdf: undefined })); // PDFs are regenerated on demand
  }
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `kold-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

export async function importBackup(file: File): Promise<void> {
  const data = JSON.parse(await file.text());
  if (data?.kold_backup !== 1) throw new Error("That isn't a Kold backup file");
  await wipe();
  const d = await db();
  for (const [k, v] of Object.entries(data.kv ?? {})) if (v !== null) await d.put("kv", v, k);
  for (const s of STORES) for (const row of (data.stores?.[s] ?? []) as { id: number }[]) await put(s, row);
}
