export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function dateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone });
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

export function tzCity(tz: string): string {
  return tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
}

/** Match score → temperature label + color, the product's core metaphor. */
export function temperature(score: number): { label: string; color: string } {
  if (score >= 75) return { label: "Hot match", color: "var(--flame)" };
  if (score >= 55) return { label: "Warm match", color: "var(--ember)" };
  if (score >= 40) return { label: "Mild match", color: "var(--violet)" };
  return { label: "Cool match", color: "var(--ice)" };
}

export const STAGE_META: Record<string, { label: string; color: string; hint: string }> = {
  liked: { label: "Saved", color: "var(--ice)", hint: "You're interested" },
  applied: { label: "Applied", color: "#93c5fd", hint: "Application submitted" },
  reaching_out: { label: "Reaching out", color: "var(--violet)", hint: "Cold emails in progress" },
  replied: { label: "Replied", color: "var(--ember)", hint: "They wrote back" },
  interview: { label: "Interview", color: "var(--flame)", hint: "In conversations" },
  offer: { label: "Offer", color: "var(--heat)", hint: "🔥 Offer received" },
  rejected: { label: "Closed", color: "var(--ink-3)", hint: "Not this time" },
  archived: { label: "Archived", color: "var(--ink-3)", hint: "Hidden" },
};

export const LABEL_META: Record<string, { label: string; color: string; emoji: string }> = {
  positive: { label: "Positive", color: "var(--flame)", emoji: "🔥" },
  question: { label: "Question", color: "var(--ember)", emoji: "💬" },
  not_now: { label: "Not right now", color: "var(--violet)", emoji: "⏳" },
  negative: { label: "Declined", color: "var(--ink-3)", emoji: "🧊" },
  annoyed: { label: "Unhappy", color: "var(--bad)", emoji: "⚠️" },
  auto_reply: { label: "Auto-reply", color: "var(--ink-3)", emoji: "🤖" },
  out_of_office: { label: "Out of office", color: "var(--ice)", emoji: "🌴" },
  bounce: { label: "Bounced", color: "var(--bad)", emoji: "↩️" },
  unclear: { label: "Unclear: please read", color: "var(--warn)", emoji: "❔" },
};
