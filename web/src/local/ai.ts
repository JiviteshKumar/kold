"use client";

/**
 * On-device AI for Kold Lite (WebGPU via WebLLM). The model downloads once, with the user's consent, and then runs
 * entirely on their phone or laptop; no text ever leaves the device. If the device can't run it, Kold's
 * research-based writer works on its own and drafts are labelled accordingly.
 */
import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import { kvGet, kvSet } from "./db";

export type Tier = "best" | "balanced" | "light";
export const TIERS: Record<Tier, { label: string; f16: string; f32: string; approxGB: number; note: string }> = {
  best: { label: "Best quality", f16: "Qwen3.5-4B-q4f16_1-MLC", f32: "Qwen3.5-4B-q4f32_1-MLC", approxGB: 2.4, note: "Laptops and desktops" },
  balanced: { label: "Balanced", f16: "Qwen3.5-2B-q4f16_1-MLC", f32: "Qwen3.5-2B-q4f32_1-MLC", approxGB: 1.3, note: "Most recent phones" },
  light: { label: "Light", f16: "Qwen3.5-0.8B-q4f16_1-MLC", f32: "Qwen3.5-0.8B-q4f32_1-MLC", approxGB: 0.6, note: "Older phones" },
};

export type AiStatus = {
  supported: boolean;
  reason?: string;
  recommended: Tier;
  chosen: Tier | null;   // what the user agreed to download
  ready: boolean;        // loaded in memory now
  loading: boolean;
  progress: number;      // 0..1 while loading
  progressText: string;
};

let engine: MLCEngineInterface | null = null;
let loading: Promise<void> | null = null;
const status: AiStatus = { supported: false, recommended: "light", chosen: null, ready: false, loading: false, progress: 0, progressText: "" };
const listeners = new Set<(s: AiStatus) => void>();
let f16 = false;

function emit() {
  listeners.forEach((f) => f({ ...status }));
}

export function onAiStatus(f: (s: AiStatus) => void): () => void {
  listeners.add(f);
  f({ ...status });
  return () => listeners.delete(f);
}

export async function detect(): Promise<AiStatus> {
  status.chosen = await kvGet<Tier | null>("ai.tier", null);
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<{ features: Set<string>; limits: { maxBufferSize: number } } | null> } }).gpu;
  if (!gpu) {
    status.supported = false;
    status.reason = "This browser doesn't support on-device AI (WebGPU). Kold's built-in writer still works.";
    emit();
    return { ...status };
  }
  const adapter = await gpu.requestAdapter().catch(() => null);
  if (!adapter) {
    status.supported = false;
    status.reason = "No compatible graphics chip found for on-device AI. Kold's built-in writer still works.";
    emit();
    return { ...status };
  }
  f16 = adapter.features.has("shader-f16");
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? (mobile ? 4 : 8);
  status.supported = true;
  status.recommended = !mobile && mem >= 8 ? "best" : mem >= 6 ? "balanced" : "light";
  emit();
  return { ...status };
}

function modelFor(tier: Tier): string {
  return f16 ? TIERS[tier].f16 : TIERS[tier].f32;
}

/** Download (first time) and load the model. Only call after the user agreed to the download size. */
export async function load(tier: Tier): Promise<void> {
  if (engine && status.chosen === tier && status.ready) return;
  if (loading) return loading;
  status.loading = true;
  status.chosen = tier;
  await kvSet("ai.tier", tier);
  emit();
  loading = (async () => {
    try {
      const { CreateWebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
      const worker = new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });
      engine = await CreateWebWorkerMLCEngine(worker, modelFor(tier), {
        initProgressCallback: (p) => {
          status.progress = p.progress;
          status.progressText = p.text;
          emit();
        },
      });
      status.ready = true;
    } catch (e) {
      engine = null;
      status.ready = false;
      status.reason = `Couldn't start on-device AI: ${(e as Error).message?.slice(0, 160)}`;
      throw e;
    } finally {
      status.loading = false;
      loading = null;
      emit();
    }
  })();
  return loading;
}

/** Load the previously chosen model in the background (it's cached on the device after the first download). */
export async function resume(): Promise<void> {
  const s = await detect();
  if (s.supported && s.chosen && !s.ready) await load(s.chosen).catch(() => {});
}

export async function forget(): Promise<void> {
  await kvSet("ai.tier", null);
  status.chosen = null;
  status.ready = false;
  engine = null;
  try {
    const { deleteModelAllInfoInCache } = await import("@mlc-ai/web-llm");
    for (const t of Object.keys(TIERS) as Tier[]) {
      await deleteModelAllInfoInCache(TIERS[t].f16).catch(() => {});
      await deleteModelAllInfoInCache(TIERS[t].f32).catch(() => {});
    }
  } catch {}
  emit();
}

export const aiReady = () => !!engine && status.ready;
export const aiLabel = () => (status.chosen ? `on-device AI (${TIERS[status.chosen].label})` : "");

function clean(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export async function generate(system: string, prompt: string, opts: { temperature?: number; maxTokens?: number } = {}): Promise<string | null> {
  if (!engine) return null;
  try {
    const r = await engine.chat.completions.create({
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 500,
      extra_body: { enable_thinking: false },
    } as Parameters<MLCEngineInterface["chat"]["completions"]["create"]>[0]);
    return clean((r as { choices: { message: { content: string } }[] }).choices[0]?.message?.content ?? "");
  } catch {
    return null;
  }
}

export async function generateJson<T>(system: string, prompt: string, schema: object, opts: { temperature?: number; maxTokens?: number } = {}): Promise<T | null> {
  if (!engine) return null;
  try {
    const r = await engine.chat.completions.create({
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 900,
      response_format: { type: "json_object", schema: JSON.stringify(schema) },
      extra_body: { enable_thinking: false },
    } as Parameters<MLCEngineInterface["chat"]["completions"]["create"]>[0]);
    const text = clean((r as { choices: { message: { content: string } }[] }).choices[0]?.message?.content ?? "");
    const m = text.match(/\{[\s\S]*\}/);
    return m ? (JSON.parse(m[0]) as T) : null;
  } catch {
    return null;
  }
}
