"""Client for the self-hosted open-weight model (served locally by Ollama).

Nothing here calls a third-party AI service. If the local model is not running,
callers fall back to deterministic rules/templates and say so in the UI.
"""
import json
import logging
import re
from typing import Any

import httpx

from .config import settings

log = logging.getLogger(__name__)


class LLMUnavailable(RuntimeError):
    pass


def model_label() -> str:
    return f"local-model:{settings.llm_model}"


def available() -> bool:
    try:
        r = httpx.get(f"{settings.ollama_url}/api/tags", timeout=3)
        names = {m["name"] for m in r.json().get("models", [])}
        return settings.llm_model in names
    except Exception:
        return False


def _chat(messages: list[dict], fmt: Any = None, temperature: float = 0.4) -> str:
    payload: dict[str, Any] = {
        "model": settings.llm_model,
        "messages": messages,
        "stream": False,
        "think": False,
        "options": {"temperature": temperature, "num_ctx": 8192},
    }
    if fmt is not None:
        payload["format"] = fmt
    try:
        r = httpx.post(f"{settings.ollama_url}/api/chat", json=payload, timeout=settings.llm_timeout_s)
        r.raise_for_status()
    except Exception as e:  # connection refused, timeout, model missing
        raise LLMUnavailable(str(e)) from e
    content = r.json().get("message", {}).get("content", "")
    # Some reasoning models still emit <think> blocks; never show those to users.
    return re.sub(r"<think>.*?</think>", "", content, flags=re.S).strip()


def generate(system: str, prompt: str, temperature: float = 0.4) -> str:
    return _chat([{"role": "system", "content": system}, {"role": "user", "content": prompt}], temperature=temperature)


def generate_json(system: str, prompt: str, schema: dict, temperature: float = 0.1) -> dict:
    out = _chat(
        [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        fmt=schema,
        temperature=temperature,
    )
    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        m = re.search(r"\{.*\}", out, flags=re.S)
        if m:
            return json.loads(m.group(0))
        raise LLMUnavailable(f"model returned invalid JSON: {e}") from e
