"""mailbot entry point.

Run from the private working dir (e.g. ``local/mailbot/``) which holds
``.env``, ``rules.yaml``, ``credentials.json``, ``token.json`` and ``log/``::

    python <repo>/tools/mailbot/run.py --dry-run
"""
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from mailbot.config import Settings, load_env  # noqa: E402
from mailbot.gmail_client import GmailClient  # noqa: E402
from mailbot.processor import format_diag, run_once  # noqa: E402
from mailbot.rules import load_rules  # noqa: E402


def format_table(outcomes) -> str:
    rows = [("status", "posted", "bank", "message", "subject", "reason")]
    for o in outcomes:
        posted = f"{o.posted}/{o.pdfs}"
        if o.text_lengths and not o.posted:
            posted += " len=" + ",".join(str(n) for n in o.text_lengths)
        reason = " ".join(x for x in (o.reason, format_diag(o.diags)) if x)
        rows.append((o.status, posted, o.bank, o.message_id, o.subject[:40], reason))
    widths = [max(len(str(r[i])) for r in rows) for i in range(len(rows[0]) - 1)]
    lines = ["  ".join(str(c).ljust(w) for c, w in zip(r, widths)) + "  " + str(r[-1]) for r in rows]
    counts = {s: sum(1 for o in outcomes if o.status == s) for s in ("done", "fail", "skip")}
    lines.append(f"total={len(outcomes)} done={counts['done']} fail={counts['fail']} skip={counts['skip']}")
    return "\n".join(lines)


def main(argv=None, client=None) -> int:
    p = argparse.ArgumentParser(description="Gmail statement bot")
    p.add_argument("--dry-run", action="store_true", help="list + extract only; no POST, no labels")
    p.add_argument("--message-id", help="process only this Gmail message id")
    p.add_argument("--rules", default="rules.yaml")
    p.add_argument("--env", default=".env")
    p.add_argument("--log-dir", default="log")
    a = p.parse_args(argv)

    env = load_env(a.env)
    settings = Settings.from_env(env)
    rules = load_rules(a.rules)
    if not a.dry_run and not (settings.GAS_IMPORT_URL and settings.WEBAPP_TOKEN):
        print("GAS_IMPORT_URL / WEBAPP_TOKEN missing in env file", file=sys.stderr)
        return 2
    if client is None:
        client = GmailClient("credentials.json", "token.json")
    outcomes = run_once(settings, rules, env, client, a.dry_run,
                        only_message_id=a.message_id, log_dir=a.log_dir)
    print(format_table(outcomes))
    return 1 if any(o.status == "fail" for o in outcomes) else 0


if __name__ == "__main__":
    sys.exit(main())
