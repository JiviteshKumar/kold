"""Resume → structured profile.

1. Extract text from PDF/DOCX/TXT.
2. Ask the local model to structure it (if it's running), else use rule-based parsing.
3. Verify: anything the model returns that does not appear in the resume text is dropped.
   Kold never invents facts about the user.
"""
import re
from pathlib import Path

from pypdf import PdfReader

from .. import llm
from .skills import SKILLS

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE = re.compile(r"(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}")
URL = re.compile(r"(?:https?://)?(?:www\.)?(?:linkedin\.com/in/|github\.com/|[\w-]+\.(?:dev|io|me|com|in|app|site)/?)[\w\-./?=#%]*", re.I)
HEADINGS = {
    "summary": r"summary|objective|profile|about me",
    "experience": r"(work |professional )?experience|employment|internships?|work history",
    "education": r"education|academics?|qualifications?",
    "skills": r"(technical )?skills|technologies|tech stack|tools",
    "projects": r"projects?|personal projects|academic projects",
    "certifications": r"certifications?|courses|licenses",
    "achievements": r"achievements?|awards|honou?rs|accomplishments|positions of responsibility|extracurricular",
}

PROFILE_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "headline": {"type": "string"},
        "email": {"type": "string"},
        "phone": {"type": "string"},
        "location": {"type": "string"},
        "links": {"type": "array", "items": {"type": "string"}},
        "summary": {"type": "string"},
        "skills": {"type": "array", "items": {"type": "string"}},
        "experience": {"type": "array", "items": {"type": "object", "properties": {
            "title": {"type": "string"}, "company": {"type": "string"}, "location": {"type": "string"},
            "start": {"type": "string"}, "end": {"type": "string"},
            "bullets": {"type": "array", "items": {"type": "string"}}},
            "required": ["title", "company", "bullets"]}},
        "education": {"type": "array", "items": {"type": "object", "properties": {
            "degree": {"type": "string"}, "institution": {"type": "string"},
            "start": {"type": "string"}, "end": {"type": "string"}, "score": {"type": "string"}},
            "required": ["degree", "institution"]}},
        "projects": {"type": "array", "items": {"type": "object", "properties": {
            "name": {"type": "string"}, "description": {"type": "string"},
            "tech": {"type": "array", "items": {"type": "string"}}, "link": {"type": "string"}},
            "required": ["name", "description"]}},
        "certifications": {"type": "array", "items": {"type": "string"}},
        "achievements": {"type": "array", "items": {"type": "string"}},
        "experience_level": {"type": "string", "enum": ["student", "fresher", "1-3", "3-5", "5+"]},
        "suggested_roles": {"type": "array", "items": {"type": "string"}},
    },
}
PROFILE_SCHEMA["required"] = list(PROFILE_SCHEMA["properties"])

SYSTEM = (
    "You extract structured data from resumes. Copy facts exactly as written. "
    "Never invent, embellish or infer employers, dates, numbers, skills or links that are not in the text. "
    "Use empty strings or empty lists for anything missing. "
    "experience_level: 'student' if still studying, 'fresher' if graduated with no full-time job, otherwise years of full-time work. "
    "suggested_roles: 3 to 5 realistic job titles this person should search for, based only on the resume."
)


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        reader = PdfReader(str(path))
        parts = []
        for page in reader.pages:
            parts.append(page.extract_text() or "")
            # Hyperlinks (LinkedIn/GitHub icons) often live only in annotations.
            for annot in page.get("/Annots") or []:
                try:
                    uri = annot.get_object().get("/A", {}).get("/URI")
                    if uri:
                        parts.append(str(uri))
                except Exception:
                    pass
        text = "\n".join(parts)
    elif suffix == ".docx":
        from docx import Document

        doc = Document(str(path))
        text = "\n".join(p.text for p in doc.paragraphs)
        for t in doc.tables:
            for row in t.rows:
                text += "\n" + " | ".join(c.text for c in row.cells)
    else:
        text = path.read_text(errors="ignore")
    text = text.replace("•", "\n• ").replace("", "\n• ")
    return re.sub(r"[ \t]+", " ", text).strip()


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9+#]", "", s.lower())


def _in_text(value: str, norm_text: str) -> bool:
    v = _norm(value)
    return bool(v) and v in norm_text


def _split_sections(text: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {"_top": []}
    current = "_top"
    for line in text.splitlines():
        stripped = line.strip().strip(":").strip()
        found = None
        if 2 < len(stripped) < 40:
            for key, pat in HEADINGS.items():
                if re.fullmatch(pat, stripped, re.I):
                    found = key
                    break
        if found:
            current = found
            sections.setdefault(current, [])
        else:
            sections.setdefault(current, []).append(line)
    return {k: "\n".join(v).strip() for k, v in sections.items()}


def _bullets(block: str) -> list[str]:
    out = []
    for line in block.splitlines():
        line = line.strip()
        if re.match(r"^[•\-\*▪●◦]\s*", line):
            out.append(re.sub(r"^[•\-\*▪●◦]\s*", "", line))
        elif out and line and not line[0].isupper() and len(line) > 3:
            out[-1] += " " + line  # wrapped bullet
    return [b for b in out if len(b) > 3]


def find_skills(text: str) -> list[str]:
    found = []
    for skill in SKILLS:
        esc = re.escape(skill)
        if re.search(rf"(?<![A-Za-z0-9+#]){esc}(?![A-Za-z0-9+#])", text, re.I if len(skill) > 3 else 0):
            found.append(skill)
    return found


def rule_based(text: str) -> dict:
    secs = _split_sections(text)
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    name = next((l for l in lines[:5] if not EMAIL.search(l) and not re.search(r"\d{4}", l) and len(l.split()) <= 5), "")
    email = (EMAIL.search(text) or [""])[0] if EMAIL.search(text) else ""
    phone_m = PHONE.search(secs.get("_top", text))
    skill_block = secs.get("skills", "")
    listed = [s.strip(" •-*:") for s in re.split(r"[,|•\n;]", skill_block) if 1 < len(s.strip(" •-*:")) <= 30]
    listed = [re.sub(r"^[\w ]+:\s*", "", s) for s in listed]
    skills = list(dict.fromkeys(listed + find_skills(skill_block) + find_skills(text)))
    edu_text = secs.get("education", "")
    return {
        "name": name,
        "headline": "",
        "email": email,
        "phone": phone_m.group(0).strip() if phone_m else "",
        "location": "",
        "links": list(dict.fromkeys(m.group(0) for m in URL.finditer(EMAIL.sub(" ", text))))[:6],
        "summary": secs.get("summary", "")[:600],
        "skills": skills[:40],
        "_listed_skills": list(dict.fromkeys(listed + find_skills(skill_block))),
        "experience": [{"title": "", "company": "", "location": "", "start": "", "end": "", "bullets": _bullets(secs.get("experience", ""))}] if secs.get("experience") else [],
        "education": [{"degree": edu_text.splitlines()[0] if edu_text else "", "institution": "", "start": "", "end": "", "score": ""}] if edu_text else [],
        "projects": [{"name": "", "description": b, "tech": [], "link": ""} for b in _bullets(secs.get("projects", ""))][:6],
        "certifications": _bullets(secs.get("certifications", "")) or [l for l in secs.get("certifications", "").splitlines() if l.strip()][:8],
        "achievements": _bullets(secs.get("achievements", ""))[:8],
        "experience_level": "student" if re.search(r"\b(20[2-3]\d)\b.*(expected|present|pursuing)|pursuing|currently studying", text, re.I) else "fresher",
        "suggested_roles": [],
    }


def verify(data: dict, text: str) -> dict:
    """Drop anything that is not grounded in the resume text."""
    nt = _norm(text)
    # The name must be written as words in the resume, not reconstructed from an email or LinkedIn handle.
    name = (data.get("name") or "").strip()
    if not name or not re.search(rf"(?<![\w.@/-]){re.escape(name)}(?![\w.@/-])", text, re.I):
        data["name"] = rule_based(text)["name"]
        if data.get("headline", "").strip().lower() == data["name"].lower():
            data["headline"] = ""
    data["skills"] = [s for s in dict.fromkeys(data.get("skills") or []) if _in_text(s, nt)]
    emails = EMAIL.findall(text)
    data["links"] = [l for l in data.get("links") or []
                     if _in_text(l.replace("https://", "").replace("http://", "").replace("www.", ""), nt)
                     and not any(l in e for e in emails)]
    if not data.get("email") or not _in_text(data["email"], nt):
        data["email"] = emails[0] if emails else ""
    data.pop("_listed_skills", None)
    data["experience"] = [e for e in data.get("experience") or [] if not e.get("company") or _in_text(e["company"], nt)]
    for e in data["experience"]:
        e.setdefault("location", "")
        e.setdefault("start", "")
        e.setdefault("end", "")
    data["education"] = [e for e in data.get("education") or [] if not e.get("institution") or _in_text(e["institution"], nt)]
    for key in ("certifications", "achievements"):
        data[key] = [x for x in data.get(key) or [] if x]
    return data


def parse(text: str) -> tuple[dict, str]:
    """Returns (profile_data, method) where method is 'local-model:<name>' or 'rules'."""
    base = rule_based(text)
    try:
        data = llm.generate_json(SYSTEM, f"Resume text:\n\n{text[:12000]}", PROFILE_SCHEMA)
        data = verify(data, text)
        # The model can miss skills in dense lists; add any it skipped from the resume's own skills section.
        data["skills"] = list(dict.fromkeys((data.get("skills") or []) + base["_listed_skills"]))[:50]
        if not data.get("phone"):
            data["phone"] = base["phone"]
        if not data.get("links"):
            data["links"] = base["links"]
        return data, llm.model_label()
    except llm.LLMUnavailable:
        return verify(base, text), "rules"
