"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, CheckCircle2, Download, ExternalLink, Mail, Play, Plus, Rocket, Search, ShieldCheck, Square, Wand2 } from "lucide-react";
import clsx from "clsx";
import { CompanyMark, Description, JobMeta, TrustPanel } from "./job-bits";
import { Badge, Button, Confirm, Field, inputCls, Sheet, Spinner, useToast } from "./ui";
import { api } from "@/lib/api";
import { ago, dateShort, dateTime, LABEL_META, STAGE_META } from "@/lib/format";
import { play } from "@/lib/sound";
import type { Campaign, Contact, JobCard, Reply } from "@/lib/types";

type Detail = JobCard & {
  description: string;
  campaign: Campaign | null;
  emails: { id: number; step: number; to: string; subject: string; body: string; status: string; sent_at: string | null; error: string }[];
  replies: Reply[];
  tailored: { changes: string[]; created_at: string } | null;
  contacts: Contact[];
  reminders: { id: number; title: string; due_at: string; kind: string; done: boolean }[];
  recipient_tz: string;
  suggested_cadence: { gaps: number[]; max_followups: number; why: string };
};

const TABS = ["Overview", "Outreach", "Resume", "Posting"] as const;

export function JobDetailSheet({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");

  // Reset when a different job is opened (React's "adjust state on prop change" pattern).
  const [shownId, setShownId] = useState(id);
  if (id !== shownId) {
    setShownId(id);
    setD(null);
    setTab("Overview");
  }

  const load = useCallback(async () => {
    if (!id) return;
    setD(await api.get<Detail>(`/jobs/${id}`));
  }, [id]);

  useEffect(() => {
    if (id) api.get<Detail>(`/jobs/${id}`).then(setD).catch(() => {});
  }, [id]);

  const changed = async () => {
    await load();
    onChanged();
    window.dispatchEvent(new Event("kold:refresh-stats"));
  };

  return (
    <Sheet open={!!id} onClose={onClose} wide title={d ? <div className="flex items-center gap-3"><CompanyMark name={d.company} size={34} /><span className="truncate">{d.title}</span></div> : <Spinner />}>
      {d && (
        <div>
          <div className="sticky top-0 z-10 -mx-5 mb-5 flex gap-1 border-b border-line bg-surface/90 px-5 pb-2 backdrop-blur">
            {TABS.map((t) => (
              <button key={t} onClick={() => { play("tap"); setTab(t); }} className={clsx("relative rounded-full px-3.5 py-1.5 text-sm transition", tab === t ? "text-ink" : "text-ink-3 hover:text-ink-2")}>
                {tab === t && <motion.span layoutId="detail-tab" className="absolute inset-0 rounded-full bg-white/[0.07] hairline" />}
                <span className="relative">{t}</span>
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
              {tab === "Overview" && <Overview d={d} onChanged={changed} />}
              {tab === "Outreach" && <Outreach d={d} onChanged={changed} />}
              {tab === "Resume" && <ResumeTab d={d} onChanged={changed} />}
              {tab === "Posting" && <div className="space-y-5"><TrustPanel job={d} /><Description text={d.description} /></div>}
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </Sheet>
  );
}

function Overview({ d, onChanged }: { d: Detail; onChanged: () => void }) {
  const toast = useToast();
  const [notes, setNotes] = useState(d.notes);
  const [deadline, setDeadline] = useState(d.my_deadline ? d.my_deadline.slice(0, 10) : "");
  const patch = async (body: Record<string, unknown>, msg?: string) => {
    try {
      await api.patch(`/jobs/${d.user_job_id}`, body);
      if (msg) toast(msg, "ok");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };
  return (
    <div className="space-y-6">
      <JobMeta job={d} />
      {!d.active && <p className="rounded-2xl bg-bad/10 p-3 text-sm text-bad">The employer has taken this listing down or it expired.</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <a href={d.apply_url || d.url} target="_blank" rel="noreferrer" onClick={() => play("whoosh")}
          className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-[#e0f2fe] via-[#7dd3fc] to-[#38bdf8] px-4 py-3 text-sm font-medium text-[#04121f]">
          Apply on {d.source === "greenhouse" || d.source === "lever" || d.source === "ashby" ? `${d.company}'s site` : "the original posting"} <ArrowUpRight size={16} />
        </a>
        {d.status !== "applied" ? (
          <Button variant="outline" className="!rounded-2xl !py-3" onClick={() => patch({ status: "applied" }, "Marked as applied")}><CheckCircle2 size={16} /> I applied</Button>
        ) : (
          <div className="flex items-center justify-center gap-2 rounded-2xl bg-ok/10 text-sm text-ok hairline"><CheckCircle2 size={16} /> Applied</div>
        )}
      </div>

      <Field label="Stage">
        <div className="flex flex-wrap gap-1.5">
          {["liked", "applied", "reaching_out", "replied", "interview", "offer", "rejected", "archived"].map((s) => (
            <button key={s} onClick={() => patch({ status: s })}
              className={clsx("rounded-full px-3 py-1.5 text-xs transition", d.status === s ? "text-black" : "text-ink-2 hairline hover:text-ink")}
              style={d.status === s ? { background: STAGE_META[s].color } : undefined}>
              {STAGE_META[s].label}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Application deadline" hint="Kold reminds you 3 days before and on the day.">
          <input type="date" className={inputCls} value={deadline} onChange={(e) => setDeadline(e.target.value)}
            onBlur={() => patch({ deadline: deadline ? `${deadline}T18:00:00` : null }, deadline ? "Reminder set" : undefined)} />
        </Field>
        <Field label="Reminders">
          <div className="space-y-1.5 text-sm text-ink-2">
            {d.reminders.filter((r) => !r.done).map((r) => <p key={r.id}>⏰ {r.title} · {dateShort(r.due_at)}</p>)}
            {!d.reminders.filter((r) => !r.done).length && <p className="text-ink-3">None yet</p>}
          </div>
        </Field>
      </div>

      <Field label="Notes">
        <textarea className={`${inputCls} resize-y`} rows={4} value={notes} placeholder="Referral? Interview prep? Anything to remember."
          onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== d.notes && patch({ notes })} />
      </Field>

      <div className="rounded-2xl bg-white/[0.02] p-4 hairline">
        <p className="mb-2 text-xs font-medium tracking-wide text-ink-3 uppercase">Why it matched</p>
        <ul className="space-y-1 text-sm text-ink-2">{d.match_reasons.map((r, i) => <li key={i}>· {r}</li>)}</ul>
      </div>
    </div>
  );
}

function Outreach({ d, onChanged }: { d: Detail; onChanged: () => void }) {
  const toast = useToast();
  const [contacts, setContacts] = useState<Contact[]>(d.contacts);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [manual, setManual] = useState("");
  const [to, setTo] = useState<string>(d.contacts[0]?.email ?? "");
  const [gaps, setGaps] = useState<number[]>(d.suggested_cadence.gaps);
  const [maxF, setMaxF] = useState(d.suggested_cadence.max_followups);
  const [starting, setStarting] = useState(false);
  const [stopAsk, setStopAsk] = useState(false);
  const c = d.campaign;
  const live = c && ["active", "paused", "replied", "completed"].includes(c.status);

  const find = async () => {
    setSearching(true);
    play("whoosh");
    try {
      const r = await api.post<{ contacts: Contact[] }>(`/jobs/${d.user_job_id}/contacts/find`);
      setContacts(r.contacts);
      if (r.contacts[0]) setTo(r.contacts[0].email);
      setSearched(true);
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setSearching(false);
    }
  };

  const add = async () => {
    try {
      const ct = await api.post<Contact>(`/jobs/${d.user_job_id}/contacts`, { email: manual });
      setContacts((cs) => [ct, ...cs]);
      setTo(ct.email);
      setManual("");
      toast("Added. Mail server verified.", "ok");
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };

  const start = async () => {
    setStarting(true);
    play("whoosh");
    try {
      await api.post(`/jobs/${d.user_job_id}/outreach`, { to_email: to, gaps: gaps.slice(0, maxF), max_followups: maxF });
      play("success");
      toast("Resume tailored and first email drafted. Review it in Today.", "ok");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setStarting(false);
    }
  };

  const decide = async (action: "stop" | "resume") => {
    if (!c) return;
    try {
      await api.post(`/campaigns/${c.id}/decision`, { action });
      toast(action === "stop" ? "Outreach stopped" : "Outreach resumed", action === "stop" ? "info" : "ok");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };

  if (live && c) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-2xl bg-white/[0.02] p-4 hairline">
          <Mail size={18} className="text-ice" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{c.to}</p>
            <p className="text-xs text-ink-3">
              {c.steps_sent} of {c.max_followups + 1} emails sent
              {c.status === "active" && c.next_due && ` · next draft on ${dateShort(c.next_due)} for your review`}
              {c.paused_until && ` · paused until ${dateShort(c.paused_until)}`}
            </p>
          </div>
          <Badge color={c.status === "replied" ? "var(--ember)" : c.status === "paused" ? "var(--warn)" : c.status === "active" ? "var(--ice)" : "var(--ink-3)"}>{c.status}</Badge>
        </div>

        {/* storyline timeline: cold → warm */}
        <ol className="relative space-y-4 border-l border-line pl-6">
          {d.emails.filter((e) => e.status !== "skipped" || e.step === 0).map((e) => (
            <li key={e.id} className="relative">
              <span className={clsx("absolute top-1 -left-[31px] h-3 w-3 rounded-full ring-4 ring-surface", e.status === "sent" ? "bg-ice" : e.status === "skipped" ? "bg-ink-3" : "bg-violet")} />
              <p className="text-sm font-medium">{e.step === 0 ? "First email" : `Follow-up ${e.step}`} <span className="font-normal text-ink-3">· {e.status}{e.sent_at ? ` ${dateTime(e.sent_at)}` : ""}</span></p>
              <details className="mt-1"><summary className="cursor-pointer text-xs text-ink-3">{e.subject}</summary><p className="mt-2 text-sm whitespace-pre-line text-ink-2">{e.body}</p></details>
            </li>
          ))}
          {d.replies.map((r) => (
            <li key={r.id} className="relative">
              <span className="absolute top-1 -left-[31px] h-3 w-3 rounded-full bg-ember shadow-[0_0_12px_var(--ember)] ring-4 ring-surface" />
              <p className="text-sm font-medium">{LABEL_META[r.label]?.emoji} Reply from {r.from_name || r.from_email} <span className="font-normal text-ink-3">· {ago(r.received_at)}</span></p>
              <p className="mt-1 line-clamp-3 text-sm text-ink-2">{r.snippet}</p>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap gap-2">
          {d.replies.length > 0 && <Link href="/inbox"><Button variant="warm"><Mail size={15} /> Open in Inbox</Button></Link>}
          {c.status === "active" && <Link href="/today"><Button variant="outline">Today&apos;s queue</Button></Link>}
          {(c.status === "paused") && <Button variant="outline" onClick={() => decide("resume")}><Play size={15} /> Resume</Button>}
          {["active", "paused"].includes(c.status) && <Button variant="danger" onClick={() => setStopAsk(true)}><Square size={14} /> Stop outreach</Button>}
        </div>
        <Confirm open={stopAsk} onClose={() => setStopAsk(false)} title="Stop emailing this company?" body="No more drafts will be created for this contact. Replies will still show in your Inbox." confirmLabel="Stop outreach" tone="danger" onConfirm={() => decide("stop")} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">1 · Who to email</h3>
        <p className="mt-1 text-sm text-ink-2">Kold only uses addresses that {d.company} publishes itself, on this posting or its own website, and checks that the domain can receive mail. No guessed addresses.</p>
        <div className="mt-3 space-y-2">
          {contacts.map((ct) => (
            <button key={ct.id} onClick={() => setTo(ct.email)} className={clsx("flex w-full items-start gap-3 rounded-2xl p-3.5 text-left transition hairline", to === ct.email ? "bg-ice/10 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.5)]" : "bg-white/[0.02] hover:bg-white/[0.04]")}>
              <ShieldCheck size={17} className={ct.confidence === "high" || ct.confidence === "user" ? "mt-0.5 text-ok" : "mt-0.5 text-warn"} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{ct.email}</p>
                <p className="text-xs text-ink-3">
                  {ct.role === "recruiting" ? "Recruiting inbox" : ct.role === "person" ? "Named person" : ct.role === "user-added" ? "Added by you" : "Company inbox"} ·{" "}
                  {ct.source_url.startsWith("http") ? <a href={ct.source_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="underline decoration-dotted hover:text-ink">found here</a> : ct.source_url}
                </p>
              </div>
              {to === ct.email && <CheckCircle2 size={17} className="text-ice" />}
            </button>
          ))}
          {!contacts.length && searched && (
            <p className="rounded-2xl bg-white/[0.02] p-4 text-sm text-ink-2 hairline">
              {d.company} doesn&apos;t publish a contact email on its site or this posting. If you have a recruiter&apos;s address (from LinkedIn, a referral or an event), add it below. Otherwise, applying directly is the best route.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={find} loading={searching}><Search size={15} /> {searched || contacts.length ? "Search again" : `Find ${d.company}'s published contacts`}</Button>
          </div>
          <div className="flex gap-2">
            <input className={inputCls} placeholder="Or add an address you know: name@company.com" value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === "Enter" && manual && add()} />
            <Button variant="outline" onClick={add} disabled={!manual}><Plus size={15} /></Button>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-base font-semibold">2 · Follow-up rhythm</h3>
        <p className="mt-1 text-sm text-ink-2">{d.suggested_cadence.why}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-3">Follow-ups:</span>
          {[0, 1, 2].map((n) => (
            <button key={n} onClick={() => setMaxF(n)} className={clsx("rounded-full px-3 py-1", maxF === n ? "bg-ice/15 text-frost hairline" : "text-ink-3 hairline")}>{n}</button>
          ))}
        </div>
        {maxF > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            Day 0 → {Array.from({ length: maxF }).map((_, i) => (
              <span key={i} className="flex items-center gap-1">
                +<input type="number" min={2} max={21} value={gaps[i] ?? 5} onChange={(e) => setGaps((g) => { const n = [...g]; n[i] = Number(e.target.value); return n; })} className="w-14 rounded-lg bg-white/[0.04] px-2 py-1 text-center hairline" /> days{i < maxF - 1 ? " →" : ""}
              </span>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-ink-3">Any reply from them stops follow-ups automatically.</p>
      </div>

      <div className="rounded-2xl bg-gradient-to-br from-ice/10 to-ember/10 p-4 hairline">
        <h3 className="text-base font-semibold">3 · Start</h3>
        <p className="mt-1 text-sm text-ink-2">Kold tailors your resume for this role, writes the first email, and puts it in <b>Today</b> for you to review. Nothing is sent until you approve it.</p>
        <Button variant="warm" className="mt-4" onClick={start} loading={starting} disabled={!to}>
          {!starting && <Rocket size={15} />} {starting ? "Tailoring resume & writing…" : "Prepare outreach"}
        </Button>
      </div>
    </div>
  );
}

function ResumeTab({ d, onChanged }: { d: Detail; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState(d.tailored?.changes ?? null);
  const tailor = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ changes: string[] }>(`/jobs/${d.user_job_id}/tailor`);
      setChanges(r.changes);
      play("success");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-2">A version of your resume that leads with what this role asks for. It reorders and lightly rephrases <b>only what&apos;s already in your resume</b>. Every rephrased line is checked so no new facts, numbers or skills appear.</p>
      {changes ? (
        <div className="rounded-2xl bg-white/[0.02] p-4 hairline">
          <p className="mb-2 text-xs font-medium tracking-wide text-ink-3 uppercase">What changed</p>
          <ul className="space-y-1.5 text-sm text-ink-2">{changes.map((c, i) => <li key={i} className="flex gap-2"><Wand2 size={14} className="mt-0.5 shrink-0 text-violet" />{c}</li>)}</ul>
        </div>
      ) : (
        <p className="text-sm text-ink-3">Not tailored yet.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant={changes ? "outline" : "primary"} onClick={tailor} loading={busy}><Wand2 size={15} /> {changes ? "Re-tailor" : "Tailor my resume"}</Button>
        {changes && (
          <a href={`/api/jobs/${d.user_job_id}/resume.pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm hairline hover:bg-white/5">
            <Download size={15} /> Download PDF
          </a>
        )}
        <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm text-ink-3 hover:text-ink">Posting <ExternalLink size={14} /></a>
      </div>
    </div>
  );
}

