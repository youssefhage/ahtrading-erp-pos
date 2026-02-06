import os

class Settings:
    def __init__(self) -> None:
        self.env = os.getenv('APP_ENV', 'local')
        self.db_url = os.getenv('DATABASE_URL', 'postgresql://localhost/ahtrading')

settings = Settings()
