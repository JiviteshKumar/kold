"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { Check, Copy, ExternalLink, Minus } from "lucide-react";
import { Explainer } from "@/components/explainer";
import { Card, useToast } from "@/components/ui";
import { play } from "@/lib/sound";

const ROWS: [string, boolean | string, boolean | string][] = [
  ["Find genuine jobs (refreshed daily)", true, true],
  ["Swipe, match reasons, trust checks", true, true],
  ["Tailored resume + email drafts", true, true],
  ["You approve every email", true, true],
  ["AI writing", "On your device", "Larger model on your computer"],
  ["Collect replies", "When you open Kold", "Every 10 minutes, 24/7"],
  ["Send at the recipient's morning", false, true],
  ["Instant reply notifications", false, true],
  ["Contacts from company websites", "Daily list + job posts", "Searches each company's site"],
  ["Use on several devices", "One device (data stays on it)", "Any device, same account"],
  ["Cost", "Free", "Free (your PC or Oracle's free server)"],
];

const STEPS = [
  { title: "Install the tools (once)", body: "Python 3.12+, Node.js 20+, and Ollama (ollama.com) for the private AI.", cmd: "ollama pull qwen3.5:4b" },
  { title: "Download Kold", body: "It's free and open source.", cmd: "git clone https://github.com/JiviteshKumar/kold.git" },
  { title: "Start the server", body: "In a terminal, inside the kold folder:", cmd: "cd kold/api && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt && .venv/Scripts/python -m uvicorn kold.main:app --port 8000" },
  { title: "Start the app", body: "In a second terminal:", cmd: "cd kold/web && npm install && npm run dev -- -p 3100" },
  { title: "Open it and connect Gmail", body: "Open http://localhost:3100, upload your resume, and connect Gmail from Profile (setup steps for Google sign-in are in the README).", cmd: "" },
  { title: "Optional: put it online for free", body: "So it runs 24/7 without your computer: create Oracle Cloud's Always Free server, then run this one command on it (full guide in the README).", cmd: "curl -fsSL https://raw.githubusercontent.com/JiviteshKumar/kold/main/deploy/setup.sh | sudo bash -s -- your-name.duckdns.org" },
];

export default function FullVersionPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 md:px-8 md:pt-10">
      <p className="text-xs font-medium tracking-[0.2em] text-ice uppercase">Kold Full</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] md:text-4xl">Use Kold to its fullest.</h1>
      <p className="mt-2 text-ink-2">You&apos;re using <b className="text-ink">Kold Lite</b>: it runs entirely on this device, free, nothing to install. The full version runs on your own computer (or a free cloud server), so it works in the background even when your phone is locked.</p>

      <div className="mt-6"><Explainer /></div>

      <h2 className="mt-10 mb-3 text-lg font-semibold">Lite vs Full</h2>
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-px bg-line text-sm">
          <div className="bg-surface p-3 text-xs text-ink-3 uppercase">Feature</div>
          <div className="bg-surface p-3 text-xs text-ice uppercase">Lite (this app)</div>
          <div className="bg-surface p-3 text-xs text-ember uppercase">Full</div>
          {ROWS.map(([f, l, full]) => (
            <Row key={f} feature={f} lite={l} full={full} />
          ))}
        </div>
      </Card>

      <h2 className="mt-10 mb-3 text-lg font-semibold">Set it up, step by step</h2>
      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <motion.li key={s.title} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}
            className="rounded-2xl bg-surface/70 p-4 hairline">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-black" style={{ background: ["#38bdf8", "#60a5fa", "#a78bfa", "#f59e0b", "#f97316", "#ef4444"][i] }}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.title}</p>
                <p className="mt-0.5 text-sm text-ink-2">{s.body}</p>
                {s.cmd && <Cmd text={s.cmd} />}
              </div>
            </div>
          </motion.li>
        ))}
      </ol>
      <a href="https://github.com/JiviteshKumar/kold#readme" target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm text-ice hairline hover:bg-white/5">
        Full guide on GitHub <ExternalLink size={14} />
      </a>
      <p className="mt-4 text-xs text-ink-3">Commands shown for Windows. On macOS/Linux use <code>.venv/bin/</code> instead of <code>.venv/Scripts/</code>.</p>
    </div>
  );
}

function Row({ feature, lite, full }: { feature: string; lite: boolean | string; full: boolean | string }) {
  const cell = (v: boolean | string, warm?: boolean) => (
    <div className="bg-surface/80 p-3 text-ink-2">
      {v === true ? <Check size={16} className={warm ? "text-ember" : "text-ice"} /> : v === false ? <Minus size={16} className="text-ink-3" /> : <span className="text-xs">{v}</span>}
    </div>
  );
  return (
    <>
      <div className="bg-surface/80 p-3 text-ink">{feature}</div>
      {cell(lite)}
      {cell(full, true)}
    </>
  );
}

function Cmd({ text }: { text: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-start gap-2 rounded-xl bg-[#070b14] p-2.5 font-mono text-[11px] text-frost hairline">
      <code className="min-w-0 flex-1 break-all">{text}</code>
      <button onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          play("tap");
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast("Couldn't copy. Select the text instead.", "warn");
        }
      }} className="shrink-0 rounded-md p-1 text-ink-3 hover:text-ink" aria-label="Copy command">
        {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
      </button>
    </div>
  );
}
