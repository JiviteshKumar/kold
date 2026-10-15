"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import clsx from "clsx";
import { play } from "@/lib/sound";

/**
 * "How to get Kold Full": an animated explainer that plays like a short video (≈32s): scenes, captions, a progress
 * bar, chapter dots and soft sound cues. Pure motion graphics, so it's crisp on any screen and weighs almost nothing.
 */
const SCENES = [
  { title: "Lite vs Full", caption: "Kold Lite runs on your phone. Kold Full runs on your own computer or a free cloud server, so it keeps working while you sleep." },
  { title: "Get the code", caption: "Download Kold from GitHub. It's free and open source." },
  { title: "Install the AI", caption: "Install Ollama and pull Kold's AI model once. It runs privately on your machine." },
  { title: "Start Kold", caption: "Start the server and the app with two commands." },
  { title: "Connect Gmail", caption: "Open Kold, connect Gmail once, and you're set: background replies, scheduled sends and notifications." },
  { title: "Online, free", caption: "Optional: install it on Oracle Cloud's free server with one command, and use Kold from any phone, anytime." },
];
const SCENE_MS = 5400;

export function Explainer() {
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [t, setT] = useState(0); // ms into current scene
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      const dt = last.current == null ? 0 : now - last.current;
      last.current = now;
      setT((prev) => {
        const next = prev + dt;
        if (next >= SCENE_MS) {
          setScene((s) => {
            if (s >= SCENES.length - 1) {
              setPlaying(false);
              return s;
            }
            play("whoosh");
            return s + 1;
          });
          return 0;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const jump = useCallback((i: number) => {
    setScene(i);
    setT(0);
    setPlaying(true);
    play("tap");
  }, []);
  const total = ((scene * SCENE_MS + t) / (SCENES.length * SCENE_MS)) * 100;
  const done = !playing && scene === SCENES.length - 1 && t === 0;

  return (
    <div className="overflow-hidden rounded-[28px] bg-[#03050a] hairline">
      <div className="relative aspect-video w-full overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(56,189,248,0.18),transparent_55%),radial-gradient(circle_at_80%_90%,rgba(245,158,11,0.14),transparent_55%)]" />
        <AnimatePresence mode="popLayout">
          <motion.div key={scene} className="absolute inset-0" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.5 }}>
            {scene === 0 && <SceneCompare />}
            {scene === 1 && <SceneDownload />}
            {scene === 2 && <SceneModel />}
            {scene === 3 && <SceneStart />}
            {scene === 4 && <SceneConnect />}
            {scene === 5 && <SceneCloud />}
          </motion.div>
        </AnimatePresence>
        <div className="absolute top-3 left-4 rounded-full bg-black/40 px-3 py-1 text-[11px] tracking-[0.2em] text-ink-2 uppercase backdrop-blur">
          {scene + 1}/{SCENES.length} · {SCENES[scene].title}
        </div>
        {done && (
          <button onClick={() => jump(0)} className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm text-ink backdrop-blur-sm">
            <RotateCcw size={18} className="mr-2" /> Replay
          </button>
        )}
      </div>
      <div className="space-y-3 border-t border-line p-4">
        <AnimatePresence mode="wait">
          <motion.p key={scene} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="min-h-[2.75rem] text-sm text-ink-2">
            {SCENES[scene].caption}
          </motion.p>
        </AnimatePresence>
        <div className="flex items-center gap-3">
          <button onClick={() => { if (done) jump(0); else setPlaying((p) => !p); play("tap"); }} aria-label={playing ? "Pause" : "Play"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] hairline hover:bg-white/10">
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${total}%`, background: "var(--grad-temp)" }} />
          </div>
          <div className="flex gap-1.5">
            {SCENES.map((s, i) => (
              <button key={s.title} onClick={() => jump(i)} aria-label={s.title} className={clsx("h-2 rounded-full transition-all", i === scene ? "w-5 bg-ice" : "w-2 bg-white/25 hover:bg-white/50")} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------------------- scenes */
const fade = (delay = 0) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { delay, type: "spring" as const, stiffness: 200, damping: 22 } });

function Device({ children, className, label, warm }: { children: React.ReactNode; className?: string; label: string; warm?: boolean }) {
  return (
    <div className={clsx("flex flex-col items-center gap-2", className)}>
      <div className={clsx("relative overflow-hidden rounded-[18px] border bg-[#0b0f19] p-2", warm ? "border-ember/50 shadow-[0_0_40px_-10px_rgba(245,158,11,0.6)]" : "border-ice/40 shadow-[0_0_40px_-12px_rgba(56,189,248,0.6)]")}>
        {children}
      </div>
      <span className={clsx("text-xs font-medium", warm ? "text-ember" : "text-ice")}>{label}</span>
    </div>
  );
}

function SceneCompare() {
  const lite = ["Works when the app is open", "On-device AI", "Nothing to install"];
  const full = ["Works 24/7 in the background", "Scheduled sends + notifications", "Reads company sites for contacts"];
  return (
    <div className="flex h-full items-center justify-center gap-6 px-6 sm:gap-14">
      <motion.div {...fade(0.1)}>
        <Device label="Kold Lite">
          <div className="flex h-36 w-20 flex-col gap-1.5 p-1 sm:h-48 sm:w-28">
            {lite.map((l, i) => <motion.div key={l} {...fade(0.5 + i * 0.25)} className="rounded-md bg-ice/10 px-1.5 py-1 text-[8px] leading-tight text-frost sm:text-[10px]">{l}</motion.div>)}
          </div>
        </Device>
      </motion.div>
      <motion.div {...fade(0.3)} className="text-2xl text-ink-3">→</motion.div>
      <motion.div {...fade(0.5)}>
        <Device label="Kold Full" warm>
          <div className="flex h-36 w-32 flex-col gap-1.5 p-1 sm:h-48 sm:w-44">
            <div className="flex gap-1">{[0, 1, 2].map((i) => <motion.span key={i} className="h-2 w-2 rounded-full bg-ok" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.3 }} />)}</div>
            {full.map((l, i) => <motion.div key={l} {...fade(1 + i * 0.25)} className="rounded-md bg-ember/10 px-1.5 py-1 text-[8px] leading-tight text-ember sm:text-[10px]">{l}</motion.div>)}
          </div>
        </Device>
      </motion.div>
    </div>
  );
}

function Terminal({ lines, title }: { lines: { text: string; delay: number; ok?: boolean }[]; title: string }) {
  return (
    <div className="w-[min(88%,520px)] overflow-hidden rounded-2xl border border-line bg-[#070b14] font-mono text-[10px] sm:text-xs">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-heat/70" /><span className="h-2 w-2 rounded-full bg-warn/70" /><span className="h-2 w-2 rounded-full bg-ok/70" />
        <span className="ml-2 text-ink-3">{title}</span>
      </div>
      <div className="space-y-1.5 p-3">
        {lines.map((l) => (
          <motion.div key={l.text} initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: "auto" }} transition={{ delay: l.delay, duration: 0.6 }}
            className={clsx("overflow-hidden whitespace-nowrap", l.ok ? "text-ok" : "text-frost")}>
            {l.ok ? "✓ " : "$ "}{l.text}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function SceneDownload() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6">
      <motion.div {...fade(0.1)} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
        <svg viewBox="0 0 16 16" className="h-6 w-6 fill-ink"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
        <div><p className="text-sm font-medium">JiviteshKumar/kold</p><p className="text-xs text-ink-3">Open source · free</p></div>
        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.9, type: "spring" }} className="ml-3 rounded-full bg-ok/15 px-2 py-0.5 text-[10px] text-ok">Code ↓</motion.span>
      </motion.div>
      <Terminal title="Terminal" lines={[
        { text: "git clone https://github.com/JiviteshKumar/kold.git", delay: 1.2 },
        { text: "Downloaded Kold", delay: 2.8, ok: true },
      ]} />
    </div>
  );
}

function SceneModel() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6">
      <Terminal title="Install the AI (once)" lines={[
        { text: "ollama pull qwen3.5:4b", delay: 0.4 },
        { text: "Model ready, runs privately on your machine", delay: 3.4, ok: true },
      ]} />
      <div className="h-2 w-[min(88%,520px)] overflow-hidden rounded-full bg-white/10">
        <motion.div className="h-full rounded-full" style={{ background: "var(--grad-cold)" }} initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ delay: 1, duration: 2.3, ease: "easeInOut" }} />
      </div>
    </div>
  );
}

function SceneStart() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
      <Terminal title="1 · Server" lines={[
        { text: "uvicorn kold.main:app --port 8000", delay: 0.3 },
        { text: "Kold API running", delay: 1.6, ok: true },
      ]} />
      <Terminal title="2 · App" lines={[
        { text: "npm run dev -- -p 3100", delay: 2.2 },
        { text: "Kold ready at http://localhost:3100", delay: 3.4, ok: true },
      ]} />
    </div>
  );
}

function SceneConnect() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <motion.div {...fade(0.1)} className="w-[min(88%,460px)] overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[10px] text-ink-3 sm:text-xs">
          <span className="h-2 w-2 rounded-full bg-white/20" /> localhost:3100/profile
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm font-medium">Gmail</p>
          <motion.div initial={{ opacity: 1 }} animate={{ opacity: [1, 1, 0] }} transition={{ times: [0, 0.6, 1], duration: 2.4 }}
            className="inline-flex rounded-full px-4 py-2 text-xs font-medium text-[#04121f]" style={{ background: "var(--grad-cold)" }}>Connect Gmail</motion.div>
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.4 }} className="flex items-center gap-2 text-sm text-ok">
            ✓ Connected as you@gmail.com
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.2 }} className="grid grid-cols-3 gap-2 text-[10px] sm:text-xs">
            {["Replies 24/7", "Their-morning sends", "Notifications"].map((x) => <span key={x} className="rounded-lg bg-ember/10 px-2 py-1.5 text-center text-ember">{x}</span>)}
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

function SceneCloud() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
      <div className="flex items-center gap-4 sm:gap-8">
        <motion.div {...fade(0.2)} className="rounded-2xl border border-ember/40 bg-surface px-3 py-2 text-center">
          <p className="text-xs font-medium text-ember">Oracle Cloud</p><p className="text-[10px] text-ink-3">Always Free server</p>
        </motion.div>
        <motion.div className="h-px w-10 sm:w-20" style={{ background: "var(--grad-temp)" }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 1.6, duration: 0.6 }} />
        <motion.div {...fade(1.8)} className="rounded-2xl border border-ice/40 bg-surface px-3 py-2 text-center">
          <p className="text-xs font-medium text-ice">kold-you.duckdns.org</p><p className="text-[10px] text-ink-3">https · always on</p>
        </motion.div>
      </div>
      <Terminal title="One command" lines={[
        { text: "curl -fsSL …/deploy/setup.sh | sudo bash -s -- kold-you.duckdns.org", delay: 0.6 },
        { text: "Kold is installed and runs by itself", delay: 2.8, ok: true },
      ]} />
      <div className="flex gap-3">
        {[0, 1, 2].map((i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3.4 + i * 0.2 }} className="h-12 w-7 rounded-lg border border-ice/40 bg-[#0b0f19]">
            <motion.div className="mx-auto mt-4 h-1.5 w-1.5 rounded-full bg-ok" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
