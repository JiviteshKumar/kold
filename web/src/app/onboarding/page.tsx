"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, FileText, Lock, Mail, ShieldCheck, Upload } from "lucide-react";
import { KoldMark, Wordmark } from "@/components/brand";
import { PrefsEditor, ProfileEditor } from "@/components/editors";
import { GmailConnect } from "@/components/gmail-connect";
import { useMe } from "@/components/providers";
import { Button, useToast } from "@/components/ui";
import { api, ApiError, isLite } from "@/lib/api";
import { play } from "@/lib/sound";
import type { Preferences, Profile } from "@/lib/types";

const STEPS = ["Resume", "Profile", "Preferences", "Gmail", "Launch"];

// Honest progress copy: these are the real stages the server runs, in order.
const SCAN_STAGES = ["Reading your resume", "Finding your experience and projects", "Picking out your skills", "Checking every detail against your resume", "Building your profile"];

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <Onboarding />
    </Suspense>
  );
}

function Onboarding() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { me, refresh } = useMe();
  // Coming back from Google's consent screen lands on the Gmail step.
  const [step, setStep] = useState(params.get("gmail") ? 3 : 0);
  const [edited, setProfile] = useState<Profile | null>(null);
  const [editedPrefs, setPrefs] = useState<Preferences | null>(null);
  // Until the user edits, show what the server has.
  const profile = edited ?? me?.profile ?? null;
  const prefs = editedPrefs ?? me?.preferences ?? null;
  const [method, setMethod] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me?.user?.onboarded) router.replace("/home");
  }, [me, router]);

  const go = (n: number) => {
    play(n > step ? "whoosh" : "tap");
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveProfile = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      await api.put("/profile", profile);
      go(2);
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const savePrefs = async () => {
    if (!prefs) return;
    if (!prefs.job_types.length) return toast("Pick at least one type of opportunity", "warn");
    setBusy(true);
    try {
      await api.put("/preferences", { ...prefs, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      await refresh();
      go(3);
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative z-10 mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-10 sm:px-6">
      <header className="mb-8 flex items-center gap-3">
        <KoldMark size={30} />
        <Wordmark className="text-xl" />
        <div className="ml-auto flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <motion.span
              key={s}
              className="h-1.5 rounded-full"
              animate={{ width: i === step ? 28 : 8, background: i < step ? "var(--ember)" : i === step ? "var(--ice)" : "rgba(255,255,255,0.12)" }}
              transition={{ type: "spring", stiffness: 300, damping: 26 }}
            />
          ))}
        </div>
      </header>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 30, filter: "blur(4px)" }}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, x: -30, filter: "blur(4px)" }}
          transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
          className="flex-1"
        >
          {step === 0 && (
            <ResumeStep
              hasExisting={!!me?.profile}
              onParsed={(p, pr, m) => {
                setProfile(p);
                setPrefs(pr);
                setMethod(m);
                void refresh();
                go(1);
              }}
              onSkip={() => go(1)}
            />
          )}

          {step === 1 && profile && (
            <div>
              <StepTitle kicker="Step 2 · Your profile" title="Here's what we read." body={
                <>Everything below came from your resume, and Kold double-checked each item against it. Edit anything you like. {method && <span className="text-ink-3">(Read with {method === "rules" ? "rule-based parsing" : "Kold's local model"}.)</span>}</>
              } />
              <ProfileEditor value={profile} onChange={setProfile} />
              <Nav onBack={() => go(0)} onNext={saveProfile} busy={busy} nextLabel="Looks right" />
            </div>
          )}

          {step === 2 && prefs && (
            <div>
              <StepTitle kicker="Step 3 · Preferences" title="What should Kold look for?" body="We pre-filled this from your resume. Kold only shows roles you can actually take from India." />
              <PrefsEditor value={prefs} onChange={setPrefs} suggestedRoles={profile?.suggested_roles ?? []} />
              <Nav onBack={() => go(1)} onNext={savePrefs} busy={busy} nextLabel="Save preferences" />
            </div>
          )}

          {step === 3 && <GmailStep onBack={() => go(2)} onNext={() => go(4)} />}

          {step === 4 && <LaunchStep />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function StepTitle({ kicker, title, body }: { kicker: string; title: string; body: React.ReactNode }) {
  return (
    <div className="mb-8">
      <p className="mb-2 text-xs font-medium tracking-[0.2em] text-ice uppercase">{kicker}</p>
      <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{title}</h1>
      <p className="mt-3 max-w-xl text-ink-2">{body}</p>
    </div>
  );
}

function Nav({ onBack, onNext, busy, nextLabel }: { onBack: () => void; onNext: () => void; busy?: boolean; nextLabel: string }) {
  return (
    <div className="sticky bottom-0 mt-10 -mx-4 flex items-center justify-between gap-3 border-t border-line bg-bg/80 px-4 py-4 backdrop-blur-xl sm:mx-0 sm:rounded-2xl sm:border-0 sm:bg-transparent sm:px-0">
      <Button variant="ghost" onClick={onBack}><ArrowLeft size={16} /> Back</Button>
      <Button variant="primary" onClick={onNext} loading={busy}>{nextLabel} <ArrowRight size={16} /></Button>
    </div>
  );
}

function ResumeStep({ onParsed, onSkip, hasExisting }: { onParsed: (p: Profile, pr: Preferences, m: string) => void; onSkip: () => void; hasExisting: boolean }) {
  const toast = useToast();
  const { me } = useMe();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState(-1);

  useEffect(() => {
    if (stage < 0 || stage >= SCAN_STAGES.length - 1) return;
    const t = setTimeout(() => setStage((s) => s + 1), 3800);
    return () => clearTimeout(t);
  }, [stage]);

  const upload = async (f: File) => {
    if (!/\.(pdf|docx|txt)$/i.test(f.name)) return toast("Please upload a PDF, DOCX or TXT file", "warn");
    if (f.size > 8 * 1024 * 1024) return toast("That file is over 8 MB", "warn");
    setFile(f);
    setStage(0);
    play("whoosh");
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await api.post<{ profile: Profile; preferences: Preferences; method: string }>("/resume", fd);
      setStage(SCAN_STAGES.length);
      play("success");
      setTimeout(() => onParsed(res.profile, res.preferences, res.method), 700);
    } catch (e) {
      setStage(-1);
      setFile(null);
      toast(e instanceof ApiError ? e.message : "Upload failed", "bad");
    }
  };

  const scanning = stage >= 0;

  return (
    <div>
      <StepTitle
        kicker="Step 1 · Your resume"
        title="Every opportunity starts cold."
        body="Drop your resume. Kold builds your profile from it, then finds genuine openings and helps you warm them up, one approved email at a time."
      />

      <motion.div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !scanning) void upload(f);
        }}
        onClick={() => !scanning && input.current?.click()}
        animate={{ scale: drag ? 1.02 : 1, borderColor: drag ? "rgba(125,211,252,0.7)" : "rgba(148,178,230,0.18)" }}
        className="relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[28px] border border-dashed bg-surface/60 px-6 py-14 text-center"
      >
        <input ref={input} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />

        {/* the scan beam */}
        {scanning && stage < SCAN_STAGES.length && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-ice/25 to-transparent"
            initial={{ top: "-20%" }}
            animate={{ top: ["-20%", "100%"] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        )}

        <motion.div
          className="relative mb-5 flex h-20 w-16 items-center justify-center rounded-xl bg-surface-2 hairline"
          animate={scanning ? { rotate: [0, -2, 2, 0], y: [0, -4, 0] } : { rotate: 0 }}
          transition={{ duration: 2, repeat: scanning ? Infinity : 0 }}
        >
          {stage >= SCAN_STAGES.length ? <Check className="text-ok" /> : scanning ? <FileText className="text-ice" /> : <Upload className="text-ice" />}
          {!scanning && <span className="absolute -inset-3 -z-10 rounded-2xl bg-ice/15 blur-xl" />}
        </motion.div>

        {!scanning ? (
          <>
            <p className="text-lg font-medium">Drop your resume here</p>
            <p className="mt-1 text-sm text-ink-3">or tap to choose · PDF, DOCX or TXT</p>
          </>
        ) : (
          <>
            <p className="max-w-full truncate text-sm text-ink-3">{file?.name}</p>
            <div className="mt-3 h-6">
              <AnimatePresence mode="wait">
                <motion.p key={stage} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="text-base font-medium">
                  {stage >= SCAN_STAGES.length ? "Profile ready" : `${SCAN_STAGES[stage]}…`}
                </motion.p>
              </AnimatePresence>
            </div>
          </>
        )}
      </motion.div>

      <div className="mt-6 flex items-start gap-3 rounded-2xl bg-white/[0.02] p-4 text-sm text-ink-2 hairline">
        <Lock size={16} className="mt-0.5 shrink-0 text-ice" />
        <p>{isLite
          ? "Your resume is read right here on your device. It is never uploaded anywhere. You can delete everything anytime from Profile."
          : "Your resume is read by Kold's own model running on our server, not sent to any third-party AI service. You can delete everything anytime from Profile."}</p>
      </div>
      {!isLite && !hasExisting && me?.gmail?.configured && (
        <p className="mt-6 text-center text-sm text-ink-3">
          Already use Kold on another device? <a href="/api/gmail/connect" className="text-ice underline decoration-dotted hover:text-frost">Sign in with Google</a>
        </p>
      )}
      {hasExisting && (
        <div className="mt-6 text-center">
          <Button variant="ghost" onClick={onSkip}>Keep my current profile <ArrowRight size={16} /></Button>
        </div>
      )}
    </div>
  );
}

function GmailStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { me } = useMe();
  const g = me?.gmail;
  return (
    <div>
      <StepTitle kicker="Step 4 · Gmail" title="Send from your own address." body="Cold emails land best when they come from you. Kold asks for exactly two permissions, and you approve every single email before it goes out." />
      <div className="space-y-3">
        {(g?.scopes ?? []).map((s, i) => (
          <motion.div key={s.name} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.1 }} className="flex gap-3 rounded-2xl bg-surface/70 p-4 hairline">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-ok" />
            <div>
              <p className="text-sm font-medium">{s.name}</p>
              <p className="mt-0.5 text-sm text-ink-2">{s.why}</p>
            </div>
          </motion.div>
        ))}
        <div className="flex gap-3 rounded-2xl bg-white/[0.02] p-4 text-sm text-ink-2 hairline">
          <Mail size={18} className="mt-0.5 shrink-0 text-ice" />
          <p>Kold never deletes, archives or changes your email, and never sends anything you haven&apos;t approved. You can disconnect anytime, which revokes access immediately.</p>
        </div>
      </div>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        {g?.connected ? (
          <Button variant="primary" onClick={onNext}><Check size={16} /> Connected as {g.email}</Button>
        ) : (
          <GmailConnect onDone={onNext} />
        )}
        <Button variant="ghost" onClick={onNext}>{g?.connected ? "Continue" : "I'll do this later"} <ArrowRight size={16} /></Button>
      </div>
      <div className="mt-6"><Button variant="ghost" onClick={onBack}><ArrowLeft size={16} /> Back</Button></div>
    </div>
  );
}

function LaunchStep() {
  const router = useRouter();
  const { refresh } = useMe();
  const toast = useToast();
  const [count, setCount] = useState<number | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const res = await api.post<{ matches: number }>("/onboarding/complete");
        setCount(res.matches);
        play("warm");
        await refresh();
        setTimeout(() => router.replace("/discover"), 2600);
      } catch (e) {
        toast((e as Error).message, "bad");
      }
    })();
  }, [refresh, router, toast]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="relative mb-10 h-40 w-40">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="absolute inset-0 rounded-full border border-ice/40"
            initial={{ scale: 0.3, opacity: 0.8 }}
            animate={{ scale: 1.6, opacity: 0 }}
            transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: "easeOut" }}
          />
        ))}
        <motion.div className="absolute inset-0 flex items-center justify-center" animate={{ rotate: 360 }} transition={{ duration: 14, repeat: Infinity, ease: "linear" }}>
          <KoldMark size={84} warm={count !== null} />
        </motion.div>
      </div>
      <AnimatePresence mode="wait">
        {count === null ? (
          <motion.div key="a" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <h2 className="text-2xl font-semibold tracking-tight">Scanning official sources…</h2>
            <p className="mt-2 text-ink-2">Employer careers boards and trusted job boards. Only real, live listings.</p>
          </motion.div>
        ) : (
          <motion.div key="b" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <h2 className="text-2xl font-semibold tracking-tight">
              {count > 0 ? <><span className="text-warm">{count}</span> matches ready</> : "You're set up"}
            </h2>
            <p className="mt-2 text-ink-2">{count > 0 ? "Swipe right on what you like." : "A fresh scan is running in the background. New matches will appear shortly."}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
