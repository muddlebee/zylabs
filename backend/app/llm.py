from functools import lru_cache
from langchain_openai import ChatOpenAI
from app.config import settings


@lru_cache(maxsize=1)
def get_llm() -> ChatOpenAI:
    if settings.model_provider == "deepseek":
        return ChatOpenAI(
            model=settings.model_name,
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            temperature=0,
        )
    return ChatOpenAI(
        model=settings.model_name,
        api_key=settings.openai_api_key,
        temperature=0,
    )
