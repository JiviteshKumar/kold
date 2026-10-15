"use client";

import { useState } from "react";
import { FlaskConical, Mail, RefreshCw } from "lucide-react";
import { useMe } from "./providers";
import { Button, useToast } from "./ui";
import { isLite } from "@/lib/api";
import { play } from "@/lib/sound";

const cls = "inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[#e0f2fe] via-[#7dd3fc] to-[#38bdf8] px-5 py-2.5 text-sm font-medium text-[#04121f]";

/** "Connect Gmail": server sign-in in the full version; Google sign-in on the device (or a demo mailbox) in Lite. */
export function GmailConnect({ label = "Connect Gmail", reconnect = false, onDone }: { label?: string; reconnect?: boolean; onDone?: () => void }) {
  const { me, refresh } = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (!isLite) {
    if (!me?.gmail?.configured) return <p className="text-sm text-warn">Gmail sign-in isn&apos;t configured on this server yet (see README).</p>;
    return <a href="/api/gmail/connect" className={cls}><Mail size={15} /> {label}</a>;
  }

  const google = async () => {
    setBusy("google");
    try {
      const g = await import("@/local/gmail");
      const email = await g.connectGoogle();
      play("success");
      toast(`Connected ${email}`, "ok");
      await refresh();
      onDone?.();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(null);
    }
  };
  const demo = async () => {
    setBusy("demo");
    const g = await import("@/local/gmail");
    await g.connectDemo();
    toast("Demo mailbox on: emails are simulated and never actually sent", "info");
    await refresh();
    onDone?.();
    setBusy(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {me?.gmail?.google ? (
        <Button variant="primary" onClick={google} loading={busy === "google"}>
          {reconnect ? <RefreshCw size={15} /> : <Mail size={15} />} {reconnect ? "Reconnect Gmail" : label}
        </Button>
      ) : (
        <p className="w-full text-sm text-ink-2">Gmail sign-in isn&apos;t switched on for this site yet. You can try everything with a demo mailbox.</p>
      )}
      {!reconnect && (
        <Button variant="ghost" onClick={demo} loading={busy === "demo"}><FlaskConical size={15} /> Use a demo mailbox</Button>
      )}
    </div>
  );
}
