"use client";

import { AnimatePresence } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Intro } from "@/components/intro";
import { useMe } from "@/components/providers";
import { useIntroSeen } from "@/lib/hooks";

export default function Home() {
  const router = useRouter();
  const { me, loading } = useMe();
  // The intro plays once per app launch, not on every navigation (`?intro=full` replays it).
  const stored = useIntroSeen();
  // Read once: the install guide removes `?install=` from the address right after the first render.
  const [search] = useState(() => (typeof location !== "undefined" ? location.search : ""));
  const seen = search.includes("install=") ? true : stored && search.includes("intro=") ? false : stored;
  const [finished, setFinished] = useState(false);
  const introDone = seen === true || finished;

  const done = useCallback(() => {
    try {
      sessionStorage.setItem("kold:intro", "1");
    } catch {}
    setFinished(true);
  }, []);

  useEffect(() => {
    if (!introDone || loading) return;
    const t = setTimeout(() => router.replace(me?.user?.onboarded ? "/home" : "/onboarding"), 350);
    return () => clearTimeout(t);
  }, [introDone, loading, me, router]);

  return <AnimatePresence>{seen === false && !finished && <Intro key="intro" onDone={done} />}</AnimatePresence>;
}
