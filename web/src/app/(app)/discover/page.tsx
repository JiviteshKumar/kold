"use client";

import { AnimatePresence, animate, motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Info, RefreshCw, RotateCcw, Snowflake, Sparkles, X } from "lucide-react";
import { CompanyMark, Description, JobMeta, TrustPanel } from "@/components/job-bits";
import { Badge, Button, Empty, Sheet, TempMeter, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { ago, temperature } from "@/lib/format";
import { useDataChanged } from "@/lib/hooks";
import { play } from "@/lib/sound";
import type { JobCard } from "@/lib/types";

type Feed = {
  cards: JobCard[];
  remaining: number;
  refreshing: boolean;
  last_scan: { at: string; new: number; closed: number; sources_ok: number; sources: number } | null;
  active_jobs: number;
};

export default function Discover() {
  const toast = useToast();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [cards, setCards] = useState<JobCard[]>([]);
  const [history, setHistory] = useState<JobCard[]>([]);
  const [detail, setDetail] = useState<JobCard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [lastDir, setLastDir] = useState<1 | -1>(1);

  const load = useCallback(async () => {
    const f = await api.get<Feed>("/feed");
    setFeed(f);
    setCards(f.cards);
    setRefreshing(f.refreshing);
    return f;
  }, []);

  useDataChanged(useCallback(() => void load().catch(() => {}), [load]));

  useEffect(() => {
    api.get<Feed>("/feed")
      .then((f) => {
        setFeed(f);
        setCards(f.cards);
        setRefreshing(f.refreshing);
      })
      .catch((e) => toast(e.message, "bad"));
  }, [toast]);

  // While a scan runs, poll until it finishes, then tell the user honestly what changed.
  useEffect(() => {
    if (!refreshing) return;
    const before = feed?.remaining ?? 0;
    const t = setInterval(async () => {
      const s = await api.get<{ running: boolean }>("/feed/refresh").catch(() => ({ running: false }));
      if (!s.running) {
        clearInterval(t);
        const f = await load();
        const added = f.remaining - before;
        setFresh(added > 0 ? `${added} new match${added > 1 ? "es" : ""}` : "You're up to date. No new matches since the last scan.");
        play(added > 0 ? "warm" : "tap");
        window.dispatchEvent(new Event("kold:refresh-stats"));
      }
    }, 2500);
    return () => clearInterval(t);
  }, [refreshing, load, feed?.remaining]);

  const refresh = async () => {
    setFresh(null);
    setRefreshing(true);
    play("whoosh");
    try {
      await api.post("/feed/refresh");
    } catch (e) {
      setRefreshing(false);
      toast((e as Error).message, "bad");
    }
  };

  const decide = async (card: JobCard, dir: "right" | "left") => {
    play(dir === "right" ? "like" : "pass");
    setLastDir(dir === "right" ? 1 : -1);
    setCards((c) => c.filter((x) => x.user_job_id !== card.user_job_id));
    setHistory((h) => [...h.slice(-9), card]);
    setFeed((f) => (f ? { ...f, remaining: Math.max(0, f.remaining - 1) } : f));
    try {
      await api.post(`/feed/${card.user_job_id}/swipe`, { direction: dir });
      if (dir === "right") toast(`Saved ${card.company} to your tracker`, "ok");
      window.dispatchEvent(new Event("kold:refresh-stats"));
    } catch (e) {
      toast((e as Error).message, "bad");
    }
    if (cards.length <= 4) load().catch(() => {});
  };

  const undo = async () => {
    const last = history[history.length - 1];
    if (!last) return;
    try {
      await api.post(`/feed/${last.user_job_id}/swipe`, { direction: "undo" });
    } catch (e) {
      toast((e as Error).message, "bad");
      return;
    }
    setHistory((h) => h.slice(0, -1));
    setCards((c) => [last, ...c.filter((x) => x.user_job_id !== last.user_job_id)]);
    play("tap");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (detail || !cards[0] || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight") void decide(cards[0], "right");
      if (e.key === "ArrowLeft") void decide(cards[0], "left");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="mx-auto max-w-xl px-4 pt-6 md:pt-10">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] md:text-3xl">Discover</h1>
          <p className="mt-1 text-sm text-ink-3">
            {feed ? <>{feed.remaining} waiting · {feed.last_scan ? <>scanned {ago(feed.last_scan.at)} · {feed.last_scan.sources_ok}/{feed.last_scan.sources} sources OK</> : "first scan pending"}</> : " "}
          </p>
        </div>
        <Button onClick={refresh} loading={refreshing} variant="outline" aria-label="Scan for new opportunities">
          {!refreshing && <RefreshCw size={15} />} {refreshing ? "Scanning" : "Refresh"}
        </Button>
      </div>

      <AnimatePresence>
        {fresh && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <button onClick={() => setFresh(null)} className="mb-4 flex w-full items-center gap-2 rounded-2xl bg-ember/10 px-4 py-3 text-left text-sm text-ember hairline">
              <Sparkles size={16} /> {fresh}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative h-[clamp(300px,calc(100dvh-400px),640px)] md:h-[clamp(420px,calc(100dvh-300px),640px)]">
        {!feed ? (
          <div className="skeleton absolute inset-0 rounded-[28px]" />
        ) : cards.length === 0 ? (
          <Empty
            icon={<Snowflake />}
            title={refreshing ? "Scanning…" : "You're all caught up"}
            body={refreshing ? "Checking employer careers boards and trusted job boards for new listings." : <>No unseen matches right now. Kold re-scans every few hours, or refresh now. You can also widen your roles or locations in Profile.</>}
            action={!refreshing && <Button variant="primary" onClick={refresh}><RefreshCw size={15} /> Scan now</Button>}
          />
        ) : (
          <AnimatePresence custom={lastDir}>
            {cards.slice(0, 3).reverse().map((card) => {
              const index = cards.indexOf(card);
              return (
                <SwipeCard
                  key={card.user_job_id}
                  card={card}
                  index={index}
                  dir={lastDir}
                  onDecide={(d) => decide(card, d)}
                  onInfo={() => setDetail(card)}
                />
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {cards.length > 0 && (
        <div className="mt-5 flex items-center justify-center gap-5">
          <RoundBtn label="Undo" onClick={undo} disabled={!history.length} small><RotateCcw size={18} /></RoundBtn>
          <RoundBtn label="Pass" onClick={() => decide(cards[0], "left")} tone="cold"><X size={26} /></RoundBtn>
          <RoundBtn label="Interested" onClick={() => decide(cards[0], "right")} tone="warm"><Check size={26} /></RoundBtn>
          <RoundBtn label="Details" onClick={() => setDetail(cards[0])} small><Info size={18} /></RoundBtn>
        </div>
      )}
      <p className="mt-4 hidden text-center text-xs text-ink-3 md:block">Tip: use ← and → keys</p>

      <Sheet open={!!detail} onClose={() => setDetail(null)} wide title={detail && <span>{detail.title}</span>}>
        {detail && <JobDetail job={detail} onDecide={(d) => { setDetail(null); void decide(detail, d); }} />}
      </Sheet>
    </div>
  );
}

function RoundBtn({ children, onClick, label, tone, small, disabled }: { children: React.ReactNode; onClick: () => void; label: string; tone?: "warm" | "cold"; small?: boolean; disabled?: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.88 }}
      whileHover={{ scale: 1.06 }}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`flex items-center justify-center rounded-full transition disabled:opacity-30 ${small ? "h-12 w-12 bg-white/[0.04] text-ink-2 hairline" : "h-16 w-16"} ${
        tone === "warm" ? "bg-gradient-to-br from-[#fde68a] via-[#f59e0b] to-[#f97316] text-[#1f1203] shadow-[0_12px_40px_-10px_rgba(245,158,11,0.8)]" : ""
      } ${tone === "cold" ? "bg-surface-2 text-ice shadow-[0_12px_40px_-14px_rgba(56,189,248,0.6),inset_0_0_0_1px_rgba(125,211,252,0.3)]" : ""}`}
    >
      {children}
    </motion.button>
  );
}

const cardVariants = {
  exit: (d: number) => ({ x: d * 600, rotate: d * 24, opacity: 0, transition: { duration: 0.35 } }),
};

function SwipeCard({ card, index, dir, onDecide, onInfo }: { card: JobCard; index: number; dir: number; onDecide: (d: "right" | "left") => void; onInfo: () => void }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-14, 14]);
  const likeOpacity = useTransform(x, [30, 140], [0, 1]);
  const passOpacity = useTransform(x, [-140, -30], [1, 0]);
  const glow = useTransform(x, [-200, 0, 200], ["0 30px 80px -30px rgba(56,189,248,0.9)", "0 30px 80px -40px rgba(0,0,0,0.9)", "0 30px 80px -30px rgba(245,158,11,0.9)"]);
  const t = temperature(card.match_score);
  const top = index === 0;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const power = info.offset.x + info.velocity.x * 0.2;
    if (Math.abs(power) > 130) {
      onDecide(power > 0 ? "right" : "left");
    } else {
      void animate(x, 0, { type: "spring", stiffness: 400, damping: 30 });
    }
  };

  return (
    <motion.article
      className="absolute inset-0 flex cursor-grab touch-pan-y flex-col overflow-hidden rounded-[28px] bg-surface active:cursor-grabbing"
      style={{ x: top ? x : 0, rotate: top ? rotate : 0, boxShadow: top ? glow : undefined, zIndex: 10 - index }}
      drag={top ? "x" : false}
      dragSnapToOrigin={false}
      onDragEnd={onDragEnd}
      initial={{ scale: 0.92, y: 30, opacity: 0 }}
      animate={{ scale: 1 - index * 0.04, y: index * 14, opacity: index > 2 ? 0 : 1 }}
      custom={dir}
      variants={cardVariants}
      exit="exit"
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
    >
      <div className="pointer-events-none absolute inset-0 rounded-[28px] hairline" />
      {/* swipe stamps */}
      <motion.div style={{ opacity: likeOpacity }} className="pointer-events-none absolute top-6 left-6 z-10 rotate-[-12deg] rounded-xl border-2 border-ember px-3 py-1 text-sm font-bold tracking-widest text-ember">INTERESTED</motion.div>
      <motion.div style={{ opacity: passOpacity }} className="pointer-events-none absolute top-6 right-6 z-10 rotate-[12deg] rounded-xl border-2 border-ice px-3 py-1 text-sm font-bold tracking-widest text-ice">PASS</motion.div>

      <div className="h-1.5 w-full" style={{ background: "var(--grad-temp)", opacity: 0.35 + card.match_score / 160 }} />
      <div className="scroll-thin flex flex-1 flex-col gap-4 overflow-y-auto p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <CompanyMark name={card.company} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink-2">{card.company}</p>
            <h2 className="text-xl leading-tight font-semibold tracking-[-0.02em]">{card.title}</h2>
          </div>
        </div>

        <JobMeta job={card} />

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-medium" style={{ color: t.color }}>{t.label}</span>
            <span className="text-ink-3">match temperature</span>
          </div>
          <TempMeter score={card.match_score} />
        </div>

        <ul className="space-y-1.5">
          {card.match_reasons.map((r, i) => (
            <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.05 }} className="flex gap-2 text-sm text-ink-2">
              <Check size={15} className="mt-0.5 shrink-0 text-ice" /> {r}
            </motion.li>
          ))}
        </ul>

        {card.summary && <p className="line-clamp-4 text-sm leading-relaxed text-ink-3">{card.summary}</p>}

        <div className="mt-auto flex items-center gap-2 pt-1">
          <Badge color={card.trust_flags.some((f) => f.level === "bad") ? "var(--bad)" : "var(--ok)"}>Trust {card.trust_score}</Badge>
          <span className="truncate text-xs text-ink-3">{card.source_label}</span>
          <button onClick={onInfo} onPointerDown={(e) => e.stopPropagation()} className="ml-auto shrink-0 rounded-full px-3 py-1.5 text-xs text-ice hairline hover:bg-white/5">Details</button>
        </div>
      </div>
    </motion.article>
  );
}

function JobDetail({ job, onDecide }: { job: JobCard; onDecide: (d: "right" | "left") => void }) {
  const [full, setFull] = useState<string | null>(null);
  useEffect(() => {
    api.get<JobCard & { description: string }>(`/jobs/${job.user_job_id}`).then((d) => setFull(d.description)).catch(() => setFull(job.summary));
  }, [job]);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <CompanyMark name={job.company} />
        <div>
          <p className="font-medium">{job.company}</p>
          <p className="text-sm text-ink-3">{job.department}</p>
        </div>
      </div>
      <JobMeta job={job} />
      <TrustPanel job={job} />
      {full === null ? <div className="skeleton h-40 rounded-2xl" /> : <Description text={full} />}
      <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur">
        <a href={job.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm text-ink-2 hairline hover:text-ink">
          Original posting <ExternalLink size={14} />
        </a>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => onDecide("left")}>Pass</Button>
        <Button variant="warm" onClick={() => onDecide("right")}>Interested</Button>
      </div>
    </div>
  );
}
