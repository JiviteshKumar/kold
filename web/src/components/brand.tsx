"use client";

import { useId } from "react";

/** The Kold mark: a six-armed ice crystal whose lower arms fold into an envelope flap (cold outreach). */
export function KoldMark({ size = 32, warm = false }: { size?: number; warm?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        {/* userSpaceOnUse: a straight vertical stroke has a zero-width bounding box and would vanish otherwise */}
        <linearGradient id={`g${id}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="64" y2="64">
          {warm ? (
            <>
              <stop offset="0" stopColor="#fde68a" />
              <stop offset="0.55" stopColor="#f59e0b" />
              <stop offset="1" stopColor="#f97316" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#e0f2fe" />
              <stop offset="0.5" stopColor="#7dd3fc" />
              <stop offset="1" stopColor="#a78bfa" />
            </>
          )}
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill="#0b0f19" stroke={`url(#g${id})`} strokeOpacity="0.35" />
      <g stroke={`url(#g${id})`} strokeWidth="3.2" strokeLinecap="round" fill="none">
        <path d="M32 12v40" />
        <path d="M14.7 22l34.6 20" />
        <path d="M49.3 22L14.7 42" />
        <path d="M32 12l-4.5 4.5M32 12l4.5 4.5" />
        <path d="M18 32l14 8 14-8" strokeWidth="3.6" />
      </g>
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-[-0.04em] ${className}`}>
      k<span className="text-cold">o</span>ld
    </span>
  );
}
