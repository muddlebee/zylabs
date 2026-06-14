from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
_env_mtime: float = -1.0


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    tavily_api_key: str = ""
    firecrawl_api_key: str = ""
    openai_api_key: str = ""
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com/v1"

    # Model — "openai" or "deepseek"
    model_name: str = "deepseek-chat"
    model_provider: str = "deepseek"

    quality_threshold: float = 0.7
    max_revisions: int = 2

    database_url: str = "sqlite:///./research.db"
    checkpoint_db_path: str = "./checkpoints.db"

    log_level: str = "INFO"


settings = Settings()


def reload_env_if_changed() -> bool:
    """Reload backend/.env and refresh settings when the file changes."""
    global settings, _env_mtime

    if not _ENV_PATH.exists():
        return False

    mtime = _ENV_PATH.stat().st_mtime
    if mtime == _env_mtime:
        return False

    load_dotenv(_ENV_PATH, override=True)
    settings = Settings()
    _env_mtime = mtime
    return True


def get_firecrawl_api_key() -> str:
    reload_env_if_changed()
    return settings.firecrawl_api_key
