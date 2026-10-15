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

// ---------------------------------------------------------------------------------------------- intro score
// Everything the intro plays shares one room (a soft synthetic reverb) and one key (D major), so the cues read as
// a single piece of music rather than separate effects.
let room: ConvolverNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function reverb(c: AudioContext): AudioNode {
  if (!room) {
    room = c.createConvolver();
    const len = Math.floor(c.sampleRate * 2.6);
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.4);
    }
    room.buffer = ir;
    const wet = c.createGain();
    wet.gain.value = 0.32;
    room.connect(wet).connect(master!);
  }
  return room;
}

function noiseSource(c: AudioContext): AudioBufferSourceNode {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}

/** A voice's way out: dry to the master, plus a send to the room. */
function bus(c: AudioContext, wet: number, pan?: StereoPannerNode): GainNode {
  const g = c.createGain();
  const head: AudioNode = pan ? (g.connect(pan), pan) : g;
  head.connect(master!);
  if (wet) {
    const send = c.createGain();
    send.gain.value = wet;
    head.connect(send).connect(reverb(c));
  }
  return g;
}

/** Glass: a sine with two inharmonic partials that die away faster, like a struck crystal. */
function glass(c: AudioContext, t: number, f: number, gain: number, wet = 0.55, decay = 1.6) {
  [[1, 1, decay], [2.76, 0.32, decay * 0.45], [5.4, 0.1, decay * 0.22]].forEach(([mul, amp, d]) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = f * mul;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * amp, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(bus(c, wet));
    o.start(t);
    o.stop(t + d + 0.05);
  });
}

/** A warm analog-style pad: detuned saws through a low-pass filter that opens as the chord swells. */
function pad(c: AudioContext, t: number, freqs: number[], gain: number, attack: number, dur: number) {
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 0.7;
  lp.frequency.setValueAtTime(380, t);
  lp.frequency.exponentialRampToValueAtTime(2600, t + attack + 0.4);
  lp.frequency.exponentialRampToValueAtTime(900, t + dur);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  lp.connect(env).connect(bus(c, 0.6));
  for (const f of freqs) {
    for (const cents of [-7, 7]) {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
}

/** Filtered noise with a moving centre frequency, level and (optionally) stereo position. */
function air(c: AudioContext, t: number, dur: number, o: { f: [number, number][]; g: [number, number][]; q?: number; pan?: [number, number][]; wet?: number }) {
  const src = noiseSource(c);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = o.q ?? 0.9;
  o.f.forEach(([at, v], i) => (i ? bp.frequency.exponentialRampToValueAtTime(v, t + at) : bp.frequency.setValueAtTime(v, t + at)));
  const g = c.createGain();
  o.g.forEach(([at, v], i) => (i ? g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0001), t + at) : g.gain.setValueAtTime(Math.max(v, 0.0001), t + at)));
  let panner: StereoPannerNode | undefined;
  if (o.pan && c.createStereoPanner) {
    panner = c.createStereoPanner();
    o.pan.forEach(([at, v], i) => (i ? panner!.pan.linearRampToValueAtTime(v, t + at) : panner!.pan.setValueAtTime(v, t + at)));
  }
  src.connect(bp).connect(g).connect(bus(c, o.wet ?? 0.4, panner));
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur);
}

function sine(c: AudioContext, t: number, f: number, gain: number, attack: number, dur: number, to?: number, wet = 0.2) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus(c, wet));
  o.start(t);
  o.stop(t + dur + 0.05);
}

/**
 * The intro's score, on the same clock as components/intro.tsx (INTRO in seconds). Returns false if the browser
 * hasn't allowed sound yet (no tap on the page so far), so the intro can offer "Tap for sound".
 */
export function playIntro(): boolean {
  if (isMuted()) return true;
  const c = ac();
  if (!c || c.state !== "running" || !master) return false;
  const t = c.currentTime + 0.03;
  const D2 = 73.42;
  // 0.0  the cold: a breath of air and a low D
  air(c, t, 2.4, { f: [[0, 500], [2.4, 900]], g: [[0, 0.0001], [0.9, 0.05], [2.4, 0.0001]], q: 0.6, wet: 0.7 });
  sine(c, t, D2, 0.16, 0.9, 2.3);
  // 0.45  each crystal arm grows with a glassy pluck, rising through D major pentatonic
  [1174.66, 1318.51, 1479.98, 1760, 1975.53, 2349.32].forEach((f, i) => glass(c, t + INTRO.arms + i * INTRO.armStep, f, 0.05));
  // 1.45  the crystal breathes in: a rising swell that stops exactly at the release
  air(c, t + INTRO.gather - 0.05, INTRO.release - INTRO.gather + 0.1, { f: [[0, 220], [INTRO.release - INTRO.gather, 2800]], g: [[0, 0.0001], [INTRO.release - INTRO.gather - 0.02, 0.09], [INTRO.release - INTRO.gather + 0.08, 0.0001]], q: 1.1, wet: 0.3 });
  sine(c, t + INTRO.gather, 293.66, 0.035, 0.5, INTRO.release - INTRO.gather + 0.05, 587.33);
  // 2.2  release: a soft low pulse, then the comet's whoosh travelling across the stereo field with it
  sine(c, t + INTRO.release, 146.83, 0.12, 0.01, 0.35, 73.42, 0.3);
  const fly = INTRO.arrive - INTRO.release;
  air(c, t + INTRO.release, fly + 0.25, {
    f: [[0, 600], [fly * 0.45, 2600], [fly + 0.25, 800]],
    g: [[0, 0.0001], [fly * 0.35, 0.11], [fly, 0.05], [fly + 0.25, 0.0001]],
    pan: [[0, 0], [fly * 0.3, 0.75], [fly * 0.7, -0.65], [fly, 0]],
    q: 0.8, wet: 0.45,
  });
  // 3.0  arrival: the warm chord (D major 9) blooms, with a bell on top and the low D underneath
  pad(c, t + INTRO.arrive, [146.83, 220, 277.18, 329.63, 369.99], 0.05, 0.3, 2.6);
  sine(c, t + INTRO.arrive, D2, 0.13, 0.15, 2.4);
  glass(c, t + INTRO.arrive, 880, 0.06, 0.7, 2.2);
  glass(c, t + INTRO.arrive + 0.05, 1174.66, 0.035, 0.7, 2.0);
  // 3.6  a tiny sparkle as each letter of "kold" comes into focus
  [1479.98, 1760, 1975.53, 2349.32].forEach((f, i) => glass(c, t + INTRO.letters + i * INTRO.letterStep + 0.03, f, 0.014, 0.7, 0.9));
  return true;
}

/** The intro's timeline in seconds, shared by the animation and the score. */
export const INTRO = { arms: 0.45, armStep: 0.08, branches: 0.85, gather: 1.5, release: 2.2, arrive: 3.0, lift: 3.55, letters: 3.6, letterStep: 0.06, tagline: 3.9, end: 4.75 };

/** Asks the browser to start audio. Resolves true if sound can play now (after a tap it always can). */
export async function unlockAudio(): Promise<boolean> {
  const c = ac();
  if (!c) return false;
  if (c.state === "running") return true;
  await Promise.race([c.resume().catch(() => {}), new Promise((r) => setTimeout(r, 80))]);
  return (c.state as AudioContextState) === "running"; // re-read: resume() may have changed it
}

export function play(cue: Cue) {
  if (isMuted()) return;
  switch (cue) {
    case "intro":
      playIntro();
      break;
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
