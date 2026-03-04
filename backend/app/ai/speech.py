"""
Speech-to-text transcription for voice notes.

Supports Whisper-compatible APIs (OpenAI, Azure, self-hosted).
Used by Telegram and WhatsApp handlers to convert voice messages to text.
"""
from __future__ import annotations

import io
import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any

from .providers import get_ai_provider_config
from ..db import get_conn, set_company_context

logger = logging.getLogger(__name__)

# Supported audio MIME types and their file extensions
_MIME_TO_EXT = {
    "audio/ogg": ".ogg",
    "audio/opus": ".ogg",
    "audio/ogg; codecs=opus": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/webm": ".webm",
    "audio/flac": ".flac",
}


def transcribe_audio(
    audio_bytes: bytes,
    mime_type: str,
    company_id: str,
) -> str | None:
    """
    Transcribe audio bytes to text using a Whisper-compatible API.

    Returns the transcribed text, or None on failure.
    """
    if not audio_bytes:
        return None

    # Determine file extension
    ext = _MIME_TO_EXT.get(mime_type.split(";")[0].strip(), ".ogg")
    filename = f"voice{ext}"

    # Get API config
    try:
        with get_conn() as conn:
            set_company_context(conn, company_id)
            with conn.cursor() as cur:
                ai_config = get_ai_provider_config(cur, company_id)
    except Exception as e:
        logger.warning("transcribe_audio: failed to get AI config: %s", e)
        return None

    api_key = ai_config.get("api_key", "")
    base_url = ai_config.get("base_url", "https://api.openai.com")

    # Allow override of STT endpoint and model
    stt_url = (os.environ.get("WHISPER_API_URL") or "").strip()
    stt_model = (os.environ.get("WHISPER_MODEL") or "whisper-1").strip()
    stt_api_key = (os.environ.get("WHISPER_API_KEY") or "").strip()

    if stt_api_key:
        api_key = stt_api_key
    if not stt_url:
        stt_url = f"{base_url.rstrip('/')}/v1/audio/transcriptions"

    if not api_key:
        logger.warning("transcribe_audio: no API key configured")
        return None

    try:
        return _call_whisper_api(stt_url, api_key, stt_model, audio_bytes, filename)
    except Exception as e:
        logger.warning("transcribe_audio failed: %s", e)
        return None


def _call_whisper_api(
    url: str,
    api_key: str,
    model: str,
    audio_bytes: bytes,
    filename: str,
) -> str | None:
    """Send audio to a Whisper-compatible transcription API."""
    # Build multipart/form-data request
    boundary = "----KaiVoiceBoundary"
    body = io.BytesIO()

    # Model field
    body.write(f"--{boundary}\r\n".encode())
    body.write(b'Content-Disposition: form-data; name="model"\r\n\r\n')
    body.write(f"{model}\r\n".encode())

    # Language hint (optional, helps accuracy)
    body.write(f"--{boundary}\r\n".encode())
    body.write(b'Content-Disposition: form-data; name="language"\r\n\r\n')
    body.write(b"en\r\n")  # Default to English; the API auto-detects anyway

    # Audio file
    body.write(f"--{boundary}\r\n".encode())
    body.write(f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode())
    body.write(b"Content-Type: application/octet-stream\r\n\r\n")
    body.write(audio_bytes)
    body.write(b"\r\n")

    # End boundary
    body.write(f"--{boundary}--\r\n".encode())

    data = body.getvalue()

    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            text = (result.get("text") or "").strip()
            return text if text else None
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else str(e)
        logger.warning("Whisper API HTTP %s: %s", getattr(e, "code", "?"), err_body[:300])
        return None
