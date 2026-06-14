import os
import time

import app.config as config


def test_reload_env_if_changed_refreshes_firecrawl_key(tmp_path, monkeypatch):
    env_path = tmp_path / ".env"
    env_path.write_text("FIRECRAWL_API_KEY=alpha\n")
    monkeypatch.setattr(config, "_ENV_PATH", env_path)
    monkeypatch.setattr(config, "_env_mtime", -1.0)

    config.reload_env_if_changed()
    assert config.settings.firecrawl_api_key == "alpha"

    env_path.write_text("FIRECRAWL_API_KEY=beta\n")
    os.utime(env_path, (time.time() + 1, time.time() + 1))

    config.reload_env_if_changed()
    assert config.settings.firecrawl_api_key == "beta"


def test_reload_env_if_changed_is_noop_when_mtime_unchanged(tmp_path, monkeypatch):
    env_path = tmp_path / ".env"
    env_path.write_text("FIRECRAWL_API_KEY=stable\n")
    monkeypatch.setattr(config, "_ENV_PATH", env_path)
    monkeypatch.setattr(config, "_env_mtime", -1.0)

    assert config.reload_env_if_changed() is True
    assert config.reload_env_if_changed() is False
    assert config.settings.firecrawl_api_key == "stable"
