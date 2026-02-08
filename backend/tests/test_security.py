from backend.app.security import hash_session_token, hash_device_token, verify_device_token


def test_session_token_is_hashed_with_prefix():
    h = hash_session_token("abc")
    assert h.startswith("sha256:")
    assert len(h) > 10


def test_device_token_hash_roundtrip():
    tok = "secret"
    h = hash_device_token(tok)
    assert verify_device_token(tok, h) is True
    assert verify_device_token("wrong", h) is False
