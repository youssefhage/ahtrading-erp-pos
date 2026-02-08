from __future__ import annotations


def is_external_ai_allowed(cur, company_id: str) -> bool:
    """
    Company-level policy gate for sending data to external AI providers.

    Convention:
      company_settings.key = 'ai'
      value_json.allow_external_processing = true|false

    Backwards compatible default:
      - If unset, we allow (existing behavior when OPENAI_API_KEY is configured).
      - If explicitly false, we deny.
    """
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
        if not row:
            return True
        v = row.get("value_json") or {}
        flag = (v or {}).get("allow_external_processing")
        if flag is None:
            return True
        return bool(flag)
    except Exception:
        # Never block core flows due to settings read failures.
        return True

