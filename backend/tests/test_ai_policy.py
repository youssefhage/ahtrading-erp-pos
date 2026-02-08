from backend.app.ai.policy import is_external_ai_allowed


class FakeCursor:
    def __init__(self, row):
        self._row = row
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchone(self):
        return self._row


def test_external_ai_allowed_default_when_setting_missing():
    cur = FakeCursor(None)
    assert is_external_ai_allowed(cur, "c1") is True


def test_external_ai_allowed_default_when_flag_missing():
    cur = FakeCursor({"value_json": {"some_other_key": True}})
    assert is_external_ai_allowed(cur, "c1") is True


def test_external_ai_denied_when_flag_false():
    cur = FakeCursor({"value_json": {"allow_external_processing": False}})
    assert is_external_ai_allowed(cur, "c1") is False


def test_external_ai_allowed_when_flag_true():
    cur = FakeCursor({"value_json": {"allow_external_processing": True}})
    assert is_external_ai_allowed(cur, "c1") is True

