/**
 * The rule-based resume reader: text → structured profile, with no AI involved. Pure functions, so every layout
 * Kold supports is checked by web/test/resume.test.ts. Lines may carry " | " between fields and "• " for bullets
 * (pdf-lines.ts and the DOCX reader add these from the document's layout).
 */
import { findSkills, norm } from "./text";
import type { Education, Experience, Profile, Project } from "@/lib/types";

export const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}/;
export const URL_RE = /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in\/[\w-]+|github\.com\/[\w-]+|[\w-]+(?:\.[\w-]+)*\.(?:dev|io|me|app|site|vercel\.app|netlify\.app|github\.io)(?:\/[\w\-./?=#%]*)?)/gi;
const MON = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const ONE_DATE = `(?:${MON}\\s*['’]?\\d{2,4}|\\d{1,2}[/.-]\\d{4}|(?:19|20)\\d{2})`;
const DATE = new RegExp(`(${ONE_DATE})\\s*(?:-|–|—|to|till|until)\\s*(${ONE_DATE}|present|current|now|ongoing|till date|date)`, "i");
const SINGLE_DATE = new RegExp(`(?:^|[\\s(|,])(${MON}\\s*\\d{4}|(?:19|20)\\d{2})(?=$|[\\s)|,])`, "i");

const HEADINGS: Record<string, RegExp> = {
  summary: /^(summary|objective|profile|about( me)?|overview|career (objective|summary)|professional (summary|profile)|personal (profile|statement))$/,
  experience: /^((work|professional|relevant|industry|industrial) )?(experience|experiences|exposure)|employment( history)?|work history|career history|internships?( (and|&) (training|experience))?|(experience|work) (and|&) internships?|internship experience$/,
  education: /^(education(al)?( background| qualifications?| details)?|academics?|academic (background|qualifications?|details|profile|record)|qualifications?|scholastic (profile|record))$/,
  skills: /^((technical|key|core|relevant|professional) )?skills( summary| (and|&) (tools|technologies|interests|expertise))?|technologies|technical (stack|expertise)|tech stack|tools( (and|&) technologies)?|core competencies|competencies|areas of expertise|expertise$/,
  projects: /^(((academic|personal|key|major|selected|notable|side|technical) )?projects?( work)?)$/,
  certifications: /^(certifications?( (and|&) (courses|training|licenses))?|courses( (and|&) certifications)?|licenses( (and|&) certifications)?|certificates|trainings?( (and|&) certifications)?|online courses)$/,
  achievements: /^(achievements?|awards( (and|&) (achievements|honou?rs))?|honou?rs( (and|&) awards)?|accomplishments|positions? of responsibility|extra[- ]?curricular( activities)?|leadership( (and|&) activities| experience)?|activities|volunteer(ing)?( experience)?|co-?curricular activities)$/,
  other: /^(languages( known)?|interests|hobbies( (and|&) interests)?|references|declaration|personal (details|information)|strengths|contact|contact (me|details|information))$/,
};
const SOFT = new Set(["Sales", "Communication", "Leadership", "Public Speaking", "Accounting", "Business Development", "Market Research",
  "Social Media", "Content Writing", "Copywriting", "CRM"]);
const DEGREE = /\b(b\.?\s?tech|b\.?\s?e\b\.?|b\.?\s?sc|b\.?\s?com|b\.?\s?a\b\.?|bca|bba|b\.?\s?des|b\.?\s?arch|b\.?\s?pharm|mca|m\.?\s?tech|m\.?\s?sc|m\.?\s?e\b\.?|m\.?\s?com|m\.?\s?a\b\.?|mba|pgdm|ph\.?\s?d|bachelor(?:'s)?|master(?:'s)?|diploma|class\s*(x|xii|10|12)(th)?|(10|12)th|x(ii)?th|hsc|ssc|cbse|icse|isc|higher secondary|senior secondary|secondary school|matriculation|intermediate|puc)\b/i;
const INSTITUTION = /\b(university|universit[ée]|institute|institution|college|school|iit|nit|iiit|iim|bits|academy|vidyalaya|vidyapeeth|polytechnic|nmims|amity|vit|srm|manipal)\b/i;
const ROLE = /\b(intern(ship)?|trainee|apprentice|engineer|developer|programmer|analyst|scientist|researcher|research (assistant|associate|fellow)|assistant|associate|consultant|manager|lead|head|director|officer|executive|specialist|designer|architect|administrator|coordinator|representative|fellow|volunteer|founder|co-?founder|tutor|instructor|teacher|writer|editor|marketer|strategist|accountant|auditor|advisor|technician|sde|swe|freelancer?)\b/i;
const COMPANY_END = /^(.+?\b(?:llp|ltd\.?|limited|inc\.?|pvt\.?(?: ltd\.?)?|private limited|technologies|labs|solutions|systems|corp\.?|corporation|llc|gmbh|services|software|consulting|ventures|bank))\s+(.+)$/i;
const WORKPLACE = /^(remote|hybrid|on-?site|in[- ]office|wfh|work from home|full[- ]time|part[- ]time|contract|freelance|internship|live|personal|ongoing|in (active )?development|open[- ]source|hackathon|team project|solo)$/i;
const CITIES = "bengaluru|bangalore|mumbai|navi mumbai|thane|pune|delhi|new delhi|ncr|gurugram|gurgaon|noida|hyderabad|secunderabad|chennai|kolkata|ahmedabad|jaipur|kochi|cochin|chandigarh|indore|bhopal|lucknow|nagpur|coimbatore|thiruvananthapuram|trivandrum|mysuru|mysore|vadodara|surat|patna|bhubaneswar|goa|mangaluru|mangalore|visakhapatnam|vizag|nashik|aurangabad|ranchi|dehradun|vellore|manipal|kanpur|kharagpur|roorkee|guwahati|warangal|trichy|tiruchirappalli|madurai|udupi";
const LOCATION = new RegExp(`^((${CITIES})(,\\s*[a-z .]+)?|india|usa|us|uk|united states|united kingdom|singapore|dubai|uae|germany|canada|australia|remote|[a-z .]+,\\s*(india|usa|uk|[A-Z]{2}))$`, "i");
const BULLET = /^[•●▪◦○■□➢➤►▸‣⁃✓✔*–-]\s+/;
const SCORE = /\b(?:cgpa|gpa|cpi|sgpa|percentage|score|marks)?\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,2})?\s*\/\s*10(?:\.0)?|\d{1,3}(?:\.\d{1,2})?\s*%|(?<=(?:cgpa|gpa|cpi|sgpa)\s*[:\-]?\s*)\d{1,2}(?:\.\d{1,2})?)/i;

// ---------------------------------------------------------------------------------------------- small helpers
const isBullet = (l: string) => BULLET.test(l);
const stripBullet = (l: string) => l.replace(BULLET, "").trim();
const flat = (l: string) => l.replace(/\s*\|\s*/g, " ").replace(/\s{2,}/g, " ").trim();
const isLocation = (s: string) => LOCATION.test(s.trim().replace(/[()]/g, ""));
const titleCase = (s: string) => s.split(/\s+/).map((w) => (w.length > 3 && w === w.toUpperCase() && /[A-Z]/.test(w) && !w.includes("/") ? w[0] + w.slice(1).toLowerCase() : w)).join(" ");

function headingOf(line: string): string | null {
  const bare = line.replace(/[:•\-–|_=#*]+$/, "").replace(/^[^a-z0-9]+/i, "").trim().toLowerCase().replace(/\s+/g, " ");
  if (bare.length < 3 || bare.length > 45) return null;
  for (const [k, re] of Object.entries(HEADINGS)) if (re.test(bare)) return k;
  return null;
}

export function sectionsOf(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = { _top: [] };
  let cur = "_top";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const hit = headingOf(line);
    if (hit) {
      cur = hit;
      out[cur] = out[cur] ?? [];
    } else (out[cur] = out[cur] ?? []).push(line);
  }
  return out;
}

/** A line that only lists tools ("Python · SQL · Airflow"), as many templates put under each job or project. */
function isToolsLine(l: string): boolean {
  if (isBullet(l) || /[.!?]$/.test(l) || DATE.test(l) || SINGLE_DATE.test(l) || /@|https?:|\.(com|io|app|dev)\b/i.test(l)) return false;
  if (l.includes(" | ") && !findSkills(l.split(" | ")[0]).length && !/^(tech|tools|stack|skills|built with)/i.test(l)) return false;
  const parts = l.replace(/^(tech(nologies)?|tools|stack|skills|built with)\s*:\s*/i, "").split(/\s*[·,|•;]\s*/).filter(Boolean);
  if (parts.length < 2 || parts.some((p) => p.split(/\s+/).length > 4)) return false;
  const known = parts.filter((p) => findSkills(p).length > 0).length;
  return known / parts.length >= 0.5;
}

/** Splits a header into fields: " | ", wide gaps, " — ", " · ", " @ ", and "(dates)". */
function fieldsOf(head: string): string[] {
  return head
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\(([^)]*)\)/g, (m, inner: string) => (WORKPLACE.test(inner.trim()) || isLocation(inner) ? ` | ${inner} | ` : m))
    .split(/\s*\|\s*|\s+[–—]\s+|\s+@\s+|\s{2,}|\s+·\s+/)
    .map((s) => s.trim().replace(/^[,;·\-–—]+|[,;·\-–—]+$/g, "").trim())
    .filter(Boolean);
}

function dropLocationTail(s: string): string {
  const parts = s.split(/,\s*/);
  while (parts.length > 1 && isLocation(parts[parts.length - 1])) parts.pop();
  if (parts.length > 1 && isLocation(parts.slice(-2).join(", "))) parts.splice(-2, 2);
  return parts.join(", ").trim();
}

function datesIn(s: string): { start: string; end: string; rest: string } {
  const m = s.match(DATE);
  if (m) return { start: tidyDate(m[1]), end: tidyDate(m[2]), rest: s.replace(m[0], " ") };
  const one = s.match(SINGLE_DATE);
  if (one) return { start: "", end: tidyDate(one[1]), rest: s.replace(one[1], " ") };
  return { start: "", end: "", rest: s };
}
const tidyDate = (d: string) => d.trim().replace(/^(present|current|now|ongoing|till date|date)$/i, "Present");

// ---------------------------------------------------------------------------------------------- entries
type Block = { head: string[]; body: string[] };

/** Groups a section's lines into entries: one or more header lines, then their description. */
function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let cur: Block | null = null;
  for (const l of lines) {
    const tools = isToolsLine(l);
    const headish = !isBullet(l) && !tools && (DATE.test(l) || l.includes(" | ") || (l.length <= 75 && !/[.!?]$/.test(l) && !/^[a-z]/.test(l)));
    if (headish) {
      const newEntry = !cur || cur.body.length > 0 || cur.head.length >= 3 || (DATE.test(l) && cur.head.some((h) => DATE.test(h)));
      if (newEntry) out.push((cur = { head: [l], body: [] }));
      else cur!.head.push(l);
    } else {
      if (!cur) out.push((cur = { head: [], body: [] }));
      if (!isBullet(l) && cur.body.length && !tools && /^[a-z(]/.test(l)) cur.body[cur.body.length - 1] += ` ${l}`; // wrapped
      else cur.body.push(tools ? `\u0001${l}` : l);
    }
  }
  return out;
}
const descriptions = (b: Block) => b.body.filter((l) => !l.startsWith("\u0001")).map((l) => flat(stripBullet(l))).filter((l) => l.length > 3);
const toolsOf = (b: Block) => b.body.filter((l) => l.startsWith("\u0001")).flatMap((l) => l.slice(1).replace(/^[a-z ]+:\s*/i, "").split(/\s*[·,|•;]\s*/)).map((s) => s.trim()).filter((s) => s && s.length <= 40);

function parseExperience(lines: string[]): Experience[] {
  const out: Experience[] = [];
  for (const b of blocks(lines)) {
    if (!b.head.length) {
      if (out.length) out[out.length - 1].bullets.push(...descriptions(b));
      continue;
    }
    const { start, end, rest } = datesIn(b.head.join(" | "));
    let location = "";
    const fields = fieldsOf(rest).flatMap((f) => {
      if (isLocation(f) || !f.includes(",")) return [f];
      const kept = dropLocationTail(f);
      if (kept !== f) location = location || f.slice(kept.length).replace(/^\s*,\s*/, "");
      return [kept];
    });
    const kept = fields.filter((f) => {
      if (WORKPLACE.test(f)) return false;
      if (isLocation(f)) return (location = location || f), false;
      return !/^\d{4}$/.test(f);
    });
    let ti = kept.findIndex((f) => ROLE.test(f) && f.split(/\s+/).length <= 7);
    if (ti < 0) ti = 0;
    let title = kept[ti] ?? "";
    let company = kept.find((f, i) => i !== ti && f.split(/\s+/).length <= 8) ?? "";
    if (title && !company) {
      // "Acme Technologies Data Analyst" on one line: split after the company's suffix
      const m = title.match(COMPANY_END);
      if (m && ROLE.test(m[2])) [company, title] = [m[1], m[2]];
    }
    out.push({ title, company, location, start, end, bullets: descriptions(b) });
  }
  return out.filter((e) => (e.title || e.company) && (e.bullets.length || e.company || e.start)).slice(0, 12);
}

function parseProjects(lines: string[]): Project[] {
  const out: Project[] = [];
  // "Name: what it is" on one line (common in short resumes)
  const inline = lines.every((l) => /^[•*\-–]?\s*[A-Z][\w .&+#'-]{1,48}?\s*[:–—]\s+.{15,}$/.test(l) || /^[a-z(]/.test(l));
  if (inline) {
    for (const l of lines) {
      const m = stripBullet(l).match(/^([A-Z][\w .&+#'-]{1,48}?)\s*[:–—]\s+(.{15,})$/);
      if (m) out.push({ name: m[1].trim(), description: flat(m[2]), tech: findSkills(m[2]) });
      else if (out.length) out[out.length - 1].description += ` ${l}`;
    }
    return out.slice(0, 10);
  }
  for (const b of blocks(lines)) {
    if (!b.head.length) {
      if (out.length) out[out.length - 1].description = `${out[out.length - 1].description} ${descriptions(b).join(" ")}`.trim();
      continue;
    }
    const head = b.head.join(" | ");
    const link = (head.match(URL_RE) ?? [])[0]?.replace(/^https?:\/\/(www\.)?/, "") ?? "";
    const { rest } = datesIn(head.replace(URL_RE, " "));
    const fields = fieldsOf(rest).filter((f) => !WORKPLACE.test(f) && !isLocation(f));
    let name = fields[0] ?? "";
    let tagline = fields.slice(1).filter((f) => !isToolsLine(f) && !(f.split(/\s*,\s*/).length > 1 && findSkills(f).length >= 2)).join(" · ");
    const headTools = fields.slice(1).filter((f) => f.split(/\s*,\s*/).length > 1 && findSkills(f).length >= 2).flatMap((f) => f.split(/\s*,\s*/));
    const m = name.match(/^(.{2,48}?)\s*[:–—]\s+(.{10,})$/);
    if (m) [name, tagline] = [m[1], [m[2], tagline].filter(Boolean).join(" · ")];
    const desc = descriptions(b).join(" ");
    const description = [tagline && desc ? `${tagline}.` : tagline, desc].filter(Boolean).join(" ").replace(/\.\./g, ".").trim();
    if (!name || name.split(/\s+/).length > 8) continue;
    const tech = [...new Set([...toolsOf(b), ...headTools, ...findSkills(`${head} ${desc}`)])];
    out.push({ name, description, tech, ...(link ? { link } : {}) });
  }
  return out.filter((p) => p.description).slice(0, 10);
}

function parseEducation(lines: string[]): Education[] {
  const out: Education[] = [];
  let cur: Education | null = null;
  const push = () => cur && (cur.degree || cur.institution) && out.push(cur);
  for (const raw of lines) {
    const l = stripBullet(raw);
    const { start, end, rest } = datesIn(l);
    const score = l.match(SCORE)?.[1]?.replace(/\s+/g, "") ?? "";
    let fields = fieldsOf(rest.replace(SCORE, " ").replace(/\b(cgpa|gpa|cpi|sgpa|percentage)\b\s*[:\-]?/gi, " "));
    // Commas separate fields only when the line packs several of them (degree + institution, or with dates/score).
    fields = fields.flatMap((f) => (f.includes(",") && ((DEGREE.test(f) && INSTITUTION.test(f)) || start || end || score || (INSTITUTION.test(f) && isLocation(f.split(/,\s*/).pop()!))) ? f.split(/\s*,\s*/) : [f]));
    fields = fields.map(dropLocationTail).filter((f) => f && !isLocation(f) && !WORKPLACE.test(f) && !/^(cgpa|gpa|cpi|score|marks)$/i.test(f));
    let di = fields.findIndex((f) => DEGREE.test(f));
    const ii = fields.findIndex((f, i) => i !== di && INSTITUTION.test(f));
    // "MBA, Business Analytics": a short degree is followed by its field
    if (di >= 0 && fields[di].length <= 7 && fields[di + 1] && di + 1 !== ii && !INSTITUTION.test(fields[di + 1]) && !DEGREE.test(fields[di + 1])) {
      fields.splice(di, 2, `${fields[di]}, ${fields[di + 1]}`);
    }
    di = fields.findIndex((f) => DEGREE.test(f));
    const degree = di >= 0 ? fields[di] : "";
    let institution = fields.find((f, i) => i !== di && INSTITUTION.test(f)) ?? "";
    if (!institution && degree) institution = fields.find((f, i) => i !== di && f.split(/\s+/).length <= 8) ?? "";
    if (!degree && !institution) {
      // a line of extra detail for the entry above: dates, score
      if (cur) {
        if (!cur.start && start) cur.start = start;
        if (!cur.end && end) cur.end = end;
        if (!cur.score && score) cur.score = score;
      }
      continue;
    }
    if (!cur || (degree && cur.degree) || (institution && cur.institution && !degree)) {
      push();
      cur = { degree: "", institution: "", start: "", end: "", score: "" };
    }
    if (degree) cur.degree = degree;
    if (institution && !cur.institution) cur.institution = institution;
    if (start && !cur.start) cur.start = start;
    if (end && !cur.end) cur.end = end;
    if (score && !cur.score) cur.score = score;
  }
  push();
  return out.slice(0, 6);
}

function parseSkills(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    let l = stripBullet(raw);
    const cat = l.match(/^([^,|:]{2,30}?)\s*(?::|\|)\s*(.+)$/); // "Languages: …" or "Languages | …"
    if (cat && !findSkills(cat[1]).length) l = cat[2];
    else if (cat && cat[2].includes(",")) l = cat[2];
    for (const s of l.split(/\s*[,;•·|]\s*|\s+\/\s+(?=[A-Z])/)) {
      const t = s.replace(/^(and|&)\s+/i, "").replace(/[.]$/, "").trim();
      if ((t.length > 1 || /^[RC]$/.test(t)) && t.length <= 40 && t.split(/\s+/).length <= 5) out.push(t);
    }
  }
  return out;
}

function listItems(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (!isBullet(l) && out.length && /^[a-z(]/.test(l)) out[out.length - 1] += ` ${l}`;
    else out.push(flat(stripBullet(l)));
  }
  return out.filter((x) => x.length > 3).slice(0, 12);
}

// ---------------------------------------------------------------------------------------------- whole resume
export function experienceLevel(text: string, edu: Education[], exp: Experience[]): Profile["experience_level"] {
  const year = new Date().getFullYear();
  if (/\b(expected|pursuing|currently studying|ongoing|final[- ]year|pre-final)\b/i.test(text) || edu.some((e) => Number((e.end ?? "").match(/\d{4}/)?.[0] ?? 0) > year)) return "student";
  let months = 0;
  for (const e of exp) {
    if (/intern|trainee|assistant|volunteer/i.test(e.title)) continue;
    const s = Number((e.start ?? "").match(/\d{4}/)?.[0] ?? 0);
    const en = /present|current|now/i.test(e.end ?? "") ? year : Number((e.end ?? "").match(/\d{4}/)?.[0] ?? 0);
    if (s && en >= s) months += (en - s) * 12 || 6;
  }
  const yrs = months / 12;
  return yrs < 1 ? "fresher" : yrs < 3 ? "1-3" : yrs < 5 ? "3-5" : "5+";
}

export function suggestRoles(skills: string[], exp: Experience[]): string[] {
  const has = (...xs: string[]) => xs.some((x) => skills.some((s) => s.toLowerCase() === x.toLowerCase()));
  const roles: string[] = [];
  if (has("Machine Learning", "Deep Learning", "PyTorch", "TensorFlow", "scikit-learn", "NLP", "Computer Vision", "XGBoost", "Hugging Face",
    "Hugging Face Transformers", "Transformers", "LLM", "LoRA", "PEFT", "FLAN-T5", "Generative AI", "LangChain", "OpenCV", "Keras")) roles.push("Machine Learning Engineer", "Data Scientist");
  if (has("SQL", "Power BI", "Tableau", "Excel", "Pandas", "Data Analysis", "Looker", "Statistics")) roles.push("Data Analyst");
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
  const recent = exp[0]?.title.replace(/\b(intern(ship)?|trainee)\b/gi, "").replace(/\s{2,}/g, " ").trim();
  if (recent && recent.length > 3 && ROLE.test(exp[0].title)) {
    const i = roles.findIndex((r) => r.toLowerCase() === recent.toLowerCase());
    if (i >= 0) roles.splice(i, 1);
    roles.unshift(recent);
  }
  return [...new Set(roles)].slice(0, 5);
}

export function ruleParse(text: string): Profile {
  const sec = sectionsOf(text);
  const top = sec._top ?? [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const nameOk = (l: string) => !l.match(EMAIL) && !/\d{3}/.test(l) && !/[@/|]/.test(l) && l.split(/\s+/).length >= 2 && l.split(/\s+/).length <= 5 && /^[A-Za-z .'-]+$/.test(l) && !headingOf(l) && !isLocation(l) && !INSTITUTION.test(l);
  const rawName = lines.slice(0, 8).map((l) => l.split(" | ")[0]).find(nameOk) ?? "";
  const name = rawName === rawName.toUpperCase() ? titleCase(rawName.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())) : rawName;
  const emails = text.match(EMAIL) ?? [];
  const links = [...new Set((text.replace(EMAIL, " ").match(URL_RE) ?? []).map((u) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")))]
    .filter((u) => /^(linkedin|github)\./i.test(u) || !/^[A-Z]/.test(u));
  const contact = [...top, ...(sec.other ?? [])]; // sidebars put phone and city under "Contact"
  const topText = contact.join("\n");
  const phone = (topText.replace(EMAIL, " ").replace(URL_RE, " ").match(PHONE) ?? [""])[0].trim();
  const location = contact.flatMap((l) => l.split(/\s*\|\s*/)).find((f) => isLocation(f) && !/^remote$/i.test(f)) ?? "";
  const headlineLine = top.slice(0, 8).flatMap((l) => l.split(/\s*\|\s*/)).find((f) => f !== rawName && f.split(/\s+/).length <= 7 && f.length >= 4 &&
    !/[@\d]/.test(f) && !f.match(URL_RE) && !isLocation(f) && !/[.,]$/.test(f) && /[a-z]/i.test(f) && (ROLE.test(f) || f === f.toUpperCase() || /\b(student|graduate|enthusiast|engineering|data|science|design)\b/i.test(f)));
  const headline = headlineLine ? titleCase(headlineLine) : "";
  const summary = (sec.summary?.length ? sec.summary : top.filter((l) => l.split(/\s+/).length >= 8 && !l.match(EMAIL)))
    .map(flat).join(" ").slice(0, 700);

  const listed = parseSkills([...(sec.skills ?? [])]);
  const tools = [...(sec.experience ?? []), ...(sec.projects ?? [])].filter(isToolsLine).flatMap((l) => l.replace(/^[a-z ]+:\s*/i, "").split(/\s*[·,|•;]\s*/)).map((s) => s.trim()).filter((s) => s.length > 1 && s.length <= 40);
  const scanned = findSkills(text).filter((s) => !SOFT.has(s) || listed.some((l) => l.toLowerCase() === s.toLowerCase()));
  const skills = [...new Map([...listed, ...tools, ...scanned].map((s) => [s.toLowerCase(), s])).values()];

  const experience = parseExperience(sec.experience ?? []);
  const education = parseEducation(sec.education ?? []);
  return {
    name, headline, email: emails[0] ?? "", phone, location, links: links.slice(0, 6), summary, skills: skills.slice(0, 60),
    experience, education, projects: parseProjects(sec.projects ?? []),
    certifications: listItems(sec.certifications ?? []).slice(0, 10),
    achievements: listItems(sec.achievements ?? []).slice(0, 10),
    experience_level: experienceLevel(text, education, experience),
    suggested_roles: suggestRoles(/\b(AI\/ML|AI|ML|machine learning)\b/i.test(headline) ? [...skills, "Machine Learning"] : skills, experience),
  };
}

// ---------------------------------------------------------------------------------------------- verification
const inText = (v: string, nt: string) => !!norm(v) && nt.includes(norm(v));

/** Anything that isn't actually written in the resume is dropped. Kold never invents facts about the user. */
export function verify(data: Profile, text: string): Profile {
  const nt = norm(text);
  const name = (data.name ?? "").trim();
  if (!name || !new RegExp(`(?<![\\w.@/-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.@/-])`, "i").test(text)) data.name = ruleParse(text).name;
  data.skills = [...new Set(data.skills ?? [])].filter((s) => inText(s, nt));
  const emails = text.match(EMAIL) ?? [];
  data.links = (data.links ?? []).filter((l) => inText(l.replace(/^https?:\/\/(www\.)?/, ""), nt) && !emails.some((e) => e.includes(l)));
  if (!data.email || !inText(data.email, nt)) data.email = emails[0] ?? "";
  data.experience = (data.experience ?? []).filter((e) => !e.company || inText(e.company, nt));
  data.education = (data.education ?? []).filter((e) => !e.institution || inText(e.institution, nt));
  for (const k of ["certifications", "achievements", "suggested_roles"] as const) data[k] = (data[k] ?? []).filter(Boolean);
  return data;
}
