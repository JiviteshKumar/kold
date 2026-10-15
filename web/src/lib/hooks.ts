"use client";

import { useEffect, useSyncExternalStore } from "react";
import { isMuted } from "./sound";

/** Current time, refreshed every 30s. Safe to use during render (no impure Date.now() calls in components). */
let now = Date.now();
const nowSubs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

export function useNow(): number {
  return useSyncExternalStore(
    (cb) => {
      nowSubs.add(cb);
      if (!timer) {
        timer = setInterval(() => {
          now = Date.now();
          nowSubs.forEach((f) => f());
        }, 30_000);
      }
      return () => {
        nowSubs.delete(cb);
        if (!nowSubs.size && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    () => now,
    () => 0,
  );
}

const muteSubs = new Set<() => void>();
export function notifyMuteChange() {
  muteSubs.forEach((f) => f());
}

/** Whether sound is muted (persisted in localStorage), without a hydration mismatch. */
export function useMuted(): boolean {
  return useSyncExternalStore(
    (cb) => {
      muteSubs.add(cb);
      return () => muteSubs.delete(cb);
    },
    isMuted,
    () => false,
  );
}

/** Whether the intro already played in this app session. */
export function useIntroSeen(): boolean | null {
  return useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return sessionStorage.getItem("kold:intro") === "1";
      } catch {
        return false;
      }
    },
    () => null,
  );
}

/** Re-run `load` when the Lite engine finishes its background work (new matches, replies, drafts). */
export function useDataChanged(load: () => void): void {
  useEffect(() => {
    window.addEventListener("kold:data-changed", load);
    return () => window.removeEventListener("kold:data-changed", load);
  }, [load]);
}
