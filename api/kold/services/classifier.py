"""Reply understanding: what did the company say?

Three layers, highest-confidence wins, and the source is always shown to the user:
1. rules: email headers and unmistakable phrases (auto-replies, bounces, "please stop emailing")
2. model: Kold's own classifier, trained on replies the user confirmed (scripts/train_classifier.py)
3. local-llm: the self-hosted model, for anything still ambiguous
The user can correct any label; corrections become training data for (2).
"""
import re
from datetime import date, datetime, timedelta
from pathlib import Path

from dateutil import parser as dateparser

from .. import llm
from ..config import settings

LABELS = ["positive", "question", "not_now", "negative", "annoyed", "auto_reply", "out_of_office", "bounce", "unclear"]
MODEL_PATH = settings.data_dir / "models" / "reply_classifier.joblib"

PHRASES = [
    ("annoyed", 0.95, r"stop (e-?mailing|contacting|sending)|remove me|unsubscribe|do not (contact|email)|don'?t (contact|email) me|"
                      r"this is spam|reported as spam|harass|leave me alone|please stop|how did you get (my|this) (e-?mail|address)"),
    ("negative", 0.85, r"not (currently )?hiring|no (open )?(positions|openings|vacancies)|position (has been|is) (filled|closed)|"
                       r"(won'?t|will not|not) be (moving|proceeding) forward|decided to (move forward|proceed) with other|"
                       r"not a (good )?(fit|match)|unable to (offer|consider)|regret to inform|we'?ll pass|unfortunately"),
    ("not_now", 0.8, r"keep (your )?(resume|cv|profile) on file|future (openings|opportunities|roles)|check back|"
                     r"reach out (again )?in (a few|\d+) (weeks|months)|not (right )?now|later this year|next quarter"),
    ("positive", 0.85, r"\b(schedule|set up|book) (a )?(call|time|chat|meeting|interview)|calendly\.com|cal\.com|"
                       r"(are|would) you (be )?(available|free)|let'?s (talk|chat|connect)|next steps?|"
                       r"(happy|glad|love) to (chat|talk|connect|speak)|move (you )?forward|shortlisted|"
                       r"interview|forward(ed)? your (profile|resume|cv)|send (over )?(a )?(take[- ]home|assignment)"),
]
OOO = re.compile(r"out of (the )?office|\booo\b|on (annual |parental |sick )?leave|on vacation|limited access to (my )?e-?mail|"
                 r"away (from|until)|currently (travelling|traveling)", re.I)
AUTO = re.compile(r"automatic reply|auto-?reply|autoresponder|this is an automated|we (have )?received your (e-?mail|application|message)|"
                  r"do not reply to this", re.I)
RETURN = re.compile(r"(back|return(ing)?|in the office|available)\s+(on|from|after|by)?\s*([A-Z][a-z]+,?\s+)?([^.\n]{3,30})", re.I)


def return_date(text: str) -> date | None:
    for m in RETURN.finditer(text):
        try:
            d = dateparser.parse(m.group(5), fuzzy=True, default=datetime.now().replace(day=1)).date()
        except (ValueError, OverflowError):
            continue
        today = date.today()
        if d < today and d.month < today.month:
            d = d.replace(year=today.year + 1)
        if today <= d <= today + timedelta(days=120):
            return d
    return None


def _auto_header(headers: dict) -> bool:
    # Precedence: bulk/list is NOT used: recruiters replying through an ATS often carry it on real human emails.
    return (headers.get("auto-submitted", "no").lower() not in ("no", "") or "x-autoreply" in headers
            or "x-autorespond" in headers or headers.get("precedence", "").lower() == "auto_reply")


def _phrase_hits(text: str) -> dict[str, tuple[float, str]]:
    hits = {}
    for label, conf, pattern in PHRASES:
        m = re.search(pattern, text, re.I)
        if m:
            hits[label] = (conf, m.group(0))
    return hits


def _rules(headers: dict, from_email: str, subject: str, body: str) -> tuple[str, float, str] | None:
    """Returns a label only when the signal is unambiguous; conflicting signals return None (let the model read it)."""
    if re.search(r"mailer-daemon|postmaster", from_email, re.I) or re.search(r"delivery status notification|undeliverable|address not found", subject, re.I):
        return "bounce", 0.99, "Delivery failure notice from the mail server"
    auto_hdr = _auto_header(headers)
    text = f"{subject}\n{body[:3000]}"
    hits = _phrase_hits(text)
    human_positive = "positive" in hits or "question" in hits
    ooo = OOO.search(text)
    if ooo and (auto_hdr or AUTO.search(subject) or re.search(r"out of (the )?office", subject, re.I) or not human_positive):
        return "out_of_office", 0.95 if auto_hdr else 0.85, f"Says “{ooo.group(0)}”"
    if (auto_hdr or AUTO.search(subject)) and not human_positive:
        return "auto_reply", 0.9, "Automatic reply (marked by their mail system)"
    if "annoyed" in hits:
        return "annoyed", hits["annoyed"][0], f"Contains “{hits['annoyed'][1][:60]}”"
    human = {k: v for k, v in hits.items() if k in ("negative", "not_now", "positive")}
    if len(human) == 1:
        label, (conf, phrase) = next(iter(human.items()))
        return label, conf, f"Contains “{phrase[:60]}”"
    return None  # nothing clear, or mixed signals (e.g. "unfortunately I'm out Monday, but let's talk Thursday")


def _model(text: str) -> tuple[str, float] | None:
    if not MODEL_PATH.exists():
        return None
    import joblib

    clf = joblib.load(MODEL_PATH)
    probs = clf.predict_proba([text])[0]
    i = int(probs.argmax())
    return str(clf.classes_[i]), float(probs[i])


LLM_SCHEMA = {"type": "object", "properties": {
    "label": {"type": "string", "enum": ["positive", "question", "not_now", "negative", "annoyed", "unclear"]},
    "reason": {"type": "string"}}, "required": ["label", "reason"]}
LLM_SYSTEM = ("Classify a company's reply to a job seeker's cold email. positive = wants to talk/interview/next step; "
              "question = asks for info before deciding; not_now = no role now but open later; negative = polite no; "
              "annoyed = irritated about being contacted; unclear = too short or ambiguous to tell (e.g. just 'ok'). "
              "reason: one short sentence quoting their words.")


def classify(headers: dict, from_email: str, subject: str, body: str) -> dict:
    # Only look at what they wrote, not the quoted history of our email below it.
    fresh = re.split(r"\n\s*On .{5,120}wrote:|\n-{2,} ?Original Message|\n>", body, maxsplit=1)[0]
    r = _rules(headers, from_email, subject, fresh)
    if r and r[1] >= 0.9:
        label, conf, reason = r
        return _out(label, conf, "rules", reason, fresh)
    m = _model(f"{subject}\n{fresh}")
    if m and m[1] >= max(0.75, r[1] if r else 0):
        return _out(m[0], m[1], "model", "Kold's reply classifier (trained on your confirmed replies)", fresh)
    if r:
        return _out(r[0], r[1], "rules", r[2], fresh)
    if len(re.findall(r"\w+", fresh)) < 4:
        return _out("unclear", 0.5, "rules", "Very short reply. Please read it and set the label.", fresh)
    try:
        d = llm.generate_json(LLM_SYSTEM, f"SUBJECT: {subject}\n\nREPLY:\n{fresh[:3000]}", LLM_SCHEMA)
        return _out(d["label"], 0.7, "local-llm", d.get("reason", ""), fresh)
    except (llm.LLMUnavailable, KeyError):
        return _out("unclear", 0.3, "rules", "Couldn't tell what they mean. Please read it and set the label.", fresh)


def _out(label: str, conf: float, source: str, reason: str, text: str) -> dict:
    return {"label": label, "confidence": round(conf, 2), "source": source, "reason": reason,
            "return_date": return_date(text) if label == "out_of_office" else None}


def model_trained() -> bool:
    return Path(MODEL_PATH).exists()
