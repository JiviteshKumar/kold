"use client";

import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";
import clsx from "clsx";
import { ApiError } from "@/lib/api";
import { play } from "@/lib/sound";

type Variant = "primary" | "warm" | "ghost" | "outline" | "danger";

export function Button({
  variant = "outline", loading, children, className, sound = true, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; sound?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: "bg-gradient-to-br from-[#e0f2fe] via-[#7dd3fc] to-[#38bdf8] text-[#04121f] shadow-[0_10px_30px_-10px_rgba(56,189,248,0.7)] hover:brightness-110",
    warm: "bg-gradient-to-br from-[#fde68a] via-[#f59e0b] to-[#f97316] text-[#1f1203] shadow-[0_10px_30px_-10px_rgba(245,158,11,0.7)] hover:brightness-110",
    ghost: "text-ink-2 hover:text-ink hover:bg-white/5",
    outline: "text-ink bg-white/[0.03] hairline hover:bg-white/[0.07]",
    danger: "text-bad bg-bad/10 hover:bg-bad/20",
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      onClick={(e) => {
        if (sound) play("tap");
        rest.onClick?.(e);
      }}
      className={clsx(
        "relative inline-flex select-none items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50",
        styles[variant],
        className,
      )}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={clsx("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Chip({ active, children, onClick, className }: { active?: boolean; children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        play("tap");
        onClick?.();
      }}
      className={clsx(
        "rounded-full px-3.5 py-1.5 text-sm transition active:scale-95",
        active ? "bg-ice/15 text-frost shadow-[inset_0_0_0_1px_rgba(125,211,252,0.5)]" : "bg-white/[0.03] text-ink-2 hairline hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Badge({ children, color = "var(--ink-3)", className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={clsx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", className)}
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 30%, transparent)` }}
    >
      {children}
    </span>
  );
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={clsx("rounded-[var(--radius)] bg-surface/80 hairline", className)}>
      {children}
    </div>
  );
}

/** Match score as a thermometer: the product's core visual metaphor. */
export function TempMeter({ score, compact = false }: { score: number; compact?: boolean }) {
  const pct = Math.max(4, Math.min(100, score));
  return (
    <div className={clsx("flex items-center gap-2", compact ? "w-24" : "w-full")}>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: "var(--grad-temp)", backgroundSize: `${(100 / pct) * 100}% 100%` }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </div>
      <span className="w-8 text-right font-mono text-xs tabular-nums text-ink-2">{score}</span>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink-3 uppercase">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl bg-white/[0.03] px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-3 hairline outline-none transition focus:bg-white/[0.06] focus:shadow-[inset_0_0_0_1px_rgba(125,211,252,0.5)]";

/** Bottom sheet on phones, side panel on desktop. */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal
            className={clsx(
              "glass absolute flex flex-col overflow-hidden",
              "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-[28px]",
              "md:inset-y-3 md:right-3 md:left-auto md:bottom-3 md:max-h-none md:rounded-[24px]",
              wide ? "md:w-[min(760px,calc(100vw-1.5rem))]" : "md:w-[min(520px,calc(100vw-1.5rem))]",
            )}
            initial={{ y: "100%", opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20 md:hidden" />
            <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
              <div className="min-w-0 flex-1 text-lg font-semibold tracking-tight">{title}</div>
              <button onClick={onClose} className="rounded-full p-2 text-ink-3 hover:bg-white/5 hover:text-ink" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

type Toast = { id: number; text: string; tone: "ok" | "warn" | "bad" | "warm" | "info" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    if (tone === "bad") play("error");
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4800);
  }, []);
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      if (e.reason instanceof ApiError) {
        e.preventDefault();
        push(e.reason.message, "bad");
      }
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, [push]);
  const color = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", warm: "var(--ember)", info: "var(--ice)" };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[90] flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ y: -30, opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -20, opacity: 0, scale: 0.95 }}
              className="glass pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-sm"
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color[t.tone], boxShadow: `0 0 12px ${color[t.tone]}` }} />
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

export function Confirm({ open, title, body, confirmLabel, tone = "primary", onConfirm, onClose }: {
  open: boolean; title: string; body: ReactNode; confirmLabel: string; tone?: Variant; onConfirm: () => void | Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center p-4 sm:items-center">
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="alertdialog"
            className="glass relative w-full max-w-sm rounded-3xl p-6"
            initial={{ y: 40, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.96 }}
          >
            <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
            <div className="mt-2 text-sm text-ink-2">{body}</div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button
                variant={tone}
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onConfirm();
                    onClose();
                  } catch (e) {
                    toast((e as Error).message || "Something went wrong", "bad");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {confirmLabel}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex max-w-sm flex-col items-center px-6 py-16 text-center"
    >
      <div className="relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-ice/10 text-ice hairline">
        <div className="absolute inset-0 rounded-2xl bg-ice/20 blur-xl" />
        <span className="relative">{icon}</span>
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <div className="mt-1.5 text-sm text-ink-2">{body}</div>
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  );
}
