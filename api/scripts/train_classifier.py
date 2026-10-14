"""Train Kold's own reply classifier from replies the user has confirmed or corrected in the Inbox.

Only real, user-confirmed labels are used (label_source == "user"). Nothing synthetic.
Usage: python -m scripts.train_classifier
"""
from collections import Counter

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score
from sklearn.pipeline import make_pipeline
from sqlmodel import select

from kold.db import init_db, session_scope
from kold.models import InboxMessage
from kold.services.classifier import MODEL_PATH

MIN_EXAMPLES = 30

if __name__ == "__main__":
    init_db()
    with session_scope() as s:
        rows = s.exec(select(InboxMessage).where(InboxMessage.label_source == "user")).all()
        X = [f"{m.subject}\n{m.body[:3000]}" for m in rows]
        y = [m.label for m in rows]
    counts = Counter(y)
    print("Confirmed examples:", dict(counts))
    if len(X) < MIN_EXAMPLES or len(counts) < 2:
        raise SystemExit(f"Need at least {MIN_EXAMPLES} confirmed replies across 2+ labels (have {len(X)}). Keep confirming labels in the Inbox.")
    clf = make_pipeline(TfidfVectorizer(ngram_range=(1, 2), min_df=1, sublinear_tf=True),
                        LogisticRegression(max_iter=2000, class_weight="balanced"))
    folds = min(5, min(counts.values()))
    if folds >= 2:
        print(f"Cross-validated accuracy: {cross_val_score(clf, X, y, cv=folds).mean():.2%}")
    clf.fit(X, y)
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(clf, MODEL_PATH)
    print("Saved", MODEL_PATH)
