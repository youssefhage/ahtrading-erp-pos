import os
from typing import List

class Settings:
    def _split_csv(self, raw: str, *, default: List[str]) -> List[str]:
        parts = [p.strip() for p in (raw or "").split(",")]
        return [p for p in parts if p] or default

    def __init__(self) -> None:
        self.env = os.getenv('APP_ENV', 'local')
        self.db_url = os.getenv('DATABASE_URL', 'postgresql://localhost/ahtrading')
        # Comma-separated list of allowed CORS origins for browser/mobile clients.
        # Default keeps local dev working out of the box.
        self.cors_origins = self._split_csv(
            os.getenv("CORS_ORIGINS", "").strip(),
            default=["http://localhost:3000", "http://127.0.0.1:3000"],
        )
        self.download_hosts = self._split_csv(
            os.getenv("DOWNLOADS_HOSTS", "").strip(),
            default=["download.melqard.com"],
        )
        self.api_version = os.getenv("APP_VERSION", "0.1.0").strip() or "0.1.0"

settings = Settings()
