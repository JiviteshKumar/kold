"use client";

/**
 * Resume → profile, entirely on the device.
 * 1. Extract text (PDF via pdf.js, DOCX via mammoth, TXT).
 * 2. Structure it with careful rules; if on-device AI is ready, also ask it and merge.
 * 3. Verify: anything not actually written in the resume is dropped. Kold never invents facts about the user.
 */
import { aiLabel, aiReady, generateJson } from "./ai";
import { findSkills, norm } from "./text";
import type { Education, Experience, Profile, Project } from "@/lib/types";

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}/;
const URL_RE = /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in\/[\w-]+|github\.com\/[\w-]+|[\w-]+\.(?:dev|io|me|app|site|vercel\.app|netlify\.app|github\.io)(?:\/[\w\-./?=#%]*)?)/gi;
const DATE = /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d{4}|\d{1,2}\/\d{4}|\d{4})\s*(?:-|–|—|to)\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d{4}|\d{1,2}\/\d{4}|\d{4}|present|current|now|ongoing)/i;
const HEADINGS: Record<string, RegExp> = {
  summary: /^(summary|objective|profile|about me|career objective|professional summary)$/i,
  experience: /^((work |professional )?experience|employment( history)?|internships?|work history)$/i,
  education: /^(education|academics?|academic (background|qualifications?)|qualifications?)$/i,
  skills: /^((technical |key |core )?skills|technologies|tech stack|tools( & technologies)?|skills (& |and )?(tools|interests))$/i,
  projects: /^((academic |personal |key )?projects?)$/i,
  certifications: /^(certifications?|courses|licenses|certificates)$/i,
  achievements: /^(achievements?|awards|honou?rs|accomplishments|positions of responsibility|extra[- ]?curricular( activities)?|leadership)$/i,
};
const SOFT = new Set(["Sales", "Communication", "Leadership", "Public Speaking", "Accounting", "Business Development", "Market Research",
  "Social Media", "Content Writing", "Copywriting", "CRM"]);
const DEGREE = /\b(b\.?\s?tech|b\.?\s?e\.?|b\.?\s?sc|b\.?\s?com|b\.?\s?a\.?|bca|mca|m\.?\s?tech|m\.?\s?sc|m\.?\s?e\.?|mba|ph\.?d|bachelor|master|diploma|class (x|xii|10|12)|hsc|ssc|cbse|icse)\b/i;
const INSTITUTION = /\b(university|institute|college|school|iit|nit|iiit|bits|academy|vidyalaya)\b/i;

// ---------------------------------------------------------------------------------------------- text extraction
export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  let text = "";
  if (name.endsWith(".pdf")) text = await pdfText(file);
  else if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  } else text = await file.text();
  return text.replace(/[•●▪]/g, "\n• ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function pdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Rebuild lines from positioned text items (top-to-bottom, left-to-right).
    const items = (content.items as { str: string; transform: number[]; width: number }[]).filter((i) => i.str?.trim());
    const lines = new Map<number, { x: number; s: string; w: number }[]>();
    for (const it of items) {
      const y = Math.round(it.transform[5] / 2) * 2;
      const key = [...lines.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      lines.set(key, [...(lines.get(key) ?? []), { x: it.transform[4], s: it.str, w: it.width }]);
    }
    const ordered = [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, segs]) => {
      segs.sort((a, b) => a.x - b.x);
      let out = "";
      let end = -1;
      for (const sg of segs) {
        out += end >= 0 && sg.x - end > 12 ? "  " : end >= 0 && sg.x - end > 1 ? " " : "";
        out += sg.s;
        end = sg.x + sg.w;
      }
      return out.trim();
    });
    // Hyperlinks (LinkedIn/GitHub icons) often exist only as annotations.
    const annots = await page.getAnnotations().catch(() => []);
    for (const a of annots as { url?: string }[]) if (a.url) ordered.push(a.url);
    pages.push(ordered.join("\n"));
  }
  return pages.join("\n");
}

// ---------------------------------------------------------------------------------------------- rule-based parse
function sectionsOf(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = { _top: [] };
  let cur = "_top";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bare = line.replace(/[:•\-–|]+$/, "").trim();
    let hit: string | null = null;
    if (bare.length > 2 && bare.length < 45) {
      for (const [k, re] of Object.entries(HEADINGS)) if (re.test(bare)) hit = k;
    }
    if (hit) {
      cur = hit;
      out[cur] = out[cur] ?? [];
    } else if (line) (out[cur] = out[cur] ?? []).push(line);
  }
  return out;
}

const isBullet = (l: string) => /^[•\-*▪●◦–]\s*/.test(l);
const stripBullet = (l: string) => l.replace(/^[•\-*▪●◦–]\s*/, "").trim();

function bulletsOf(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (isBullet(l)) out.push(stripBullet(l));
    else if (out.length && /^[a-z(]/.test(l)) out[out.length - 1] += " " + l; // wrapped line
  }
  return out.filter((b) => b.length > 3);
}

function parseExperience(lines: string[]): Experience[] {
  const out: Experience[] = [];
  let cur: Experience | null = null;
  for (const l of lines) {
    if (isBullet(l)) {
      if (!cur) cur = { title: "", company: "", start: "", end: "", bullets: [] };
      cur.bullets.push(stripBullet(l));
      continue;
    }
    if (cur && /^[a-z(]/.test(l) && cur.bullets.length) {
      cur.bullets[cur.bullets.length - 1] += " " + l;
      continue;
    }
    // A header line: "Title, Company, City (Mon YYYY - Mon YYYY)" / "Title | Company | dates" / "Title at Company"
    if (cur && (cur.title || cur.bullets.length)) out.push(cur);
    const dm = l.match(DATE);
    const head = (dm ? l.replace(dm[0], "") : l).replace(/[()]/g, " ").replace(/\s{2,}/g, " ").trim().replace(/[,|–—-]+$/, "").trim();
    let title = head, company = "";
    const at = head.match(/^(.*?)\s+(?:at|@)\s+(.*)$/i);
    const parts = head.split(/\s*[|,–—]\s*|\s{2,}/).filter(Boolean);
    if (at) [title, company] = [at[1], at[2]];
    else if (parts.length >= 2) [title, company] = [parts[0], parts[1]];
    cur = { title: title.trim(), company: company.trim(), start: dm?.[1] ?? "", end: dm?.[2] ?? "", bullets: [] };
  }
  if (cur && (cur.title || cur.bullets.length)) out.push(cur);
  return out.filter((e) => e.bullets.length || e.company);
}

function parseEducation(lines: string[]): Education[] {
  const out: Education[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!DEGREE.test(l) && !INSTITUTION.test(l)) continue;
    const block = [l, lines[i + 1] ?? ""].join(" | ");
    const dm = block.match(DATE) ?? block.match(/\b(20\d\d)\b.*?\b(20\d\d)\b/);
    const score = block.match(/(cgpa|gpa|percentage|score)?\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,2})?\s*(?:\/\s*10|%|cgpa)|\d{1,2}\.\d{1,2})/i);
    const segs = l.split(/\s*[,|–—]\s*/);
    const degree = segs.find((s) => DEGREE.test(s)) ?? (DEGREE.test(l) ? l : "");
    const inst = segs.find((s) => INSTITUTION.test(s)) ?? (lines[i + 1] && INSTITUTION.test(lines[i + 1]) ? lines[i + 1] : "");
    out.push({ degree: degree.trim(), institution: inst.trim(), start: dm?.[1] ?? "", end: dm?.[2] ?? "", score: score ? score[0].replace(/^[|:\s-]+/, "").trim() : "" });
    if (inst === lines[i + 1]) i++;
  }
  return out.slice(0, 4);
}

function parseProjects(lines: string[]): Project[] {
  const out: Project[] = [];
  for (const raw of lines) {
    const l = stripBullet(raw);
    const m = l.match(/^([A-Z][\w .&+#'-]{1,48}?)\s*[:–—-]\s+(.{15,})$/);
    if (m) out.push({ name: m[1].trim(), description: m[2].trim(), tech: findSkills(m[2]) });
    else if (out.length && (isBullet(raw) || /^[a-z(]/.test(l))) out[out.length - 1].description += " " + l;
    else if (l.length > 3 && l.length < 60 && !/[.]$/.test(l)) out.push({ name: l, description: "", tech: [] });
  }
  return out.filter((p) => p.description).slice(0, 8);
}

function suggestRoles(skills: string[], exp: Experience[]): string[] {
  const has = (...xs: string[]) => xs.some((x) => skills.includes(x));
  const roles: string[] = [];
  if (has("Machine Learning", "Deep Learning", "PyTorch", "TensorFlow", "scikit-learn", "NLP", "Computer Vision")) roles.push("Machine Learning Engineer", "Data Scientist");
  if (has("SQL", "Power BI", "Tableau", "Excel", "Pandas", "Data Analysis", "Looker")) roles.push("Data Analyst");
  const fe = has("React", "Angular", "Vue", "Next.js", "HTML", "CSS", "JavaScript", "TypeScript");
  const be = has("Node.js", "Django", "Flask", "FastAPI", "Spring", "Spring Boot", "Express", "PostgreSQL", "MongoDB", "Java", "Golang");
  if (fe && be) roles.push("Full Stack Developer");
  if (fe) roles.push("Frontend Developer");
  if (be) roles.push("Backend Developer");
  if (has("Android", "iOS", "Flutter", "React Native", "Kotlin", "Swift")) roles.push("Mobile Developer");
  if (has("AWS", "Docker", "Kubernetes", "Terraform", "CI/CD", "Linux")) roles.push("DevOps Engineer");
  if (has("Figma", "UI/UX", "Adobe XD", "Wireframing", "Prototyping")) roles.push("UI/UX Designer");
  if (has("Digital Marketing", "SEO", "SEM", "Google Analytics", "Social Media")) roles.push("Digital Marketing Associate");
  if (has("Product Management")) roles.push("Product Manager");
  // The user's own most recent title is the strongest signal of what they want next: put it first.
  const recent = exp[0]?.title.replace(/\b(intern(ship)?|trainee)\b/gi, "").trim();
  if (recent && recent.length > 3) {
    const i = roles.findIndex((r) => r.toLowerCase() === recent.toLowerCase());
    if (i >= 0) roles.splice(i, 1);
    roles.unshift(recent);
  }
  return [...new Set(roles)].slice(0, 5);
}

function experienceLevel(text: string, edu: Education[], exp: Experience[]): Profile["experience_level"] {
  const year = new Date().getFullYear();
  if (/\b(expected|pursuing|currently studying|ongoing)\b/i.test(text) || edu.some((e) => Number((e.end ?? "").match(/\d{4}/)?.[0] ?? 0) > year)) return "student";
  let months = 0;
  for (const e of exp) {
    if (/intern|trainee/i.test(e.title)) continue;
    const s = Number((e.start ?? "").match(/\d{4}/)?.[0] ?? 0);
    const en = /present|current|now/i.test(e.end ?? "") ? year : Number((e.end ?? "").match(/\d{4}/)?.[0] ?? 0);
    if (s && en >= s) months += (en - s) * 12 || 6;
  }
  const yrs = months / 12;
  return yrs < 1 ? "fresher" : yrs < 3 ? "1-3" : yrs < 5 ? "3-5" : "5+";
}

export function ruleParse(text: string): Profile {
  const sec = sectionsOf(text);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const name = lines.slice(0, 6).find((l) => !EMAIL.test(l) && !/\d{3}/.test(l) && !/[@|/]/.test(l) && l.split(/\s+/).length <= 5 && /^[A-Za-z .'-]+$/.test(l)) ?? "";
  EMAIL.lastIndex = 0;
  const top = (sec._top ?? []).join("\n");
  const emails = text.match(EMAIL) ?? [];
  const links = [...new Set((text.replace(EMAIL, " ").match(URL_RE) ?? []).map((u) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")))];
  const listed = (sec.skills ?? []).join(",").split(/[,|•;\n]/).map((s) => s.replace(/^[\w &/]+:\s*/, "").replace(/^[•\-*\s]+/, "").trim()).filter((s) => s.length > 1 && s.length <= 30);
  const scanned = findSkills(text).filter((s) => !SOFT.has(s) || listed.some((l) => l.toLowerCase() === s.toLowerCase()));
  const skills = [...new Map([...listed, ...scanned].map((s) => [s.toLowerCase(), s])).values()];
  const experience = parseExperience(sec.experience ?? []);
  const education = parseEducation(sec.education ?? []);
  const location = (top.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?),\s*(India|[A-Z][a-z]+)\b/) ?? [""])[0];
  return {
    name, headline: "", email: emails[0] ?? "", phone: (top.match(PHONE) ?? [""])[0].trim(), location,
    links: links.slice(0, 6), summary: (sec.summary ?? []).join(" ").slice(0, 600), skills: skills.slice(0, 50),
    experience, education, projects: parseProjects(sec.projects ?? []),
    certifications: bulletsOf(sec.certifications ?? []).concat((sec.certifications ?? []).filter((l) => !isBullet(l))).slice(0, 10),
    achievements: bulletsOf(sec.achievements ?? []).slice(0, 10),
    experience_level: experienceLevel(text, education, experience),
    suggested_roles: suggestRoles(skills, experience),
  };
}

// ---------------------------------------------------------------------------------------------- verification
const inText = (v: string, nt: string) => !!norm(v) && nt.includes(norm(v));

export function verify(data: Profile, text: string): Profile {
  const nt = norm(text);
  const name = (data.name ?? "").trim();
  if (!name || !new RegExp(`(?<![\\w.@/-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.@/-])`, "i").test(text)) {
    data.name = ruleParse(text).name;
  }
  data.skills = [...new Set(data.skills ?? [])].filter((s) => inText(s, nt));
  const emails = text.match(EMAIL) ?? [];
  data.links = (data.links ?? []).filter((l) => inText(l.replace(/^https?:\/\/(www\.)?/, ""), nt) && !emails.some((e) => e.includes(l)));
  if (!data.email || !inText(data.email, nt)) data.email = emails[0] ?? "";
  data.experience = (data.experience ?? []).filter((e) => !e.company || inText(e.company, nt));
  data.education = (data.education ?? []).filter((e) => !e.institution || inText(e.institution, nt));
  for (const k of ["certifications", "achievements", "suggested_roles"] as const) data[k] = (data[k] ?? []).filter(Boolean);
  return data;
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
  if ((merged.projects?.length ?? 0) < base.projects.length) merged.projects = base.projects;
  if (!merged.links?.length) merged.links = base.links;
  if (!merged.phone) merged.phone = base.phone;
  if (!merged.suggested_roles?.length) merged.suggested_roles = base.suggested_roles;
  return { profile: merged, method: aiLabel() };
}
