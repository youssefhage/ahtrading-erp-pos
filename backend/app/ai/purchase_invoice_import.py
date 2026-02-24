import base64
import io
import json
import os
import urllib.request
import urllib.error
from typing import Any, Optional

try:
    from PIL import Image, ImageOps  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    Image = None
    ImageOps = None


def _b64_data_url(content_type: str, raw: bytes) -> str:
    ct = (content_type or "application/octet-stream").strip() or "application/octet-stream"
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:{ct};base64,{b64}"


def _env_int(name: str, default: int, min_v: int, max_v: int) -> int:
    try:
        v = int(os.environ.get(name, str(default)) or default)
    except Exception:
        v = default
    return max(min_v, min(v, max_v))


def _optimize_image_for_vision(raw: bytes, content_type: str) -> tuple[bytes, str]:
    """
    Best-effort in-memory optimization before sending to the model.
    Original uploaded files remain unchanged in attachments.
    """
    if not raw:
        return raw, content_type
    max_side = _env_int("AI_IMPORT_IMAGE_MAX_SIDE", 2200, 800, 5000)
    target_bytes = _env_int("AI_IMPORT_IMAGE_TARGET_BYTES", 1_800_000, 300_000, 12_000_000)
    if len(raw) <= target_bytes:
        return raw, content_type
    if Image is None:
        return raw, content_type

    try:
        with Image.open(io.BytesIO(raw)) as im:
            if ImageOps is not None:
                im = ImageOps.exif_transpose(im)
            width, height = im.size
            longest = max(width, height)
            if longest > max_side:
                scale = float(max_side) / float(longest)
                new_size = (max(1, int(round(width * scale))), max(1, int(round(height * scale))))
                resample = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
                im = im.resize(new_size, resample)

            has_alpha = im.mode in {"RGBA", "LA"} or ("transparency" in (im.info or {}))

            best_bytes: bytes | None = None
            best_ct: str = "image/jpeg"

            if has_alpha:
                out_png = io.BytesIO()
                im.save(out_png, format="PNG", optimize=True, compress_level=6)
                cand_png = out_png.getvalue()
                best_bytes = cand_png
                best_ct = "image/png"
                if len(cand_png) <= target_bytes:
                    return cand_png, "image/png"

            if im.mode != "RGB":
                if has_alpha:
                    bg = Image.new("RGB", im.size, (255, 255, 255))
                    alpha = im.split()[-1] if im.mode in {"RGBA", "LA"} else None
                    bg.paste(im, mask=alpha)
                    im_jpeg = bg
                else:
                    im_jpeg = im.convert("RGB")
            else:
                im_jpeg = im

            for quality in (92, 88, 84, 80, 76):
                out_jpg = io.BytesIO()
                im_jpeg.save(out_jpg, format="JPEG", quality=quality, optimize=True, progressive=True)
                cand_jpg = out_jpg.getvalue()
                if best_bytes is None or len(cand_jpg) < len(best_bytes):
                    best_bytes = cand_jpg
                    best_ct = "image/jpeg"
                if len(cand_jpg) <= target_bytes:
                    return cand_jpg, "image/jpeg"

            if best_bytes and len(best_bytes) < len(raw):
                return best_bytes, best_ct
    except Exception:
        return raw, content_type
    return raw, content_type


def _responses_api_call(
    payload: dict[str, Any],
    *,
    base_url: str | None = None,
    api_key: str | None = None,
    timeout_s: int = 45,
) -> dict[str, Any]:
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
        with urllib.request.urlopen(req, timeout=max(10, int(timeout_s or 45))) as resp:
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


def _purchase_invoice_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "document_type": {
                "type": ["string", "null"],
                "description": "purchase_invoice | receipt | statement | soa | credit_note | other",
            },
            "document_confidence": {"type": ["number", "null"], "description": "0..1 confidence for document_type"},
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
                "required": ["name", "vat_no", "phone", "email", "address"],
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
                "required": [
                    "invoice_no",
                    "supplier_ref",
                    "invoice_date",
                    "due_date",
                    "currency",
                    "exchange_rate",
                ],
            },
            "lines": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "supplier_item_code": {"type": ["string", "null"]},
                        "supplier_item_name": {"type": ["string", "null"]},
                        "description": {"type": ["string", "null"]},
                        "qty": {"type": "number"},
                        "unit_price": {"type": "number"},
                        "line_total": {"type": ["number", "null"]},
                        "currency": {"type": ["string", "null"], "description": "USD or LBP if known"},
                        "confidence": {"type": ["number", "null"], "description": "0..1 confidence for this line"},
                    },
                    "required": [
                        "supplier_item_code",
                        "supplier_item_name",
                        "description",
                        "qty",
                        "unit_price",
                        "line_total",
                        "currency",
                        "confidence",
                    ],
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
                "required": ["subtotal", "tax", "total", "currency"],
            },
            "notes": {"type": ["string", "null"]},
        },
        "required": ["document_type", "document_confidence", "supplier", "invoice", "lines", "totals", "notes"],
    }


def _purchase_invoice_prompt(filename: str) -> str:
    return (
        "Extract this supplier purchase invoice into structured JSON.\n"
        "Rules:\n"
        "- Classify document_type: purchase_invoice | receipt | statement | soa | credit_note | other.\n"
        "- Provide document_confidence as 0..1.\n"
        "- Return ONLY fields that are visible on the document(s).\n"
        "- If a field is not present, return null.\n"
        "- For dates, use YYYY-MM-DD.\n"
        "- If currency is unclear per line, set line currency null.\n"
        "- qty, unit_price, line_total must be numeric when present.\n"
        "- line confidence must be 0..1.\n"
        f"Filename context: {filename}\n"
    )


def openai_pick_purchase_item_candidate(
    *,
    line: dict[str, Any],
    candidates: list[dict[str, Any]],
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
) -> dict[str, Any]:
    """
    Choose one item candidate for a purchase-invoice line from a shortlist.
    Returns:
      {
        candidate_item_id: str | null,
        confidence: float | null,
        reason: str | null,
        entered_uom_code: str | null
      }
    """
    use_model = (
        model
        or os.environ.get("AI_INVOICE_MATCH_MODEL")
        or os.environ.get("AI_INVOICE_TEXT_MODEL")
        or os.environ.get("AI_DEFAULT_MODEL")
        or ""
    ).strip()
    if not use_model:
        raise RuntimeError("AI model is not configured (set company AI settings or AI_DEFAULT_MODEL)")
    shortlist = [c for c in (candidates or []) if str(c.get("id") or "").strip()]
    if not shortlist:
        return {"candidate_item_id": None, "confidence": 0, "reason": "no_candidates", "entered_uom_code": None}
    shortlist = shortlist[:20]

    schema: dict[str, Any] = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "candidate_item_id": {"type": ["string", "null"]},
            "confidence": {"type": ["number", "null"]},
            "reason": {"type": ["string", "null"]},
            "entered_uom_code": {"type": ["string", "null"]},
        },
        "required": ["candidate_item_id", "confidence", "reason", "entered_uom_code"],
    }
    allowed_ids = [str(c.get("id")) for c in shortlist]
    prompt = (
        "Choose the best matching internal item for this supplier invoice line.\n"
        "Rules:\n"
        "- candidate_item_id MUST be one of the provided IDs or null if none is safe.\n"
        "- Be conservative: prefer null over a risky guess.\n"
        "- confidence is 0..1.\n"
        "- entered_uom_code should be one of known candidate UOMs when possible, else null.\n"
        "- Output JSON only.\n\n"
        f"LINE:\n{json.dumps(line, ensure_ascii=False)}\n\n"
        f"ALLOWED_IDS:\n{json.dumps(allowed_ids, ensure_ascii=False)}\n\n"
        f"CANDIDATES:\n{json.dumps(shortlist, ensure_ascii=False)}\n"
    )
    payload = {
        "model": use_model,
        "input": [{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
        "text": {"format": {"type": "json_schema", "name": "purchase_invoice_item_pick", "strict": True, "schema": schema}},
    }
    res = _responses_api_call(payload, base_url=base_url, api_key=api_key, timeout_s=45)
    out_text = _extract_output_text(res)
    try:
        out = json.loads(out_text)
    except Exception as e:
        raise RuntimeError(f"OpenAI returned invalid JSON for candidate pick: {out_text[:500]}") from e
    picked = str((out or {}).get("candidate_item_id") or "").strip() or None
    if picked and picked not in set(allowed_ids):
        picked = None
    conf = (out or {}).get("confidence")
    try:
        conf_n = float(conf)
    except Exception:
        conf_n = 0.0
    conf_n = max(0.0, min(1.0, conf_n))
    uom = str((out or {}).get("entered_uom_code") or "").strip().upper() or None
    return {
        "candidate_item_id": picked,
        "confidence": conf_n,
        "reason": str((out or {}).get("reason") or "").strip() or None,
        "entered_uom_code": uom,
    }


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
    use_model = (
        model
        or os.environ.get("AI_INVOICE_VISION_MODEL")
        or os.environ.get("OPENAI_INVOICE_VISION_MODEL")
        or os.environ.get("AI_DEFAULT_MODEL")
        or ""
    ).strip()
    if not use_model:
        raise RuntimeError("AI model is not configured (set company AI settings or AI_DEFAULT_MODEL)")
    opt_raw, opt_ct = _optimize_image_for_vision(raw, content_type)
    img_url = _b64_data_url(opt_ct, opt_raw)

    schema = _purchase_invoice_schema()
    prompt = _purchase_invoice_prompt(filename)

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


def openai_extract_purchase_invoice_from_images(
    *,
    images: list[dict[str, Any]],
    filename_hint: str,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
) -> dict[str, Any]:
    """
    Extract one invoice from multiple page images in a single model call.
    `images` entries must include: raw (bytes), content_type (str), filename (str|None).
    """
    use_model = (
        model
        or os.environ.get("AI_INVOICE_VISION_MODEL")
        or os.environ.get("OPENAI_INVOICE_VISION_MODEL")
        or os.environ.get("AI_DEFAULT_MODEL")
        or ""
    ).strip()
    if not use_model:
        raise RuntimeError("AI model is not configured (set company AI settings or AI_DEFAULT_MODEL)")
    if not images:
        raise RuntimeError("images is empty")

    schema = _purchase_invoice_schema()
    prompt = (
        _purchase_invoice_prompt(filename_hint)
        + "Important: Multiple page images are provided for the same invoice packet.\n"
        + "Use all pages before deciding totals/lines.\n"
    )
    content: list[dict[str, Any]] = [{"type": "input_text", "text": prompt}]
    max_images = max(1, min(int(os.environ.get("AI_INVOICE_MAX_PACKET_IMAGES", "12") or 12), 20))
    for it in images[:max_images]:
        raw = it.get("raw") or b""
        content_type = str(it.get("content_type") or "image/jpeg")
        if not raw:
            continue
        opt_raw, opt_ct = _optimize_image_for_vision(raw, content_type)
        content.append({"type": "input_image", "image_url": _b64_data_url(opt_ct, opt_raw)})
    if len(content) <= 1:
        raise RuntimeError("no non-empty images to process")

    payload = {
        "model": use_model,
        "input": [{"role": "user", "content": content}],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "purchase_invoice_extract_packet",
                "strict": True,
                "schema": schema,
            }
        },
    }
    # Multi-image calls can be slower.
    res = _responses_api_call(payload, base_url=base_url, api_key=api_key, timeout_s=120)
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
    use_model = (
        model
        or os.environ.get("AI_INVOICE_TEXT_MODEL")
        or os.environ.get("OPENAI_INVOICE_TEXT_MODEL")
        or os.environ.get("AI_DEFAULT_MODEL")
        or ""
    ).strip()
    if not use_model:
        raise RuntimeError("AI model is not configured (set company AI settings or AI_DEFAULT_MODEL)")

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
