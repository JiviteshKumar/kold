"use client";

/**
 * "Install Kold" on any phone or computer.
 * - Chrome, Edge, Samsung Internet (Android and desktop): the browser hands us an install prompt, so one tap installs.
 * - iPhone and iPad: Apple doesn't let websites install themselves, so we show where to tap (Share, Add to Home Screen).
 * - Apps' built-in browsers (Instagram, Gmail…) can't install anything: we ask to open the page in the real browser.
 * The prompt can arrive before React starts, so layout.tsx catches it early into window.__koldInstall.
 */
import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
declare global {
  interface Window {
    __koldInstall?: InstallPrompt | null;
  }
}

export type InstallMode = "installed" | "prompt" | "ios" | "in-app" | "android" | "unsupported";

function detect(): InstallMode {
  if (typeof window === "undefined") return "unsupported";
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (standalone) return "installed";
  if (window.__koldInstall) return "prompt";
  const ua = navigator.userAgent;
  if (/FBAN|FBAV|Instagram|Line\/|LinkedInApp|Snapchat|Twitter|GSA\/|; wv\)/i.test(ua)) return "in-app";
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return "ios";
  if (/Android/i.test(ua)) return "android"; // a browser without the prompt (yet): show its menu steps
  return "unsupported"; // desktop browser without install support: nothing to offer
}

export function useInstall() {
  const [mode, setMode] = useState<InstallMode>("unsupported");
  useEffect(() => {
    const update = () => setMode(detect());
    update();
    const installed = () => setMode("installed");
    window.addEventListener("kold:install-ready", update);
    window.addEventListener("kold:installed", installed);
    return () => {
      window.removeEventListener("kold:install-ready", update);
      window.removeEventListener("kold:installed", installed);
    };
  }, []);

  /** Shows the browser's own install dialog. Returns true if the user installed. */
  const install = async (): Promise<boolean> => {
    const p = window.__koldInstall;
    if (!p) return false;
    await p.prompt();
    const { outcome } = await p.userChoice;
    window.__koldInstall = null; // a prompt can only be used once
    setMode(outcome === "accepted" ? "installed" : detect());
    return outcome === "accepted";
  };

  return { mode, install };
}
