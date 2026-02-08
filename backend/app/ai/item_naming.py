import json
import os
import re
import urllib.request
import urllib.error
from typing import Any


OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com").rstrip("/")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()


def _responses_api_call(payload: dict[str, Any]) -> dict[str, Any]:
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    url = f"{OPENAI_BASE_URL}/v1/responses"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else str(e)
        raise RuntimeError(f"OpenAI HTTP {getattr(e, 'code', '?')}: {body}") from e


def _extract_output_text(res: dict[str, Any]) -> str:
    for out in (res.get("output") or []):
        if out.get("type") == "message":
            for c in (out.get("content") or []):
                if c.get("type") in {"output_text", "text"} and isinstance(c.get("text"), str):
                    return c["text"]
    if isinstance(res.get("output_text"), str):
        return res["output_text"]
    raise RuntimeError("OpenAI response did not contain output_text")


def _smart_unit_normalize(s: str) -> str:
    t = re.sub(r"\s+", " ", (s or "").strip())
    # normalize common unit typos: "20gram" -> "20 g"
    t = re.sub(r"(\d+)\s*(grams|gram|gr)\b", r"\1 g", t, flags=re.IGNORECASE)
    t = re.sub(r"(\d+)\s*(kgs|kg)\b", r"\1 kg", t, flags=re.IGNORECASE)
    t = re.sub(r"(\d+)\s*(mls|ml)\b", r"\1 ml", t, flags=re.IGNORECASE)
    t = re.sub(r"(\d+)\s*(liters|liter|ltr|l)\b", r"\1 L", t, flags=re.IGNORECASE)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def heuristic_item_name_suggestions(raw_name: str) -> list[dict[str, str]]:
    """
    Deterministic fallback suggestions when an external LLM isn't configured.
    """
    base = _smart_unit_normalize(raw_name)
    if not base:
        return []

    # Gentle normalization, avoid over-formatting brand names.
    suggestion = base[:1].upper() + base[1:]
    alt = base.title()
    alt = re.sub(r"\b(G|Kg|Ml)\b", lambda m: m.group(1).lower(), alt)
    alt = re.sub(r"\bL\b", "L", alt)

    out = [{"name": suggestion, "reason": "Normalized spacing/units."}]
    if alt != suggestion:
        out.append({"name": alt, "reason": "Title-cased words and normalized units."})
    return out[:3]


def openai_item_name_suggestions(raw_name: str, count: int = 3, model: str | None = None) -> list[dict[str, str]]:
    use_model = (model or os.environ.get("OPENAI_ITEM_NAMING_MODEL") or "gpt-4o-mini").strip()
    n = max(1, min(int(count or 3), 6))

    schema: dict[str, Any] = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "suggestions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "name": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                    "required": ["name", "reason"],
                },
            }
        },
        "required": ["suggestions"],
    }

    prompt = (
        "You are helping normalize messy supplier/item names into clean POS-friendly product names.\n"
        "Return short, clear names with correct units and brand capitalization when obvious.\n"
        "Do not invent pack sizes or flavors that aren't present.\n"
        f"Input: {raw_name}\n"
        f"Return {n} suggestions.\n"
    )

    payload = {
        "model": use_model,
        "input": [{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
        "text": {"format": {"type": "json_schema", "name": "item_name_suggestions", "strict": True, "schema": schema}},
    }
    res = _responses_api_call(payload)
    out_text = _extract_output_text(res)
    obj = json.loads(out_text)
    sug = obj.get("suggestions") or []
    out: list[dict[str, str]] = []
    for s in sug:
        name = str((s or {}).get("name") or "").strip()
        reason = str((s or {}).get("reason") or "").strip()
        if not name:
            continue
        out.append({"name": name[:200], "reason": reason[:300]})
        if len(out) >= n:
            break
    return out

