"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, ExternalLink, FileText, Inbox as InboxIcon, Mail, PenLine, Play, RefreshCw, Send, Sparkles, Square, UserRound } from "lucide-react";
import clsx from "clsx";
import { CompanyMark } from "@/components/job-bits";
import { Badge, Button, Confirm, Empty, inputCls, Sheet, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { ago, dateShort, dateTime, LABEL_META } from "@/lib/format";
import { useDataChanged } from "@/lib/hooks";
import { play } from "@/lib/sound";
import type { Conversation, ConvMessage, Quality, Reply } from "@/lib/types";

const FIX_LABELS = ["positive", "question", "not_now", "negative", "annoyed", "auto_reply", "out_of_office", "bounce", "unclear"];

const FILTERS: { id: string; label: string; test: (c: Conversation) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "needs", label: "Needs you", test: (c) => c.needs_you > 0 },
  { id: "positive", label: "🔥 Interested", test: (c) => has(c, ["positive"]) },
  { id: "question", label: "💬 Questions", test: (c) => has(c, ["question", "unclear"]) },
  { id: "no", label: "Not now / No", test: (c) => has(c, ["not_now", "negative", "annoyed"]) },
  { id: "auto", label: "Auto-replies", test: (c) => has(c, ["auto_reply", "out_of_office"]) },
  { id: "bounce", label: "Bounced", test: (c) => has(c, ["bounce"]) },
  { id: "waiting", label: "No reply yet", test: (c) => c.replies === 0 },
];

function has(c: Conversation, labels: string[]) {
  return c.messages.some((m) => m.kind === "received" && labels.includes(m.label));
}

function statusOf(c: Pick<Conversation, "status" | "stop_reason" | "next_due" | "paused_until" | "replies">): { text: string; color: string } {
  if (c.status === "replied") return { text: "They replied", color: "var(--ember)" };
  if (c.status === "paused") return { text: c.stop_reason?.includes("decision") ? "Paused: your call" : "Paused", color: "var(--warn)" };
  if (c.status === "stopped") return { text: c.stop_reason === "Address bounced" ? "Bounced" : "Stopped", color: "var(--ink-3)" };
  if (c.paused_until) return { text: `Away until ${dateShort(c.paused_until)}`, color: "var(--ice)" };
  if (c.status === "completed") return { text: "All sent · waiting", color: "var(--violet)" };
  return { text: c.next_due ? `Next follow-up ${dateShort(c.next_due)}` : "Following up", color: "var(--ice)" };
}

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="p-8"><div className="skeleton h-96 rounded-3xl" /></div>}>
      <Inbox />
    </Suspense>
  );
}

function Inbox() {
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("c") ? Number(params.get("c")) : null;
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [connected, setConnected] = useState(true);
  const [filter, setFilter] = useState("all");
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    const d = await api.get<{ conversations: Conversation[]; gmail_connected: boolean }>("/conversations");
    setConvs(d.conversations);
    setConnected(d.gmail_connected);
    return d.conversations;
  }, []);

  useDataChanged(useCallback(() => void load().catch(() => {}), [load]));

  useEffect(() => {
    api.get<{ conversations: Conversation[]; gmail_connected: boolean }>("/conversations")
      .then((d) => {
        setConvs(d.conversations);
        setConnected(d.gmail_connected);
      })
      .catch((e) => toast(e.message, "bad"));
  }, [toast]);

  const check = async () => {
    setChecking(true);
    try {
      const r = await api.post<{ new: number }>("/inbox/check");
      const list = await load();
      if (r.new && list.some((c) => c.needs_you && c.latest_label === "positive")) play("warm");
      toast(r.new ? `${r.new} new repl${r.new > 1 ? "ies" : "y"}` : "No new replies yet", r.new ? "warm" : "info");
      window.dispatchEvent(new Event("kold:refresh-stats"));
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setChecking(false);
    }
  };

  const open = (id: number | null) => router.replace(id ? `/inbox?c=${id}` : "/inbox", { scroll: false });
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, (convs ?? []).filter(f.test).length])), [convs]);
  const visible = (convs ?? []).filter(FILTERS.find((f) => f.id === filter)!.test);
  const current = (convs ?? []).find((c) => c.campaign_id === openId) ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 md:px-8 md:pt-10">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] md:text-3xl">Inbox</h1>
          <p className="mt-1 text-sm text-ink-3">Every company you&apos;ve emailed, with every reply, in one place. No need to dig through Gmail.</p>
        </div>
        <Button onClick={check} loading={checking} disabled={!connected}>{!checking && <RefreshCw size={15} />} Check</Button>
      </div>

      {!connected && (
        <p className="mb-6 rounded-2xl bg-warn/10 p-4 text-sm text-warn hairline">Connect Gmail in <Link href="/profile" className="underline">Profile</Link> so Kold can collect replies.</p>
      )}

      <div className="scroll-thin -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => { play("tap"); setFilter(f.id); }}
            className={clsx("flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition", filter === f.id ? "bg-white/[0.08] text-ink hairline" : "text-ink-3 hover:text-ink-2")}>
            {f.label}
            {!!counts[f.id] && <span className={clsx("text-xs tabular-nums", f.id === "needs" ? "text-ember" : "text-ink-3")}>{counts[f.id]}</span>}
          </button>
        ))}
      </div>

      {!convs ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-24 rounded-3xl" />)}</div>
      ) : convs.length === 0 ? (
        <Empty icon={<InboxIcon />} title="No conversations yet" body="Once you send your first email, the conversation with that company lives here, along with every reply they send." />
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-3">Nothing in this view.</p>
      ) : (
        <div className="space-y-3">
          {visible.map((c, i) => <ConversationRow key={c.campaign_id} c={c} i={i} onOpen={() => { play("tap"); open(c.campaign_id); }} />)}
        </div>
      )}

      <Sheet open={!!current} onClose={() => open(null)} wide
        title={current && <div className="flex min-w-0 items-center gap-3"><CompanyMark name={current.company} size={34} /><div className="min-w-0"><p className="truncate">{current.company}</p><p className="truncate text-xs font-normal text-ink-3">{current.job_title}</p></div></div>}>
        {current && <ConversationView key={current.campaign_id} c={current} onChanged={async () => { await load(); window.dispatchEvent(new Event("kold:refresh-stats")); }} />}
      </Sheet>
    </div>
  );
}

function ConversationRow({ c, i, onOpen }: { c: Conversation; i: number; onOpen: () => void }) {
  const last = c.messages[c.messages.length - 1];
  const meta = c.latest_label ? LABEL_META[c.latest_label] : null;
  const st = statusOf(c);
  const hot = c.needs_you > 0 && c.latest_label === "positive";
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i * 0.03, 0.3) }}
      onClick={onOpen}
      className={clsx("relative flex w-full items-start gap-3 overflow-hidden rounded-3xl p-4 text-left hairline transition hover:bg-white/[0.04]",
        c.needs_you ? "bg-ember/[0.06]" : "bg-surface/70")}
    >
      {hot && <motion.span className="pointer-events-none absolute inset-0 rounded-3xl" animate={{ boxShadow: ["inset 0 0 0 1px rgba(245,158,11,0.2)", "inset 0 0 0 1px rgba(245,158,11,0.7)", "inset 0 0 0 1px rgba(245,158,11,0.2)"] }} transition={{ duration: 2.2, repeat: Infinity }} />}
      <CompanyMark name={c.company} size={42} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{c.company}</p>
          {c.needs_you > 0 && <span className="rounded-full bg-ember px-1.5 text-[10px] font-bold text-black">{c.needs_you}</span>}
          <span className="ml-auto shrink-0 text-xs text-ink-3">{ago(c.last_at)}</span>
        </div>
        <p className="truncate text-xs text-ink-3">{c.job_title} · {c.to}</p>
        <p className="mt-1.5 line-clamp-2 text-sm text-ink-2">
          {last.kind === "sent" ? <span className="text-ink-3">You: </span> : null}
          {last.kind === "sent" ? last.body.split("\n").find((l) => l.trim().length > 20) ?? last.subject : last.snippet}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {meta && <Badge color={meta.color}>{meta.emoji} {meta.label}</Badge>}
          <Badge color={st.color}>{st.text}</Badge>
          <Badge>{c.replies} from them · {c.you_sent} from you</Badge>
        </div>
      </div>
    </motion.button>
  );
}

function ConversationView({ c, onChanged }: { c: Conversation; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const received = c.messages.filter((m): m is Extract<ConvMessage, { kind: "received" }> => m.kind === "received");
  const focus = [...received].reverse().find((m) => !m.handled) ?? received[received.length - 1];
  const [selected, setSelected] = useState<number | null>(focus?.id ?? null);
  const st = statusOf(c);
  const [stopAsk, setStopAsk] = useState(false);

  const decide = async (action: "stop" | "resume") => {
    try {
      await api.post(`/campaigns/${c.campaign_id}/decision`, { action });
      toast(action === "stop" ? "Outreach stopped" : "Outreach resumed", action === "stop" ? "info" : "ok");
      await onChanged();
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/[0.02] p-3 hairline">
        <Badge color={st.color}>{st.text}</Badge>
        <span className="text-xs text-ink-3">{c.steps_sent} of {c.max_followups + 1} emails sent to {c.to}</span>
        <div className="ml-auto flex gap-2">
          <Link href={`/tracker?job=${c.user_job_id}`} className="rounded-full px-3 py-1.5 text-xs text-ink-2 hairline hover:text-ink">Open in tracker</Link>
          {["active", "paused"].includes(c.status) && <Button variant="danger" className="!px-3 !py-1.5 !text-xs" onClick={() => setStopAsk(true)}><Square size={12} /> Stop</Button>}
          {c.status === "paused" && <Button variant="outline" className="!px-3 !py-1.5 !text-xs" onClick={() => decide("resume")}><Play size={12} /> Resume</Button>}
        </div>
      </div>

      <ol className="space-y-3">
        {c.messages.map((m) =>
          m.kind === "sent" ? (
            <li key={m.key} className="ml-8 rounded-2xl rounded-tr-md bg-ice/[0.07] p-3.5 hairline">
              <div className="mb-1 flex items-center gap-2 text-xs text-ink-3">
                <Send size={12} className="text-ice" /> You · {m.step === 0 ? "first email" : m.step > 0 ? `follow-up ${m.step}` : m.via === "gmail" ? "your reply (from Gmail)" : "your reply"} · {dateTime(m.at)}
              </div>
              <details>
                <summary className="cursor-pointer text-sm text-ink-2">{m.subject}</summary>
                <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-ink-2">{m.body}</p>
                {m.attachment && <p className="mt-2 flex items-center gap-1 text-xs text-ink-3"><FileText size={12} /> {m.attachment}</p>}
              </details>
            </li>
          ) : (
            <li key={m.key}>
              <button onClick={() => setSelected(m.id)} className={clsx("mr-8 block w-[calc(100%-2rem)] rounded-2xl rounded-tl-md p-3.5 text-left hairline transition",
                selected === m.id ? "bg-ember/[0.08] shadow-[inset_0_0_0_1px_rgba(245,158,11,0.45)]" : "bg-surface-2/70 hover:bg-white/[0.04]")}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <Mail size={12} className="text-ember" /> {m.from_name || m.from_email} · {dateTime(m.at)}
                  <Badge color={LABEL_META[m.label]?.color}>{LABEL_META[m.label]?.emoji} {LABEL_META[m.label]?.label}</Badge>
                  {m.new_thread && <Badge color="var(--violet)"><Sparkles size={11} /> New email</Badge>}
                  {!m.handled && <span className="h-2 w-2 rounded-full bg-ember shadow-[0_0_8px_var(--ember)]" />}
                </div>
                {m.new_thread && <p className="mb-1 text-xs text-ink-3">Subject: {m.subject}</p>}
                <p className="text-sm leading-relaxed whitespace-pre-line text-ink">{(m.body || m.snippet).split(/\n\s*On .{5,120}wrote:/)[0].trim()}</p>
              </button>
              <AnimatePresence>
                {selected === m.id && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="mt-3 mr-8">
                      <ReplyActions msg={m} onChanged={onChanged} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          ),
        )}
      </ol>

      {received.length === 0 && (
        <p className="rounded-2xl bg-white/[0.02] p-4 text-sm text-ink-2 hairline">
          No reply yet. Kold checks every few minutes, including new emails they might send instead of replying.
          {c.next_due && c.status === "active" && ` The next follow-up will be drafted on ${dateShort(c.next_due)} for your review.`}
        </p>
      )}

      <Confirm open={stopAsk} onClose={() => setStopAsk(false)} title="Stop emailing this company?" body="No more emails will be drafted. Kold still shows any reply they send." confirmLabel="Stop outreach" tone="danger" onConfirm={() => decide("stop")} />
    </div>
  );
}

function ReplyActions({ msg, onChanged }: { msg: Reply; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [draft, setDraft] = useState(msg.suggested_reply);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stopAsk, setStopAsk] = useState(false);
  const needsDecision = msg.campaign_status === "paused" && ["negative", "annoyed"].includes(msg.label);
  const canReply = !["auto_reply", "out_of_office", "bounce"].includes(msg.label);

  const mode = async (m: "self" | "assisted") => {
    setBusy(m);
    try {
      const r = await api.post<{ suggested_reply: string; quality: Quality | null }>(`/inbox/${msg.id}/mode`, { mode: m });
      if (m === "assisted") {
        setDraft(r.suggested_reply);
        setQuality(r.quality);
        play("success");
      } else {
        window.open(msg.thread_url, "_blank");
      }
      await onChanged();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    setBusy("send");
    try {
      await api.post(`/inbox/${msg.id}/send`, { body: draft });
      play("send");
      toast("Reply sent", "ok");
      await onChanged();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const decide = async (action: "stop" | "resume") => {
    try {
      await api.post(`/campaigns/${msg.campaign_id}/decision`, { action });
      await api.post(`/inbox/${msg.id}/handled`);
      toast(action === "stop" ? "Outreach stopped for good" : "Outreach resumed", "info");
      await onChanged();
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };

  const relabel = async (label: string) => {
    try {
      await api.post(`/inbox/${msg.id}/label`, { label });
      toast("Thanks. Kold learns from your corrections.", "ok");
      await onChanged();
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };

  return (
    <div className="space-y-4 rounded-2xl bg-white/[0.02] p-4 hairline">
      <p className="text-xs text-ink-3">
        Read as <b className="text-ink-2">{LABEL_META[msg.label]?.label}</b> · {Math.round(msg.confidence * 100)}% sure ·{" "}
        {msg.label_source === "user" ? "set by you" : msg.label_source === "rules" ? "clear signals" : msg.label_source === "model" ? "Kold's classifier" : "Kold's local model"}
        {msg.label_reason && <> · {msg.label_reason}</>}
      </p>

      {needsDecision && (
        <div className="rounded-xl bg-warn/10 p-3">
          <p className="text-sm font-medium text-warn">{msg.label === "annoyed" ? "They seem unhappy about being contacted." : "They declined."} Outreach is paused.</p>
          <p className="mt-1 text-sm text-ink-2">We recommend stopping. You can still send one gracious reply.</p>
          <div className="mt-3 flex gap-2">
            <Button variant="danger" onClick={() => setStopAsk(true)}><Square size={14} /> Stop for good</Button>
            <Button variant="ghost" onClick={() => decide("resume")}>Resume follow-ups</Button>
          </div>
        </div>
      )}
      {msg.label === "out_of_office" && <p className="text-sm text-ink-2">🌴 Follow-ups are paused{msg.return_date ? ` until they're back on ${dateShort(msg.return_date)}` : " for a week"}. Nothing for you to do.</p>}
      {msg.label === "auto_reply" && <p className="text-sm text-ink-2">🤖 An automatic acknowledgement. Your follow-ups continue as planned.</p>}
      {msg.label === "bounce" && <p className="text-sm text-bad">This address doesn&apos;t exist anymore. Outreach stopped. Pick another contact from the job in Tracker.</p>}

      {canReply && !msg.handled && !draft && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard icon={<UserRound size={20} />} title="I'll reply myself" body="Opens this email in Gmail. Kold notices when you've replied." onClick={() => mode("self")} loading={busy === "self"} />
          <ChoiceCard warm icon={<Bot size={20} />} title="Draft a reply for me" body="Kold writes a reply from your profile. You edit it and decide whether to send." onClick={() => mode("assisted")} loading={busy === "assisted"} />
        </div>
      )}

      {canReply && draft && !msg.handled && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium"><PenLine size={15} className="text-ember" /> Suggested reply (edit freely)</div>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(16, draft.split("\n").length + 3)} className={`${inputCls} resize-y leading-relaxed`} />
          {/\[[^\]]+\]/.test(draft) && <p className="text-xs text-warn">Fill in the [bracketed] parts. Kold leaves those for things only you know.</p>}
          {quality && quality.checks.filter((c) => !c.ok).map((c, i) => <p key={i} className="text-xs text-warn">· {c.text}</p>)}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => mode("assisted")} loading={busy === "assisted"}><RefreshCw size={14} /> New draft</Button>
            <div className="flex-1" />
            <Button variant="warm" onClick={send} loading={busy === "send"} disabled={/\[[^\]]+\]/.test(draft) || !draft.trim()} sound={false}><Send size={15} /> Send reply</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {msg.handled ? (
          <span className="flex items-center gap-1.5 text-sm text-ok"><Check size={15} /> Handled{msg.reply_mode === "self" ? " (you replied in Gmail)" : msg.reply_mode === "assisted" ? " (reply sent)" : ""}</span>
        ) : (
          <Button variant="outline" onClick={async () => {
            try {
              await api.post(`/inbox/${msg.id}/handled`);
              await onChanged();
            } catch (e) {
              toast((e as Error).message, "bad");
            }
          }}>
            <Check size={15} /> {msg.reply_mode === "self" ? "I've replied" : "Mark as handled"}
          </Button>
        )}
        <a href={msg.thread_url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">Open in Gmail <ExternalLink size={11} /></a>
      </div>

      <details className="rounded-xl bg-white/[0.02] hairline">
        <summary className="cursor-pointer px-3 py-2 text-xs text-ink-3">Label wrong? Correct it (this trains Kold&apos;s reply classifier)</summary>
        <div className="flex flex-wrap gap-1.5 px-3 pb-3">
          {FIX_LABELS.map((l) => (
            <button key={l} onClick={() => relabel(l)} className={clsx("rounded-full px-3 py-1 text-xs hairline", l === msg.label ? "bg-white/10 text-ink" : "text-ink-3 hover:text-ink")}>
              {LABEL_META[l].emoji} {LABEL_META[l].label}
            </button>
          ))}
        </div>
      </details>

      <Confirm open={stopAsk} onClose={() => setStopAsk(false)} title="Stop outreach for good?" body="No more emails will be drafted to this contact." confirmLabel="Stop" tone="danger" onConfirm={() => decide("stop")} />
    </div>
  );
}

function ChoiceCard({ icon, title, body, onClick, loading, warm }: { icon: React.ReactNode; title: string; body: string; onClick: () => void; loading?: boolean; warm?: boolean }) {
  return (
    <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} onClick={onClick} disabled={loading}
      className={clsx("rounded-2xl p-4 text-left hairline transition disabled:opacity-60", warm ? "bg-gradient-to-br from-ember/15 to-flame/5" : "bg-white/[0.03]")}>
      <div className={clsx("mb-3 flex h-10 w-10 items-center justify-center rounded-xl", warm ? "bg-ember/20 text-ember" : "bg-ice/15 text-ice")}>{loading ? <RefreshCw size={18} className="animate-spin" /> : icon}</div>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-ink-2">{body}</p>
    </motion.button>
  );
}
