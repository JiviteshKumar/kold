"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { play } from "@/lib/sound";

/**
 * Kold's 4.6s opening. Storyboard:
 *  0.0s  darkness, a single frost point of light, sub-bass swell        (the cold)
 *  0.6s  an ice crystal draws itself, crystalline shimmer                 (your resume, your profile)
 *  1.7s  the crystal folds into an envelope and flies off with a whoosh   (outreach goes out)
 *  2.4s  its trail curves back and warms from ice-blue to amber           (a reply comes back)
 *  3.1s  "kold" rises letter by letter on a warm chord + tagline          (cold outreach, warm replies)
 *  4.3s  the scene lifts away into the product
 */
export function Intro({ onDone }: { onDone: () => void }) {
  const prefersReduced = useReducedMotion();
  // `?intro=full` previews the full animation even when the device asks for reduced motion.
  const reduce = prefersReduced && !(typeof location !== "undefined" && location.search.includes("intro=full"));
  const [stage, setStage] = useState(0);
  const [needsTap, setNeedsTap] = useState(false);

  const particles = useMemo(
    () => Array.from({ length: 26 }, (_, i) => ({
      x: (Math.sin(i * 12.9898) * 43758.5453) % 1,
      y: (Math.sin(i * 78.233) * 12345.678) % 1,
      s: 1 + (i % 3),
      d: 2 + (i % 5) * 0.4,
    })),
    [],
  );

  useEffect(() => {
    if (reduce) {
      // Reduced motion: a calm, static reveal of the final frame instead of the animated story.
      const timers = [setTimeout(() => setStage(4), 0), setTimeout(onDone, 1800)];
      return () => timers.forEach(clearTimeout);
    }
    // Browsers block audio until a user gesture; try anyway, and offer a tap-to-hear if blocked.
    const timers = [
      setTimeout(() => {
        try {
          play("intro");
          const probe = new AudioContext();
          setNeedsTap(probe.state === "suspended");
          void probe.close();
        } catch {}
      }, 0),
      setTimeout(() => setStage(1), 600),
      setTimeout(() => setStage(2), 1700),
      setTimeout(() => setStage(3), 2400),
      setTimeout(() => setStage(4), 3100),
      setTimeout(onDone, 4600),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onDone, reduce]);

  const letters = ["k", "o", "l", "d"];

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#03050a]"
      exit={{ opacity: 0, scale: 1.04, filter: "blur(6px)" }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      onClick={() => {
        if (needsTap) {
          setNeedsTap(false);
          play("warm");
        }
      }}
    >
      {/* drifting frost */}
      {particles.map((p, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-frost"
          style={{ left: `${50 + p.x * 50}%`, top: `${50 + p.y * 50}%`, width: p.s, height: p.s }}
          initial={{ opacity: 0 }}
          animate={{ opacity: stage >= 1 ? [0, 0.7, 0.2] : 0, y: [-6, 6] }}
          transition={{ duration: p.d, repeat: Infinity, repeatType: "mirror", delay: i * 0.03 }}
        />
      ))}

      {/* heat bloom, cold → warm */}
      <motion.div
        className="absolute h-[70vmin] w-[70vmin] rounded-full"
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{
          opacity: stage >= 3 ? 0.55 : stage >= 1 ? 0.25 : 0,
          scale: stage >= 3 ? 1.1 : 0.7,
          background: stage >= 3
            ? "radial-gradient(circle, rgba(245,158,11,0.45) 0%, rgba(249,115,22,0.15) 40%, transparent 70%)"
            : "radial-gradient(circle, rgba(56,189,248,0.45) 0%, rgba(125,211,252,0.12) 40%, transparent 70%)",
        }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      />

      <div className="relative flex flex-col items-center">
        <div className="relative h-40 w-40">
          {/* point of light */}
          <motion.div
            className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-frost shadow-[0_0_30px_8px_rgba(125,211,252,0.7)]"
            animate={{ opacity: stage === 0 ? [0, 1] : 0, scale: stage === 0 ? [0.2, 1.4] : 0 }}
            transition={{ duration: 0.6 }}
          />

          {/* crystal → envelope */}
          <motion.svg
            viewBox="0 0 100 100"
            className="absolute inset-0"
            animate={
              stage >= 2
                ? { x: [0, -10, 260], y: [0, 6, -240], rotate: [0, -8, 18], scale: [1, 0.8, 0.25], opacity: [1, 1, 0] }
                : { x: 0, y: 0, rotate: stage >= 1 ? 30 : 0, scale: 1, opacity: 1 }
            }
            transition={stage >= 2 ? { duration: 0.75, ease: [0.6, 0, 0.3, 1], times: [0, 0.25, 1] } : { duration: 1.1, ease: "easeOut" }}
          >
            <defs>
              <linearGradient id="ice" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="100">
                <stop offset="0" stopColor="#e0f2fe" />
                <stop offset="1" stopColor="#38bdf8" />
              </linearGradient>
            </defs>
            <g stroke="url(#ice)" strokeWidth="2.4" strokeLinecap="round" fill="none">
              {[0, 60, 120].map((r) => (
                <g key={r} transform={`rotate(${r} 50 50)`}>
                  <motion.path
                    d="M50 14 L50 86"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: stage >= 1 ? 1 : 0, opacity: stage >= 2 ? 0 : 1 }}
                    transition={{ duration: 0.8, delay: r / 400 }}
                  />
                  {[24, 76].map((y) => (
                    <motion.path
                      key={y}
                      d={`M50 ${y} l-7 ${y < 50 ? -7 : 7} M50 ${y} l7 ${y < 50 ? -7 : 7}`}
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: stage >= 1 ? 1 : 0, opacity: stage >= 2 ? 0 : 1 }}
                      transition={{ duration: 0.5, delay: 0.35 + r / 400 }}
                    />
                  ))}
                </g>
              ))}
              {/* the envelope it folds into */}
              <motion.rect
                x="22" y="32" width="56" height="38" rx="6"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: stage >= 1 ? 1 : 0, opacity: stage >= 1 ? (stage >= 2 ? 1 : 0.0) : 0 }}
                transition={{ duration: 0.3 }}
              />
              <motion.path
                d="M22 36 L50 56 L78 36"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: stage >= 2 ? 1 : 0, opacity: stage >= 2 ? 1 : 0 }}
                transition={{ duration: 0.25 }}
              />
            </g>
          </motion.svg>

          {/* the trail that comes back warm */}
          <svg viewBox="0 0 200 200" className="pointer-events-none absolute -inset-16 h-[calc(100%+8rem)] w-[calc(100%+8rem)]">
            <defs>
              <linearGradient id="trail" gradientUnits="userSpaceOnUse" x1="200" y1="0" x2="0" y2="200">
                <stop offset="0" stopColor="#7dd3fc" />
                <stop offset="0.5" stopColor="#a78bfa" />
                <stop offset="1" stopColor="#f59e0b" />
              </linearGradient>
            </defs>
            <motion.path
              d="M190 10 C 150 30, 40 40, 60 110 S 140 150, 100 100"
              stroke="url(#trail)"
              strokeWidth="2.2"
              strokeLinecap="round"
              fill="none"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: stage >= 3 ? 1 : 0, opacity: stage >= 4 ? 0 : stage >= 3 ? 1 : 0 }}
              transition={{ pathLength: { duration: 0.7, ease: "easeInOut" }, opacity: { duration: 0.4 } }}
            />
          </svg>

          {/* the warm reply lands: mark */}
          <AnimatePresence>
            {stage >= 3 && (
              <motion.div
                className="absolute inset-0 flex items-center justify-center"
                initial={{ scale: 0.3, opacity: 0, rotate: -20 }}
                animate={{ scale: stage >= 4 ? 0.55 : 1, opacity: 1, rotate: 0, y: stage >= 4 ? -58 : 0 }}
                transition={{ type: "spring", stiffness: 160, damping: 16 }}
              >
                <div className="h-24 w-24 rounded-[28px] bg-gradient-to-br from-[#fde68a] via-[#f59e0b] to-[#f97316] p-[2px] shadow-[0_0_60px_-10px_rgba(245,158,11,0.8)]">
                  <div className="flex h-full w-full items-center justify-center rounded-[26px] bg-[#0b0f19]">
                    <svg viewBox="0 0 64 64" className="h-14 w-14">
                      <g stroke="#f59e0b" strokeWidth="3.4" strokeLinecap="round" fill="none">
                        <path d="M32 12v40" /><path d="M14.7 22l34.6 20" /><path d="M49.3 22L14.7 42" />
                        <path d="M18 32l14 8 14-8" />
                      </g>
                    </svg>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* wordmark */}
        <div className="mt-2 flex h-20 items-end overflow-hidden" aria-label="kold">
          {letters.map((l, i) => (
            <motion.span
              key={i}
              className={`text-7xl font-semibold tracking-[-0.06em] ${i === 1 ? "text-warm" : "text-ink"}`}
              initial={{ y: 90, opacity: 0, filter: "blur(12px)" }}
              animate={stage >= 4 ? { y: 0, opacity: 1, filter: "blur(0px)" } : {}}
              transition={{ type: "spring", stiffness: 220, damping: 20, delay: i * 0.07 }}
            >
              {l}
            </motion.span>
          ))}
        </div>
        <motion.p
          className="mt-3 max-w-[90vw] px-4 text-center text-xs tracking-[0.18em] text-ink-2 uppercase sm:text-sm sm:tracking-[0.3em]"
          initial={{ opacity: 0, y: 8 }}
          animate={stage >= 4 ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.35 }}
        >
          Cold outreach · Warm replies
        </motion.p>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onDone();
        }}
        className="absolute bottom-[max(2rem,env(safe-area-inset-bottom))] right-6 rounded-full px-4 py-2 text-xs text-ink-3 transition hover:text-ink"
      >
        Skip
      </button>
      {needsTap && (
        <span className="absolute bottom-[max(2rem,env(safe-area-inset-bottom))] left-6 text-xs text-ink-3">Tap for sound</span>
      )}
    </motion.div>
  );
}
