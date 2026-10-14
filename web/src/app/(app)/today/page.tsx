"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Clock, FileText, Mail, PenLine, RefreshCw, Send, SkipForward, Sunrise } from "lucide-react";
import { CompanyMark } from "@/components/job-bits";
import { Badge, Button, Card, Empty, inputCls, useToast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { dateTime, tzCity } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { play } from "@/lib/sound";
import type { OutboxEmail, Quality } from "@/lib/types";

type Today = { date: string; emails: OutboxEmail[]; sent_today: number; daily_limit: number; gmail_connected: boolean };

export default function TodayPage() {
  const toast = useToast();
  const [data, setData] = useState<Today | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<Today>("/today"));
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  }, [toast]);

  useEffect(() => {
    api.get<Today>("/today").then(setData).catch((e) => toast((e as Error).message, "bad"));
  }, [toast]);

  const waiting = data?.emails.filter((e) => e.status === "pending" || e.status === "failed") ?? [];
  const scheduled = data?.emails.filter((e) => e.status === "scheduled") ?? [];
  const done = data?.emails.filter((e) => e.status === "sent" || e.status === "skipped") ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 md:px-8 md:pt-10">
      <div className="mb-6">
        <p className="text-xs font-medium tracking-[0.2em] text-ice uppercase">{data ? new Date(data.date + "T00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) : " "}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] md:text-3xl">Today&apos;s emails</h1>
        <p className="mt-2 text-sm text-ink-2">Review each draft. Edit anything, then send it now or at the recipient&apos;s morning. Nothing leaves without your tap.</p>
      </div>

      {data && (
        <div className="mb-6 grid grid-cols-3 gap-2">
          <Mini label="Waiting for you" value={waiting.length} tone="ice" />
          <Mini label="Scheduled" value={scheduled.length} tone="violet" />
          <Mini label={`Sent today (limit ${data.daily_limit})`} value={data.sent_today} tone="ember" />
        </div>
      )}

      {data && !data.gmail_connected && waiting.length > 0 && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl bg-warn/10 p-4 text-sm text-warn hairline">
          <AlertTriangle size={18} className="shrink-0" />
          <span className="flex-1">Connect Gmail to send these. Drafts are saved until you do.</span>
          <Link href="/profile" className="rounded-full bg-warn/20 px-3 py-1.5 text-xs font-medium">Connect</Link>
        </div>
      )}

      {!data ? (
        <div className="space-y-4">{[0, 1].map((i) => <div key={i} className="skeleton h-72 rounded-3xl" />)}</div>
      ) : data.emails.length === 0 ? (
        <Empty
          icon={<Mail />}
          title="Nothing to review today"
          body={<>When you start outreach on a saved job, its first email is drafted here. Follow-ups appear here on their due day.</>}
          action={<Link href="/tracker"><Button variant="primary">Open tracker</Button></Link>}
        />
      ) : (
        <div className="space-y-8">
          {waiting.length > 0 && (
            <Section title="Waiting for your review" icon={<PenLine size={15} />}>
              <AnimatePresence initial={false}>
                {waiting.map((e) => <EmailCard key={e.id} email={e} gmail={data.gmail_connected} onChange={load} />)}
              </AnimatePresence>
            </Section>
          )}
          {scheduled.length > 0 && (
            <Section title="Scheduled for their morning" icon={<Sunrise size={15} />}>
              {scheduled.map((e) => <EmailCard key={e.id} email={e} gmail={data.gmail_connected} onChange={load} />)}
            </Section>
          )}
          {done.length > 0 && (
            <Section title="Done today" icon={<CheckCircle2 size={15} />}>
              {done.map((e) => (
                <Card key={e.id} className="flex items-center gap-3 p-4">
                  <CompanyMark name={e.company} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{e.subject}</p>
                    <p className="truncate text-xs text-ink-3">{e.to} · {e.company}</p>
                  </div>
                  {e.status === "sent" ? <Badge color="var(--ok)"><Check size={12} /> Sent</Badge> : <Badge>Skipped</Badge>}
                </Card>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: number; tone: "ice" | "violet" | "ember" }) {
  return (
    <div className="rounded-2xl bg-surface/70 p-3 hairline">
      <motion.div key={value} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-2xl font-semibold tabular-nums" style={{ color: `var(--${tone})` }}>{value}</motion.div>
      <div className="mt-0.5 text-[11px] leading-tight text-ink-3">{label}</div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-medium tracking-wide text-ink-3 uppercase">{icon}{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

const STEP_LABEL = (step: number, max: number) => (step === 0 ? "First email" : step >= max ? "Final follow-up" : `Follow-up ${step}`);

function EmailCard({ email, gmail, onChange }: { email: OutboxEmail; gmail: boolean; onChange: () => void }) {
  const toast = useToast();
  const [subject, setSubject] = useState(email.subject);
  const [body, setBody] = useState(email.body);
  const [quality, setQuality] = useState<Quality>(email.quality);
  const [busy, setBusy] = useState<string | null>(null);
  const [flying, setFlying] = useState(false);
  const dirty = subject !== email.subject || body !== email.body;
  const now = useNow();
  const theirTime = now ? new Date(now).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: email.recipient_tz }) : "";
  const recommendNow = !email.recommended_send_at || new Date(email.recommended_send_at).getTime() <= now + 60_000;

  const save = async () => {
    const res = await api.put<{ quality: Quality }>(`/outbox/${email.id}`, { subject, body });
    setQuality(res.quality);
    return res.quality;
  };

  const act = async (kind: "now" | "best" | "skip" | "rewrite") => {
    setBusy(kind);
    try {
      if (kind === "skip") {
        await api.post(`/outbox/${email.id}/skip`);
        toast("Skipped", "info");
      } else if (kind === "rewrite") {
        await api.post(`/outbox/${email.id}/regenerate`);
        toast("New draft written", "ok");
      } else {
        if (dirty) {
          const q = await save();
          if (!q.ready) {
            toast("Fix the highlighted items first", "warn");
            return;
          }
        }
        const res = await api.post<{ status: string; scheduled_for?: string }>(`/outbox/${email.id}/send`, { when: kind });
        if (res.status === "sent") {
          setFlying(true);
          play("send");
          toast(`Sent to ${email.to}`, "ok");
          await new Promise((r) => setTimeout(r, 650));
        } else {
          play("success");
          toast(`Scheduled for ${dateTime(res.scheduled_for)} (your time)`, "info");
        }
      }
      window.dispatchEvent(new Event("kold:refresh-stats"));
      onChange();
    } catch (e) {
      toast((e as Error).message, "bad");
      // 409 = the draft changed under us (they replied, it was replaced or sent elsewhere): show the truth.
      if (e instanceof ApiError && e.status === 409) onChange();
    } finally {
      setBusy(null);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={flying ? { x: 400, y: -200, rotate: 12, scale: 0.4, opacity: 0 } : { opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={flying ? { duration: 0.6, ease: [0.6, 0, 0.3, 1] } : { type: "spring", stiffness: 260, damping: 28 }}
    >
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line p-4">
          <CompanyMark name={email.company} size={38} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{email.company} · <span className="text-ink-2">{email.job_title}</span></p>
            <p className="truncate text-xs text-ink-3">To {email.to}</p>
          </div>
          <Badge color={email.step === 0 ? "var(--ice)" : "var(--violet)"}>{STEP_LABEL(email.step, email.max_followups)}</Badge>
        </div>

        <div className="space-y-3 p-4">
          {email.status === "failed" && <p className="rounded-xl bg-bad/10 p-3 text-xs text-bad">Last attempt failed: {email.error}</p>}
          {email.step === 0 ? (
            <input value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={() => dirty && save()} className={`${inputCls} font-medium`} aria-label="Subject" />
          ) : (
            <p className="px-1 text-xs text-ink-3">Sent as a reply in the same thread: “{email.subject}”</p>
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => dirty && save()}
            rows={Math.min(18, Math.max(7, body.split("\n").length + 2))}
            className={`${inputCls} resize-y font-[450] leading-relaxed`}
            aria-label="Email body"
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
            {email.attachment && (
              <a href={`/api/jobs/${email.user_job_id}/resume.pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-ink-2 hairline hover:text-ink">
                <FileText size={13} /> {email.attachment} <span className="text-ink-3">(tailored)</span>
              </a>
            )}
            <span>Written by {email.generated_by.startsWith("local-model") ? "Kold's local model" : "a template (local model was offline)"}</span>
          </div>

          <details className="group rounded-2xl bg-white/[0.02] hairline">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-sm">
              <span className={`h-2 w-2 rounded-full ${quality.ready ? "bg-ok" : "bg-bad"}`} />
              Pre-send check · {quality.score}/100
              <span className="ml-auto text-xs text-ink-3 group-open:hidden">Show</span>
            </summary>
            <ul className="space-y-1.5 px-3.5 pb-3">
              {quality.checks.map((c, i) => (
                <li key={i} className={`flex gap-2 text-xs ${c.ok ? "text-ink-2" : c.blocking ? "text-bad" : "text-warn"}`}>
                  {c.ok ? <Check size={13} className="mt-px shrink-0 text-ok" /> : <AlertTriangle size={13} className="mt-px shrink-0" />} {c.text}
                </li>
              ))}
            </ul>
          </details>

          <div className="flex items-start gap-2 rounded-2xl bg-ice/5 p-3 text-xs text-ink-2 hairline">
            <Clock size={14} className="mt-px shrink-0 text-ice" />
            {email.status === "scheduled" && email.scheduled_for ? (
              <span>Scheduled: lands {dateTime(email.scheduled_for, email.recipient_tz)} in {tzCity(email.recipient_tz)} ({dateTime(email.scheduled_for)} your time).</span>
            ) : recommendNow ? (
              <span>It&apos;s {theirTime} in {tzCity(email.recipient_tz)}: a good time to send.</span>
            ) : (
              <span>It&apos;s {theirTime} in {tzCity(email.recipient_tz)}. Best to land at their morning: {dateTime(email.recommended_send_at, email.recipient_tz)} their time.</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
          <Button variant="ghost" onClick={() => act("skip")} loading={busy === "skip"}><SkipForward size={15} /> Skip</Button>
          <Button variant="ghost" onClick={() => act("rewrite")} loading={busy === "rewrite"}><RefreshCw size={15} /> Rewrite</Button>
          <div className="flex-1" />
          {!recommendNow && email.status !== "scheduled" && (
            <Button variant="outline" onClick={() => act("best")} loading={busy === "best"} disabled={!gmail}><Sunrise size={15} /> Their morning</Button>
          )}
          <Button variant="warm" onClick={() => act("now")} loading={busy === "now"} disabled={!gmail || !quality.ready} sound={false}>
            <Send size={15} /> Send now
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}
