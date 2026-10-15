"""Rule-based resume reader (no AI): text -> structured profile.

The same rules as Kold Lite's web/src/local/resume-rules.ts, so both versions read resumes the same way when the
local model isn't available (and the model's answer is merged with these). Lines may carry " | " between fields and
"• " for bullets; layout_lines() adds those from a PDF's layout, docx_lines() from Word list styles.
"""
from __future__ import annotations

import re
from datetime import date

from .skills import SKILLS

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE = re.compile(r"(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}")
URL = re.compile(r"(?:https?://)?(?:www\.)?(?:linkedin\.com/in/[\w-]+|github\.com/[\w-]+|[\w-]+(?:\.[\w-]+)*\.(?:dev|io|me|app|site|vercel\.app|netlify\.app|github\.io)(?:/[\w\-./?=#%]*)?)", re.I)
MON = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
ONE_DATE = rf"(?:{MON}\s*['’]?\d{{2,4}}|\d{{1,2}}[/.-]\d{{4}}|(?:19|20)\d{{2}})"
DATE = re.compile(rf"({ONE_DATE})\s*(?:-|–|—|to|till|until)\s*({ONE_DATE}|present|current|now|ongoing|till date|date)", re.I)
SINGLE_DATE = re.compile(rf"(?:^|[\s(|,])({MON}\s*\d{{4}}|(?:19|20)\d{{2}})(?=$|[\s)|,])", re.I)

HEADINGS = {
    "summary": r"summary|objective|profile|about( me)?|overview|career (objective|summary)|professional (summary|profile)|personal (profile|statement)",
    "experience": r"((work|professional|relevant|industry|industrial) )?(experience|experiences|exposure)|employment( history)?|work history|career history|internships?( (and|&) (training|experience))?|(experience|work) (and|&) internships?|internship experience",
    "education": r"education(al)?( background| qualifications?| details)?|academics?|academic (background|qualifications?|details|profile|record)|qualifications?|scholastic (profile|record)",
    "skills": r"((technical|key|core|relevant|professional) )?skills( summary| (and|&) (tools|technologies|interests|expertise))?|technologies|technical (stack|expertise)|tech stack|tools( (and|&) technologies)?|core competencies|competencies|areas of expertise|expertise",
    "projects": r"((academic|personal|key|major|selected|notable|side|technical) )?projects?( work)?",
    "certifications": r"certifications?( (and|&) (courses|training|licenses))?|courses( (and|&) certifications)?|licenses( (and|&) certifications)?|certificates|trainings?( (and|&) certifications)?|online courses",
    "achievements": r"achievements?|awards( (and|&) (achievements|honou?rs))?|honou?rs( (and|&) awards)?|accomplishments|positions? of responsibility|extra[- ]?curricular( activities)?|leadership( (and|&) activities| experience)?|activities|volunteer(ing)?( experience)?|co-?curricular activities",
    "other": r"languages( known)?|interests|hobbies( (and|&) interests)?|references|declaration|personal (details|information)|strengths|contact|contact (me|details|information)",
}
SOFT = {"Sales", "Communication", "Leadership", "Public Speaking", "Accounting", "Business Development", "Market Research",
        "Social Media", "Content Writing", "Copywriting", "CRM"}
DEGREE = re.compile(r"\b(b\.?\s?tech|b\.?\s?e\b\.?|b\.?\s?sc|b\.?\s?com|b\.?\s?a\b\.?|bca|bba|b\.?\s?des|b\.?\s?arch|b\.?\s?pharm|mca|m\.?\s?tech|m\.?\s?sc|m\.?\s?e\b\.?|m\.?\s?com|m\.?\s?a\b\.?|mba|pgdm|ph\.?\s?d|bachelor(?:'s)?|master(?:'s)?|diploma|class\s*(x|xii|10|12)(th)?|(10|12)th|x(ii)?th|hsc|ssc|cbse|icse|isc|higher secondary|senior secondary|secondary school|matriculation|intermediate|puc)\b", re.I)
INSTITUTION = re.compile(r"\b(university|universit[ée]|institute|institution|college|school|iit|nit|iiit|iim|bits|academy|vidyalaya|vidyapeeth|polytechnic|nmims|amity|vit|srm|manipal)\b", re.I)
ROLE = re.compile(r"\b(intern(ship)?|trainee|apprentice|engineer|developer|programmer|analyst|scientist|researcher|research (assistant|associate|fellow)|assistant|associate|consultant|manager|lead|head|director|officer|executive|specialist|designer|architect|administrator|coordinator|representative|fellow|volunteer|founder|co-?founder|tutor|instructor|teacher|writer|editor|marketer|strategist|accountant|auditor|advisor|technician|sde|swe|freelancer?)\b", re.I)
WORKPLACE = re.compile(r"^(remote|hybrid|on-?site|in[- ]office|wfh|work from home|full[- ]time|part[- ]time|contract|freelance|internship|live|personal|ongoing|in (active )?development|open[- ]source|hackathon|team project|solo)$", re.I)
COMPANY_END = re.compile(r"^(.+?\b(?:llp|ltd\.?|limited|inc\.?|pvt\.?(?: ltd\.?)?|private limited|technologies|labs|solutions|systems|corp\.?|corporation|llc|gmbh|services|software|consulting|ventures|bank))\s+(.+)$", re.I)
CITIES = ("bengaluru|bangalore|mumbai|navi mumbai|thane|pune|delhi|new delhi|ncr|gurugram|gurgaon|noida|hyderabad|secunderabad|chennai|kolkata|"
          "ahmedabad|jaipur|kochi|cochin|chandigarh|indore|bhopal|lucknow|nagpur|coimbatore|thiruvananthapuram|trivandrum|mysuru|mysore|vadodara|"
          "surat|patna|bhubaneswar|goa|mangaluru|mangalore|visakhapatnam|vizag|nashik|aurangabad|ranchi|dehradun|vellore|manipal|kanpur|kharagpur|"
          "roorkee|guwahati|warangal|trichy|tiruchirappalli|madurai|udupi")
LOCATION = re.compile(rf"^(({CITIES})(,\s*[a-z .]+)?|india|usa|us|uk|united states|united kingdom|singapore|dubai|uae|germany|canada|australia|remote|[a-z .]+,\s*(india|usa|uk|[A-Z]{{2}}))$", re.I)
BULLET = re.compile(r"^[•●▪◦○■□➢➤►▸‣⁃✓✔*–-]\s+")
SCORE = re.compile(r"\b(?:cgpa|gpa|cpi|sgpa|percentage|score|marks)?\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,2})?\s*/\s*10(?:\.0)?|\d{1,3}(?:\.\d{1,2})?\s*%|(?<=cgpa )\d{1,2}(?:\.\d{1,2})?|(?<=cgpa: )\d{1,2}(?:\.\d{1,2})?|(?<=gpa )\d{1,2}(?:\.\d{1,2})?)", re.I)


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9+#]", "", s.lower())


def find_skills(text: str) -> list[str]:
    out = []
    for s in SKILLS:
        esc = re.escape(s)
        if re.search(rf"(?<![A-Za-z0-9+#]){esc}(?![A-Za-z0-9+#])", text, 0 if len(s) <= 3 else re.I):
            out.append(s)
    return out


def is_bullet(l: str) -> bool:
    return bool(BULLET.match(l))


def strip_bullet(l: str) -> str:
    return BULLET.sub("", l).strip()


def flat(l: str) -> str:
    return re.sub(r"\s{2,}", " ", re.sub(r"\s*\|\s*", " ", l)).strip()


def is_location(s: str) -> bool:
    return bool(LOCATION.match(s.strip().replace("(", "").replace(")", "")))


def title_case(s: str) -> str:
    return " ".join(w[0] + w[1:].lower() if len(w) > 3 and w.isupper() and "/" not in w else w for w in s.split())


# ------------------------------------------------------------------------------------------- layout -> lines
SPACED = re.compile(r"^(?:\S {1,3}){2,}\S$")
GLYPHS = {"": "•", "": "•", "": "•", "": "•", "": "•", "●": "•"}  # symbol-font bullets


def layout_lines(text: str) -> list[str]:
    """pypdf layout-mode text (columns kept by position) -> lines with ' | ' between fields and '• ' bullets."""
    raw = [l.rstrip() for l in text.replace("\r", "").split("\n")]
    for k, v in GLYPHS.items():
        raw = [l.replace(k, v) for l in raw]
    raw = [l for l in raw if l.strip()]
    if not raw:
        return []
    out: list[str] = []
    for col in _columns(raw):
        out += _column_lines(col)
    return out


def _columns(lines: list[str]) -> list[list[str]]:
    width = max(len(l) for l in lines)
    best = None
    for c in range(15, int(width * 0.62)):
        both = cross = 0
        for l in lines:
            if len(l) <= c:
                continue
            if l[c - 1] != " " and l[c] != " ":
                cross += 1
            elif l[max(0, c - 2):c + 1].strip() == "" and l[:c].strip() and l[c:].strip() and len(l[c:].strip()) > 20:
                both += 1
        if cross == 0 and both >= 4 and (best is None or both > best[1]):
            best = (c, both)
    if not best:
        return [lines]
    c = best[0]
    left = [l[:c].rstrip() for l in lines if l[:c].strip()]
    right = [l[c:] for l in lines if len(l) > c and l[c:].strip()]
    return [left, right]


def _column_lines(lines: list[str]) -> list[str]:
    rows = []
    for l in lines:
        indent = len(l) - len(l.lstrip())
        s = l.strip()
        if SPACED.match(s):
            s = " ".join(w.replace(" ", "") for w in re.split(r" {2,}", s))
        s = re.sub(r" \xa0|\xa0 ", " | ", s).replace("\xa0", " ")  # a space next to a no-break space sets fields apart
        s = re.sub(r"\s{3,}", " | ", s)
        rows.append([indent, s])
    width = max(len(l) for l in lines)
    header_indents = [i for i, s in rows if " | " in s]
    counts: dict[int, int] = {}
    for i, _ in rows:
        counts[i] = counts.get(i, 0) + 1
    margin = min(header_indents) if len(header_indents) >= 2 else min([i for i, n in counts.items() if n >= 2] or [min(counts)])
    reach: dict[int, int] = {}
    for i, s in rows:
        reach[i] = max(reach.get(i, 0), i + len(s))
    out: list[list] = []  # [text, indent, right]
    for i, s in rows:
        right_aligned = i > width * 0.4
        centred = i > margin + 6 and abs(i + len(s) / 2 - width / 2) < width * 0.12
        heading = s.isupper() and len(s.split()) <= 4 and " | " not in s and re.search(r"[A-Z]{3}", s)
        prev = out[-1] if out else None
        if prev and not is_bullet(s) and not heading and not prev[3] and " | " not in s and " | " not in prev[0] and not right_aligned \
                and not re.search(r"@|https?:|\b(19|20)\d{2}\b", s) and abs(prev[1] - i) <= 1:
            full = reach.get(prev[1], prev[2])
            lower = bool(re.match(r"[a-z(]", s))
            ends = bool(re.search(r"[.!?:;]$", prev[0]))
            if (not ends and prev[2] >= full * (0.85 if lower else 0.93)) or (ends and lower and prev[2] >= full * 0.85):
                prev[0] = re.sub(r"(\w)- ([a-z])", r"\1-\2", f"{prev[0]} {s}")
                prev[2] = i + len(s)
                continue
        text = s
        if is_bullet(s) or s.startswith("•"):
            text = "• " + re.sub(r"^[•●▪◦○■□➢➤►▸‣⁃✓✔*–-]\s*", "", s)
        elif i > margin + 1 and " | " not in s and not right_aligned and not heading and not centred:
            text = "• " + s
        out.append([text, i, i + len(s), bool(heading)])
    return [r[0] for r in out]


# ------------------------------------------------------------------------------------------- sections and entries
def heading_of(line: str) -> str | None:
    bare = re.sub(r"\s+", " ", re.sub(r"^[^a-z0-9]+", "", re.sub(r"[:•\-–|_=#*]+$", "", line), flags=re.I).strip().lower())
    if len(bare) < 3 or len(bare) > 45:
        return None
    for k, pat in HEADINGS.items():
        if re.fullmatch(pat, bare):
            return k
    return None


def sections_of(text: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {"_top": []}
    cur = "_top"
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        hit = heading_of(line)
        if hit:
            cur = hit
            out.setdefault(cur, [])
        else:
            out.setdefault(cur, []).append(line)
    return out


def is_tools_line(l: str) -> bool:
    if is_bullet(l) or re.search(r"[.!?]$", l) or DATE.search(l) or SINGLE_DATE.search(l) or re.search(r"@|https?:|\.(com|io|app|dev)\b", l, re.I):
        return False
    if " | " in l and not find_skills(l.split(" | ")[0]) and not re.match(r"(tech|tools|stack|skills|built with)", l, re.I):
        return False
    parts = [p for p in re.split(r"\s*[·,|•;]\s*", re.sub(r"^(tech(nologies)?|tools|stack|skills|built with)\s*:\s*", "", l, flags=re.I)) if p]
    if len(parts) < 2 or any(len(p.split()) > 4 for p in parts):
        return False
    return sum(1 for p in parts if find_skills(p)) / len(parts) >= 0.5


def fields_of(head: str) -> list[str]:
    s = re.sub(r"\(\s*\)|\[\s*\]", " ", head)
    s = re.sub(r"\(([^)]*)\)", lambda m: f" | {m.group(1)} | " if WORKPLACE.match(m.group(1).strip()) or is_location(m.group(1)) else m.group(0), s)
    parts = re.split(r"\s*\|\s*|\s+[–—]\s+|\s+@\s+|\s{2,}|\s+·\s+", s)
    return [p for p in (re.sub(r"^[,;·\-–—]+|[,;·\-–—]+$", "", x.strip()).strip() for x in parts) if p]


def drop_location_tail(s: str) -> str:
    parts = re.split(r",\s*", s)
    while len(parts) > 1 and is_location(parts[-1]):
        parts.pop()
    if len(parts) > 1 and is_location(", ".join(parts[-2:])):
        parts = parts[:-2]
    return ", ".join(parts).strip()


def tidy_date(d: str) -> str:
    d = d.strip()
    return "Present" if re.fullmatch(r"present|current|now|ongoing|till date|date", d, re.I) else d


def dates_in(s: str) -> tuple[str, str, str]:
    m = DATE.search(s)
    if m:
        return tidy_date(m.group(1)), tidy_date(m.group(2)), s.replace(m.group(0), " ")
    one = SINGLE_DATE.search(s)
    if one:
        return "", tidy_date(one.group(1)), s.replace(one.group(1), " ", 1)
    return "", "", s


def blocks(lines: list[str]) -> list[dict]:
    out: list[dict] = []
    cur = None
    for l in lines:
        tools = is_tools_line(l)
        headish = not is_bullet(l) and not tools and bool(DATE.search(l) or " | " in l or (len(l) <= 75 and not re.search(r"[.!?]$", l) and not re.match(r"[a-z]", l)))
        if headish:
            new = cur is None or cur["body"] or len(cur["head"]) >= 3 or (DATE.search(l) and any(DATE.search(h) for h in cur["head"]))
            if new:
                cur = {"head": [l], "body": []}
                out.append(cur)
            else:
                cur["head"].append(l)
        else:
            if cur is None:
                cur = {"head": [], "body": []}
                out.append(cur)
            if not is_bullet(l) and cur["body"] and not tools and re.match(r"[a-z(]", l):
                cur["body"][-1] += f" {l}"
            else:
                cur["body"].append(f"\x01{l}" if tools else l)
    return out


def descriptions(b: dict) -> list[str]:
    return [x for x in (flat(strip_bullet(l)) for l in b["body"] if not l.startswith("\x01")) if len(x) > 3]


def tools_of(b: dict) -> list[str]:
    out = []
    for l in b["body"]:
        if l.startswith("\x01"):
            out += [s.strip() for s in re.split(r"\s*[·,|•;]\s*", re.sub(r"^[a-z ]+:\s*", "", l[1:], flags=re.I)) if s.strip() and len(s.strip()) <= 40]
    return out


def parse_experience(lines: list[str]) -> list[dict]:
    out: list[dict] = []
    for b in blocks(lines):
        if not b["head"]:
            if out:
                out[-1]["bullets"] += descriptions(b)
            continue
        start, end, rest = dates_in(" | ".join(b["head"]))
        location = ""
        fields = []
        for f in fields_of(rest):
            if is_location(f) or "," not in f:
                fields.append(f)
                continue
            kept = drop_location_tail(f)
            if kept != f and not location:
                location = re.sub(r"^\s*,\s*", "", f[len(kept):])
            fields.append(kept)
        kept_fields = []
        for f in fields:
            if WORKPLACE.match(f):
                continue
            if is_location(f):
                location = location or f
                continue
            if not re.fullmatch(r"\d{4}", f):
                kept_fields.append(f)
        ti = next((i for i, f in enumerate(kept_fields) if ROLE.search(f) and len(f.split()) <= 7), 0)
        title = kept_fields[ti] if kept_fields else ""
        company = next((f for i, f in enumerate(kept_fields) if i != ti and len(f.split()) <= 8), "")
        if title and not company:  # "Acme Technologies Data Analyst" on one line: split after the company's suffix
            m = COMPANY_END.match(title)
            if m and ROLE.search(m.group(2)):
                company, title = m.group(1), m.group(2)
        out.append({"title": title, "company": company, "location": location, "start": start, "end": end, "bullets": descriptions(b)})
    return [e for e in out if (e["title"] or e["company"]) and (e["bullets"] or e["company"] or e["start"])][:12]


def parse_projects(lines: list[str]) -> list[dict]:
    out: list[dict] = []
    inline_re = re.compile(r"^([A-Z][\w .&+#'-]{1,48}?)\s*[:–—]\s+(.{15,})$")
    if lines and all(inline_re.match(strip_bullet(l)) or re.match(r"[a-z(]", l) for l in lines):
        for l in lines:
            m = inline_re.match(strip_bullet(l))
            if m:
                out.append({"name": m.group(1).strip(), "description": flat(m.group(2)), "tech": find_skills(m.group(2)), "link": ""})
            elif out:
                out[-1]["description"] += f" {l}"
        return out[:10]
    for b in blocks(lines):
        if not b["head"]:
            if out:
                out[-1]["description"] = f"{out[-1]['description']} {' '.join(descriptions(b))}".strip()
            continue
        head = " | ".join(b["head"])
        link_m = URL.search(head)
        link = re.sub(r"^https?://(www\.)?", "", link_m.group(0)) if link_m else ""
        _, _, rest = dates_in(URL.sub(" ", head))
        fields = [f for f in fields_of(rest) if not WORKPLACE.match(f) and not is_location(f)]
        name = fields[0] if fields else ""
        tech_fields = [f for f in fields[1:] if len(re.split(r"\s*,\s*", f)) > 1 and len(find_skills(f)) >= 2]
        tagline = " · ".join(f for f in fields[1:] if f not in tech_fields and not is_tools_line(f))
        m = re.match(r"^(.{2,48}?)\s*[:–—]\s+(.{10,})$", name)
        if m:
            name, tagline = m.group(1), " · ".join(x for x in (m.group(2), tagline) if x)
        desc = " ".join(descriptions(b))
        description = " ".join(x for x in ((f"{tagline}." if tagline and desc else tagline), desc) if x).replace("..", ".").strip()
        if not name or len(name.split()) > 8:
            continue
        tech = list(dict.fromkeys(tools_of(b) + [t for f in tech_fields for t in re.split(r"\s*,\s*", f)] + find_skills(f"{head} {desc}")))
        out.append({"name": name, "description": description, "tech": tech, "link": link})
    return [p for p in out if p["description"]][:10]


def parse_education(lines: list[str]) -> list[dict]:
    out: list[dict] = []
    cur = None

    def push():
        if cur and (cur["degree"] or cur["institution"]):
            out.append(cur)

    for raw in lines:
        l = strip_bullet(raw)
        start, end, rest = dates_in(l)
        sm = SCORE.search(l)
        score = re.sub(r"\s+", "", sm.group(1)) if sm and sm.group(1) else ""
        fields = fields_of(re.sub(r"\b(cgpa|gpa|cpi|sgpa|percentage)\b\s*[:\-]?", " ", SCORE.sub(" ", rest), flags=re.I))
        split = []
        for f in fields:
            many = "," in f and ((DEGREE.search(f) and INSTITUTION.search(f)) or start or end or score
                                 or (INSTITUTION.search(f) and is_location(re.split(r",\s*", f)[-1])))
            split += re.split(r"\s*,\s*", f) if many else [f]
        fields = [x for x in (drop_location_tail(f) for f in split) if x and not is_location(x) and not WORKPLACE.match(x)
                  and not re.fullmatch(r"cgpa|gpa|cpi|score|marks", x, re.I)]
        di = next((i for i, f in enumerate(fields) if DEGREE.search(f)), -1)
        ii = next((i for i, f in enumerate(fields) if i != di and INSTITUTION.search(f)), -1)
        if di >= 0 and len(fields[di]) <= 7 and di + 1 < len(fields) and di + 1 != ii and not INSTITUTION.search(fields[di + 1]) and not DEGREE.search(fields[di + 1]):
            fields[di:di + 2] = [f"{fields[di]}, {fields[di + 1]}"]
        di = next((i for i, f in enumerate(fields) if DEGREE.search(f)), -1)
        degree = fields[di] if di >= 0 else ""
        institution = next((f for i, f in enumerate(fields) if i != di and INSTITUTION.search(f)), "")
        if not institution and degree:
            institution = next((f for i, f in enumerate(fields) if i != di and len(f.split()) <= 8), "")
        if not degree and not institution:
            if cur:
                cur["start"] = cur["start"] or start
                cur["end"] = cur["end"] or end
                cur["score"] = cur["score"] or score
            continue
        if cur is None or (degree and cur["degree"]) or (institution and cur["institution"] and not degree):
            push()
            cur = {"degree": "", "institution": "", "start": "", "end": "", "score": ""}
        if degree:
            cur["degree"] = degree
        if institution and not cur["institution"]:
            cur["institution"] = institution
        cur["start"] = cur["start"] or start
        cur["end"] = cur["end"] or end
        cur["score"] = cur["score"] or score
    push()
    return out[:6]


def parse_skills(lines: list[str]) -> list[str]:
    out = []
    for raw in lines:
        l = strip_bullet(raw)
        cat = re.match(r"^([^,|:]{2,30}?)\s*(?::|\|)\s*(.+)$", l)
        if cat and (not find_skills(cat.group(1)) or "," in cat.group(2)):
            l = cat.group(2)
        for s in re.split(r"\s*[,;•·|]\s*|\s+/\s+(?=[A-Z])", l):
            t = re.sub(r"[.]$", "", re.sub(r"^(and|&)\s+", "", s, flags=re.I)).strip()
            if (len(t) > 1 or t in ("R", "C")) and len(t) <= 40 and len(t.split()) <= 5:
                out.append(t)
    return out


def list_items(lines: list[str]) -> list[str]:
    out: list[str] = []
    for l in lines:
        if not is_bullet(l) and out and re.match(r"[a-z(]", l):
            out[-1] += f" {l}"
        else:
            out.append(flat(strip_bullet(l)))
    return [x for x in out if len(x) > 3][:12]


# ------------------------------------------------------------------------------------------- whole resume
def experience_level(text: str, edu: list[dict], exp: list[dict]) -> str:
    year = date.today().year
    if re.search(r"\b(expected|pursuing|currently studying|ongoing|final[- ]year|pre-final)\b", text, re.I) or any(
            int((re.search(r"\d{4}", e.get("end") or "") or [0])[0]) > year for e in edu):
        return "student"
    months = 0
    for e in exp:
        if re.search(r"intern|trainee|assistant|volunteer", e.get("title", ""), re.I):
            continue
        s = int((re.search(r"\d{4}", e.get("start") or "") or [0])[0])
        en = year if re.search(r"present|current|now", e.get("end") or "", re.I) else int((re.search(r"\d{4}", e.get("end") or "") or [0])[0])
        if s and en >= s:
            months += (en - s) * 12 or 6
    yrs = months / 12
    return "fresher" if yrs < 1 else "1-3" if yrs < 3 else "3-5" if yrs < 5 else "5+"


def suggest_roles(skills: list[str], exp: list[dict]) -> list[str]:
    low = {s.lower() for s in skills}

    def has(*xs):
        return any(x.lower() in low for x in xs)

    roles: list[str] = []
    if has("Machine Learning", "Deep Learning", "PyTorch", "TensorFlow", "scikit-learn", "NLP", "Computer Vision", "XGBoost", "Hugging Face",
           "Hugging Face Transformers", "Transformers", "LLM", "LoRA", "PEFT", "FLAN-T5", "Generative AI", "LangChain", "OpenCV", "Keras"):
        roles += ["Machine Learning Engineer", "Data Scientist"]
    if has("SQL", "Power BI", "Tableau", "Excel", "Pandas", "Data Analysis", "Looker", "Statistics"):
        roles.append("Data Analyst")
    fe = has("React", "Angular", "Vue", "Next.js", "HTML", "CSS", "JavaScript", "TypeScript")
    be = has("Node.js", "Django", "Flask", "FastAPI", "Spring", "Spring Boot", "Express", "PostgreSQL", "MongoDB", "Java", "Golang")
    if fe and be:
        roles.append("Full Stack Developer")
    if fe:
        roles.append("Frontend Developer")
    if be:
        roles.append("Backend Developer")
    if has("Android", "iOS", "Flutter", "React Native", "Kotlin", "Swift"):
        roles.append("Mobile Developer")
    if has("AWS", "Docker", "Kubernetes", "Terraform", "CI/CD", "Linux"):
        roles.append("DevOps Engineer")
    if has("Figma", "UI/UX", "Adobe XD", "Wireframing", "Prototyping"):
        roles.append("UI/UX Designer")
    if has("Digital Marketing", "SEO", "SEM", "Google Analytics", "Social Media"):
        roles.append("Digital Marketing Associate")
    if has("Product Management"):
        roles.append("Product Manager")
    recent = re.sub(r"\s{2,}", " ", re.sub(r"\b(intern(ship)?|trainee)\b", "", exp[0]["title"], flags=re.I)).strip() if exp else ""
    if recent and len(recent) > 3 and ROLE.search(exp[0]["title"]):
        roles = [r for r in roles if r.lower() != recent.lower()]
        roles.insert(0, recent)
    return list(dict.fromkeys(roles))[:5]


def rule_parse(text: str) -> dict:
    sec = sections_of(text)
    top = sec.get("_top", [])
    lines = [l.strip() for l in text.split("\n") if l.strip()]

    def name_ok(l: str) -> bool:
        w = l.split()
        return not EMAIL.search(l) and not re.search(r"\d{3}", l) and not re.search(r"[@/|]", l) and 2 <= len(w) <= 5 \
            and bool(re.fullmatch(r"[A-Za-z .'-]+", l)) and not heading_of(l) and not is_location(l) and not INSTITUTION.search(l)

    raw_name = next((c for c in (l.split(" | ")[0] for l in lines[:8]) if name_ok(c)), "")
    name = title_case(raw_name.title()) if raw_name.isupper() else raw_name
    emails = EMAIL.findall(text)
    links = list(dict.fromkeys(re.sub(r"/$", "", re.sub(r"^https?://(www\.)?", "", m.group(0))) for m in URL.finditer(EMAIL.sub(" ", text))))
    links = [u for u in links if re.match(r"(linkedin|github)\.", u, re.I) or not u[:1].isupper()]
    contact = top + sec.get("other", [])  # sidebars put phone and city under "Contact"
    pm = PHONE.search(URL.sub(" ", EMAIL.sub(" ", "\n".join(contact))))
    location = next((f for l in contact for f in re.split(r"\s*\|\s*", l) if is_location(f) and f.lower() != "remote"), "")
    headline_raw = next((f for l in top[:8] for f in re.split(r"\s*\|\s*", l) if f != raw_name and len(f.split()) <= 7 and len(f) >= 4
                         and not re.search(r"[@\d]", f) and not URL.search(f) and not is_location(f) and not re.search(r"[.,]$", f)
                         and re.search(r"[a-z]", f, re.I) and (ROLE.search(f) or f.isupper() or re.search(r"\b(student|graduate|enthusiast|engineering|data|science|design)\b", f, re.I))), "")
    headline = title_case(headline_raw) if headline_raw else ""
    summary_lines = sec.get("summary") or [l for l in top if len(l.split()) >= 8 and not EMAIL.search(l)]
    summary = " ".join(flat(l) for l in summary_lines)[:700]

    listed = parse_skills(sec.get("skills", []))
    tools = [s.strip() for l in sec.get("experience", []) + sec.get("projects", []) if is_tools_line(l)
             for s in re.split(r"\s*[·,|•;]\s*", re.sub(r"^[a-z ]+:\s*", "", l, flags=re.I)) if 1 < len(s.strip()) <= 40]
    scanned = [s for s in find_skills(text) if s not in SOFT or any(x.lower() == s.lower() for x in listed)]
    skills = list({s.lower(): s for s in listed + tools + scanned}.values())

    experience = parse_experience(sec.get("experience", []))
    education = parse_education(sec.get("education", []))
    role_skills = skills + (["Machine Learning"] if re.search(r"\b(AI/ML|AI|ML|machine learning)\b", headline, re.I) else [])
    return {
        "name": name, "headline": headline, "email": emails[0] if emails else "", "phone": pm.group(0).strip() if pm else "",
        "location": location, "links": links[:6], "summary": summary, "skills": skills[:60],
        "experience": experience, "education": education, "projects": parse_projects(sec.get("projects", [])),
        "certifications": list_items(sec.get("certifications", []))[:10], "achievements": list_items(sec.get("achievements", []))[:10],
        "experience_level": experience_level(text, education, experience), "suggested_roles": suggest_roles(role_skills, experience),
    }
