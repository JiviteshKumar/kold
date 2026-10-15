from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import event, inspect, text
from sqlmodel import Session, SQLModel, create_engine

from .config import settings

_sqlite = settings.database_url.startswith("sqlite")
# The scheduler, the refresh worker and web requests all write concurrently: wait for locks instead of failing.
_connect_args = {"check_same_thread": False, "timeout": 30} if _sqlite else {}
engine = create_engine(settings.database_url, connect_args=_connect_args)

if _sqlite:
    @event.listens_for(engine, "connect")
    def _pragmas(conn, _):
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=30000")
        cur.close()


def init_db() -> None:
    from . import models

    assert models.User  # importing the models registers their tables
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()
    _fix_indexes()


def _fix_indexes() -> None:
    """Gmail message ids are unique per mailbox, not globally: enforce uniqueness per (user, message)."""
    insp = inspect(engine)
    with engine.begin() as conn:
        for ix in insp.get_indexes("inboxmessage"):
            if ix["name"] == "ix_inboxmessage_gmail_message_id" and ix.get("unique"):
                conn.execute(text("DROP INDEX ix_inboxmessage_gmail_message_id"))
                conn.execute(text("CREATE INDEX ix_inboxmessage_gmail_message_id ON inboxmessage (gmail_message_id)"))
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_user_message ON inboxmessage (user_id, gmail_message_id)"))
        # Addresses users typed in before contacts became per-user were stored as shared: they must not leak.
        conn.execute(text("DELETE FROM contact WHERE role_hint = 'user-added' AND user_id IS NULL"))
        conn.execute(text('DELETE FROM contact WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM "user")'))


def _add_missing_columns() -> None:
    """Tiny forward-only migration: add any new nullable/defaulted columns to existing tables."""
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl = col.type.compile(dialect=engine.dialect)
                default = ""
                if col.default is not None and getattr(col.default, "is_scalar", False):
                    v = col.default.arg
                    default = f" DEFAULT {int(v) if isinstance(v, bool) else repr(v)}"
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl}{default}'))


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


@contextmanager
def session_scope() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
