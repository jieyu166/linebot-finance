"""Environment/settings loading (no python-dotenv dependency)."""
from __future__ import annotations

import os
from dataclasses import dataclass


def load_env(path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path or not os.path.exists(path):
        return env
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            val = val.strip()
            if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
                val = val[1:-1]
            env[key.strip()] = val
    return env


@dataclass
class Settings:
    GAS_IMPORT_URL: str = ""
    WEBAPP_TOKEN: str = ""
    LOOKBACK_DAYS: int = 45
    LABEL_DONE: str = "已記帳"
    LABEL_FAIL: str = "記帳失敗"

    @classmethod
    def from_env(cls, env: dict[str, str]) -> "Settings":
        return cls(
            GAS_IMPORT_URL=env.get("GAS_IMPORT_URL", ""),
            WEBAPP_TOKEN=env.get("WEBAPP_TOKEN", ""),
            LOOKBACK_DAYS=int(env.get("LOOKBACK_DAYS") or 45),
            LABEL_DONE=env.get("LABEL_DONE") or "已記帳",
            LABEL_FAIL=env.get("LABEL_FAIL") or "記帳失敗",
        )


def password_for(rule, env: dict[str, str]) -> str:
    return env.get(rule.pw_env, "") or ""
