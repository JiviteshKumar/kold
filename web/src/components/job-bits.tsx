"use client";

import { AlertTriangle, BadgeCheck, CalendarClock, ExternalLink, Globe2, MapPin, ShieldAlert, Wallet } from "lucide-react";
import { Badge } from "./ui";
import { ago, dateShort, daysUntil } from "@/lib/format";
import type { JobCard } from "@/lib/types";

const PALETTE = ["#7dd3fc", "#a78bfa", "#f59e0b", "#34d399", "#f472b6", "#60a5fa", "#fb923c"];

export function CompanyMark({ name, size = 44 }: { name: string; size?: number }) {
  const c = PALETTE[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % PALETTE.length];
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-2xl font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.42, color: c, background: `color-mix(in srgb, ${c} 14%, #0b0f19)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 35%, transparent)` }}
      aria-hidden
    >
      {name.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "•"}
    </div>
  );
}

export function placeLabel(j: Pick<JobCard, "workplace" | "region" | "open_to_india" | "location">): { text: string; icon: typeof MapPin } {
  if (j.workplace === "remote") {
    if (j.region === "india") return { text: "Remote · India", icon: Globe2 };
    if (j.open_to_india) return { text: "Remote · open to India", icon: Globe2 };
    return { text: "Remote · eligibility unclear", icon: Globe2 };
  }
  return { text: `${j.workplace === "hybrid" ? "Hybrid" : "On-site"} · ${j.location.split(/[;|]/)[0].slice(0, 40)}`, icon: MapPin };
}

export function JobMeta({ job }: { job: JobCard }) {
  const place = placeLabel(job);
  const due = daysUntil(job.my_deadline ?? job.deadline);
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge color="var(--ice)"><place.icon size={12} /> {place.text}</Badge>
      <Badge color="var(--violet)">{job.job_type_label}</Badge>
      {job.salary && <Badge color="var(--ok)"><Wallet size={12} /> {job.salary}</Badge>}
      {due !== null && due >= 0 && (
        <Badge color={due <= 3 ? "var(--heat)" : "var(--ember)"}><CalendarClock size={12} /> Apply by {dateShort(job.my_deadline ?? job.deadline)}</Badge>
      )}
      {job.posted_at && <Badge>Posted {ago(job.posted_at)}</Badge>}
    </div>
  );
}

export function TrustPanel({ job }: { job: JobCard }) {
  const bad = job.trust_flags.some((f) => f.level === "bad");
  return (
    <div className="rounded-2xl bg-white/[0.02] p-3.5 hairline">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        {bad ? <ShieldAlert size={16} className="text-bad" /> : <BadgeCheck size={16} className="text-ok" />}
        <span>Trust {job.trust_score}/100</span>
        <a href={job.source_url || job.url} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
          Source <ExternalLink size={11} />
        </a>
      </div>
      <ul className="space-y-1.5">
        {job.trust_flags.map((f, i) => (
          <li key={i} className="flex gap-2 text-xs text-ink-2">
            {f.level === "ok" ? <BadgeCheck size={13} className="mt-px shrink-0 text-ok" /> : <AlertTriangle size={13} className={`mt-px shrink-0 ${f.level === "bad" ? "text-bad" : "text-warn"}`} />}
            {f.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Description({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink-2">
      {text.split(/\n{2,}/).filter(Boolean).map((p, i) => (
        <p key={i} className="whitespace-pre-line">{p.trim()}</p>
      ))}
    </div>
  );
}
