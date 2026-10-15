"use client";

import { motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Layers } from "lucide-react";
import clsx from "clsx";
import { JobDetailSheet } from "@/components/job-detail";
import { CompanyMark, placeLabel } from "@/components/job-bits";
import { Badge, Empty, Button } from "@/components/ui";
import { api } from "@/lib/api";
import { ago, dateShort, daysUntil, STAGE_META } from "@/lib/format";
import type { JobCard } from "@/lib/types";
import Link from "next/link";

const BOARD = ["liked", "applied", "reaching_out", "replied", "interview", "offer", "rejected"];

export default function TrackerPage() {
  return (
    <Suspense fallback={<div className="p-8"><div className="skeleton h-96 rounded-3xl" /></div>}>
      <Tracker />
    </Suspense>
  );
}

function Tracker() {
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("job") ? Number(params.get("job")) : null;
  const [items, setItems] = useState<JobCard[] | null>(null);
  const [stage, setStage] = useState<string>("all");

  const load = useCallback(async () => {
    const d = await api.get<{ items: JobCard[] }>("/tracker");
    setItems(d.items);
  }, []);

  useEffect(() => {
    api.get<{ items: JobCard[] }>("/tracker").then((d) => setItems(d.items)).catch(() => setItems([]));
  }, []);

  const open = (id: number | null) => router.replace(id ? `/tracker?job=${id}` : "/tracker", { scroll: false });
  const byStage = (s: string) => (items ?? []).filter((i) => i.status === s);
  const visible = stage === "all" ? (items ?? []).filter((i) => i.status !== "archived") : byStage(stage);

  return (
    <div className="px-4 pt-6 md:px-8 md:pt-10">
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] md:text-3xl">Tracker</h1>
          <p className="mt-1 text-sm text-ink-3">Every saved opportunity, from cold to hot.</p>
        </div>
      </div>

      {/* temperature legend = pipeline */}
      <div className="scroll-thin -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        <StageChip active={stage === "all"} onClick={() => setStage("all")} label="All" count={(items ?? []).filter((i) => i.status !== "archived").length} color="var(--ink-2)" />
        {BOARD.map((s) => (
          <StageChip key={s} active={stage === s} onClick={() => setStage(s)} label={STAGE_META[s].label} count={byStage(s).length} color={STAGE_META[s].color} />
        ))}
      </div>

      {!items ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-36 rounded-3xl" />)}</div>
      ) : items.length === 0 ? (
        <Empty icon={<Layers />} title="Nothing saved yet" body="Swipe right on opportunities in Discover and they'll land here." action={<Link href="/discover"><Button variant="primary">Go to Discover</Button></Link>} />
      ) : stage === "all" ? (
        <div className="scroll-thin -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-6 md:mx-0 md:px-0">
          {BOARD.map((s) => (
            <div key={s} className="w-[85vw] max-w-[320px] shrink-0 snap-start sm:w-[300px]">
              <div className="mb-3 flex items-center gap-2 px-1">
                <span className="h-2 w-2 rounded-full" style={{ background: STAGE_META[s].color, boxShadow: `0 0 10px ${STAGE_META[s].color}` }} />
                <span className="text-sm font-medium">{STAGE_META[s].label}</span>
                <span className="text-xs text-ink-3">{byStage(s).length}</span>
              </div>
              <div className="space-y-3">
                {byStage(s).map((j, i) => <TrackerCard key={j.user_job_id} job={j} i={i} onOpen={() => open(j.user_job_id)} />)}
                {!byStage(s).length && <div className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-xs text-ink-3">{STAGE_META[s].hint}</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((j, i) => <TrackerCard key={j.user_job_id} job={j} i={i} onOpen={() => open(j.user_job_id)} />)}
          {!visible.length && <p className="text-sm text-ink-3">Nothing here yet.</p>}
        </div>
      )}

      <JobDetailSheet id={openId} onClose={() => open(null)} onChanged={load} />
    </div>
  );
}

function StageChip({ active, onClick, label, count, color }: { active: boolean; onClick: () => void; label: string; count: number; color: string }) {
  return (
    <button onClick={onClick} className={clsx("flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm transition", active ? "bg-white/[0.08] text-ink hairline" : "text-ink-3 hover:text-ink-2")}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
      <span className="text-xs tabular-nums text-ink-3">{count}</span>
    </button>
  );
}

function TrackerCard({ job, i, onOpen }: { job: JobCard; i: number; onOpen: () => void }) {
  const due = daysUntil(job.my_deadline);
  const c = job.campaign;
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i * 0.03, 0.3) }}
      whileHover={{ y: -2 }}
      onClick={onOpen}
      className="relative w-full overflow-hidden rounded-3xl bg-surface/80 p-4 text-left hairline"
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: STAGE_META[job.status]?.color }} />
      <div className="flex items-start gap-3">
        <CompanyMark name={job.company} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-ink-3">{job.company}</p>
          <p className="line-clamp-2 text-sm leading-snug font-medium">{job.title}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge color="var(--ice)">{placeLabel(job).text}</Badge>
        {due !== null && due >= 0 && <Badge color={due <= 3 ? "var(--heat)" : "var(--ember)"}>Due {dateShort(job.my_deadline)}</Badge>}
        {!job.active && <Badge color="var(--bad)">Listing closed</Badge>}
      </div>
      {c && (
        <p className="mt-3 text-xs text-ink-2">
          {c.status === "active" && (c.next_due ? `Emailing ${c.to} · next draft ${dateShort(c.next_due)}` : `Emailing ${c.to}`)}
          {c.status === "replied" && <span className="text-ember">🔥 Replied: your move</span>}
          {c.status === "paused" && <span className="text-warn">Paused: {c.stop_reason || "awaiting your decision"}</span>}
          {c.status === "completed" && `All ${c.steps_sent} emails sent · watching for replies`}
          {c.status === "stopped" && <span className="text-ink-3">Outreach stopped</span>}
        </p>
      )}
      <p className="mt-2 text-[11px] text-ink-3">Updated {ago(job.updated_at)}</p>
    </motion.button>
  );
}
