"""Location understanding: where is a job, can someone in India do it, and what time is it for the recipient."""
import re
from dataclasses import dataclass

INDIA_CITIES = {
    "bengaluru": "Bengaluru", "bangalore": "Bengaluru", "mumbai": "Mumbai", "navi mumbai": "Mumbai",
    "delhi": "Delhi", "new delhi": "Delhi", "ncr": "Delhi NCR", "gurugram": "Gurugram", "gurgaon": "Gurugram",
    "noida": "Noida", "hyderabad": "Hyderabad", "chennai": "Chennai", "pune": "Pune", "kolkata": "Kolkata",
    "ahmedabad": "Ahmedabad", "jaipur": "Jaipur", "chandigarh": "Chandigarh", "mohali": "Mohali", "kochi": "Kochi",
    "indore": "Indore", "coimbatore": "Coimbatore", "thiruvananthapuram": "Thiruvananthapuram",
    "trivandrum": "Thiruvananthapuram", "bhubaneswar": "Bhubaneswar", "lucknow": "Lucknow", "nagpur": "Nagpur",
    "vadodara": "Vadodara", "surat": "Surat", "mysuru": "Mysuru", "mysore": "Mysuru", "goa": "Goa",
    "visakhapatnam": "Visakhapatnam", "bhopal": "Bhopal", "dehradun": "Dehradun",
}

# Phrases in a remote job's location that mean a candidate living in India is eligible.
OPEN_TO_INDIA = re.compile(r"\b(worldwide|anywhere|global(ly)?|international|india|apac|asia|asia[- ]pacific|south asia)\b", re.I)
REMOTE_WORD = re.compile(r"\b(remote|work from home|wfh|distributed|anywhere)\b", re.I)
HYBRID_WORD = re.compile(r"\bhybrid\b", re.I)

# (pattern, IANA timezone). City patterns come before country patterns so they win.
TZ_RULES: list[tuple[str, str]] = [
    (r"san francisco|bay area|seattle|los angeles|palo alto|mountain view|san jose|sunnyvale|portland|san diego|menlo park|redwood", "America/Los_Angeles"),
    (r"denver|boulder|salt lake|phoenix", "America/Denver"),
    (r"chicago|austin|dallas|houston|minneapolis", "America/Chicago"),
    (r"new york|nyc|boston|atlanta|miami|washington|philadelphia|toronto|montreal", "America/New_York"),
    (r"vancouver", "America/Vancouver"),
    (r"london|manchester|edinburgh|\buk\b|united kingdom|england|scotland", "Europe/London"),
    (r"dublin|ireland", "Europe/Dublin"),
    (r"berlin|munich|hamburg|germany", "Europe/Berlin"),
    (r"paris|france", "Europe/Paris"),
    (r"amsterdam|netherlands", "Europe/Amsterdam"),
    (r"madrid|barcelona|spain", "Europe/Madrid"),
    (r"lisbon|portugal", "Europe/Lisbon"),
    (r"warsaw|krakow|poland", "Europe/Warsaw"),
    (r"stockholm|sweden", "Europe/Stockholm"),
    (r"zurich|geneva|switzerland", "Europe/Zurich"),
    (r"tel aviv|israel", "Asia/Jerusalem"),
    (r"dubai|abu dhabi|uae|united arab emirates", "Asia/Dubai"),
    (r"singapore", "Asia/Singapore"),
    (r"tokyo|japan", "Asia/Tokyo"),
    (r"sydney|melbourne|australia", "Australia/Sydney"),
    (r"sao paulo|são paulo|brazil", "America/Sao_Paulo"),
    (r"mexico", "America/Mexico_City"),
    (r"canada", "America/Toronto"),
    (r"\bus\b|\busa\b|united states|america", "America/New_York"),
    (r"europe|emea|\beu\b", "Europe/Berlin"),
]

ABROAD_HINT = re.compile("|".join(p for p, _ in TZ_RULES), re.I)


@dataclass
class Place:
    workplace: str      # onsite | hybrid | remote
    region: str         # india | global_remote | abroad | unknown
    open_to_india: bool
    city: str = ""


def india_city(text: str) -> str:
    low = text.lower()
    for key, name in INDIA_CITIES.items():
        if re.search(rf"\b{re.escape(key)}\b", low):
            return name
    return ""


def classify(
    location: str,
    remote_flag: bool | None = None,
    workplace_hint: str = "",
    restrictions: list[str] | None = None,
    tz_offsets: list[float] | None = None,
    country: str = "",
) -> Place:
    """Decide whether a job is in India, remote-and-open-to-India, or abroad (not workable from India)."""
    text = " ".join([location or "", workplace_hint or "", " ".join(restrictions or []), country or ""]).strip()
    hint = (workplace_hint or "").lower()
    if remote_flag or "remote" in hint or REMOTE_WORD.search(location or ""):
        workplace = "remote"
    elif "hybrid" in hint or HYBRID_WORD.search(location or ""):
        workplace = "hybrid"
    else:
        workplace = "onsite"

    city = india_city(text)
    in_india = bool(city) or bool(re.search(r"\bindia\b", text, re.I)) or country.upper() == "IN"

    if workplace != "remote":
        if in_india:
            return Place(workplace, "india", True, city)
        if ABROAD_HINT.search(text):
            return Place(workplace, "abroad", False, city)
        return Place(workplace, "unknown", False, city)

    # Remote: is someone sitting in India allowed to take it?
    if in_india:
        return Place("remote", "india", True, city)
    verdict = _open_from_text(" ".join(restrictions or []) or location or "")
    if verdict is False:
        return Place("remote", "abroad", False, city)  # "Remote - US", "U.S. Anywhere", "Kazakhstan"...
    if tz_offsets:
        # A stated working-hours window must overlap India (UTC+5:30) too.
        overlap = any(abs(o - 5.5) <= 1.5 for o in tz_offsets)
        return Place("remote", "global_remote" if overlap else "abroad", overlap, city)
    if verdict:
        return Place("remote", "global_remote", True, city)
    # Remote with no stated restriction. We do not assume it is open to India.
    return Place("remote", "unknown", False, city)


OTHER_COUNTRY = re.compile(
    r"\b(ukraine|kazakhstan|azerbaijan|armenia|georgia|indonesia|korea|philippines|vietnam|thailand|malaysia|pakistan|bangladesh|"
    r"sri lanka|nepal|china|hong kong|taiwan|new zealand|nigeria|kenya|ghana|south africa|egypt|morocco|turkey|t[uü]rkiye|"
    r"argentina|colombia|chile|peru|uruguay|costa rica|romania|bulgaria|serbia|croatia|greece|italy|austria|belgium|denmark|"
    r"norway|finland|czech|hungary|estonia|latvia|lithuania|slovakia|slovenia|latam|latin america|americas|amer|north america|"
    r"saudi|qatar|bahrain|kuwait|oman|jordan|lebanon|russia|belarus)\b", re.I)


def _open_from_text(text: str) -> bool | None:
    """True = explicitly open to India, False = restricted elsewhere, None = not stated."""
    # "U.S. Anywhere" / "Ukraine Anywhere" mean anywhere *in that country*, not worldwide.
    scoped = re.sub(r"\b(?!remote\b)([A-Za-z][A-Za-z.]*)\s+anywhere\b", r"\1", text, flags=re.I)
    if OPEN_TO_INDIA.search(scoped):
        return True
    if ABROAD_HINT.search(scoped) or OTHER_COUNTRY.search(scoped):
        return False
    return None


# A "worldwide" location can still be contradicted by the posting itself.
RESTRICTED_IN_TEXT = re.compile(
    r"\b(us|u\.s\.|usa|united states|uk|canada|eu|europe|latam)[- ]?(only|based (candidates|applicants) only)\b|"
    r"\bmust (be|reside|live) (located |based )?in (the )?(us|u\.s\.|usa|united states|uk|united kingdom|canada|europe|eu|latam|latin america)\b|"
    r"\b(authori[sz]ed|eligible|legally able) to work in (the )?(us|u\.s\.|usa|united states|uk|united kingdom|canada|eu|europe)\b|"
    r"\bonly (open to|accepting|considering) (candidates|applicants) (from|in|based in|located in) (the )?(us|u\.s\.|usa|united states|uk|canada|europe|eu|latam)\b",
    re.I)


def description_restricts(description: str) -> bool:
    return bool(RESTRICTED_IN_TEXT.search(description or ""))


def timezone_for(location: str, region: str) -> str:
    """Best guess of the recipient's timezone, used to land emails in their morning."""
    if region == "india" or india_city(location or "") or re.search(r"\bindia\b", location or "", re.I):
        return "Asia/Kolkata"
    for pattern, tz in TZ_RULES:
        if re.search(pattern, location or "", re.I):
            return tz
    return "Asia/Kolkata" if region == "unknown" else "UTC"
