/**
 * The resume reader against real-world layouts (fixtures/make_resumes.py builds them; every person is invented).
 * Each test states what a careful human would copy from that resume into the profile.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { extractText, pageLines } from "@/local/resume";
import { ruleParse, verify } from "@/local/resume-rules";
import type { Profile } from "@/lib/types";

const dir = join(__dirname, "fixtures", "resumes");

async function pdfToText(path: string): Promise<string> {
  const require = createRequire(import.meta.url);
  const pdfjs = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) pages.push((await pageLines(pdfjs, await doc.getPage(p))).join("\n"));
  return pages.join("\n");
}

async function read(name: string): Promise<{ text: string; p: Profile }> {
  const path = join(dir, name);
  const text = name.endsWith(".pdf")
    ? await pdfToText(path)
    : await extractText(new File([readFileSync(path)], name));
  return { text, p: verify(ruleParse(text), text) };
}

const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());

describe("modern layout: spaced headings, font-size headers, indented paragraphs", async () => {
  const { p } = await read("modern-spaced.pdf");
  it("reads the contact block", () => {
    expect(p.name).toBe("Ananya Iyer");
    expect(p.email).toBe("ananya.iyer.dev@example.com");
    expect(p.links).toEqual(expect.arrayContaining(["linkedin.com/in/ananya-iyer-dev", "github.com/ananya-iyer"]));
    expect(p.location).toBe("Bengaluru, India");
    expect(p.headline).toBe("Data Science");
    expect(p.summary).toMatch(/^Final-year engineering student who builds data products end to end, from SQL pipelines to models that ship\./);
  });
  it("splits each job into title, company and dates", () => {
    expect(p.experience).toHaveLength(2);
    expect(p.experience[0]).toMatchObject({ title: "Data Science Intern", company: "Razorpay", start: "May 2025", end: "Aug 2025" });
    expect(p.experience[1]).toMatchObject({ title: "Analytics Intern", company: "Zeta Suite", start: "Dec 2024", end: "Feb 2025" });
  });
  it("joins wrapped paragraphs into whole bullets", () => {
    expect(p.experience[0].bullets).toContain("Built a gradient boosting model that flagged 2,300 risky merchants a month, improving precision by 18% over the rules engine.");
    expect(p.experience[0].bullets).toContain("Automated weekly risk reporting in SQL and Python, saving the team 5 hours a week.");
    expect(p.experience[0].bullets.some((b) => /Python · SQL/.test(b))).toBe(false); // the tools line is not an achievement
    expect(p.experience[1].bullets).toHaveLength(2);
  });
  it("reads projects with their descriptions", () => {
    expect(p.projects.map((x) => x.name)).toEqual(["Churn Radar", "ResumeLens"]);
    expect(p.projects[0].description).toContain("Predicts which subscribers will cancel in the next 30 days from usage logs, with an AUC of 0.87 on held-out data.");
  });
  it("reads education", () => {
    expect(p.education).toHaveLength(1);
    expect(p.education[0]).toMatchObject({ degree: "B.E., Computer Science", institution: "RV College of Engineering", start: "2022", end: "2026", score: "8.9/10" });
  });
  it("lists skills without category labels", () => {
    expect(lower(p.skills)).toEqual(expect.arrayContaining(["python", "sql", "r", "scikit-learn", "xgboost", "pytorch", "nlp", "airflow", "tableau", "git", "docker"]));
    expect(lower(p.skills)).not.toContain("languages");
    expect(lower(p.skills)).not.toContain("tools");
  });
  it("knows the level and suggests roles from the resume", () => {
    expect(p.experience_level).toBe("student");
    expect(p.suggested_roles[0]).toBe("Data Science");
    expect(p.suggested_roles).toEqual(expect.arrayContaining(["Data Scientist", "Data Analyst"]));
  });
});

describe("Jake's Resume (LaTeX) template", async () => {
  const { p } = await read("jakes-template.pdf");
  it("reads the contact line", () => {
    expect(p.name).toBe("Rohan Mehta");
    expect(p.email).toBe("rohan.mehta@example.com");
    expect(p.phone.replace(/\s/g, "")).toBe("+919820012345");
    expect(p.links).toEqual(expect.arrayContaining(["linkedin.com/in/rohanmehta", "github.com/rohanmehta"]));
  });
  it("reads two-line job headers (title + dates, then company + place)", () => {
    expect(p.experience).toHaveLength(2);
    expect(p.experience[0]).toMatchObject({ title: "Software Engineering Intern", company: "Swiggy", location: "Bengaluru, India", start: "May 2024", end: "July 2024" });
    expect(p.experience[0].bullets).toEqual([
      "Cut p95 latency of the restaurant search API from 420 ms to 180 ms by adding a Redis cache.",
      "Wrote load tests in Locust that now run on every release.",
    ]);
    expect(p.experience[1]).toMatchObject({ title: "Undergraduate Researcher", company: "IIT Bombay", start: "Jan. 2023", end: "Dec. 2023" });
  });
  it("reads two-line education", () => {
    expect(p.education[0]).toMatchObject({ degree: "Bachelor of Technology in Electrical Engineering", institution: "Indian Institute of Technology Bombay", start: "Aug. 2021", end: "May 2025" });
  });
  it("reads a project with its tech list", () => {
    expect(p.projects[0].name).toBe("Gitty");
    expect(p.projects[0].description).toContain("A Git analytics dashboard used by 300+ students");
    expect(lower(p.projects[0].tech ?? [])).toEqual(expect.arrayContaining(["python", "flask", "react", "postgresql"]));
  });
  it("reads categorised skills", () => {
    expect(lower(p.skills)).toEqual(expect.arrayContaining(["java", "python", "c/c++", "sql", "javascript", "react", "node.js", "flask", "fastapi", "git", "docker", "aws"]));
    expect(lower(p.skills)).not.toContain("developer tools");
  });
});

describe("classic one-column resume", async () => {
  const { p } = await read("classic.pdf");
  it("reads every section", () => {
    expect(p.name).toBe("Priya Nair");
    expect(p.summary).toBe("Computer science student who enjoys building clean, fast web apps.");
    expect(p.experience.map((e) => [e.title, e.company, e.start, e.end])).toEqual([
      ["Frontend Developer Intern", "UST Global", "Jan 2025", "Apr 2025"],
      ["Teaching Assistant", "Model Engineering College", "Aug 2024", "Dec 2024"],
    ]);
    expect(p.experience[0].bullets).toHaveLength(2);
    expect(p.education[0]).toMatchObject({ degree: "B.Tech in Computer Science", institution: "Model Engineering College", start: "2021", end: "2025", score: "8.4" });
    expect(p.projects.map((x) => x.name)).toEqual(["Bus Buddy", "Notes AI"]);
    expect(p.certifications).toEqual(["AWS Certified Cloud Practitioner (2024)"]);
    expect(p.achievements).toEqual(["Winner, Kerala Startup Mission Hackathon 2024"]);
  });
});

describe("two-column sidebar resume", async () => {
  const { p } = await read("two-column.pdf");
  it("reads the columns separately", () => {
    expect(p.name).toBe("Meera Joshi");
    expect(p.headline).toBe("Data Analyst");
    expect(p.email).toBe("meera.joshi@example.com");
    expect(p.experience).toHaveLength(1);
    expect(p.experience[0]).toMatchObject({ title: "Data Analyst", company: "Deloitte India", start: "Jul 2023", end: "Present" });
    expect(p.experience[0].bullets).toHaveLength(2);
    expect(p.education[0]).toMatchObject({ degree: "B.Sc Computer Science", institution: "St. Xavier's College", start: "2020", end: "2023" });
    expect(p.projects[0]).toMatchObject({ name: "Ride Demand Forecast" });
    expect(lower(p.skills)).toEqual(expect.arrayContaining(["sql", "python", "power bi", "excel", "statistics"]));
    expect(p.summary).toContain("Analyst who turns messy operational data into decisions.");
  });
});

describe("Word document (.docx), experienced professional", async () => {
  const { p } = await read("experienced.docx");
  it("reads jobs written as title, company and dates on separate lines", () => {
    expect(p.name).toBe("Vikram Rao");
    expect(p.experience.map((e) => [e.title, e.company, e.start, e.end])).toEqual([
      ["Senior Data Analyst", "Flipkart", "March 2021", "Present"],
      ["Data Analyst", "Mu Sigma", "June 2018", "February 2021"],
    ]);
    expect(p.experience[0].bullets).toHaveLength(2);
    expect(p.experience_level).toBe("5+");
  });
  it("reads education written on one line each", () => {
    expect(p.education.map((e) => [e.degree, e.institution, e.end])).toEqual([
      ["MBA, Business Analytics", "NMIMS Mumbai", "2018"],
      ["B.Com", "Christ University", "2016"],
    ]);
  });
  it("reads skills separated by dots", () => {
    expect(lower(p.skills)).toEqual(expect.arrayContaining(["sql", "python", "r", "tableau", "power bi", "excel", "statistics"]));
  });
});

describe("plain text, fresher with school results", async () => {
  const { p } = await read("fresher.txt");
  it("reads internships, school rows and inline projects", () => {
    expect(p.name).toBe("Kabir Singh");
    expect(p.experience).toHaveLength(1);
    expect(p.experience[0]).toMatchObject({ title: "Web Development Intern", company: "Infosys", start: "Jan 2025", end: "Mar 2025" });
    expect(p.experience[0].bullets).toHaveLength(2);
    expect(p.education.map((e) => [e.degree, e.institution, e.end, e.score])).toEqual([
      ["B.Tech (CSE)", "Amity University", "2025", "7.8"],
      ["Class XII (CBSE)", "Delhi Public School", "2021", "91%"],
      ["Class X (CBSE)", "Delhi Public School", "2019", "94%"],
    ]);
    expect(p.projects[0]).toMatchObject({ name: "Expense Tracker" });
  });
});

describe("never invents anything", async () => {
  it("drops facts the resume doesn't contain", () => {
    const text = "Asha Rao\nasha@example.com\nSKILLS\nPython, SQL";
    const p = verify({ ...ruleParse(text), skills: ["Python", "Kubernetes"], experience: [{ title: "SDE", company: "Google", bullets: [] }] }, text);
    expect(p.skills).toEqual(["Python"]);
    expect(p.experience).toEqual([]);
  });
});

// The developer's own resume, when present locally (never committed): KOLD_PRIVATE_RESUME=/path/to/resume.pdf
const privatePath = process.env.KOLD_PRIVATE_RESUME;
describe.skipIf(!privatePath || !existsSync(privatePath))("a real resume (local only)", async () => {
  const text = privatePath && existsSync(privatePath) ? await pdfToText(privatePath) : "";
  const p = text ? verify(ruleParse(text), text) : ({} as Profile);
  it("fills every section", () => {
    expect(p.name).toBeTruthy();
    expect(p.experience.length).toBeGreaterThan(0);
    expect(p.experience.every((e) => e.title && e.company && e.end && e.bullets.length)).toBe(true);
    expect(p.education.length).toBeGreaterThan(0);
    expect(p.education.every((e) => e.degree && e.institution)).toBe(true);
    expect(p.projects.length).toBeGreaterThan(0);
    expect(p.skills.length).toBeGreaterThan(10);
  });
});
