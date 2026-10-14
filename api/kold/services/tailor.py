"""Per-job tailored resume.

What tailoring does: reorders skills, bullets and projects so the most relevant come first, and (with the
local model) rewrites the summary and lightly rephrases bullets to use the job's language.
What it never does: add skills, numbers, employers or claims that aren't in the original resume.
Every change is listed so the user can review it.
"""
import copy
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import HRFlowable, ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer

from .. import llm
from ..config import settings
from ..models import Job

STOP = set("the a an and or of to in for with on at by from as is are be we you our your will this that it role team work".split())


def _keywords(job: Job) -> set[str]:
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9+#.]{1,}", f"{job.title} {job.title} {job.description[:6000]}".lower())
    return {w.strip(".") for w in words if w not in STOP and len(w) > 2}


def _relevance(text: str, kw: set[str]) -> int:
    return len(set(re.findall(r"[a-z0-9+#]+", text.lower())) & kw)


def _numbers(s: str) -> set[str]:
    return set(re.findall(r"\d+(?:[.,]\d+)?%?", s))


BULLETS_SYSTEM = ("Lightly rephrase each resume bullet so it uses wording from the job description where it is TRUE. "
                  "Keep every fact and number exactly; never add new facts, tools or numbers. Same count, same order.")
BULLETS_SCHEMA = {"type": "object", "properties": {"bullets": {"type": "array", "items": {"type": "string"}}}, "required": ["bullets"]}


def tailor(profile: dict, job: Job) -> tuple[dict, list[str]]:
    data = copy.deepcopy(profile)
    kw = _keywords(job)
    changes: list[str] = []

    skills = data.get("skills") or []
    in_job = [s for s in skills if re.search(rf"(?<![a-z0-9+#]){re.escape(s.lower())}(?![a-z0-9+#])", job.description.lower() + " " + job.title.lower())]
    if in_job:
        data["skills"] = in_job + [s for s in skills if s not in in_job]
        changes.append(f"Moved skills the job asks for to the front: {', '.join(in_job[:6])}")

    for exp in data.get("experience") or []:
        b = exp.get("bullets") or []
        ordered = sorted(b, key=lambda x: -_relevance(x, kw))
        if ordered != b:
            exp["bullets"] = ordered
            changes.append(f"Reordered bullets under {exp.get('title') or 'experience'} at {exp.get('company') or ''} by relevance".strip())

    projects = data.get("projects") or []
    ordered_p = sorted(projects, key=lambda p: -_relevance(p.get("description", "") + " " + " ".join(p.get("tech") or []), kw))
    if ordered_p != projects:
        data["projects"] = ordered_p
        changes.append("Put the most relevant projects first")

    summary = factual_summary(data, in_job)
    if summary:
        data["summary"] = summary
        changes.append("Wrote a summary from your own resume facts, leading with what this role asks for")

    try:
        for exp in data.get("experience") or []:
            bullets = exp.get("bullets") or []
            if not bullets:
                continue
            out = llm.generate_json(BULLETS_SYSTEM, f"JOB DESCRIPTION:\n{job.description[:2500]}\n\nBULLETS:\n" + "\n".join(bullets), BULLETS_SCHEMA)["bullets"]
            if len(out) != len(bullets):
                continue
            kept = []
            for orig, new in zip(bullets, out):
                safe = (_numbers(new) <= _numbers(orig) and _skill_hits(new) <= _skill_hits(orig)
                        and len(_novel_words(new, orig)) <= 3 and 0.5 < len(new) / max(1, len(orig)) < 1.6)
                kept.append(new if safe else orig)
            if kept != bullets:
                exp["bullets"] = kept
                changes.append(f"Rephrased bullets at {exp.get('company') or 'experience'} to match the job's wording (each checked: no new facts or numbers)")
    except (llm.LLMUnavailable, KeyError, TypeError):
        changes.append("Local model offline: only reordering was applied")
    return data, changes


FILLER = set("a an the and or of to in for with on at by from as into using via across which that used built "
              "designed developed created implemented delivered led drove improved automated analyzed wrote "
              "managed optimized enabled supported reduced increased identify identified find found track tracking".split())


def _novel_words(new: str, orig: str) -> set[str]:
    """Content words the rephrase introduced that the original bullet didn't have."""
    words = lambda t: {w for w in re.findall(r"[a-z][a-z0-9+#-]+", t.lower()) if w not in FILLER and len(w) > 2}
    return words(new) - words(orig)


def factual_summary(data: dict, matched_skills: list[str]) -> str:
    """A summary assembled only from fields in the resume, so nothing can be invented."""
    parts = []
    edu = (data.get("education") or [{}])[0]
    if edu.get("degree"):
        student = data.get("experience_level") == "student"
        when = (f" (graduating {edu['end']})" if student else f" ({edu['end']})") if edu.get("end") else ""
        status = "student" if student else "graduate"
        parts.append(f"{edu['degree']} {status}{when}" + (f", {edu['institution']}" if edu.get("institution") else "") + ".")
    exp = (data.get("experience") or [{}])[0]
    if exp.get("title") and exp.get("company"):
        parts.append(f"{exp['title']} at {exp['company']}.")
    skills = (matched_skills or [])[:4] + [s for s in (data.get("skills") or []) if s not in matched_skills][: max(0, 5 - len(matched_skills[:4]))]
    if skills:
        parts.append("Skills: " + ", ".join(skills) + ".")
    return " ".join(parts)


def _skill_hits(text: str) -> set[str]:
    """Known skills mentioned in a piece of text, used to make sure a rephrase adds no new skills."""
    from ..resume.skills import SKILLS

    low = text.lower()
    return {s for s in SKILLS if re.search(rf"(?<![a-z0-9+#]){re.escape(s.lower())}(?![a-z0-9+#])", low)}


def render_pdf(data: dict, out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(out), pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                            title=f"{data.get('name', '')} Resume", author=data.get("name", ""))
    ink = colors.HexColor("#111827")
    muted = colors.HexColor("#4B5563")
    st = {
        "name": ParagraphStyle("n", fontName="Helvetica-Bold", fontSize=18, leading=22, alignment=TA_CENTER, textColor=ink),
        "contact": ParagraphStyle("c", fontName="Helvetica", fontSize=9, leading=12, alignment=TA_CENTER, textColor=muted),
        "h": ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=10.5, leading=14, spaceBefore=8, textColor=ink),
        "b": ParagraphStyle("b", fontName="Helvetica", fontSize=9.5, leading=13, textColor=ink),
        "sub": ParagraphStyle("s", fontName="Helvetica-Bold", fontSize=9.5, leading=13, textColor=ink),
    }

    def esc(s: str) -> str:
        return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    story = [Paragraph(esc(data.get("name", "")), st["name"])]
    contact = " · ".join(x for x in [data.get("email"), data.get("phone"), data.get("location")] + (data.get("links") or [])[:3] if x)
    story += [Paragraph(esc(contact), st["contact"]), Spacer(1, 4)]

    def section(title: str):
        story.append(Paragraph(title.upper(), st["h"]))
        story.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#D1D5DB"), spaceAfter=3))

    def bullets(items: list[str]):
        if items:
            story.append(ListFlowable([ListItem(Paragraph(esc(i), st["b"]), leftIndent=10) for i in items], bulletType="bullet", start="•", leftIndent=10))

    if data.get("summary"):
        section("Summary")
        story.append(Paragraph(esc(data["summary"]), st["b"]))
    if data.get("skills"):
        section("Skills")
        story.append(Paragraph(esc(", ".join(data["skills"])), st["b"]))
    if data.get("experience"):
        section("Experience")
        for e in data["experience"]:
            head = " — ".join(x for x in [e.get("title"), e.get("company")] if x)
            dates = " – ".join(x for x in [e.get("start"), e.get("end")] if x)
            story.append(Paragraph(f"{esc(head)} <font color='#6B7280'>{esc(dates)}</font>", st["sub"]))
            bullets(e.get("bullets") or [])
    if data.get("projects"):
        section("Projects")
        for p in data["projects"]:
            tech = f" ({', '.join(p.get('tech') or [])})" if p.get("tech") else ""
            story.append(Paragraph(f"<b>{esc(p.get('name', ''))}</b>{esc(tech)}: {esc(p.get('description', ''))}", st["b"]))
    if data.get("education"):
        section("Education")
        for e in data["education"]:
            line = ", ".join(x for x in [e.get("degree"), e.get("institution"), e.get("score")] if x)
            dates = " – ".join(x for x in [e.get("start"), e.get("end")] if x)
            story.append(Paragraph(f"{esc(line)} <font color='#6B7280'>{esc(dates)}</font>", st["b"]))
    if data.get("certifications"):
        section("Certifications")
        bullets(data["certifications"])
    if data.get("achievements"):
        section("Achievements")
        bullets(data["achievements"])
    doc.build(story)
    return out


def pdf_path(user_id: int, job_id: int, name: str) -> Path:
    # One folder per job so the attachment the company sees is just "Firstname_Lastname_Resume.pdf".
    safe = re.sub(r"[^A-Za-z0-9]+", "_", name or "").strip("_") or "My"
    return settings.data_dir / "tailored" / str(user_id) / str(job_id) / f"{safe}_Resume.pdf"
