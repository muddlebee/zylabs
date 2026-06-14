from pydantic_settings import BaseSettings, SettingsConfigDict


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
