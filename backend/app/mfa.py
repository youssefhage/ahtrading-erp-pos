import hashlib
import os
import time
import threading
from collections import OrderedDict
from fastapi import HTTPException

import pyotp
from cryptography.fernet import Fernet, InvalidToken

# TOTP replay prevention: track recently used codes per user secret hash.
# Keys are (secret_hash, code), values are expiry timestamps.
_used_totp_codes: OrderedDict = OrderedDict()
_used_totp_lock = threading.Lock()
_TOTP_REPLAY_WINDOW = 90  # seconds to remember a used code (> 2x the 30s step)


def _fernet() -> Fernet:
    """
    MFA secrets must be decryptable server-side to verify TOTP codes.

    We keep the encryption key out of the DB. Provide it via env:
      APP_MFA_FERNET_KEY = <base64 urlsafe 32-byte key>

    Generate one with:
      python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    """
    key = (os.environ.get("APP_MFA_FERNET_KEY") or "").strip()
    if not key:
        raise HTTPException(
            status_code=500,
            detail="MFA is not configured on the server (missing APP_MFA_FERNET_KEY).",
        )
    try:
        return Fernet(key.encode("utf-8"))
    except Exception:
        raise HTTPException(status_code=500, detail="invalid APP_MFA_FERNET_KEY") from None


def encrypt_secret(secret: str) -> str:
    f = _fernet()
    token = f.encrypt(secret.encode("utf-8"))
    return token.decode("utf-8")


def decrypt_secret(token: str) -> str:
    f = _fernet()
    try:
        raw = f.decrypt(token.encode("utf-8"))
    except InvalidToken:
        raise HTTPException(status_code=500, detail="MFA verification failed") from None
    return raw.decode("utf-8")


def new_totp_secret() -> str:
    # 32 chars base32 ~= 160-bit secret (standard).
    return pyotp.random_base32(length=32)


def provisioning_uri(secret: str, email: str, issuer: str = "AH Trading") -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)


def verify_totp_code(secret: str, code: str) -> bool:
    c = (code or "").strip().replace(" ", "")
    # Accept 6 or 8 digits; most apps default to 6.
    if not c.isdigit() or len(c) not in (6, 8):
        return False
    totp = pyotp.TOTP(secret)
    # Allow +/- 1 step drift.
    if not totp.verify(c, valid_window=1):
        return False

    # Replay prevention: reject codes that were already used within the window.
    now = time.time()
    replay_key = (hashlib.sha256(secret.encode()).hexdigest(), c)
    with _used_totp_lock:
        # Prune expired entries
        while _used_totp_codes:
            oldest_key, oldest_exp = next(iter(_used_totp_codes.items()))
            if oldest_exp < now:
                _used_totp_codes.pop(oldest_key, None)
            else:
                break
        if replay_key in _used_totp_codes:
            return False  # Code was already used
        _used_totp_codes[replay_key] = now + _TOTP_REPLAY_WINDOW
    return True

