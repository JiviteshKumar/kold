"""Runtime configuration. Every value can be overridden with a KOLD_* environment variable or api/.env."""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KOLD_", env_file=API_DIR / ".env", extra="ignore")

    app_name: str = "Kold"
    database_url: str = f"sqlite:///{(API_DIR / 'data' / 'kold.db').as_posix()}"
    data_dir: Path = API_DIR / "data"
    # Where the web app lives; used for OAuth redirects back into the product. Set it in production
    # (Google requires the exact redirect URI). Left empty, it's taken from each request (dev convenience).
    web_origin: str = ""
    secret_key: str = "change-me-in-production"

    # Local, self-hosted open-weight model served by Ollama. No third-party AI API.
    ollama_url: str = "http://127.0.0.1:11434"
    llm_model: str = "qwen3.5:4b"
    llm_timeout_s: float = 180.0

    # Google OAuth client (Web application) from Google Cloud Console.
    google_client_id: str = ""
    google_client_secret: str = ""

    # Outreach safety limits. These protect the user's own Gmail reputation.
    max_cold_emails_per_day: int = 25
    max_followups: int = 2
    default_followup_gaps_days: str = "4,7"  # gap after initial, then after follow-up 1

    crawl_interval_hours: int = 6
    inbox_poll_minutes: int = 10
    stale_job_days: int = 45

    # Web push (optional). Generate with: python -m scripts.gen_vapid
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:admin@example.com"

    user_agent: str = "KoldBot/0.1 (+opportunity discovery; respects robots.txt)"

    # Sandbox: Gmail is simulated with a local mailbox file. Nothing reaches the internet.
    # For development and testing only; the app shows a banner while it's on.
    gmail_sandbox: bool = False
    sandbox_email: str = "you@kold.sandbox"

    @property
    def cookie_secure(self) -> bool:
        return self.web_origin.startswith("https://")

    @property
    def followup_gaps(self) -> list[int]:
        return [int(x) for x in self.default_followup_gaps_days.split(",") if x.strip()]



settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
(settings.data_dir / "resumes").mkdir(exist_ok=True)
