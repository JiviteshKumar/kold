"use client";

/**
 * Kold's sound design, synthesized live with the Web Audio API (no audio files, no licensing).
 * Palette follows the brand story: crystalline "ice" tones for discovery, warm major chords for good news.
 */

type Cue = "intro" | "tap" | "like" | "pass" | "send" | "success" | "warm" | "error" | "whoosh";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const KEY = "kold:muted";

export function isMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(m: boolean) {
  try {
    localStorage.setItem(KEY, m ? "1" : "0");
  } catch {}
  if (master) master.gain.value = m ? 0 : 0.55;
}

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = isMuted() ? 0 : 0.55;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, opts: { type?: OscillatorType; gain?: number; attack?: number; detune?: number; to?: number } = {}) {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
  if (opts.detune) osc.detune.value = opts.detune;
  const peak = opts.gain ?? 0.2;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(start: number, dur: number, opts: { from?: number; to?: number; gain?: number; q?: number } = {}) {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + start;
  const len = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = opts.q ?? 1.2;
  f.frequency.setValueAtTime(opts.from ?? 400, t0);
  f.frequency.exponentialRampToValueAtTime(opts.to ?? 4000, t0 + dur);
  const g = c.createGain();
  const peak = opts.gain ?? 0.15;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + dur * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur);
}

export function play(cue: Cue) {
  if (isMuted()) return;
  switch (cue) {
    case "intro": {
      // 0.0s sub swell (the cold) → 0.7s crystal shimmer → 1.7s whoosh (the email flies) → 3.1s warm chord (the reply)
      tone(55, 0, 2.2, { gain: 0.25, attack: 1.2, type: "sine" });
      tone(82.4, 0.2, 2.0, { gain: 0.08, attack: 1.0, type: "triangle" });
      [2093, 2637, 3136, 3951, 4699].forEach((f, i) => tone(f, 0.7 + i * 0.09, 1.4, { gain: 0.035, attack: 0.005 }));
      noise(1.7, 0.75, { from: 300, to: 6000, gain: 0.12, q: 0.8 });
      [261.63, 329.63, 392.0, 493.88].forEach((f, i) => {
        tone(f, 3.1 + i * 0.05, 1.8, { gain: 0.09, attack: 0.08, type: "triangle" });
        tone(f * 2, 3.1 + i * 0.05, 1.4, { gain: 0.03, attack: 0.08, detune: 6 });
      });
      tone(130.81, 3.1, 1.9, { gain: 0.12, attack: 0.1 });
      break;
    }
    case "tap":
      tone(1800, 0, 0.05, { gain: 0.04, type: "triangle" });
      break;
    case "like":
      tone(659.25, 0, 0.18, { gain: 0.12, type: "triangle" });
      tone(987.77, 0.07, 0.28, { gain: 0.1, type: "triangle" });
      break;
    case "pass":
      noise(0, 0.18, { from: 900, to: 200, gain: 0.08, q: 2 });
      tone(196, 0, 0.12, { gain: 0.06 });
      break;
    case "whoosh":
      noise(0, 0.45, { from: 400, to: 5000, gain: 0.1, q: 0.9 });
      break;
    case "send":
      noise(0, 0.5, { from: 300, to: 7000, gain: 0.1, q: 0.8 });
      tone(1318.5, 0.32, 0.6, { gain: 0.07 });
      tone(1975.5, 0.38, 0.7, { gain: 0.04 });
      break;
    case "success":
      [523.25, 659.25, 783.99].forEach((f, i) => tone(f, i * 0.08, 0.5, { gain: 0.09, type: "triangle" }));
      break;
    case "warm":
      [392, 493.88, 587.33, 783.99].forEach((f, i) => tone(f, i * 0.09, 0.9, { gain: 0.09, type: "triangle" }));
      tone(196, 0, 1.2, { gain: 0.08 });
      break;
    case "error":
      tone(220, 0, 0.18, { gain: 0.08, type: "square", to: 180 });
      break;
  }
}
