import base64
import json
import os
import urllib.request
import urllib.error
from typing import Any, Optional


def _b64_data_url(content_type: str, raw: bytes) -> str:
    ct = (content_type or "application/octet-stream").strip() or "application/octet-stream"
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:{ct};base64,{b64}"


def _responses_api_call(payload: dict[str, Any], *, base_url: str | None = None, api_key: str | None = None) -> dict[str, Any]:
    use_base = (base_url or os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com").rstrip("/")
    use_key = (api_key or os.environ.get("OPENAI_API_KEY") or "").strip()
    if not use_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    url = f"{use_base}/v1/responses"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {use_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read()
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else str(e)
        raise RuntimeError(f"OpenAI HTTP {getattr(e, 'code', '?')}: {body}") from e


def _extract_output_text(res: dict[str, Any]) -> str:
    # Responses API can return multiple output items; we want the first output_text content.
    for out in (res.get("output") or []):
        if out.get("type") == "message":
            for c in (out.get("content") or []):
                if c.get("type") in {"output_text", "text"} and isinstance(c.get("text"), str):
                    return c["text"]
    # Fallback: try top-level convenience fields if present.
    if isinstance(res.get("output_text"), str):
        return res["output_text"]
    raise RuntimeError("OpenAI response did not contain output_text")


def openai_extract_purchase_invoice_from_image(
    *,
    raw: bytes,
    content_type: str,
    filename: str,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
) -> dict[str, Any]:
    """
    Use an OpenAI vision-capable model to extract a purchase invoice into structured JSON.
    Returns a dict with keys: supplier, invoice, lines, totals (best-effort).
    """
    use_model = (model or os.environ.get("OPENAI_INVOICE_VISION_MODEL") or "gpt-4o-mini").strip()
    img_url = _b64_data_url(content_type, raw)

    schema: dict[str, Any] = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "supplier": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "name": {"type": ["string", "null"]},
                    "vat_no": {"type": ["string", "null"]},
                    "phone": {"type": ["string", "null"]},
                    "email": {"type": ["string", "null"]},
                    "address": {"type": ["string", "null"]},
                },
            },
            "invoice": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "invoice_no": {"type": ["string", "null"]},
                    "supplier_ref": {"type": ["string", "null"]},
                    "invoice_date": {"type": ["string", "null"], "description": "YYYY-MM-DD if known"},
                    "due_date": {"type": ["string", "null"], "description": "YYYY-MM-DD if known"},
                    "currency": {"type": ["string", "null"], "description": "USD or LBP if known"},
                    "exchange_rate": {"type": ["number", "null"], "description": "LBP per 1 USD if present on invoice"},
                },
            },
            "lines": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "supplier_item_code": {"type": ["string", "null"]},
                        "supplier_item_name": {"type": ["string", "null"]},
                        "qty": {"type": "number"},
                        "unit_price": {"type": "number"},
                        "currency": {"type": ["string", "null"], "description": "USD or LBP if known"},
                    },
                    "required": ["qty", "unit_price"],
                },
            },
            "totals": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "subtotal": {"type": ["number", "null"]},
                    "tax": {"type": ["number", "null"]},
                    "total": {"type": ["number", "null"]},
                    "currency": {"type": ["string", "null"], "description": "USD or LBP if known"},
                },
            },
            "notes": {"type": ["string", "null"]},
        },
        "required": ["lines"],
    }

    prompt = (
        "Extract this supplier purchase invoice into structured JSON.\n"
        "Rules:\n"
        "- Return ONLY fields that are visible on the document.\n"
        "- If a field is not present, return null.\n"
        "- For dates, use YYYY-MM-DD.\n"
        "- If currency is unclear per line, set line currency null.\n"
        "- qty and unit_price must be numeric.\n"
        f"Filename: {filename}\n"
    )

    payload = {
        "model": use_model,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": img_url},
                ],
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "purchase_invoice_extract",
                "strict": True,
                "schema": schema,
            }
        },
    }

    res = _responses_api_call(payload, base_url=base_url, api_key=api_key)
    out_text = _extract_output_text(res)
    try:
        return json.loads(out_text)
    except Exception as e:
        raise RuntimeError(f"OpenAI returned invalid JSON: {out_text[:500]}") from e


def openai_extract_purchase_invoice_from_text(
    *,
    text: str,
    filename: str,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
) -> dict[str, Any]:
    """
    Extract invoice info from already-extracted text (e.g., pdftotext output).
    """
    use_model = (model or os.environ.get("OPENAI_INVOICE_TEXT_MODEL") or "gpt-4o-mini").strip()

    schema: dict[str, Any] = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "supplier": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "name": {"type": ["string", "null"]},
                    "vat_no": {"type": ["string", "null"]},
                },
            },
            "invoice": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "invoice_no": {"type": ["string", "null"]},
                    "supplier_ref": {"type": ["string", "null"]},
                    "invoice_date": {"type": ["string", "null"]},
                    "due_date": {"type": ["string", "null"]},
                    "currency": {"type": ["string", "null"]},
                    "exchange_rate": {"type": ["number", "null"]},
                },
            },
            "lines": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "supplier_item_code": {"type": ["string", "null"]},
                        "supplier_item_name": {"type": ["string", "null"]},
                        "qty": {"type": "number"},
                        "unit_price": {"type": "number"},
                        "currency": {"type": ["string", "null"]},
                    },
                    "required": ["qty", "unit_price"],
                },
            },
        },
        "required": ["lines"],
    }

    prompt = (
        "Extract this supplier purchase invoice text into structured JSON.\n"
        "Rules:\n"
        "- Return ONLY fields that are supported by the schema.\n"
        "- If a field is not present, return null.\n"
        "- For dates, use YYYY-MM-DD.\n"
        f"Filename: {filename}\n\n"
        "INVOICE TEXT:\n"
        + (text or "")[:20000]
    )

    payload = {
        "model": use_model,
        "input": [{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
        "text": {"format": {"type": "json_schema", "name": "purchase_invoice_extract_text", "strict": True, "schema": schema}},
    }
    res = _responses_api_call(payload, base_url=base_url, api_key=api_key)
    out_text = _extract_output_text(res)
    try:
        return json.loads(out_text)
    except Exception as e:
        raise RuntimeError(f"OpenAI returned invalid JSON: {out_text[:500]}") from e
