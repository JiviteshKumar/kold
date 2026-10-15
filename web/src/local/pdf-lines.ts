/**
 * Turns a PDF page's positioned text into lines a resume reader can understand, keeping the layout's meaning:
 * - fields on one line that are set apart by a wide gap or a change of font ("Acme Corp  Intern  Jun 2024 – Aug
 *   2024", company in bold, dates small) are joined with " | ", so the header can be split reliably;
 * - two-column resumes are read one column at a time instead of across;
 * - spaced-out headings ("E X P E R I E N C E") are closed up;
 * - wrapped paragraph lines are joined, and indented paragraphs become "• " bullets.
 * Pure (no pdf.js import), so it is tested directly in web/test.
 */
export type PdfItem = { str: string; x: number; y: number; w: number; size: number; bold?: boolean };
type Item = PdfItem & { spaced?: boolean };
type Line = { x: number; textX: number; right: number; size: number; bold: boolean; text: string; heading: boolean };

const SPACED = /^(?:\S {1,3}){2,}\S$/; // "E X P E R I E N C E" (two or more spaces between words)
const BULLET = /^[•●▪◦○■□➢➤►▸‣⁃–\-*✓✔]\s*/;
const END = /[.!?:;]$/;
// Lines that hold a single fact (date, email, link, phone) are never glued to their neighbours.
const FIELD = /@|https?:|www\.|linkedin\.com|github\.com|\b(19|20)\d{2}\b|\+?\d[\d\s-]{8,}\d/i;

export function pdfLines(items: PdfItem[], pageWidth: number): string[] {
  const clean: Item[] = items
    .map((it) => (SPACED.test(it.str.trim()) ? { ...it, str: it.str.trim().split(/ {2,}/).map((w) => w.replace(/ /g, "")).join(" "), spaced: true } : it))
    .filter((it) => it.str.trim());
  if (!clean.length) return [];
  return splitColumns(clean, pageWidth).flatMap(columnLines);
}

/** A sidebar layout has a vertical gutter that no text crosses, with plenty of text on both sides. */
function splitColumns(items: Item[], pageWidth: number): Item[][] {
  const chars = (xs: Item[]) => xs.reduce((n, it) => n + it.str.length, 0);
  const rows = (xs: Item[]) => new Set(xs.map((it) => Math.round(it.y / 4))).size;
  const total = chars(items);
  let best: { x: number; score: number } | null = null;
  for (let x = pageWidth * 0.22; x <= pageWidth * 0.62; x += 4) {
    if (items.some((it) => it.x < x - 2 && it.x + it.w > x + 2)) continue; // something crosses the gutter
    const left = items.filter((it) => it.x + it.w <= x);
    const right = items.filter((it) => it.x >= x);
    const lc = chars(left), rc = chars(right);
    if (lc < total * 0.15 || rc < total * 0.2 || rows(left) < 5 || rows(right) < 5) continue;
    // Real columns hold sentences on both sides of the gutter, not just right-aligned dates.
    if (!right.some((it) => it.str.length > 25) || !left.some((it) => it.str.length > 8)) continue;
    const score = Math.min(lc, rc);
    if (!best || score > best.score) best = { x, score };
  }
  if (!best) return [items];
  const left = items.filter((it) => it.x + it.w <= best!.x);
  const right = items.filter((it) => it.x >= best!.x);
  const top = (xs: Item[]) => Math.max(...xs.map((it) => it.y));
  return top(left) >= top(right) ? [left, right] : [right, left];
}

function buildLine(segs: Item[]): Line {
  segs.sort((a, b) => a.x - b.x);
  const plainLen = segs.reduce((n, s) => n + s.str.length, 0);
  const parts: { sep: string; s: string }[] = [];
  let wideGap = false;
  segs.forEach((sg, i) => {
    if (!i) return parts.push({ sep: "", s: sg.str });
    const prev = segs[i - 1];
    const gap = sg.x - (prev.x + prev.w);
    const size = Math.min(prev.size, sg.size);
    const styleChange = Math.abs(prev.size - sg.size) > 0.6 || !!prev.bold !== !!sg.bold;
    let sep = "";
    if (gap > Math.max(12, 2.2 * size)) {
      sep = " | ";
      wideGap = true;
    } else if (styleChange && gap > 0.5) sep = "\u0000"; // a field break in headers, a plain space inside sentences
    else if ((prev.spaced && sg.spaced) || (gap > size * 0.08 && !prev.str.endsWith(" ") && !sg.str.startsWith(" "))) sep = " ";
    parts.push({ sep, s: sg.str });
  });
  // Short lines (headers) and lines with a wide gap split on font changes; long sentences keep inline bold as text.
  const header = plainLen <= 80 || wideGap;
  const text = parts.map((p) => (p.sep === "\u0000" ? (header ? " | " : " ") : p.sep) + p.s).join("")
    .replace(/\s+/g, " ").replace(/(\s*\|\s*)+/g, " | ").replace(/^\s*\|\s*|\s*\|\s*$/g, "").trim();
  const boldChars = segs.filter((s) => s.bold).reduce((n, s) => n + s.str.length, 0);
  const size = segs.reduce((n, s) => n + s.size * s.str.length, 0) / Math.max(1, plainLen);
  // A bullet's text (and its wrapped lines) starts after the glyph.
  const textX = BULLET.test(segs[0].str.trim()) && segs[0].str.trim().length <= 2 && segs[1] ? segs[1].x : segs[0].x;
  // Spaced-out or short all-capitals lines are headings.
  const heading = segs.every((s) => s.spaced) || (text === text.toUpperCase() && /[A-Z]{3}/.test(text) && text.split(/\s+/).length <= 4 && !text.includes(" | "));
  return { x: segs[0].x, textX, right: Math.max(...segs.map((s) => s.x + s.w)), size, bold: boldChars > plainLen / 2, text, heading };
}

function columnLines(items: Item[]): string[] {
  // 1. visual lines, top to bottom
  const rows: Item[][] = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r[0].y - it.y) <= Math.max(2, 0.3 * Math.min(r[0].size, it.size)));
    if (row) row.push(it);
    else rows.push([it]);
  }
  const lines = rows.map(buildLine);

  // 2. the column's geometry
  const colLeft = Math.min(...lines.map((l) => l.x));
  const colRight = Math.max(...lines.map((l) => l.right));
  const headerXs = lines.filter((l) => l.text.includes(" | ")).map((l) => Math.round(l.x));
  const margin = headerXs.length >= 2 ? Math.min(...headerXs) : leftMargin(lines.map((l) => Math.round(l.x)));
  const bodySize = median(lines.map((l) => l.size));
  const rightAligned = (l: Line) => l.x > colLeft + 0.45 * (colRight - colLeft);
  const centred = (l: Line) => l.x > margin + 30 && Math.abs((l.x + l.right) / 2 - (colLeft + colRight) / 2) < 15;
  // How far a full line of each paragraph indent reaches (to tell a wrapped line from a short one).
  const reach = new Map<number, number>();
  for (const l of lines) {
    const k = Math.round(l.textX / 3);
    reach.set(k, Math.max(reach.get(k) ?? 0, l.right));
  }

  // 3. join wrapped lines; indented paragraphs become bullets
  type Out = { text: string; x: number; textX: number; size: number; bold: boolean; right: number; heading: boolean };
  const out: Out[] = [];
  for (const l of lines) {
    const bulleted = BULLET.test(l.text) && !/^[-–]\s*\d/.test(l.text);
    const prev = out[out.length - 1];
    if (prev && !bulleted && !l.heading && !prev.heading && !l.text.includes(" | ") && !prev.text.includes(" | ") && !rightAligned(l) && !FIELD.test(l.text) && !FIELD.test(prev.text.replace(/\b(19|20)\d{2}\b/g, ""))) {
      const sameIndent = Math.abs(l.x - prev.textX) <= 3;
      const full = reach.get(Math.round(prev.textX / 3)) ?? prev.right;
      const lowerStart = /^[a-z(]/.test(l.text);
      const wrapped = !END.test(prev.text) ? prev.right >= full * (lowerStart ? 0.85 : 0.93) : lowerStart && prev.right >= full * 0.85;
      if (sameIndent && wrapped && Math.abs(prev.size - l.size) < 0.8 && prev.bold === l.bold) {
        prev.text = `${prev.text} ${l.text}`.replace(/(\w)- ([a-z])/g, "$1-$2");
        prev.right = l.right;
        continue;
      }
    }
    let text = l.text;
    if (bulleted) text = text.replace(BULLET, "• ");
    else if (l.x > margin + 5 && !l.heading && !l.text.includes(" | ") && !rightAligned(l) && !centred(l) && l.size <= bodySize + 1.2) text = `• ${text}`;
    out.push({ text, x: l.x, textX: l.textX, size: l.size, bold: l.bold, right: l.right, heading: l.heading });
  }

  // 4. the name is the biggest text near the top: put it first so the reader finds it
  const topBand = out.slice(0, 8);
  if (topBand.length) {
    const biggest = topBand.reduce((a, b) => (b.size > a.size ? b : a));
    if (biggest.size >= 14 && out.indexOf(biggest) > 0) {
      out.splice(out.indexOf(biggest), 1);
      out.unshift(biggest);
    }
  }
  return out.map((l) => l.text);
}

function leftMargin(xs: number[]): number {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  const repeated = [...counts].filter(([, n]) => n >= 2).map(([x]) => x);
  return repeated.length ? Math.min(...repeated) : Math.min(...xs);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 10;
}
