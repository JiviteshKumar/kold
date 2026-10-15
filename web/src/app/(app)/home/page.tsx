"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CalendarClock, CheckCircle2, Flame, Inbox, PenLine, Snowflake, Sunrise } from "lucide-react";
import clsx from "clsx";
import { CompanyMark } from "@/components/job-bits";
import { Badge, Card, TempMeter, useToast } from "@/components/ui";
import { api, isLite } from "@/lib/api";
import { ago, dateShort, daysUntil, LABEL_META, STAGE_META } from "@/lib/format";
import { useDataChanged, useNow } from "@/lib/hooks";
import type { HomeData } from "@/lib/types";

const PIPE = ["liked", "applied", "reaching_out", "replied", "interview", "offer"];

export default function HomePage() {
  const toast = useToast();
  const now = useNow();
  const [d, setD] = useState<HomeData | null>(null);

  const reload = useCallback(() => {
    api.get<HomeData>("/home").then(setD).catch(() => {});
  }, []);
  useDataChanged(reload);

  useEffect(() => {
    api.get<HomeData>("/home").then(setD).catch((e) => toast(e.message, "bad"));
    const t = setInterval(() => api.get<HomeData>("/home").then(setD).catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, [toast]);

  const hour = now ? new Date(now).getHours() : 12;
  const greeting = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const todo: string[] = [];
  if (d?.replies_waiting) todo.push(`${d.replies_waiting} repl${d.replies_waiting > 1 ? "ies need" : "y needs"} you`);
  if (d?.approvals_waiting) todo.push(`${d.approvals_waiting} email${d.approvals_waiting > 1 ? "s" : ""} to approve`);
  if (d?.deadlines.length) todo.push(`${d.deadlines.length} deadline${d.deadlines.length > 1 ? "s" : ""} this week`);
  const pipeTotal = d ? PIPE.reduce((a, s) => a + (d.pipeline[s] || 0), 0) : 0;

  return (
    <div className="mx-auto max-w-4xl px-4 pt-6 md:px-8 md:pt-10">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
        <p className="text-xs font-medium tracking-[0.2em] text-ice uppercase">{now ? new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) : " "}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em] md:text-4xl">{greeting}{d?.name ? `, ${d.name}` : ""}.</h1>
        <p className="mt-2 text-ink-2">
          {!d ? " " : todo.length ? <>Today: {todo.join(" · ")}.</> : <>You&apos;re all caught up. Nothing needs you right now. ✨</>}
        </p>
      </motion.div>

      {!d ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-44 rounded-3xl" />)}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* 1. Replies: the most important thing */}
          <Panel i={0} className="md:col-span-2" warm={d.replies_waiting > 0} icon={<Inbox size={17} />} title="Replies from companies"
            action={<Link href="/inbox" className="flex items-center gap-1 text-xs text-ice hover:text-frost">Open inbox <ArrowRight size={13} /></Link>}>
            {d.replies.length ? (
              <ul className="divide-y divide-line">
                {d.replies.map((r) => {
                  const m = LABEL_META[r.label];
                  return (
                    <li key={r.id}>
                      <Link href={`/inbox?c=${r.campaign_id}`} className="flex items-start gap-3 py-3 transition hover:opacity-90">
                        <CompanyMark name={r.company} size={36} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium">{r.company}</p>
                            {m && <Badge color={m.color}>{m.emoji} {m.label}</Badge>}
                            <span className="ml-auto shrink-0 text-xs text-ink-3">{ago(r.at)}</span>
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-sm text-ink-2">{r.from}: {r.snippet}</p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Quiet icon={<CheckCircle2 size={16} />} text={d.gmail_connected ? "No replies waiting for you. Kold checks your outreach threads every few minutes." : "Connect Gmail in Profile so replies show up here."} />
            )}
          </Panel>

          {/* 2. Emails to approve */}
          <Panel i={1} icon={<PenLine size={17} />} title="Emails to approve"
            action={<Link href="/today" className="flex items-center gap-1 text-xs text-ice hover:text-frost">Review <ArrowRight size={13} /></Link>}>
            {d.approvals.length ? (
              <ul className="space-y-2">
                {d.approvals.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-sm">
                    <CompanyMark name={a.company} size={26} />
                    <span className="truncate">{a.company}</span>
                    <span className="ml-auto shrink-0 text-xs text-ink-3">{a.status === "failed" ? "failed: retry" : a.step === 0 ? "first email" : `follow-up ${a.step}`}</span>
                  </li>
                ))}
                {d.approvals_waiting > d.approvals.length && <li className="text-xs text-ink-3">+{d.approvals_waiting - d.approvals.length} more</li>}
              </ul>
            ) : (
              <Quiet icon={<CheckCircle2 size={16} />} text="Nothing waiting. Drafts appear here the day they're due." />
            )}
            <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-3">
              <Sunrise size={13} /> {d.sent_today}/{d.daily_limit} sent today{d.scheduled ? ` · ${d.scheduled} scheduled for their morning` : ""}
            </p>
          </Panel>

          {/* 3. Deadlines */}
          <Panel i={2} icon={<CalendarClock size={17} />} title="Deadlines this week"
            action={<Link href="/tracker" className="flex items-center gap-1 text-xs text-ice hover:text-frost">Tracker <ArrowRight size={13} /></Link>}>
            {d.deadlines.length ? (
              <ul className="space-y-2">
                {d.deadlines.map((r) => {
                  const left = daysUntil(r.due_at) ?? 0;
                  return (
                    <li key={r.id}>
                      <Link href={r.user_job_id ? `/tracker?job=${r.user_job_id}` : "/tracker"} className="flex items-center gap-2 text-sm">
                        <span className={clsx("h-2 w-2 shrink-0 rounded-full", left <= 1 ? "bg-heat" : left <= 3 ? "bg-ember" : "bg-ice")} />
                        <span className="truncate">{r.title}</span>
                        <span className="ml-auto shrink-0 text-xs text-ink-3">{left < 0 ? "overdue" : left === 0 ? "today" : `${dateShort(r.due_at)}`}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Quiet icon={<CheckCircle2 size={16} />} text="No deadlines in the next 7 days." />
            )}
          </Panel>

          {/* 4. New matches */}
          <Panel i={3} icon={<Snowflake size={17} />} title={`New matches${d.matches_waiting ? ` · ${d.matches_waiting}` : ""}`}
            action={<Link href="/discover" className="flex items-center gap-1 text-xs text-ice hover:text-frost">Discover <ArrowRight size={13} /></Link>}>
            {d.top_matches.length ? (
              <ul className="space-y-3">
                {d.top_matches.map((m) => (
                  <li key={m.user_job_id}>
                    <Link href="/discover" className="block">
                      <p className="truncate text-sm"><span className="text-ink-3">{m.company} · </span>{m.title}</p>
                      <div className="mt-1"><TempMeter score={m.score} /></div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Quiet icon={<CheckCircle2 size={16} />} text="You've seen every match. Kold rescans official sources every few hours." />
            )}
            {d.last_scan && <p className="mt-3 text-xs text-ink-3">Last scan {ago(d.last_scan.at)}</p>}
          </Panel>

          {/* 5. Pipeline: cold → hot */}
          <Panel i={4} icon={<Flame size={17} />} title="Your pipeline">
            {pipeTotal ? (
              <>
                <div className="flex h-3 overflow-hidden rounded-full bg-white/5">
                  {PIPE.map((s) => d.pipeline[s] ? (
                    <motion.div key={s} initial={{ width: 0 }} animate={{ width: `${(100 * d.pipeline[s]) / pipeTotal}%` }} transition={{ duration: 0.8 }}
                      style={{ background: STAGE_META[s].color }} title={`${STAGE_META[s].label}: ${d.pipeline[s]}`} />
                  ) : null)}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {PIPE.map((s) => (
                    <Link key={s} href="/tracker" className="rounded-xl bg-white/[0.02] p-2 hairline">
                      <p className="text-lg font-semibold tabular-nums" style={{ color: d.pipeline[s] ? STAGE_META[s].color : undefined }}>{d.pipeline[s] || 0}</p>
                      <p className="text-[11px] text-ink-3">{STAGE_META[s].label}</p>
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <Quiet icon={<Snowflake size={16} />} text="Swipe right on jobs in Discover to start your pipeline." />
            )}
          </Panel>

          {isLite && (
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="md:col-span-2">
              <Link href="/full" className="flex items-center gap-4 rounded-[var(--radius)] bg-gradient-to-br from-ice/10 via-violet/5 to-ember/10 p-5 hairline">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">You&apos;re on Kold Lite</p>
                  <p className="mt-0.5 text-sm text-ink-2">It runs on this device and works while Kold is open. Want reply checks in the background, sends at their morning and notifications? Get the free full version.</p>
                </div>
                <ArrowRight size={18} className="shrink-0 text-ice" />
              </Link>
            </motion.div>
          )}

          {/* 6. What Kold did */}
          <Panel i={5} className="md:col-span-2" icon={<CheckCircle2 size={17} />} title="What Kold did recently">
            <ul className="space-y-2">
              {d.activity.map((a) => (
                <li key={a.id}>
                  <Link href={a.url || "/"} className="flex gap-3 text-sm text-ink-2 hover:text-ink">
                    <span className="w-16 shrink-0 text-xs text-ink-3">{ago(a.at)}</span>
                    <span className="min-w-0 flex-1">{a.message}</span>
                  </Link>
                </li>
              ))}
              {!d.activity.length && <Quiet icon={<CheckCircle2 size={16} />} text="Nothing yet." />}
            </ul>
          </Panel>
        </div>
      )}
    </div>
  );
}

function Panel({ i, title, icon, action, children, className, warm }: { i: number; title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; warm?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, type: "spring", stiffness: 260, damping: 26 }} className={className}>
      <Card className={clsx("h-full p-5", warm && "bg-gradient-to-br from-ember/[0.10] to-transparent shadow-[inset_0_0_0_1px_rgba(245,158,11,0.35)]")}>
        <div className="mb-4 flex items-center gap-2">
          <span className={warm ? "text-ember" : "text-ice"}>{icon}</span>
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="ml-auto">{action}</div>
        </div>
        {children}
      </Card>
    </motion.div>
  );
}

function Quiet({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <p className="flex items-start gap-2 text-sm text-ink-3"><span className="mt-0.5 text-ok">{icon}</span>{text}</p>;
}
