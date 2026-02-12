import hashlib
import hmac
from typing import Optional
from passlib.context import CryptContext

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


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
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_device_token(token: str, token_hash: Optional[str]) -> bool:
    if not token_hash:
        return False
    return hmac.compare_digest(hash_device_token(token), token_hash)


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
