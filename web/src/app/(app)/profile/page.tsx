"use client";

import { motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BellRing, Cpu, FileText, Link2Off, Mail, ShieldCheck, Trash2, Upload } from "lucide-react";
import clsx from "clsx";
import { PrefsEditor, ProfileEditor } from "@/components/editors";
import { AiCard } from "@/components/ai-card";
import { GmailConnect } from "@/components/gmail-connect";
import Link from "next/link";
import { useMe } from "@/components/providers";
import { Badge, Button, Card, Confirm, useToast } from "@/components/ui";
import { api, isLite } from "@/lib/api";
import { ago } from "@/lib/format";
import type { Preferences, Profile } from "@/lib/types";

const TABS = ["Profile", "Preferences", "Account"] as const;

export default function ProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfileInner />
    </Suspense>
  );
}

function ProfileInner() {
  const { me, refresh } = useMe();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<(typeof TABS)[number]>(params.get("gmail") ? "Account" : "Profile");
  const [edited, setProfile] = useState<Profile | null>(null);
  const [editedPrefs, setPrefs] = useState<Preferences | null>(null);
  const profile = edited ?? me?.profile ?? null;
  const prefs = editedPrefs ?? me?.preferences ?? null;
  const [saving, setSaving] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [del, setDel] = useState(false);

  useEffect(() => {
    const g = params.get("gmail");
    if (g === "connected") toast("Gmail connected", "ok");
    if (g === "denied") toast("Gmail access was not granted", "warn");
    if (g === "failed") toast("Couldn't connect Gmail. Please try again.", "bad");
    if (g) router.replace("/profile", { scroll: false });
  }, [params, router, toast]);

  const save = async () => {
    setSaving(true);
    try {
      if (tab === "Profile" && profile) await api.put("/profile", profile);
      if (tab === "Preferences" && prefs) await api.put("/preferences", prefs);
      await refresh();
      toast(tab === "Preferences" ? "Saved. Your deck was re-matched." : "Profile saved", "ok");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setSaving(false);
    }
  };

  const enablePush = async () => {
    try {
      const { key } = await api.get<{ key: string }>("/push/key");
      if (!key) return toast("Push notifications aren't configured on the server yet", "warn");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return toast("Notifications blocked in browser settings", "warn");
      const reg = await navigator.serviceWorker.ready;
      const pad = "=".repeat((4 - (key.length % 4)) % 4);
      const raw = atob((key + pad).replace(/-/g, "+").replace(/_/g, "/"));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
      await api.post("/push/subscribe", JSON.parse(JSON.stringify(sub)));
      toast("Notifications on: you'll hear about replies and deadlines", "ok");
    } catch (e) {
      toast((e as Error).message || "Couldn't enable notifications", "bad");
    }
  };

  const g = me?.gmail;
  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 md:px-8 md:pt-10">
      <h1 className="text-2xl font-semibold tracking-[-0.03em] md:text-3xl">{me?.user?.name || "Profile"}</h1>
      <p className="mt-1 text-sm text-ink-3">{profile?.headline || "Your profile drives matching, tailoring and every email."}</p>

      <div className="mt-6 mb-6 flex gap-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={clsx("relative rounded-full px-4 py-2 text-sm", tab === t ? "text-ink" : "text-ink-3 hover:text-ink-2")}>
            {tab === t && <motion.span layoutId="profile-tab" className="absolute inset-0 rounded-full bg-white/[0.07] hairline" />}
            <span className="relative">{t}</span>
          </button>
        ))}
      </div>

      {tab === "Profile" && profile && (
        <>
          <Card className="mb-6 flex items-center gap-3 p-4">
            <FileText size={18} className="text-ice" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{me?.resume?.filename ?? "No resume"}</p>
              <p className="text-xs text-ink-3">Uploaded {ago(me?.resume?.uploaded_at)}</p>
            </div>
            <Button variant="outline" onClick={() => router.push("/onboarding")}><Upload size={15} /> Replace</Button>
          </Card>
          <ProfileEditor value={profile} onChange={setProfile} />
        </>
      )}
      {tab === "Preferences" && prefs && <PrefsEditor value={prefs} onChange={setPrefs} suggestedRoles={profile?.suggested_roles ?? []} />}

      {tab !== "Account" && (
        <div className="sticky bottom-24 mt-8 flex justify-end md:bottom-6">
          <Button variant="primary" onClick={save} loading={saving} className="shadow-2xl">Save changes</Button>
        </div>
      )}

      {tab === "Account" && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <Mail size={18} className="text-ice" />
              <h2 className="flex-1 font-medium">Gmail</h2>
              {g?.connected ? <Badge color="var(--ok)">Connected</Badge> : <Badge color="var(--warn)">Not connected</Badge>}
            </div>
            {g?.connected && <p className="mt-2 text-sm text-ink-2">Sending as <b>{g.email}</b></p>}
            <ul className="mt-4 space-y-2">
              {g?.scopes.map((s) => (
                <li key={s.name} className="flex gap-2 text-sm text-ink-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-ok" /><span><b className="font-medium text-ink">{s.name}</b>: {s.why}</span></li>
              ))}
            </ul>
            <div className="mt-4">
              {g?.connected ? (
                <Button variant="danger" onClick={async () => {
                  try {
                    await api.post("/gmail/disconnect");
                    await refresh();
                    toast("Disconnected and access revoked", "info");
                  } catch (e) {
                    toast((e as Error).message, "bad");
                  }
                }}><Link2Off size={15} /> Disconnect & revoke</Button>
              ) : (
                <GmailConnect />
              )}
              {g?.connected && isLite && !g.demo && !g.session_ok && <div className="mt-3"><GmailConnect reconnect /></div>}
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-3">
              <BellRing size={18} className="text-ember" />
              <h2 className="flex-1 font-medium">Notifications</h2>
            </div>
            <p className="mt-2 text-sm text-ink-2">Get a ping for positive replies, today&apos;s review queue and deadlines. On iPhone, add Kold to your Home Screen first.</p>
            <Button className="mt-4" onClick={enablePush}>Enable notifications</Button>
          </Card>

          {isLite && <AiCard />}
          {isLite && (
            <Link href="/full" className="block rounded-[var(--radius)] bg-gradient-to-br from-ice/10 to-ember/10 p-5 hairline">
              <p className="font-medium">Get the full version</p>
              <p className="mt-1 text-sm text-ink-2">Background reply checks, scheduled sends, notifications and more. Free, with a 30-second walkthrough.</p>
            </Link>
          )}
          {isLite && (
            <Card className="p-5">
              <h2 className="font-medium">Back up or move your data</h2>
              <p className="mt-1 text-sm text-ink-2">Kold Lite keeps everything on this device. Download a backup to keep it safe or move it to another device.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={async () => { const { exportBackup } = await import("@/local/backup"); await exportBackup(); }}>Download backup</Button>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2.5 text-sm hairline hover:bg-white/5">
                  Restore from backup
                  <input type="file" accept="application/json" className="hidden" onChange={(e) => {
                    setRestoreFile(e.target.files?.[0] ?? null);
                    e.target.value = ""; // the same file can be picked again
                  }} />
                </label>
              </div>
              <Confirm open={!!restoreFile} onClose={() => setRestoreFile(null)} title="Replace the data on this device?" confirmLabel="Restore"
                body="Your profile, tracker, emails and inbox on this device are replaced with the backup's. Your Gmail connection and today's job feed stay as they are."
                onConfirm={async () => {
                  try {
                    const { importBackup } = await import("@/local/backup");
                    await importBackup(restoreFile!);
                    toast("Backup restored", "ok");
                    await refresh();
                    window.dispatchEvent(new Event("kold:run-daily"));
                  } catch (err) {
                    toast((err as Error).message, "bad");
                  }
                }} />
            </Card>
          )}

          <Card className="p-5">
            <div className="flex items-center gap-3">
              <Cpu size={18} className="text-violet" />
              <h2 className="flex-1 font-medium">How Kold thinks</h2>
            </div>
            <ul className="mt-3 space-y-2 text-sm text-ink-2">
              {isLite ? (
                <li>· Writing: Kold&apos;s research-based writer builds every email from your resume facts{me?.engine?.local_model_online ? ", polished by the on-device AI" : ""}. Jobs: refreshed once a day from {me?.feed ? `${me.feed.sources_ok} official sources (${me.feed.jobs.toLocaleString()} live listings)` : "official sources"}; matching re-runs every time you open Kold.</li>
              ) : (
                <li>· Writing &amp; reading: Kold&apos;s own local model <b className="text-ink">{me?.engine?.local_model}</b>, {me?.engine?.local_model_online ? <span className="text-ok">online</span> : <span className="text-warn">offline (simple templates used instead, clearly labeled)</span>}</li>
              )}
              <li>· Reply classifier: {me?.engine?.reply_model_trained ? "trained on your confirmed labels" : "rules + local model; learns once you've confirmed ~30 reply labels"}</li>
              <li>· Safety limits: at most {me?.limits?.max_emails_per_day} emails/day and {me?.limits?.max_followups} follow-ups per contact</li>
              <li>· No third-party AI services. No guessed email addresses. No job board scraping that breaks site rules.</li>
            </ul>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-3">
              <Trash2 size={18} className="text-bad" />
              <h2 className="flex-1 font-medium">Delete everything</h2>
            </div>
            <p className="mt-2 text-sm text-ink-2">Permanently removes your resume, profile, tracker, drafts and Gmail connection from Kold. Emails already in your Gmail stay in your Gmail.</p>
            <Button variant="danger" className="mt-4" onClick={() => setDel(true)}>Delete my data</Button>
          </Card>
        </div>
      )}

      <Confirm
        open={del}
        onClose={() => setDel(false)}
        title="Delete all your Kold data?"
        body="This can't be undone."
        confirmLabel="Delete forever"
        tone="danger"
        onConfirm={async () => {
          await api.del("/me");
          sessionStorage.clear();
          await refresh();
          router.replace("/onboarding");
        }}
      />
    </div>
  );
}
