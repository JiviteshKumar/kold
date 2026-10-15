"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { InstallFromLink } from "./install";
import { ToastProvider } from "./ui";
import { api, isLite } from "@/lib/api";
import type { Me } from "@/lib/types";

type MeCtx = { me: Me | null; loading: boolean; refresh: () => Promise<Me | null> };
const Ctx = createContext<MeCtx>({ me: null, loading: true, refresh: async () => null });

export function Providers({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const m = await api.get<Me>("/me");
      setMe(m);
      return m;
    } catch {
      setMe({ user: null });
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api.get<Me>("/me")
      .then(setMe)
      .catch(() => setMe({ user: null }))
      .finally(() => setLoading(false));
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
        navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/`, updateViaCache: "none" }).catch(() => {});
      } else {
        // Dev chunks aren't content-hashed; a caching worker would serve stale code.
        navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
        caches?.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
      }
    }
  }, []);

  // Lite: no server, so the daily work happens whenever the app is open: fetch today's verified listings,
  // re-run matching, prepare due follow-ups, collect replies (if Gmail's session is valid) and check reminders.
  useEffect(() => {
    if (!isLite) return;
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try {
        const { runDaily } = await import("@/local/engine");
        const out = await runDaily();
        if (out.matches || out.replies || out.drafts || out.newListings) window.dispatchEvent(new Event("kold:data-changed"));
        window.dispatchEvent(new Event("kold:refresh-stats"));
      } catch {
      } finally {
        running = false;
      }
    };
    void run();
    import("@/local/ai").then((m) => m.resume()).catch(() => {});
    const t = setInterval(run, 15 * 60_000);
    const onVis = () => document.visibilityState === "visible" && run();
    const onChange = () => void refresh();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("kold:reconnect", onChange);
    window.addEventListener("kold:run-daily", run);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("kold:reconnect", onChange);
      window.removeEventListener("kold:run-daily", run);
    };
  }, [refresh]);

  return (
    <Ctx.Provider value={{ me, loading, refresh }}>
      <ToastProvider>
        {children}
        <InstallFromLink />
      </ToastProvider>
    </Ctx.Provider>
  );
}

export const useMe = () => useContext(Ctx);
