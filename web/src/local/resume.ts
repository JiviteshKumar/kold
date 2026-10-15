"use client";

/**
 * Resume → profile, entirely on the device.
 * 1. Extract text keeping the layout's meaning (PDF via pdf.js + pdf-lines.ts, DOCX via mammoth, TXT).
 * 2. Structure it with careful rules (resume-rules.ts); if on-device AI is ready, also ask it and merge.
 * 3. Verify: anything not actually written in the resume is dropped. Kold never invents facts about the user.
 */
import { aiLabel, aiReady, generateJson } from "./ai";
import { pdfLines, type PdfItem } from "./pdf-lines";
import { ruleParse, verify } from "./resume-rules";
import type { Profile } from "@/lib/types";

export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  let text = "";
  if (name.endsWith(".pdf")) text = await pdfText(file);
  else if (name.endsWith(".docx")) text = await docxText(file);
  else text = await file.text();
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function pdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) pages.push((await pageLines(pdfjs, await doc.getPage(p))).join("\n"));
  return pages.join("\n");
}

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<typeof import("pdfjs-dist").getDocument>["promise"]>["getPage"]>>;

/** One page's text as layout-aware lines (shared with the tests through pageItems). */
export async function pageLines(_pdfjs: unknown, page: PdfPage): Promise<string[]> {
  const items = await pageItems(page);
  const lines = pdfLines(items, page.getViewport({ scale: 1 }).width);
  // Hyperlinks (LinkedIn/GitHub icons) often exist only as annotations: add any the text doesn't already show,
  // next to the contact details (not at the end, where they'd land in the last section).
  const shown = lines.join(" ").toLowerCase();
  const annots = (await page.getAnnotations().catch(() => [])) as { url?: string }[];
  const extra = annots.map((a) => a.url ?? "").filter((u) => /^https?:/i.test(u))
    .map((u) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")).filter((u) => u && !shown.includes(u.toLowerCase()));
  if (extra.length) lines.splice(Math.min(1, lines.length), 0, ...new Set(extra));
  return lines;
}

export async function pageItems(page: PdfPage): Promise<PdfItem[]> {
  const content = await page.getTextContent();
  // Bold is read from the font's own name (e.g. "Calibri-Bold"); fonts are only known after the page is processed.
  const bold = new Map<string, boolean>();
  try {
    await page.getOperatorList();
    for (const it of content.items as { fontName?: string }[]) {
      if (!it.fontName || bold.has(it.fontName)) continue;
      let fontName = "";
      try {
        fontName = (page.commonObjs.get(it.fontName) as { name?: string } | null)?.name ?? "";
      } catch {}
      bold.set(it.fontName, /bold|black|heavy|semibold|demi/i.test(fontName));
    }
  } catch {}
  return (content.items as { str: string; transform: number[]; width: number; fontName?: string }[])
    .filter((i) => typeof i.str === "string" && i.str.trim())
    .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, size: Math.hypot(i.transform[0], i.transform[1]) || 10, bold: bold.get(i.fontName ?? "") ?? false }));
}

/** DOCX through HTML, so list items keep their bullets and table cells stay apart. */
async function docxText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  // The browser build reads arrayBuffer; Node (tests) reads buffer.
  const input = typeof Buffer !== "undefined" ? { arrayBuffer, buffer: Buffer.from(arrayBuffer) } : { arrayBuffer };
  const { value } = await mammoth.convertToHtml(input as { arrayBuffer: ArrayBuffer });
  return docxHtmlToText(value);
}

export function docxHtmlToText(html: string): string {
  return html
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|li|h\d|tr|div)>|<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split("\n").map((l) => l.trim().replace(/\s*\|\s*$/, "")).join("\n");
}

const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" }, headline: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, location: { type: "string" },
    links: { type: "array", items: { type: "string" } }, summary: { type: "string" }, skills: { type: "array", items: { type: "string" } },
    experience: { type: "array", items: { type: "object", properties: { title: { type: "string" }, company: { type: "string" }, start: { type: "string" }, end: { type: "string" }, bullets: { type: "array", items: { type: "string" } } }, required: ["title", "company", "bullets"] } },
    education: { type: "array", items: { type: "object", properties: { degree: { type: "string" }, institution: { type: "string" }, start: { type: "string" }, end: { type: "string" }, score: { type: "string" } }, required: ["degree", "institution"] } },
    projects: { type: "array", items: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name", "description"] } },
    experience_level: { type: "string", enum: ["student", "fresher", "1-3", "3-5", "5+"] },
    suggested_roles: { type: "array", items: { type: "string" } },
  },
  required: ["name", "skills", "experience", "education", "projects", "experience_level", "suggested_roles"],
};

/** Parse a resume. Returns the profile and how it was read ("rules" or the on-device model). */
export async function parseResume(text: string): Promise<{ profile: Profile; method: string }> {
  const base = verify(ruleParse(text), text);
  if (!aiReady()) return { profile: base, method: "rules" };
  const ai = await generateJson<Profile>(
    "You extract structured data from resumes. Copy facts exactly as written. Never invent employers, dates, numbers, skills or links. Use empty strings or lists when missing.",
    `Resume text:\n\n${text.slice(0, 9000)}`, SCHEMA, { maxTokens: 1400 });
  if (!ai) return { profile: base, method: "rules" };
  const merged = verify({ ...base, ...ai, certifications: base.certifications, achievements: base.achievements }, text);
  // Keep the richer of the two for each section, and every skill the resume lists.
  merged.skills = [...new Set([...(merged.skills ?? []), ...base.skills])];
  if ((merged.experience?.length ?? 0) < base.experience.length) merged.experience = base.experience;
  if ((merged.education?.length ?? 0) < base.education.length) merged.education = base.education;
  if ((merged.projects?.length ?? 0) < base.projects.length) merged.projects = base.projects;
  for (const k of ["links", "phone", "headline", "summary", "location"] as const) if (!merged[k]?.length) (merged as Record<string, unknown>)[k] = base[k];
  if (!merged.suggested_roles?.length) merged.suggested_roles = base.suggested_roles;
  return { profile: merged, method: aiLabel() };
}
