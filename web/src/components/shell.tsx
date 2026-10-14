"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Bell, House, Inbox, Layers, Send, Snowflake, User, Volume2, VolumeX } from "lucide-react";
import clsx from "clsx";
import { KoldMark, Wordmark } from "./brand";
import { useMe } from "./providers";
import { Sheet } from "./ui";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { notifyMuteChange, useMuted } from "@/lib/hooks";
import { play, setMuted } from "@/lib/sound";
import type { Activity, Stats } from "@/lib/types";

const NAV = [
  { href: "/home", label: "Home", icon: House, badge: () => 0, mobile: true },
  { href: "/discover", label: "Discover", icon: Snowflake, badge: (s: Stats) => s.to_review, mobile: true },
  { href: "/today", label: "Today", icon: Send, badge: (s: Stats) => s.awaiting_approval, mobile: true },
  { href: "/inbox", label: "Inbox", icon: Inbox, badge: (s: Stats) => s.needs_attention, warm: true, mobile: true },
  { href: "/tracker", label: "Tracker", icon: Layers, badge: () => 0, mobile: true },
  { href: "/profile", label: "Profile", icon: User, badge: () => 0, mobile: false },
];

const KIND_ICON: Record<string, string> = {
  crawl: "🛰️", match: "❄️", contact: "🔎", draft: "✍️", send: "📨", reply: "🔥", pause: "⏸️", stop: "⛔",
  reminder: "⏰", profile: "🪪", gmail: "🔐", resume: "📄", campaign: "🚀", queue: "📬", skip: "↪️", error: "⚠️", tracker: "🗂️",
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, loading } = useMe();
  const [stats, setStats] = useState<Stats | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [log, setLog] = useState<Activity[]>([]);
  const muted = useMuted();

  useEffect(() => {
    if (!loading && !me?.user?.onboarded) router.replace("/onboarding");
  }, [loading, me, router]);

  const loadStats = useCallback(() => {
    api.get<Stats>("/stats").then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setInterval(loadStats, 20000);
    const first = setTimeout(loadStats, 0);
    const onFocus = () => loadStats();
    window.addEventListener("focus", onFocus);
    window.addEventListener("kold:refresh-stats", onFocus);
    return () => {
      clearInterval(t);
      clearTimeout(first);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("kold:refresh-stats", onFocus);
    };
  }, [loadStats, pathname]);

  const openLog = async () => {
    setLogOpen(true);
    try {
      setLog(await api.get<Activity[]>("/activity?limit=100"));
      await api.post("/activity/seen");
      void loadStats();
    } catch {}
  };

  if (loading || !me?.user?.onboarded) {
    return <div className="flex h-dvh items-center justify-center"><KoldMark size={44} /></div>;
  }

  return (
    <div className="relative z-10 flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line px-4 py-6 md:flex">
        <Link href="/home" className="mb-8 flex items-center gap-2.5 px-2">
          <KoldMark size={30} />
          <Wordmark className="text-2xl" />
        </Link>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => {
            const active = pathname.startsWith(n.href);
            const count = stats ? n.badge(stats) : 0;
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => play("tap")}
                className={clsx("relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition", active ? "text-ink" : "text-ink-3 hover:text-ink-2")}
              >
                {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-white/[0.06] hairline" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
                <n.icon size={18} className="relative" />
                <span className="relative flex-1">{n.label}</span>
                {count > 0 && (
                  <span className={clsx("relative rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", n.warm ? "bg-ember/20 text-ember" : "bg-ice/15 text-ice")}>
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-2 px-2 text-xs text-ink-3">
          {stats && (
            <div className="grid grid-cols-2 gap-2 pb-3">
              <Stat label="Emails sent" value={stats.sent} />
              <Stat label="Replies" value={stats.replies} warm={stats.replies > 0} />
            </div>
          )}
          <p className="leading-relaxed">Every email waits for your approval. Nothing is sent on its own.</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {me.sandbox && (
          <div className="flex items-center justify-center gap-2 bg-warn/15 px-4 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-center text-xs font-medium text-warn">
            Sandbox mode: emails are simulated on this computer and never actually sent.
          </div>
        )}
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/70 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur-xl md:px-8">
          <Link href="/home" className="flex items-center gap-2 md:hidden">
            <KoldMark size={26} />
            <Wordmark className="text-xl" />
          </Link>
          <div className="flex-1" />
          <button
            onClick={() => {
              setMuted(!muted);
              notifyMuteChange();
              if (muted) play("success");
            }}
            className="rounded-full p-2 text-ink-3 transition hover:bg-white/5 hover:text-ink"
            aria-label={muted ? "Turn sound on" : "Mute sound"}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <Link href="/profile" onClick={() => play("tap")} className="rounded-full p-2 text-ink-3 transition hover:bg-white/5 hover:text-ink md:hidden" aria-label="Profile">
            <User size={18} />
          </Link>
          <button onClick={openLog} className="relative rounded-full p-2 text-ink-3 transition hover:bg-white/5 hover:text-ink" aria-label="Activity log">
            <Bell size={18} />
            {!!stats?.unseen_activity && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-ember shadow-[0_0_8px_var(--ember)]" />}
          </button>
        </header>

        <main className="flex-1 pb-28 md:pb-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile tab bar */}
      <nav className="glass fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex justify-around rounded-[22px] px-1 py-1.5 md:hidden">
        {NAV.filter((n) => n.mobile).map((n) => {
          const active = pathname.startsWith(n.href);
          const count = stats ? n.badge(stats) : 0;
          return (
            <Link key={n.href} href={n.href} onClick={() => play("tap")} className="relative flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-1.5">
              {active && <motion.span layoutId="tab-active" className="absolute inset-0 rounded-2xl bg-white/[0.07]" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
              <n.icon size={20} className={clsx("relative transition", active ? "text-frost" : "text-ink-3")} />
              <span className={clsx("relative text-[10px] font-medium", active ? "text-ink" : "text-ink-3")}>{n.label}</span>
              {count > 0 && (
                <span className={clsx("absolute top-0.5 right-[22%] min-w-4 rounded-full px-1 text-center text-[9px] leading-4 font-bold", n.warm ? "bg-ember text-black" : "bg-ice text-black")}>
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <Sheet open={logOpen} onClose={() => setLogOpen(false)} title="Everything Kold did for you">
        <p className="mb-4 text-sm text-ink-2">A complete, timestamped record of every scan, draft, send and reply. Nothing happens off the record.</p>
        <ol className="relative space-y-1 border-l border-line pl-5">
          {log.map((a, i) => (
            <motion.li
              key={a.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.4) }}
              className="relative"
            >
              <span className="absolute top-3 -left-[27px] flex h-3 w-3 items-center justify-center rounded-full bg-surface-2 hairline">
                {!a.seen && <span className="h-1.5 w-1.5 rounded-full bg-ember" />}
              </span>
              <button
                onClick={() => {
                  setLogOpen(false);
                  router.push(a.url || "/");
                }}
                className="w-full rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.04]"
              >
                <div className="text-sm text-ink">
                  <span className="mr-2">{KIND_ICON[a.kind] ?? "•"}</span>
                  {a.message}
                </div>
                <div className="mt-0.5 text-xs text-ink-3">{ago(a.at)}</div>
              </button>
            </motion.li>
          ))}
          {!log.length && <li className="py-6 text-sm text-ink-3">Nothing yet.</li>}
        </ol>
      </Sheet>
    </div>
  );
}

function Stat({ label, value, warm }: { label: string; value: number; warm?: boolean }) {
  return (
    <div className="rounded-xl bg-white/[0.03] p-2.5 hairline">
      <div className={clsx("text-lg font-semibold tabular-nums", warm ? "text-ember" : "text-ink")}>{value}</div>
      <div className="text-[11px]">{label}</div>
    </div>
  );
}
