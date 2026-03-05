"""Shared search utilities for typeahead / filtering endpoints."""

import re
import unicodedata

# Arabic tashkeel / diacritics: fathah, dammah, kasrah, sukun, shadda, tanwin, etc.
_ARABIC_DIACRITICS = re.compile("[\u0610-\u061A\u064B-\u065F\u0670]")


def normalize_search_query(q: str) -> str:
    """
    Normalize a search query for ILIKE matching:
    - Strip Latin combining diacritics (NFKD decomposition)
    - Strip Arabic tashkeel / diacritics
    - Collapse whitespace, trim
    """
    if not q:
        return ""
    # Decompose, strip Latin combining marks (U+0300..U+036F)
    s = unicodedata.normalize("NFKD", q)
    s = re.sub("[\u0300-\u036f]", "", s)
    # Strip Arabic diacritics
    s = _ARABIC_DIACRITICS.sub("", s)
    return " ".join(s.split()).strip()
