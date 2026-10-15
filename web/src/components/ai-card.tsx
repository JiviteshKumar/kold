"use client";

import { useEffect, useState } from "react";
import { Cpu, Download, Trash2 } from "lucide-react";
import clsx from "clsx";
import { Button, Card, useToast } from "./ui";
import type { AiStatus, Tier } from "@/local/ai";

/** Kold Lite: download and manage the on-device AI (only with the user's consent; sizes shown up front). */
export function AiCard() {
  const toast = useToast();
  const [s, setS] = useState<AiStatus | null>(null);
  const [tiers, setTiers] = useState<Record<Tier, { label: string; approxGB: number; note: string }> | null>(null);
  const [pick, setPick] = useState<Tier | null>(null);

  useEffect(() => {
    let off = () => {};
    import("@/local/ai").then((m) => {
      setTiers(m.TIERS);
      off = m.onAiStatus(setS);
      void m.detect();
    });
    return () => off();
  }, []);

  const tier = pick ?? s?.chosen ?? s?.recommended ?? "light";
  const start = async () => {
    try {
      const m = await import("@/local/ai");
      await m.load(tier);
      toast("On-device AI ready. Drafts will be polished on this device.", "ok");
    } catch (e) {
      toast((e as Error).message?.slice(0, 160) || "Couldn't start on-device AI", "bad");
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <Cpu size={18} className="text-violet" />
        <h2 className="flex-1 font-medium">On-device AI</h2>
        {s?.ready && <span className="rounded-full bg-ok/15 px-2.5 py-0.5 text-xs text-ok">Ready</span>}
      </div>
      <p className="mt-2 text-sm text-ink-2">
        Polishes your emails, reads tricky replies and tailors resumes, privately on this device: nothing you write leaves it. Kold&apos;s
        built-in writer works without it; the AI only polishes, and every polished draft is checked against your resume.
      </p>
      {!s ? null : !s.supported ? (
        <p className="mt-3 rounded-xl bg-white/[0.03] p-3 text-sm text-ink-3">{s.reason}</p>
      ) : (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {tiers && (Object.keys(tiers) as Tier[]).map((t) => (
              <button key={t} onClick={() => setPick(t)} disabled={s.loading}
                className={clsx("rounded-xl p-3 text-left text-sm transition hairline", tier === t ? "bg-violet/15 shadow-[inset_0_0_0_1px_rgba(167,139,250,0.5)]" : "bg-white/[0.02] hover:bg-white/[0.05]")}>
                <p className="font-medium">{tiers[t].label}{t === s.recommended && <span className="ml-1 text-xs text-ok">· recommended</span>}</p>
                <p className="text-xs text-ink-3">about {tiers[t].approxGB} GB · {tiers[t].note}</p>
              </button>
            ))}
          </div>
          {s.loading ? (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(s.progress * 100)}%`, background: "var(--grad-cold)" }} />
              </div>
              <p className="mt-2 text-xs text-ink-3">{s.progressText || "Preparing…"} Keep this tab open; it only downloads once.</p>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              {!(s.ready && s.chosen === tier) && (
                <Button variant="primary" onClick={start}><Download size={15} /> {s.chosen === tier ? "Load AI" : `Download (about ${tiers?.[tier].approxGB} GB, once)`}</Button>
              )}
              {s.chosen && (
                <Button variant="ghost" onClick={async () => { (await import("@/local/ai")).forget(); toast("AI removed from this device", "info"); }}>
                  <Trash2 size={15} /> Remove from device
                </Button>
              )}
            </div>
          )}
          <p className="mt-3 text-xs text-ink-3">Tip: use Wi-Fi. Large downloads can be slow on mobile data.</p>
        </>
      )}
    </Card>
  );
}
