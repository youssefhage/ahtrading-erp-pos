import os

class Settings:
    def __init__(self) -> None:
        self.env = os.getenv('APP_ENV', 'local')
        self.db_url = os.getenv('DATABASE_URL', 'postgresql://localhost/ahtrading')
        # Comma-separated list of allowed CORS origins for browser/mobile clients.
        # Default keeps local dev working out of the box.
        raw = os.getenv("CORS_ORIGINS", "").strip()
        if raw:
            self.cors_origins = [x.strip() for x in raw.split(",") if x.strip()]
        else:
            self.cors_origins = [
                "http://localhost:3000",
                "http://127.0.0.1:3000",
            ]

settings = Settings()
