"""Check that real Gmail is configured correctly before switching off sandbox mode.

Usage: python -m scripts.check_gmail_setup
"""
import re
import sys

from kold.config import settings

ok = True


def say(good: bool, text: str) -> None:
    global ok
    ok &= good
    print(("  OK   " if good else "  FIX  ") + text)


print("Kold: Gmail setup check\n")
say(not settings.gmail_sandbox, "Sandbox mode is OFF (remove KOLD_GMAIL_SANDBOX=1 from api/.env)" if settings.gmail_sandbox
    else "Sandbox mode is off: real Gmail will be used")
say(bool(re.fullmatch(r"[\w-]+\.apps\.googleusercontent\.com", settings.google_client_id)),
    "KOLD_GOOGLE_CLIENT_ID looks like a Google OAuth client id (...apps.googleusercontent.com)")
say(len(settings.google_client_secret) >= 20, "KOLD_GOOGLE_CLIENT_SECRET is set")
origin = settings.web_origin.rstrip("/")
say(bool(origin), "KOLD_WEB_ORIGIN is set to the address people open Kold at (e.g. https://kold.yourdomain.com)")
if origin:
    say(origin.startswith("https://") or origin.startswith("http://localhost"),
        "KOLD_WEB_ORIGIN uses https (required for phones / installing the app), or localhost for testing")
    print(f"\n  Register this exact redirect URI in Google Cloud > Credentials > your OAuth client:\n    {origin}/api/gmail/callback")
print("\n  In the OAuth consent screen, add these scopes: gmail.send, gmail.readonly, userinfo.email")
print("  While the app is in 'Testing', add each user's Gmail address under 'Test users' (max 100).\n")
print("All set: restart the API and click 'Connect Gmail' in Profile." if ok else "Fix the items above, then run this again.")
sys.exit(0 if ok else 1)
