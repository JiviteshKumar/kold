"use client";

/**
 * Per-job tailored resume (Lite). Reorders skills, bullets and projects so what the job asks for comes first, and
 * writes a factual summary from resume fields only. If the on-device AI is ready it may lightly rephrase bullets,
 * and each rephrase is rejected if it adds a number, a skill or more than a few new words. Every change is listed.
 */
import { aiReady, generateJson } from "./ai";
import type { FeedJob } from "./feed";
import { findSkills, keywords, numbers, termRe, words } from "./text";
import type { Profile } from "@/lib/types";

const FILLER = new Set(("a an the and or of to in for with on at by from as into using via across which that used built designed developed " +
  "created implemented delivered led drove improved automated analyzed wrote managed optimized enabled supported reduced increased " +
  "identify identified find found track tracking").split(" "));

function novel(newer: string, orig: string): number {
  const ws = (t: string) => new Set(words(t).filter((w) => !FILLER.has(w) && w.length > 2));
  const o = ws(orig);
  return [...ws(newer)].filter((w) => !o.has(w)).length;
}

function factualSummary(d: Profile, matched: string[]): string {
  const parts: string[] = [];
  const edu = d.education?.[0];
  if (edu?.degree) {
    const student = d.experience_level === "student";
    const yr = edu.end?.match(/\d{4}/)?.[0];
    parts.push(`${edu.degree} ${student ? "student" : "graduate"}${yr ? ` (${student ? "graduating " : ""}${yr})` : ""}${edu.institution ? `, ${edu.institution}` : ""}.`);
  }
  const exp = d.experience?.[0];
  if (exp?.title && exp.company) parts.push(`${exp.title} at ${exp.company}.`);
  const skills = [...matched.slice(0, 4), ...(d.skills ?? []).filter((s) => !matched.includes(s))].slice(0, 6);
  if (skills.length) parts.push(`Skills: ${skills.join(", ")}.`);
  return parts.join(" ");
}

export async function tailor(profile: Profile, job: FeedJob): Promise<{ data: Profile; changes: string[] }> {
  const data: Profile = JSON.parse(JSON.stringify(profile));
  const kw = keywords(`${job.title} ${job.title} ${job.description}`);
  const rel = (t: string) => [...new Set(words(t))].filter((w) => kw.has(w)).length;
  const changes: string[] = [];
  const jt = `${job.title}\n${job.description}`.toLowerCase();
  const inJob = (data.skills ?? []).filter((s) => termRe(s).test(jt));
  if (inJob.length) {
    data.skills = [...inJob, ...data.skills.filter((s) => !inJob.includes(s))];
    changes.push(`Moved skills the job asks for to the front: ${inJob.slice(0, 6).join(", ")}`);
  }
  for (const e of data.experience ?? []) {
    const sorted = [...(e.bullets ?? [])].sort((a, b) => rel(b) - rel(a));
    if (sorted.join("|") !== (e.bullets ?? []).join("|")) {
      e.bullets = sorted;
      changes.push(`Reordered bullets under ${e.title || "experience"}${e.company ? ` at ${e.company}` : ""} by relevance`);
    }
  }
  const projSorted = [...(data.projects ?? [])].sort((a, b) => rel(`${b.description} ${(b.tech ?? []).join(" ")}`) - rel(`${a.description} ${(a.tech ?? []).join(" ")}`));
  if (projSorted.map((p) => p.name).join("|") !== (data.projects ?? []).map((p) => p.name).join("|")) {
    data.projects = projSorted;
    changes.push("Put the most relevant projects first");
  }
  const summary = factualSummary(data, inJob);
  if (summary) {
    data.summary = summary;
    changes.push("Wrote a summary from your own resume facts, leading with what this role asks for");
  }
  if (aiReady()) {
    for (const e of data.experience ?? []) {
      if (!e.bullets?.length) continue;
      const out = await generateJson<{ bullets: string[] }>(
        "Lightly rephrase each resume bullet so it uses wording from the job description where it is TRUE. Keep every fact and number exactly; never add facts, tools or numbers. Same count, same order.",
        `JOB DESCRIPTION:\n${job.description.slice(0, 2000)}\n\nBULLETS:\n${e.bullets.join("\n")}`,
        { type: "object", properties: { bullets: { type: "array", items: { type: "string" } } }, required: ["bullets"] });
      if (!out || out.bullets?.length !== e.bullets.length) continue;
      const kept = e.bullets.map((orig, i) => {
        const nw = out.bullets[i] ?? orig;
        const sk = (t: string) => new Set(findSkills(t));
        const safe = [...numbers(nw)].every((n) => numbers(orig).has(n)) && [...sk(nw)].every((s) => sk(orig).has(s)) &&
          novel(nw, orig) <= 3 && nw.length / Math.max(1, orig.length) > 0.5 && nw.length / Math.max(1, orig.length) < 1.6;
        return safe ? nw : orig;
      });
      if (kept.join("|") !== e.bullets.join("|")) {
        e.bullets = kept;
        changes.push(`Rephrased bullets at ${e.company || "experience"} to match the job's wording (each checked: no new facts or numbers)`);
      }
    }
  } else {
    changes.push("On-device AI not enabled: reordering and summary only (your wording is unchanged)");
  }
  return { data, changes };
}

/** Clean, ATS-friendly single-column PDF. Returns the file name and its bytes. */
export async function renderPdf(d: Profile): Promise<{ name: string; blob: Blob }> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), M = 46, maxW = W - M * 2;
  let y = 54;
  const ensure = (h: number) => {
    if (y + h > doc.internal.pageSize.getHeight() - 46) {
      doc.addPage();
      y = 54;
    }
  };
  const text = (s: string, size: number, opts: { bold?: boolean; color?: number; indent?: number; align?: "center" } = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(opts.color ?? 17);
    const lines = doc.splitTextToSize(s, maxW - (opts.indent ?? 0)) as string[];
    for (const l of lines) {
      ensure(size + 4);
      if (opts.align === "center") doc.text(l, W / 2, y, { align: "center" });
      else doc.text(l, M + (opts.indent ?? 0), y);
      y += size + 3.5;
    }
  };
  const section = (title: string) => {
    y += 6;
    ensure(30);
    text(title.toUpperCase(), 10.5, { bold: true });
    doc.setDrawColor(209);
    doc.line(M, y - 6, W - M, y - 6);
    y += 4;
  };
  const bullets = (items: string[]) => items.forEach((b) => {
    ensure(14);
    doc.setFontSize(9.5);
    doc.text("•", M + 4, y);
    text(b, 9.5, { indent: 14 });
  });

  text(d.name || "Resume", 18, { bold: true, align: "center" });
  const contact = [d.email, d.phone, d.location, ...(d.links ?? []).slice(0, 3)].filter(Boolean).join("  ·  ");
  if (contact) text(contact, 9, { color: 75, align: "center" });
  if (d.summary) { section("Summary"); text(d.summary, 9.5); }
  if (d.skills?.length) { section("Skills"); text(d.skills.join(", "), 9.5); }
  if (d.experience?.length) {
    section("Experience");
    for (const e of d.experience) {
      text(`${[e.title, e.company].filter(Boolean).join(" — ")}${e.start || e.end ? `   ${[e.start, e.end].filter(Boolean).join(" – ")}` : ""}`, 9.5, { bold: true });
      bullets(e.bullets ?? []);
      y += 3;
    }
  }
  if (d.projects?.length) {
    section("Projects");
    for (const p of d.projects) text(`${p.name}${p.tech?.length ? ` (${p.tech.join(", ")})` : ""}: ${p.description}`, 9.5);
  }
  if (d.education?.length) {
    section("Education");
    for (const e of d.education) text([e.degree, e.institution, e.score, [e.start, e.end].filter(Boolean).join(" – ")].filter(Boolean).join(", "), 9.5);
  }
  if (d.certifications?.length) { section("Certifications"); bullets(d.certifications); }
  if (d.achievements?.length) { section("Achievements"); bullets(d.achievements); }
  const safe = (d.name || "My").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "My";
  return { name: `${safe}_Resume.pdf`, blob: doc.output("blob") };
}
