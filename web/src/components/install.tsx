"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { ArrowDown, Copy, Download, EllipsisVertical, Share, SquarePlus } from "lucide-react";
import { KoldMark } from "./brand";
import { useMe } from "./providers";
import { Button, Sheet, useToast } from "./ui";

/**
 * Installing Kold starts on the landing page (docs/index.html): Android installs there in one tap. iPhone can't
 * install from a website's button, so the landing page sends people here with ?install=ios and this guide shows
 * the Share, Add to Home Screen steps on the app's own page (so the icon opens the app, not the landing page).
 */
export type InstallMode = "ios" | "android" | "in-app";

/** Opens the guide when the app was opened with ?install=…, then tidies the address bar. */
export function InstallFromLink() {
  const [mode, setMode] = useState<InstallMode | null>(null);
  useEffect(() => {
    const url = new URL(location.href);
    const m = url.searchParams.get("install");
    if (m !== "ios" && m !== "android" && m !== "in-app") return;
    url.searchParams.delete("install");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    const t = setTimeout(() => setMode(m), 400); // after the first screen has settled
    return () => clearTimeout(t);
  }, []);
  return <InstallGuide mode={mode ?? "ios"} open={!!mode} onClose={() => setMode(null)} />;
}

/** Steps for browsers that can't install with one tap. */
export function InstallGuide({ mode, open, onClose }: { mode: InstallMode; open: boolean; onClose: () => void }) {
  const { me } = useMe();
  const toast = useToast();
  const setUp = !!me?.user?.onboarded;
  const iphone = typeof navigator !== "undefined" && /iPhone|iPod/.test(navigator.userAgent);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast("Link copied. Paste it into Safari or Chrome.", "ok");
    } catch {
      toast(location.href, "info");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Install Kold">
      <div className="space-y-5 p-5 pb-8">
        {mode === "ios" && (
          <>
            <p className="text-sm text-ink-2">Apple doesn&apos;t let websites install themselves, so it takes three taps in Safari:</p>
            <ol className="space-y-3">
              <Step n={1} icon={<Share size={18} />} title="Tap the Share button">
                In Safari&apos;s toolbar{iphone ? " at the bottom of the screen" : ""}. On iOS 26, tap <b className="text-ink">•••</b> first, then Share.
              </Step>
              <Step n={2} icon={<SquarePlus size={18} />} title="Choose “Add to Home Screen”">
                Scroll down the list if you don&apos;t see it. Keep “Open as Web App” switched on.
              </Step>
              <Step n={3} icon={<KoldMark size={18} />} title="Tap Add, then open Kold from your Home Screen">
                It opens full screen, like any other app.
              </Step>
            </ol>
            {setUp && (
              <p className="rounded-xl bg-warn/10 p-3 text-xs leading-relaxed text-warn">
                iPhone keeps the installed app&apos;s data separate from Safari. To bring what you&apos;ve set up here, download a backup in Profile → Account first, then restore it in the installed app.
              </p>
            )}
            {iphone && (
              <div className="flex flex-col items-center gap-1 pt-2 text-xs text-ink-3">
                <span>Safari&apos;s Share button is down there</span>
                <motion.span animate={{ y: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 1.4 }} className="text-ice"><ArrowDown size={20} /></motion.span>
              </div>
            )}
          </>
        )}

        {mode === "android" && (
          <>
            <p className="text-sm text-ink-2">Your browser installs apps from its menu:</p>
            <ol className="space-y-3">
              <Step n={1} icon={<EllipsisVertical size={18} />} title="Open the browser menu">The <b className="text-ink">⋮</b> button, usually at the top right.</Step>
              <Step n={2} icon={<SquarePlus size={18} />} title="Tap “Install app” or “Add to Home screen”">Then confirm. Kold appears with your other apps.</Step>
            </ol>
            <p className="text-xs text-ink-3">In Chrome, the Install button here usually becomes one tap after you&apos;ve used Kold for a moment.</p>
          </>
        )}

        {mode === "in-app" && (
          <>
            <p className="text-sm text-ink-2">
              You&apos;ve opened Kold inside another app&apos;s browser, which can&apos;t install apps. Open it in {iphone ? "Safari" : "Chrome"} first:
            </p>
            <ol className="space-y-3">
              <Step n={1} icon={<EllipsisVertical size={18} />} title="Open this app's menu">Look for <b className="text-ink">•••</b> or <b className="text-ink">⋮</b>, then “Open in browser”.</Step>
              <Step n={2} icon={<Download size={18} />} title="Tap Install Kold there">The button appears at the top of Kold.</Step>
            </ol>
            <Button variant="outline" onClick={copyLink}><Copy size={14} /> Copy the link instead</Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

function Step({ n, icon, title, children }: { n: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 rounded-2xl bg-white/[0.03] p-3.5 hairline">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ice/10 text-ice">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium"><span className="mr-1.5 text-ink-3 tabular-nums">{n}.</span>{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{children}</p>
      </div>
    </li>
  );
}
