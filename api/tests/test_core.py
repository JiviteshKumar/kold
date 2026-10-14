from kold.services import classifier, geo, quality, trust


def test_geo_india_onsite():
    p = geo.classify("Bengaluru, Karnataka, India")
    assert (p.region, p.workplace, p.open_to_india) == ("india", "onsite", True)


def test_geo_remote_us_only_is_not_open_to_india():
    p = geo.classify("Remote - US", remote_flag=True)
    assert p.region == "abroad" and not p.open_to_india


def test_geo_remote_worldwide_is_open():
    p = geo.classify("Worldwide", remote_flag=True, restrictions=["Worldwide"])
    assert p.open_to_india


def test_geo_remote_restricted_to_mexico_is_abroad():
    p = geo.classify("Ciudad de México, Mexico", remote_flag=True, restrictions=["Ciudad de México, Mexico"])
    assert p.region == "abroad"


def test_geo_timezone_overlap():
    assert geo.classify("", remote_flag=True, tz_offsets=[5.5, 6]).open_to_india
    assert not geo.classify("", remote_flag=True, tz_offsets=[-8, -5]).open_to_india


def test_timezone_for():
    assert geo.timezone_for("San Francisco, CA", "global_remote") == "America/Los_Angeles"
    assert geo.timezone_for("Pune", "india") == "Asia/Kolkata"


def test_trust_does_not_flag_fintech_language():
    desc = "You'll build OTP verification flows and reduce payment processing fees for merchants' bank accounts. " * 5
    score, flags = trust.score("greenhouse", desc, None, "Stripe")
    assert score >= 80 and not [f for f in flags if f["level"] == "bad"]


def test_trust_flags_fee_scam():
    desc = "Work from home data entry. Candidates must pay a registration fee of Rs 999. Contact us on WhatsApp. " * 4
    score, flags = trust.score("remoteok", desc, None, "X")
    assert score < 40 and len([f for f in flags if f["level"] == "bad"]) >= 2


def test_classifier_rules():
    c = classifier.classify({}, "hr@acme.com", "Re: SDE intern", "Thanks! Are you available for a call on Thursday?\n\nOn Mon, X wrote:\n> hi")
    assert c["label"] == "positive"
    c = classifier.classify({}, "a@acme.com", "Re: hi", "Please stop emailing me.")
    assert c["label"] == "annoyed"
    c = classifier.classify({"auto-submitted": "auto-replied"}, "a@acme.com", "Out of Office", "I am out of office, back on 20 December.")
    assert c["label"] == "out_of_office"
    c = classifier.classify({}, "mailer-daemon@googlemail.com", "Delivery Status Notification (Failure)", "Address not found")
    assert c["label"] == "bounce"
    c = classifier.classify({}, "a@acme.com", "Re: role", "Unfortunately the position has been filled.")
    assert c["label"] == "negative"


def test_quality_blocks_placeholders():
    q = quality.check("Data intern at Acme", "Hi, I'm free [your availability]. Thanks", "Acme", 0, True)
    assert not q["ready"]
    q = quality.check("Data intern at Acme", "Hi Acme team, short note. Resume attached. Thanks", "Acme", 0, True)
    assert q["ready"]


def test_classifier_hard_cases():
    # Recruiter replying through an ATS often carries "Precedence: bulk": still a human, still positive.
    assert classifier.classify({"precedence": "bulk"}, "r@ats.io", "Re: role", "Thanks for reaching out. Let's set up a call next week.")["label"] == "positive"
    # Mentions leave, but wants to talk: positive, not out-of-office.
    assert classifier.classify({}, "a@b.com", "Re: role", "I'm on leave Monday but happy to chat Thursday.")["label"] == "positive"
    # ATS acknowledgement: automatic.
    assert classifier.classify({"auto-submitted": "auto-generated"}, "no-reply@ats.com", "We received your application",
                               "Thanks for applying, we received your application.")["label"] == "auto_reply"
    # Too short to judge: ask the user.
    assert classifier.classify({}, "a@b.com", "Re: role", "ok")["label"] == "unclear"


def test_unsupported_claims_flagged():
    support = "Python SQL Built a Power BI dashboard tracking 40+ KPIs Data Analyst Intern Finlytics"
    body = "At Finlytics I built a Power BI dashboard tracking 40+ KPIs. I have led production ML systems at scale for enterprises."
    flagged = quality.unsupported_claims(body, support)
    assert len(flagged) == 1 and "production ML" in flagged[0]


def test_geo_eligibility_edge_cases():
    c = geo.classify
    assert not c("U.S. Anywhere", remote_flag=True, restrictions=["U.S. Anywhere"]).open_to_india
    assert not c("Ukraine Anywhere", remote_flag=True, restrictions=["Ukraine Anywhere"]).open_to_india
    assert not c("Kazakhstan", remote_flag=True, restrictions=["Kazakhstan"], tz_offsets=[5, 6]).open_to_india
    assert not c("Worldwide", remote_flag=True, restrictions=["Worldwide"], tz_offsets=[-8, -7, -6, -5]).open_to_india
    assert c("Worldwide", remote_flag=True, restrictions=["Worldwide"], tz_offsets=[0, 5.5]).open_to_india
    assert c("Remote Anywhere", remote_flag=True).open_to_india
    assert c("Northern America, LATAM, Europe, APAC", remote_flag=True, restrictions=["Northern America", "LATAM", "Europe", "APAC"]).open_to_india
    assert geo.description_restricts("This role is US-only. You must be authorized to work in the United States.")
    assert not geo.description_restricts("We hire globally, including India and the US.")
