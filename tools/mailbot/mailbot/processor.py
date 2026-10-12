"""Per-message processing and one full run (search -> decrypt -> POST -> label -> log)."""
from __future__ import annotations

import datetime as dt
import os
from dataclasses import dataclass, field

from mailbot import importer
from mailbot.config import password_for
from mailbot.gmail_client import get_header
from mailbot.pdf_text import PdfPasswordError, decrypt_and_extract
from mailbot.rules import match_rule, pick_pdf_parts


@dataclass
class Outcome:
    status: str  # done | fail | skip
    reason: str = ""
    posted: int = 0
    message_id: str = ""
    subject: str = ""
    bank: str = ""
    pdfs: int = 0
    text_lengths: list[int] = field(default_factory=list)


def _short(s, n=160) -> str:
    return " ".join(str(s).split())[:n]


def process_message(client, msg, rules, settings, env, dry_run) -> Outcome:
    subject = get_header(msg, "Subject")
    sender = get_header(msg, "From")
    out = Outcome(status="skip", message_id=msg.get("id", ""), subject=subject)
    rule = match_rule(subject, sender, rules)
    if rule is None:
        out.reason = "no rule"
        return out
    out.bank = rule.bank
    parts = pick_pdf_parts(msg.get("payload") or {})
    out.pdfs = len(parts)
    if not parts:
        out.reason = "no pdf attachment"
        return out

    password = password_for(rule, env)
    errors: list[str] = []
    for part in parts:
        name = part.get("filename") or "?"
        try:
            data = client.get_attachment(out.message_id, part["body"]["attachmentId"])
            text = decrypt_and_extract(data, password)
        except PdfPasswordError:
            errors.append(f"{name}: pdf password ({rule.pw_env})")
            continue
        except Exception as e:  # noqa: BLE001 - one bad PDF must not kill the run
            errors.append(f"{name}: {type(e).__name__}")
            continue
        out.text_lengths.append(len(text))
        if not text.strip():
            errors.append(f"{name}: empty text")
            continue
        if dry_run:
            continue
        payload = importer.build_payload(text, rule, settings.WEBAPP_TOKEN, out.message_id)
        result = importer.post_import(settings.GAS_IMPORT_URL, payload)
        if result.get("ok"):
            out.posted += 1
        else:
            errors.append(f"{name}: post {_short(result.get('error') or 'not ok', 80)}")

    if errors:
        out.status, out.reason = "fail", _short("; ".join(errors), 300)
    else:
        out.status, out.reason = "done", ("dry-run" if dry_run else "")
    return out


def _label_name(name) -> str:
    return str(name).replace('"', "").strip()


def _quote_label(name) -> str:
    return '"' + _label_name(name) + '"'


def build_query(settings) -> str:
    return (f"newer_than:{settings.LOOKBACK_DAYS}d has:attachment filename:pdf "
            f"-label:{_quote_label(settings.LABEL_DONE)} -label:{_quote_label(settings.LABEL_FAIL)}")


def _write_log(log_dir, outcome: Outcome, dry_run: bool) -> None:
    if not log_dir:
        return
    os.makedirs(log_dir, exist_ok=True)
    now = dt.datetime.now()
    line = "\t".join([
        now.strftime("%H:%M:%S"),
        "dry-run" if dry_run else "run",
        outcome.message_id,
        outcome.status,
        f"posted={outcome.posted}/{outcome.pdfs}",
        outcome.bank,
        _short(outcome.subject, 120),
        outcome.reason,
    ])
    with open(os.path.join(log_dir, f"{now:%Y-%m-%d}.log"), "a", encoding="utf-8") as f:
        f.write(line + "\n")


def run_once(settings, rules, env, client, dry_run, only_message_id=None, log_dir="log") -> list[Outcome]:
    ids = [only_message_id] if only_message_id else client.search(build_query(settings))
    label_ids = {}
    if not dry_run and ids:
        label_ids = {"done": client.ensure_label(_label_name(settings.LABEL_DONE)),
                     "fail": client.ensure_label(_label_name(settings.LABEL_FAIL))}

    outcomes: list[Outcome] = []
    for mid in ids:
        try:
            msg = client.get_message(mid)
            outcome = process_message(client, msg, rules, settings, env, dry_run)
        except Exception as e:  # noqa: BLE001
            outcome = Outcome(status="fail", reason=f"fetch: {type(e).__name__}", message_id=mid)
        outcome.message_id = outcome.message_id or mid
        if not dry_run and outcome.status in label_ids:
            try:
                client.add_label(mid, label_ids[outcome.status])
            except Exception as e:  # noqa: BLE001
                outcome.reason = _short(f"{outcome.reason}; label: {type(e).__name__}".strip("; "), 300)
        _write_log(log_dir, outcome, dry_run)
        outcomes.append(outcome)
    return outcomes
