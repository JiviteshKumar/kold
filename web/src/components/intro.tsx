"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { INTRO, isMuted, playIntro, unlockAudio } from "@/lib/sound";

/**
 * Kold's opening, about 4.8s, one continuous shot (no cuts). Every element and every sound runs off the same
 * clock (INTRO in lib/sound.ts), with one easing family, so motion and music land together.
 *
 *  0.00  dark; a point of frost light breathes in, air and a low D                 the cold
 *  0.45  six crystal arms grow out of the light, a glass pluck for each             your profile takes shape
 *  1.50  the crystal breathes in and brightens; a rising swell                      outreach is ready
 *  2.20  release: a comet leaves the core, loops out and back, ice turning amber    it goes out, a reply comes back
 *  3.00  it lands as the Kold mark with a soft ripple; a warm D major 9 chord       warm
 *  3.55  the mark lifts while "kold" rises into focus, a sparkle per letter         the brand
 *  4.75  the scene dissolves into the app
 */
const OUT: [number, number, number, number] = [0.16, 1, 0.3, 1]; // arrivals: fast start, long soft landing
const INOUT: [number, number, number, number] = [0.65, 0, 0.35, 1]; // transformations

// Out from the core, a loop to the right and round, back into the core from the left.
const COMET = "M100 100 C 128 70, 182 44, 176 96 C 170 148, 70 168, 44 124 C 26 90, 66 62, 100 100";

export function Intro({ onDone }: { onDone: () => void }) {
  const prefersReduced = useReducedMotion();
  // `?intro=full` previews the full animation even when the device asks for reduced motion.
  const reduce = prefersReduced && !(typeof location !== "undefined" && location.search.includes("intro=full"));
  const [run, setRun] = useState(0); // bumping it restarts the whole shot (used for "Tap for sound")
  const [started, setStarted] = useState(false);
  const [silent, setSilent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    (async () => {
      const soundOk = isMuted() || reduce ? true : await unlockAudio();
      if (cancelled) return;
      // Picture and sound start on the same frame.
      if (soundOk && !reduce) playIntro();
      setSilent(!soundOk);
      setStarted(true);
      timers.push(setTimeout(onDone, (reduce ? 1.8 : INTRO.end) * 1000));
    })();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [onDone, reduce, run]);

  const restartWithSound = async () => {
    if (!(await unlockAudio())) return;
    setStarted(false);
    setRun((r) => r + 1);
  };

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#03050a]"
      exit={{ opacity: 0, scale: 1.035, filter: "blur(8px)" }}
      transition={{ duration: 0.6, ease: INOUT }}
    >
      {started && (reduce ? <FinalFrame /> : <Shot key={run} />)}

      <button
        onClick={onDone}
        className="absolute bottom-[max(2rem,env(safe-area-inset-bottom))] right-6 rounded-full px-4 py-2 text-xs text-ink-3 transition hover:text-ink"
      >
        Skip
      </button>
      {silent && (
        <button
          onClick={restartWithSound}
          className="absolute bottom-[max(2rem,env(safe-area-inset-bottom))] left-6 rounded-full px-4 py-2 text-xs text-ink-3 hairline transition hover:text-ink"
        >
          ♪ Play with sound
        </button>
      )}
    </motion.div>
  );
}

function Shot() {
  const particles = useMemo(
    () => Array.from({ length: 30 }, (_, i) => {
      const r = (n: number) => Math.abs((Math.sin(i * n) * 43758.5453) % 1);
      return { x: r(12.9898) * 100, y: r(78.233) * 100, s: 1 + (i % 3) * 0.6, depth: 0.4 + r(3.7) * 0.8 };
    }),
    [],
  );
  const T = INTRO;

  return (
    <>
      {/* frost in the air: drifts the whole time (parallax by depth), dims as warmth arrives */}
      {particles.map((p, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-frost"
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s }}
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: [0, 0.55 * p.depth, 0.55 * p.depth, 0.12], y: -28 * p.depth }}
          transition={{
            opacity: { duration: T.arrive + 0.6, times: [0, 0.3, 0.75, 1], ease: "easeInOut", delay: (i % 7) * 0.05 },
            y: { duration: T.end + 0.6, ease: "linear" },
          }}
        />
      ))}

      {/* two glows that cross-fade, so cold turns warm gradually instead of switching */}
      <motion.div
        className="absolute h-[72vmin] w-[72vmin] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.42)_0%,rgba(125,211,252,0.1)_40%,transparent_70%)]"
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: [0, 0.32, 0.4, 0], scale: [0.6, 0.85, 0.7, 1.1] }}
        transition={{ duration: T.arrive + 0.4, times: [0, 0.35, 0.62, 1], ease: INOUT }}
      />
      <motion.div
        className="absolute h-[72vmin] w-[72vmin] rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.5)_0%,rgba(249,115,22,0.14)_40%,transparent_70%)]"
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: [0, 0.6, 0.48], scale: [0.7, 1.05, 1.15] }}
        transition={{ duration: T.end - T.release, delay: T.release + 0.3, times: [0, 0.4, 1], ease: OUT }}
      />

      <div className="relative flex flex-col items-center">
        <div className="relative h-40 w-40">
          <svg viewBox="0 0 200 200" className="pointer-events-none absolute -inset-16 h-[calc(100%+8rem)] w-[calc(100%+8rem)] overflow-visible">
            <defs>
              <linearGradient id="intro-ice" gradientUnits="userSpaceOnUse" x1="60" y1="60" x2="140" y2="140">
                <stop offset="0" stopColor="#e0f2fe" />
                <stop offset="1" stopColor="#38bdf8" />
              </linearGradient>
              <filter id="intro-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
            </defs>

            {/* the crystal: grows out of the light, turns slowly, then breathes in */}
            <motion.g
              initial={{ rotate: 0, scale: 1, opacity: 1 }}
              animate={{ rotate: [0, 0, 32, 44], scale: [1, 1, 1, 0.12], opacity: [1, 1, 1, 0] }}
              transition={{ duration: T.release, times: [0, T.arms / T.release, T.gather / T.release, 1], ease: ["linear", OUT, INOUT] }}
            >
              <g stroke="url(#intro-ice)" strokeWidth="2.4" strokeLinecap="round" fill="none">
                {[0, 60, 120, 180, 240, 300].map((deg, i) => (
                  <g key={deg} transform={`rotate(${deg} 100 100)`}>
                    <motion.path
                      d="M100 100 L100 62"
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 0.7, delay: T.arms + i * T.armStep, ease: OUT }}
                    />
                    <motion.path
                      d="M100 74 l-7 -7 M100 74 l7 -7"
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 0.45, delay: T.branches + i * 0.06, ease: OUT }}
                    />
                  </g>
                ))}
              </g>
            </motion.g>

            {/* the core: appears first, brightens as the crystal gathers into it, then lets go */}
            <motion.circle
              cx="100" cy="100" r="3.2" fill="#e0f2fe"
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{ opacity: [0, 1, 0.9, 1, 0], scale: [0.3, 1, 0.85, 2.1, 0.2] }}
              transition={{ duration: T.release + 0.25, times: [0, 0.2, T.gather / (T.release + 0.25), T.release / (T.release + 0.25) - 0.02, 1], ease: INOUT }}
            />
            <motion.circle
              cx="100" cy="100" r="9" fill="#7dd3fc" filter="url(#intro-glow)"
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{ opacity: [0, 0.7, 0.5, 0.95, 0], scale: [0.3, 1, 0.9, 2.2, 0.3] }}
              transition={{ duration: T.release + 0.25, times: [0, 0.2, T.gather / (T.release + 0.25), T.release / (T.release + 0.25) - 0.02, 1], ease: INOUT }}
            />

            {/* the comet: a faint wake, a soft glow and a bright head, warming from ice to amber as it travels */}
            <motion.path
              d={COMET} fill="none" strokeWidth="1.2" strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0, stroke: "#bae6fd" }}
              animate={{ pathLength: 1, opacity: [0, 0.35, 0.35, 0], stroke: ["#bae6fd", "#a78bfa", "#f59e0b"] }}
              transition={{
                pathLength: { duration: T.arrive - T.release, delay: T.release, ease: INOUT },
                opacity: { duration: T.arrive - T.release + 0.6, delay: T.release, times: [0, 0.1, 0.6, 1] },
                stroke: { duration: T.arrive - T.release, delay: T.release, ease: "linear" },
              }}
            />
            {[{ w: 9, o: 0.55, f: "url(#intro-glow)" }, { w: 3, o: 1, f: undefined }].map((s) => (
              <motion.path
                key={s.w}
                d={COMET} fill="none" strokeWidth={s.w} strokeLinecap="round" filter={s.f}
                initial={{ pathLength: 0.16, pathOffset: 0, opacity: 0, stroke: "#e0f2fe" }}
                animate={{ pathOffset: 0.84, opacity: [0, s.o, s.o, 0], stroke: ["#e0f2fe", "#a78bfa", "#fbbf24"] }}
                transition={{
                  pathOffset: { duration: T.arrive - T.release, delay: T.release, ease: INOUT },
                  opacity: { duration: T.arrive - T.release + 0.15, delay: T.release, times: [0, 0.08, 0.85, 1] },
                  stroke: { duration: T.arrive - T.release, delay: T.release, ease: "linear" },
                }}
              />
            ))}

            {/* the landing ripple */}
            <motion.circle
              cx="100" cy="100" r="34" fill="none" stroke="#f59e0b" strokeWidth="1.2"
              initial={{ opacity: 0, scale: 0.55 }}
              animate={{ opacity: [0, 0.7, 0], scale: [0.55, 0.75, 2] }}
              transition={{ duration: 1.1, delay: T.arrive - 0.05, times: [0, 0.12, 1], ease: OUT }}
            />
          </svg>

          {/* the mark it becomes: focuses in (no bounce), holds, then lifts to sit above the name */}
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0, scale: 0.82, y: 0, filter: "blur(10px)" }}
            animate={{ opacity: [0, 1, 1], scale: [0.82, 1, 0.56], y: [0, 0, -58], filter: ["blur(10px)", "blur(0px)", "blur(0px)"] }}
            transition={{ duration: T.lift + 0.5 - T.arrive, delay: T.arrive, times: [0, (T.lift - T.arrive) / (T.lift + 0.5 - T.arrive), 1], ease: [OUT, INOUT] }}
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
        </div>

        <Wordmark animate />
      </div>
    </>
  );
}

function Wordmark({ animate }: { animate?: boolean }) {
  const T = INTRO;
  return (
    <>
      <div className="mt-2 flex h-20 items-end" aria-label="kold">
        {["k", "o", "l", "d"].map((l, i) => (
          <motion.span
            key={i}
            className={`text-7xl font-semibold tracking-[-0.06em] ${i === 1 ? "text-warm" : "text-ink"}`}
            initial={animate ? { y: 36, opacity: 0, filter: "blur(12px)" } : false}
            animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.75, delay: animate ? T.letters + i * T.letterStep : 0, ease: OUT }}
          >
            {l}
          </motion.span>
        ))}
      </div>
      <motion.p
        className="mt-3 max-w-[90vw] px-4 text-center text-xs text-ink-2 uppercase sm:text-sm"
        initial={animate ? { opacity: 0, letterSpacing: "0.42em" } : false}
        animate={{ opacity: 1, letterSpacing: "0.26em" }}
        transition={{ duration: 0.9, delay: animate ? T.tagline : 0, ease: OUT }}
      >
        Cold outreach · Warm replies
      </motion.p>
    </>
  );
}

/** Reduced motion: the finished lockup, gently faded in. */
function FinalFrame() {
  return (
    <motion.div className="flex flex-col items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
      <div className="h-14 w-14 rounded-[18px] bg-gradient-to-br from-[#fde68a] via-[#f59e0b] to-[#f97316] p-[2px]">
        <div className="flex h-full w-full items-center justify-center rounded-[16px] bg-[#0b0f19]">
          <svg viewBox="0 0 64 64" className="h-9 w-9">
            <g stroke="#f59e0b" strokeWidth="3.4" strokeLinecap="round" fill="none">
              <path d="M32 12v40" /><path d="M14.7 22l34.6 20" /><path d="M49.3 22L14.7 42" /><path d="M18 32l14 8 14-8" />
            </g>
          </svg>
        </div>
      </div>
      <Wordmark />
    </motion.div>
  );
}
