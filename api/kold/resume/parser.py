"""Resume -> structured profile.

1. Extract text keeping the layout's meaning (PDF in pypdf's layout mode, DOCX with its list bullets, TXT).
2. Read it with Kold's rules (rules.py, the same rules as Kold Lite) and, if it's running, ask the local model too;
   the two are merged, keeping the richer answer for each section.
3. Verify: anything that does not appear in the resume text is dropped. Kold never invents facts about the user.
"""
import re
from pathlib import Path

from pypdf import PdfReader

from .. import llm
from . import rules

EMAIL = rules.EMAIL

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
        lines: list[str] = []
        links: list[str] = []
        for page in reader.pages:
            lines += rules.layout_lines(page.extract_text(extraction_mode="layout") or "")
            # Hyperlinks (LinkedIn/GitHub icons) often live only in annotations.
            for annot in page.get("/Annots") or []:
                try:
                    uri = annot.get_object().get("/A", {}).get("/URI")
                    if uri and str(uri).lower().startswith("http"):
                        links.append(re.sub(r"/$", "", re.sub(r"^https?://(www\.)?", "", str(uri))))
                except Exception:
                    pass
        shown = " ".join(lines).lower()
        extra = [u for u in dict.fromkeys(links) if u and u.lower() not in shown]
        # next to the contact details, not at the end where they'd land in the last section
        text = "\n".join(lines[:1] + extra + lines[1:])
    elif suffix == ".docx":
        from docx import Document

        doc = Document(str(path))
        out = []
        for para in doc.paragraphs:
            listed = "list" in (para.style.name or "").lower() or para._p.pPr is not None and para._p.pPr.numPr is not None
            out.append(("• " if listed and para.text.strip() else "") + para.text)
        for t in doc.tables:
            for row in t.rows:
                out.append(" | ".join(c.text for c in row.cells))
        text = "\n".join(out)
    else:
        text = path.read_text(encoding="utf-8", errors="ignore")
    return re.sub(r"[ \t]+", " ", text).strip()


def rule_based(text: str) -> dict:
    return rules.rule_parse(text)


def _norm(s: str) -> str:
    return rules.norm(s)


def _in_text(value: str, norm_text: str) -> bool:
    v = _norm(value)
    return bool(v) and v in norm_text


def verify(data: dict, text: str) -> dict:
    """Drop anything that is not grounded in the resume text."""
    nt = _norm(text)
    # The name must be written as words in the resume, not reconstructed from an email or LinkedIn handle.
    name = (data.get("name") or "").strip()
    if not name or not re.search(rf"(?<![\w.@/-]){re.escape(name)}(?![\w.@/-])", text, re.I):
        data["name"] = rules.rule_parse(text)["name"]
        if data.get("headline", "").strip().lower() == data["name"].lower():
            data["headline"] = ""
    data["skills"] = [s for s in dict.fromkeys(data.get("skills") or []) if _in_text(s, nt)]
    emails = EMAIL.findall(text)
    data["links"] = [l for l in data.get("links") or []
                     if _in_text(l.replace("https://", "").replace("http://", "").replace("www.", ""), nt)
                     and not any(l in e for e in emails)]
    if not data.get("email") or not _in_text(data["email"], nt):
        data["email"] = emails[0] if emails else ""
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
    base = verify(rules.rule_parse(text), text)
    try:
        data = llm.generate_json(SYSTEM, f"Resume text:\n\n{text[:12000]}", PROFILE_SCHEMA)
    except llm.LLMUnavailable:
        return base, "rules"
    data = verify(data, text)
    # Keep the richer answer for each section, and every skill the resume lists.
    data["skills"] = list(dict.fromkeys((data.get("skills") or []) + base["skills"]))[:60]
    for key in ("experience", "education", "projects"):
        if len(data.get(key) or []) < len(base[key]):
            data[key] = base[key]
    for key in ("phone", "links", "headline", "summary", "location"):
        if not data.get(key):
            data[key] = base[key]
    if not data.get("suggested_roles"):
        data["suggested_roles"] = base["suggested_roles"]
    return data, llm.model_label()
