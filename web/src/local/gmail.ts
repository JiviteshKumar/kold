"use client";

/**
 * Gmail for Kold Lite: the user's phone talks directly to Google with Google Identity Services. No Kold server is
 * involved, and tokens stay on the device. Permissions: gmail.send + gmail.readonly, and Kold only reads threads it
 * started plus new emails from companies the user contacted. The rest of the inbox is never read.
 *
 * If no Google client ID is configured yet, a clearly labelled demo mailbox lets people try the whole flow.
 */
import { kvGet, kvSet } from "./db";
import { htmlToText } from "./text";

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const SCOPES = "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export type MailMsg = {
  id: string; thread_id: string; from_email: string; from_name: string; subject: string; snippet: string; body: string;
  headers: Record<string, string>; internal_date: number; message_id_header: string; label_ids: string[]; to?: string;
};
type Conn = { mode: "google" | "demo"; email: string; token?: string; expires_at?: number };

export const googleConfigured = () => !!CLIENT_ID;
export async function connection(): Promise<Conn | null> {
  return kvGet<Conn | null>("gmail.conn", null);
}
export async function disconnect(): Promise<void> {
  const c = await connection();
  if (c?.mode === "google" && c.token) {
    const g = (window as unknown as { google?: GIS }).google;
    try { g?.accounts.oauth2.revoke(c.token, () => {}); } catch {}
  }
  await kvSet("gmail.conn", null);
}

type GIS = { accounts: { oauth2: {
  initTokenClient: (o: { client_id: string; scope: string; callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void; error_callback?: (e: { type: string }) => void }) => { requestAccessToken: (o?: { prompt?: string; login_hint?: string }) => void };
  revoke: (t: string, cb: () => void) => void;
} } };

function loadGis(): Promise<GIS> {
  const w = window as unknown as { google?: GIS };
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google);
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => (w.google ? res(w.google) : rej(new Error("Google sign-in didn't load")));
    s.onerror = () => rej(new Error("Couldn't reach Google sign-in. Check your connection."));
    document.head.appendChild(s);
  });
}

/** Must be called from a tap/click (browsers only allow sign-in popups from a user gesture). */
export async function connectGoogle(): Promise<string> {
  if (!CLIENT_ID) throw new Error("Gmail sign-in isn't set up for this site yet. Try the demo mailbox instead.");
  const g = await loadGis();
  const prev = await connection();
  const token = await new Promise<{ access_token: string; expires_in: number }>((res, rej) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPES,
      callback: (r) => (r.access_token ? res({ access_token: r.access_token, expires_in: r.expires_in ?? 3600 }) : rej(new Error(r.error || "Google sign-in was cancelled"))),
      error_callback: (e) => rej(new Error(e.type === "popup_closed" ? "Sign-in window was closed" : "Google sign-in failed")),
    });
    client.requestAccessToken({ prompt: prev?.mode === "google" ? "" : "consent", login_hint: prev?.email });
  });
  const profile = await fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${token.access_token}` } }).then((r) => r.json());
  const email = String(profile.emailAddress ?? "").toLowerCase();
  await kvSet("gmail.conn", { mode: "google", email, token: token.access_token, expires_at: Date.now() + (token.expires_in - 60) * 1000 } satisfies Conn);
  return email;
}

export async function connectDemo(): Promise<string> {
  await kvSet("gmail.conn", { mode: "demo", email: "you@demo.kold" } satisfies Conn);
  return "you@demo.kold";
}

/** True when Kold can talk to Gmail right now without asking the user (token still valid, or demo). */
export async function ready(): Promise<boolean> {
  const c = await connection();
  return !!c && (c.mode === "demo" || (!!c.token && (c.expires_at ?? 0) > Date.now()));
}

export class NeedsReconnect extends Error {
  constructor() {
    super("Your Gmail session expired. Tap 'Reconnect Gmail' to continue (Google asks every hour for apps without a server).");
  }
}

async function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const c = await connection();
  if (!c || c.mode !== "google") throw new Error("Connect Gmail first");
  if (!c.token || (c.expires_at ?? 0) < Date.now()) throw new NeedsReconnect();
  const r = await fetch(`${API}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${c.token}` } });
  if (r.status === 401) {
    await kvSet("gmail.conn", { ...c, token: undefined, expires_at: 0 });
    throw new NeedsReconnect();
  }
  if (!r.ok) throw new Error(`Gmail error ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r;
}

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function blobB64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s).replace(/(.{76})/g, "$1\r\n");
}
const encWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`);

export async function send(o: { fromName: string; to: string; subject: string; body: string; attachment?: { name: string; blob: Blob }; threadId?: string; inReplyTo?: string }): Promise<{ id: string; thread_id: string; message_id_header: string }> {
  if (/[\r\n]/.test(o.subject)) throw new Error("Subject can't contain line breaks");
  const c = await connection();
  if (!c) throw new Error("Connect Gmail first");
  if (c.mode === "demo") return demoSend(c.email, o);
  const boundary = `kold_${Math.random().toString(36).slice(2)}`;
  const head = [`To: ${o.to}`, `From: ${encWord(o.fromName)} <${c.email}>`, `Subject: ${encWord(o.subject)}`, "MIME-Version: 1.0"];
  if (o.inReplyTo) head.push(`In-Reply-To: ${o.inReplyTo}`, `References: ${o.inReplyTo}`);
  let mime: string;
  if (o.attachment) {
    mime = [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`, "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit", "", o.body, "", `--${boundary}`, `Content-Type: application/pdf; name="${o.attachment.name}"`,
      "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${o.attachment.name}"`, "",
      await blobB64(o.attachment.blob), `--${boundary}--`].join("\r\n");
  } else {
    mime = [...head, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", o.body].join("\r\n");
  }
  const sent = await (await authed("/messages/send", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64url(mime), ...(o.threadId ? { threadId: o.threadId } : {}) }),
  })).json();
  const meta = await (await authed(`/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`)).json();
  const mid = (meta.payload?.headers ?? []).find((h: { name: string }) => h.name.toLowerCase() === "message-id")?.value ?? "";
  return { id: sent.id, thread_id: sent.threadId, message_id_header: mid };
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] };
const dec = (d: string) => decodeURIComponent(escape(atob(d.replace(/-/g, "+").replace(/_/g, "/"))));
function bodyText(p: Part): string {
  const found: Record<string, string> = {};
  const walk = (x: Part) => {
    if (x.body?.data && (x.mimeType === "text/plain" || x.mimeType === "text/html") && !found[x.mimeType]) {
      try { found[x.mimeType] = dec(x.body.data); } catch {}
    }
    (x.parts ?? []).forEach(walk);
  };
  walk(p);
  return found["text/plain"]?.trim() ? found["text/plain"] : found["text/html"] ? htmlToText(found["text/html"]) : "";
}
function parse(m: { id: string; threadId: string; snippet?: string; internalDate?: string; labelIds?: string[]; payload: Part }): MailMsg {
  const h = Object.fromEntries((m.payload.headers ?? []).map((x) => [x.name.toLowerCase(), x.value]));
  const from = h["from"] ?? "";
  const addr = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  const name = from.includes("<") ? from.split("<")[0].replace(/"/g, "").trim() : "";
  return { id: m.id, thread_id: m.threadId, from_email: addr, from_name: name, subject: h["subject"] ?? "", snippet: m.snippet ?? "",
    headers: h, body: bodyText(m.payload).slice(0, 20000), internal_date: Number(m.internalDate ?? 0), message_id_header: h["message-id"] ?? "",
    label_ids: m.labelIds ?? [], to: h["to"] };
}

export async function threadMessages(threadId: string): Promise<MailMsg[]> {
  const c = await connection();
  if (c?.mode === "demo") return demoThread(threadId);
  const t = await (await authed(`/threads/${threadId}?format=full`)).json();
  return (t.messages ?? []).map(parse);
}

/** New emails from contacted companies (exact address, or domain) since a date, used for replies sent as a new email. */
export async function messagesFrom(senders: string[], afterSec: number, skip: Set<string>): Promise<MailMsg[]> {
  if (!senders.length) return [];
  const c = await connection();
  if (c?.mode === "demo") return demoFrom(senders, afterSec, skip);
  const out: MailMsg[] = [];
  for (let i = 0; i < senders.length; i += 20) {
    const q = `(${senders.slice(i, i + 20).map((s) => `from:${s}`).join(" OR ")}) after:${afterSec} -in:sent -in:drafts -in:spam`;
    const list = await (await authed(`/messages?maxResults=50&q=${encodeURIComponent(q)}`)).json();
    for (const ref of list.messages ?? []) {
      if (skip.has(ref.id)) continue;
      out.push(parse(await (await authed(`/messages/${ref.id}?format=full`)).json()));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- demo mailbox
type Demo = Record<string, MailMsg[]>;
async function demoSend(email: string, o: { fromName: string; to: string; subject: string; body: string; attachment?: { name: string }; threadId?: string; inReplyTo?: string }) {
  const box = await kvGet<Demo>("demo.mailbox", {});
  const tid = o.threadId || `demo-t-${crypto.randomUUID().slice(0, 8)}`;
  const id = `demo-${crypto.randomUUID().slice(0, 12)}`;
  const m: MailMsg = { id, thread_id: tid, from_email: email, from_name: o.fromName, subject: o.subject, snippet: o.body.slice(0, 120), body: o.body,
    headers: o.inReplyTo ? { "in-reply-to": o.inReplyTo } : {}, internal_date: Date.now(), message_id_header: `<${id}@demo.kold>`, label_ids: ["SENT"], to: o.to };
  box[tid] = [...(box[tid] ?? []), m];
  await kvSet("demo.mailbox", box);
  return { id, thread_id: tid, message_id_header: m.message_id_header };
}
async function demoThread(tid: string) {
  return (await kvGet<Demo>("demo.mailbox", {}))[tid] ?? [];
}
async function demoFrom(senders: string[], afterSec: number, skip: Set<string>) {
  const box = await kvGet<Demo>("demo.mailbox", {});
  return Object.values(box).flat().filter((m) => !skip.has(m.id) && m.internal_date >= afterSec * 1000 && !m.label_ids.includes("SENT") &&
    senders.some((s) => m.from_email === s || m.from_email.endsWith(`@${s}`)));
}

/** Demo only: simulate a company's reply so people can see how Kold handles it. */
export async function demoReply(threadId: string, from: string, fromName: string, subject: string, body: string, opts: { newThread?: boolean; headers?: Record<string, string> } = {}) {
  const box = await kvGet<Demo>("demo.mailbox", {});
  const tid = opts.newThread ? `demo-n-${crypto.randomUUID().slice(0, 8)}` : threadId;
  const id = `demo-${crypto.randomUUID().slice(0, 12)}`;
  box[tid] = [...(box[tid] ?? []), { id, thread_id: tid, from_email: from, from_name: fromName, subject, snippet: body.slice(0, 120), body,
    headers: opts.headers ?? {}, internal_date: Date.now(), message_id_header: `<${id}@demo.kold>`, label_ids: ["INBOX"] }];
  await kvSet("demo.mailbox", box);
}
