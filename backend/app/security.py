import hashlib
import hmac
import logging
import os
from typing import Optional
from passlib.context import CryptContext

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
_logger = logging.getLogger(__name__)

# Server-side secret for HMAC-based device token hashing.
# Falls back to a static key if not configured (backward compatibility).
DEVICE_TOKEN_HMAC_SECRET = os.getenv("DEVICE_TOKEN_HMAC_SECRET", "")
if not DEVICE_TOKEN_HMAC_SECRET:
    import logging as _sec_logging
    _sec_logging.getLogger(__name__).warning(
        "DEVICE_TOKEN_HMAC_SECRET not set — using insecure default. "
        "Set this in production!"
    )
    DEVICE_TOKEN_HMAC_SECRET = "codex-pos-device-token-default-key"
_DEVICE_TOKEN_SECRET = DEVICE_TOKEN_HMAC_SECRET.encode("utf-8")


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def is_legacy_hash(hashed: Optional[str]) -> bool:
    if not hashed:
        return False
    return not hashed.startswith("$2")


def verify_password(password: str, hashed: Optional[str]) -> bool:
    if not hashed:
        return False
    if is_legacy_hash(hashed):
        _logger.warning("Legacy unsalted SHA-256 password hash used; will be rehashed on next login")
        legacy = hashlib.sha256(password.encode("utf-8")).hexdigest()
        return hmac.compare_digest(legacy, hashed)
    return _pwd_context.verify(password, hashed)


def needs_rehash(hashed: Optional[str]) -> bool:
    if not hashed:
        return False
    if is_legacy_hash(hashed):
        return True
    return _pwd_context.needs_update(hashed)


def hash_device_token(token: str) -> str:
    return hmac.new(_DEVICE_TOKEN_SECRET, token.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_device_token(token: str, token_hash: Optional[str]) -> bool:
    if not token_hash:
        return False
    # Support legacy unsalted SHA-256 hashes for backward compatibility
    computed = hash_device_token(token)
    if hmac.compare_digest(computed, token_hash):
        return True
    # Fallback: check against legacy unsalted SHA-256 hash
    legacy = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return hmac.compare_digest(legacy, token_hash)


def hash_session_token(token: str) -> str:
    # Store sessions as a one-way hash so a DB leak doesn't immediately grant access.
    # Prefix prevents "hash-as-token" replay when supporting legacy plaintext sessions.
    return "sha256:" + hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_pin(pin: str) -> str:
    # Use bcrypt (same as user passwords). Safe to sync to POS devices for offline verification.
    return _pwd_context.hash(pin)


def verify_pin(pin: str, hashed: Optional[str]) -> bool:
    if not hashed:
        return False
    return _pwd_context.verify(pin, hashed)
