/** Text helpers shared by the Lite engine (mirrors the server's Python logic). */

export const SKILLS = [
  "Python", "Java", "JavaScript", "TypeScript", "C++", "C#", "Golang", "Rust", "Kotlin", "Swift", "Dart", "Ruby", "PHP", "Scala",
  "MATLAB", "SQL", "Bash", "Shell", "Solidity", "Elixir", "Haskell",
  "HTML", "CSS", "React", "React Native", "Next.js", "Vue", "Angular", "Svelte", "Node.js", "Express", "Django", "Flask", "FastAPI",
  "Spring", "Spring Boot", "Rails", "Laravel", ".NET", "GraphQL", "REST", "Tailwind", "Redux", "jQuery", "Bootstrap", "Webpack",
  "Vite", "Flutter", "Android", "iOS", "SwiftUI",
  "Machine Learning", "Deep Learning", "NLP", "Computer Vision", "LLM", "Generative AI", "PyTorch", "TensorFlow", "Keras",
  "scikit-learn", "Pandas", "NumPy", "Matplotlib", "Seaborn", "OpenCV", "Hugging Face", "LangChain", "Spark", "PySpark", "Hadoop",
  "Airflow", "dbt", "Kafka", "Snowflake", "BigQuery", "Databricks", "Tableau", "Power BI", "Looker", "Excel", "Statistics",
  "Data Analysis", "Data Visualization", "ETL", "A/B Testing", "Jupyter",
  "AWS", "GCP", "Google Cloud", "Azure", "Docker", "Kubernetes", "Terraform", "Ansible", "Jenkins", "GitHub Actions", "CI/CD",
  "Linux", "Nginx", "Git", "Microservices", "Serverless", "Firebase", "Supabase", "Vercel", "Prometheus", "Grafana",
  "PostgreSQL", "MySQL", "MongoDB", "Redis", "SQLite", "DynamoDB", "Cassandra", "Elasticsearch", "Oracle",
  "Figma", "Adobe XD", "Photoshop", "Illustrator", "After Effects", "Premiere Pro", "Canva", "Blender", "UI/UX", "UX Research",
  "Wireframing", "Prototyping", "Product Management", "Agile", "Scrum", "Jira",
  "Digital Marketing", "SEO", "SEM", "Content Writing", "Copywriting", "Social Media", "Google Analytics", "Salesforce", "HubSpot",
  "CRM", "Sales", "Business Development", "Market Research", "Financial Modeling", "Accounting", "Tally", "Communication",
  "Leadership", "Public Speaking",
  "Data Structures", "Algorithms", "System Design", "OOP", "DBMS", "Operating Systems", "Computer Networks", "Cybersecurity",
  "Penetration Testing", "Selenium", "Cypress", "Jest", "Pytest", "Postman", "Unity", "Unreal Engine", "Embedded Systems", "Arduino",
  "Raspberry Pi", "IoT", "Blockchain", "Web3",
];

export const STOP = new Set(
  ("a an and or of to in for with on at by from as is are be we you our your will this that it its role team work the they them their " +
    "have has had was were been being do does did not no but if then than so such can could would should may might must about into over " +
    "under also more most other some any all each who whom which what when where why how our ours us i me my mine he she his her " +
    "job jobs position candidate candidates company opportunity opportunities experience years year strong ability skills skill " +
    "including include includes etc using use used across within based new well able help helps").split(" "),
);

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary match that also works for terms like C++, C#, Node.js. */
export function termRe(term: string, flags = "i"): RegExp {
  return new RegExp(`(?<![a-z0-9+#])${escapeRe(term.trim().toLowerCase())}(?![a-z0-9+#])`, flags);
}

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9+#.-]*[a-z0-9+#]|[a-z]/g) ?? []).map((w) => w.replace(/[.-]+$/, ""));
}

export function keywords(text: string): Set<string> {
  return new Set(words(text).filter((w) => w.length > 2 && !STOP.has(w)));
}

export function findSkills(text: string): string[] {
  return SKILLS.filter((s) => (s.length <= 3 ? new RegExp(`(?<![A-Za-z0-9+#])${escapeRe(s)}(?![A-Za-z0-9+#])`) : termRe(s)).test(text));
}

export function numbers(s: string): Set<string> {
  return new Set(s.match(/\d+(?:[.,]\d+)?%?/g) ?? []);
}

export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+#]/g, "");
}

export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** Flesch reading ease (higher = simpler). Simpler emails get more replies. */
export function readingEase(text: string): number {
  const sents = Math.max(1, sentences(text).length);
  const ws = text.match(/[A-Za-z]+/g) ?? [];
  if (!ws.length) return 100;
  const syll = ws.reduce((a, w) => a + Math.max(1, (w.toLowerCase().replace(/e$/, "").match(/[aeiouy]+/g) ?? []).length), 0);
  return 206.835 - 1.015 * (ws.length / sents) - 84.6 * (syll / ws.length);
}

export function htmlToText(html: string): string {
  if (!html) return "";
  if (typeof DOMParser === "undefined") return html.replace(/<[^>]+>/g, " ");
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
  doc.querySelectorAll("p,li,div,h1,h2,h3,h4,tr").forEach((b) => b.append("\n"));
  return (doc.body.textContent ?? "").replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
