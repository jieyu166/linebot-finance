"""mailbot entry point (stub; real work comes in Task 4)."""
import argparse
from pathlib import Path

from mailbot.config import Settings, load_env
from mailbot.rules import load_rules

HERE = Path(__file__).parent


def main(argv=None):
    p = argparse.ArgumentParser(description="Gmail statement bot")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--message-id")
    p.add_argument("--rules", default=str(HERE / "rules.yaml"))
    p.add_argument("--env", default=str(HERE / ".env"))
    a = p.parse_args(argv)
    env = load_env(a.env)
    s = Settings.from_env(env)
    rules = load_rules(a.rules)
    print(f"rules={len(rules)} env_keys={len(env)} lookback_days={s.LOOKBACK_DAYS} dry_run={a.dry_run}")


if __name__ == "__main__":
    main()
