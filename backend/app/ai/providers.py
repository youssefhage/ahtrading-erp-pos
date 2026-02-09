from __future__ import annotations

import os


def get_ai_provider_config(cur, company_id: str) -> dict:
    """
    Resolve AI provider config for a company, with env fallbacks.

    Config location:
      company_settings.key = 'ai'
      value_json can include:
        provider: 'openai' | 'openai_compatible'
        base_url: string (OpenAI-compatible endpoint root)
        api_key: string
        item_naming_model: string
        invoice_vision_model: string
        invoice_text_model: string
    """
    provider = (os.environ.get("AI_PROVIDER") or "openai").strip().lower()
    base_url = (os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com").strip().rstrip("/")
    api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()

    # Prefer explicit feature models, otherwise fall back to a single default configured via env.
    # (We avoid hardcoding a model name in code so it can be changed from Settings/.env.)
    default_model = (os.environ.get("AI_DEFAULT_MODEL") or "").strip()
    item_model = (
        os.environ.get("AI_ITEM_NAMING_MODEL")
        or os.environ.get("OPENAI_ITEM_NAMING_MODEL")
        or default_model
    )
    vision_model = (
        os.environ.get("AI_INVOICE_VISION_MODEL")
        or os.environ.get("OPENAI_INVOICE_VISION_MODEL")
        or default_model
    )
    text_model = (
        os.environ.get("AI_INVOICE_TEXT_MODEL")
        or os.environ.get("OPENAI_INVOICE_TEXT_MODEL")
        or default_model
    )
    item_model = (item_model or "").strip()
    vision_model = (vision_model or "").strip()
    text_model = (text_model or "").strip()

    try:
        cur.execute(
            """
            SELECT value_json
            FROM company_settings
            WHERE company_id = %s AND key = 'ai'
            LIMIT 1
            """,
            (company_id,),
        )
        row = cur.fetchone()
        if row:
            v = row.get("value_json") or {}
            provider = (v.get("provider") or provider).strip().lower()
            base_url = (v.get("base_url") or base_url).strip().rstrip("/")
            api_key = (v.get("api_key") or api_key).strip()
            item_model = (v.get("item_naming_model") or item_model).strip()
            vision_model = (v.get("invoice_vision_model") or vision_model).strip()
            text_model = (v.get("invoice_text_model") or text_model).strip()
    except Exception:
        # Never break runtime if settings are malformed or DB read fails.
        pass

    if provider not in {"openai", "openai_compatible"}:
        provider = "openai"

    return {
        "provider": provider,
        "base_url": base_url,
        "api_key": api_key,
        "item_naming_model": item_model,
        "invoice_vision_model": vision_model,
        "invoice_text_model": text_model,
    }
