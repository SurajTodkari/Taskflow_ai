from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql+psycopg2://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg2://" + url[len("postgresql://"):]
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite:///./taskflow.db"
    SECRET_KEY: str = "dev-secret-change-me-please-0123456789"
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"
    ACCESS_TOKEN_MINUTES: int = 30
    REFRESH_TOKEN_DAYS: int = 14
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_SUBJECT: str = "mailto:admin@example.com"
    ANTHROPIC_API_KEY: str = ""
    AI_MODEL: str = "claude-sonnet-5-5"
    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_MB: int = 10
    RATE_LIMIT_ENABLED: bool = True
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10

    @field_validator("DATABASE_URL")
    @classmethod
    def _norm(cls, v: str) -> str:
        return normalize_database_url(v)

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
