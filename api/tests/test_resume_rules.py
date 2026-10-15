"""The server's resume reader on the same layouts as Kold Lite (web/test/fixtures/resumes, all invented people).

These run the rules alone, as the server does when the local model isn't available; with the model, its answer
is merged with these (the richer section wins).
"""
import os
from pathlib import Path

import pytest

from kold import llm
from kold.resume import parser

FIX = Path(__file__).resolve().parents[2] / "web" / "test" / "fixtures" / "resumes"


def read(name: str) -> dict:
    text = parser.extract_text(FIX / name)
    return parser.verify(parser.rule_based(text), text)


def jobs(p):
    return [(e["title"], e["company"], e["start"], e["end"]) for e in p["experience"]]


def low(xs):
    return {x.lower() for x in xs}


def test_modern_spaced_headings_and_font_headers():
    p = read("modern-spaced.pdf")
    assert (p["name"], p["headline"], p["location"]) == ("Ananya Iyer", "Data Science", "Bengaluru, India")
    assert jobs(p) == [("Data Science Intern", "Razorpay", "May 2025", "Aug 2025"), ("Analytics Intern", "Zeta Suite", "Dec 2024", "Feb 2025")]
    assert "Built a gradient boosting model that flagged 2,300 risky merchants a month, improving precision by 18% over the rules engine." in p["experience"][0]["bullets"]
    assert [x["name"] for x in p["projects"]] == ["Churn Radar", "ResumeLens"]
    assert p["education"][0] | {} == {"degree": "B.E., Computer Science", "institution": "RV College of Engineering", "start": "2022", "end": "2026", "score": "8.9/10"}
    assert {"python", "sql", "r", "xgboost", "pytorch", "airflow", "docker"} <= low(p["skills"])
    assert not {"languages", "tools", "ml"} & low(p["skills"])


def test_jakes_latex_template():
    p = read("jakes-template.pdf")
    assert p["name"] == "Rohan Mehta"
    assert jobs(p) == [("Software Engineering Intern", "Swiggy", "May 2024", "July 2024"), ("Undergraduate Researcher", "IIT Bombay", "Jan. 2023", "Dec. 2023")]
    assert len(p["experience"][0]["bullets"]) == 2
    assert p["education"][0]["degree"] == "Bachelor of Technology in Electrical Engineering"
    assert p["education"][0]["institution"] == "Indian Institute of Technology Bombay"
    assert p["projects"][0]["name"] == "Gitty"
    assert {"java", "c/c++", "react", "node.js", "fastapi", "aws"} <= low(p["skills"])


def test_classic_one_column():
    p = read("classic.pdf")
    assert jobs(p) == [("Frontend Developer Intern", "UST Global", "Jan 2025", "Apr 2025"), ("Teaching Assistant", "Model Engineering College", "Aug 2024", "Dec 2024")]
    assert p["education"][0]["score"] == "8.4"
    assert [x["name"] for x in p["projects"]] == ["Bus Buddy", "Notes AI"]
    assert p["certifications"] == ["AWS Certified Cloud Practitioner (2024)"]


def test_two_column_sidebar():
    p = read("two-column.pdf")
    assert (p["name"], p["headline"]) == ("Meera Joshi", "Data Analyst")
    assert p["phone"].replace(" ", "") == "+919930044556"
    assert jobs(p) == [("Data Analyst", "Deloitte India", "Jul 2023", "Present")]
    assert p["education"][0]["institution"] == "St. Xavier's College"
    assert {"sql", "python", "power bi", "excel", "statistics"} <= low(p["skills"])


def test_word_document():
    p = read("experienced.docx")
    assert jobs(p) == [("Senior Data Analyst", "Flipkart", "March 2021", "Present"), ("Data Analyst", "Mu Sigma", "June 2018", "February 2021")]
    assert all(len(e["bullets"]) == 2 for e in p["experience"])
    assert [(e["degree"], e["institution"]) for e in p["education"]] == [("MBA, Business Analytics", "NMIMS Mumbai"), ("B.Com", "Christ University")]
    assert p["experience_level"] == "5+"


def test_plain_text_fresher():
    p = read("fresher.txt")
    assert jobs(p) == [("Web Development Intern", "Infosys", "Jan 2025", "Mar 2025")]
    assert [(e["degree"], e["end"], e["score"]) for e in p["education"]] == [("B.Tech (CSE)", "2025", "7.8"), ("Class XII (CBSE)", "2021", "91%"), ("Class X (CBSE)", "2019", "94%")]


def test_falls_back_to_rules_when_the_model_is_down(monkeypatch):
    def down(*a, **k):
        raise llm.LLMUnavailable("not running")

    monkeypatch.setattr(llm, "generate_json", down)
    data, method = parser.parse(parser.extract_text(FIX / "modern-spaced.pdf"))
    assert method == "rules"
    assert data["experience"][0]["company"] == "Razorpay"


def test_keeps_the_richer_answer_when_merging_with_the_model(monkeypatch):
    # A model that only found one job: the rules found two, so both are kept.
    monkeypatch.setattr(llm, "generate_json", lambda *a, **k: {"name": "Ananya Iyer", "skills": ["Python"], "experience": [
        {"title": "Data Science Intern", "company": "Razorpay", "bullets": []}], "education": [], "projects": [], "links": []})
    monkeypatch.setattr(llm, "model_label", lambda: "local-model:test")
    data, method = parser.parse(parser.extract_text(FIX / "modern-spaced.pdf"))
    assert method == "local-model:test"
    assert len(data["experience"]) == 2 and len(data["projects"]) == 2 and data["education"]


@pytest.mark.skipif(not os.environ.get("KOLD_PRIVATE_RESUME"), reason="set KOLD_PRIVATE_RESUME to a real resume to check it (never committed)")
def test_a_real_resume():
    path = Path(os.environ["KOLD_PRIVATE_RESUME"])
    text = parser.extract_text(path)
    p = parser.verify(parser.rule_based(text), text)
    assert p["name"] and p["experience"] and p["education"] and p["projects"]
    assert all(e["title"] and e["company"] and e["end"] and e["bullets"] for e in p["experience"])
