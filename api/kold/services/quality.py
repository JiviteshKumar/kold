"""Pre-send checks shown next to every email, so the user sees why a draft is (or isn't) ready."""
import re

SPAM_WORDS = re.compile(
    r"\b(guarantee[d]?|act now|urgent|limited time|free money|100% free|risk[- ]free|click here|"
    r"buy now|winner|congratulations|no obligation|dear sir/madam|to whom it may concern|"
    r"i hope this (e-?mail|message) finds you well)\b", re.I)
PLACEHOLDER = re.compile(r"\[[^\]]{2,60}\]|\{\{.*?\}\}|<[A-Z ]{3,}>")


CLAIM = re.compile(r"\b(I|I've|I'm|my|me)\b")
COMMON = set("""about above after again also although among another apply applying attached available based being brief call
calls chat could connect consider considering currently discuss email excited experience forward from have having help hiring
hope interest interested into just keen kind know learn like look looking love manager more most much next note open
opportunity opportunities person please point position recently regarding resume review right role roles share short should
some team than thank thanks that their them there these they this those through time very want week well were what when where
which while will with would writing your yours also additionally recently currently particularly especially really""".split())


def _content_words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z][a-z0-9+#.-]{3,}", text.lower()) if w.strip(".-") not in COMMON]


def unsupported_claims(body: str, support_text: str) -> list[str]:
    """First-person sentences whose substance doesn't appear in the user's resume (or the role itself)."""
    support = support_text.lower()
    flagged = []
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", body):
        if not CLAIM.search(sentence):
            continue
        words = _content_words(sentence)
        if len(words) < 4:
            continue
        backed = sum(1 for w in words if w.strip(".-") in support)
        if backed / len(words) < 0.6:
            flagged.append(sentence.strip())
    return flagged


def check(subject: str, body: str, company: str, step: int, has_attachment: bool, support_text: str = "") -> dict:
    words = len(re.findall(r"\w+", body))
    limit = 160 if step == 0 else 90
    checks = []

    def add(ok: bool, good: str, bad: str, blocking: bool = False):
        checks.append({"ok": ok, "text": good if ok else bad, "blocking": blocking and not ok})

    add(words <= limit, f"Short and readable ({words} words)", f"{words} words is long. Aim for under {limit}.")
    add(0 < len(subject) <= 70, "Subject line is concise", "Subject is missing or too long", blocking=not subject)
    add(not SPAM_WORDS.search(subject + " " + body), "No spam-trigger phrases", "Contains phrases that spam filters or recruiters dislike")
    add(body.count("!") <= 1, "Calm tone", "Too many exclamation marks")
    add(len(re.findall(r"https?://", body)) <= 2, "Two links or fewer", "Too many links can land the email in spam")
    add(not re.search(r"\b[A-Z]{5,}\b", re.sub(r"\b(SQL|HTML|CSS|AWS|REST|JSON|API|NLP|CI/CD)\b", "", body)), "No shouting (ALL CAPS)", "Avoid ALL-CAPS words")
    if step == 0:
        add(company.lower() in (subject + body).lower(), f"Mentions {company} specifically", f"Doesn't mention {company}: feels generic")
        add(has_attachment, "Resume attached", "No resume attached")
    if support_text:
        claims = unsupported_claims(body, support_text)
        add(not claims, "Every claim about you is backed by your resume",
            "Check this. It's not clearly in your resume: “" + "”, “".join(c[:120] for c in claims[:2]) + "”")
    ph = PLACEHOLDER.findall(subject + " " + body)
    add(not ph, "No placeholders left", "Fill in before sending: " + ", ".join(ph[:3]), blocking=True)
    passed = sum(c["ok"] for c in checks)
    return {"score": round(100 * passed / len(checks)), "checks": checks, "ready": not any(c["blocking"] for c in checks)}
