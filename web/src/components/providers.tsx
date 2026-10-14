"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ToastProvider } from "./ui";
import { api } from "@/lib/api";
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
        navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
      } else {
        // Dev chunks aren't content-hashed; a caching worker would serve stale code.
        navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
        caches?.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
      }
    }
  }, []);

  return (
    <Ctx.Provider value={{ me, loading, refresh }}>
      <ToastProvider>{children}</ToastProvider>
    </Ctx.Provider>
  );
}

export const useMe = () => useContext(Ctx);
