"use client";

/**
 * Kold Lite storage: everything lives in this browser's IndexedDB, on the user's own device.
 * Nothing is sent to any Kold server (there isn't one in Lite).
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type Row = Record<string, unknown> & { id: number };

export const STORES = [
  "userjobs", "contacts", "campaigns", "outbox", "inbox", "sentreplies", "reminders", "activity", "tailored", "resumes",
] as const;
export type Store = (typeof STORES)[number];

interface KoldDB extends DBSchema {
  kv: { key: string; value: unknown };
  jobs: { key: string; value: Record<string, unknown> };
  userjobs: { key: number; value: Row; indexes: { job_id: string; status: string } };
  contacts: { key: number; value: Row };
  campaigns: { key: number; value: Row };
  outbox: { key: number; value: Row; indexes: { campaign_id: number; status: string } };
  inbox: { key: number; value: Row; indexes: { campaign_id: number; gmail_message_id: string } };
  sentreplies: { key: number; value: Row; indexes: { campaign_id: number } };
  reminders: { key: number; value: Row };
  activity: { key: number; value: Row };
  tailored: { key: number; value: Row; indexes: { job_id: string } };
  resumes: { key: number; value: Row };
}

let dbp: Promise<IDBPDatabase<KoldDB>> | null = null;

export function db(): Promise<IDBPDatabase<KoldDB>> {
  if (!dbp) {
    dbp = openDB<KoldDB>("kold-lite", 1, {
      upgrade(d) {
        d.createObjectStore("kv");
        d.createObjectStore("jobs");
        const uj = d.createObjectStore("userjobs", { keyPath: "id", autoIncrement: true });
        uj.createIndex("job_id", "job_id");
        uj.createIndex("status", "status");
        d.createObjectStore("contacts", { keyPath: "id", autoIncrement: true });
        d.createObjectStore("campaigns", { keyPath: "id", autoIncrement: true });
        const ob = d.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
        ob.createIndex("campaign_id", "campaign_id");
        ob.createIndex("status", "status");
        const ib = d.createObjectStore("inbox", { keyPath: "id", autoIncrement: true });
        ib.createIndex("campaign_id", "campaign_id");
        ib.createIndex("gmail_message_id", "gmail_message_id");
        const sr = d.createObjectStore("sentreplies", { keyPath: "id", autoIncrement: true });
        sr.createIndex("campaign_id", "campaign_id");
        d.createObjectStore("reminders", { keyPath: "id", autoIncrement: true });
        d.createObjectStore("activity", { keyPath: "id", autoIncrement: true });
        const tr = d.createObjectStore("tailored", { keyPath: "id", autoIncrement: true });
        tr.createIndex("job_id", "job_id");
        d.createObjectStore("resumes", { keyPath: "id", autoIncrement: true });
      },
    });
  }
  return dbp;
}

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const v = await (await db()).get("kv", key);
  return (v === undefined ? fallback : v) as T;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).put("kv", value, key);
}

export async function all<T = Row>(store: Store): Promise<T[]> {
  return (await (await db()).getAll(store)) as T[];
}

export async function get<T = Row>(store: Store, id: number): Promise<T | undefined> {
  return (await (await db()).get(store, id)) as T | undefined;
}

export async function put<T extends Partial<Row>>(store: Store, row: T): Promise<T & { id: number }> {
  const id = (await (await db()).put(store, row as Row)) as number;
  return { ...row, id };
}

export async function del(store: Store, id: number): Promise<void> {
  await (await db()).delete(store, id);
}

export async function where<T = Row>(store: Store, pred: (r: T) => boolean): Promise<T[]> {
  return (await all<T>(store)).filter(pred);
}

export async function wipe(): Promise<void> {
  const d = await db();
  d.close();
  dbp = null;
  await new Promise<void>((res) => {
    const r = indexedDB.deleteDatabase("kold-lite");
    r.onsuccess = r.onerror = r.onblocked = () => res();
  });
}

export const nowIso = () => new Date().toISOString();
