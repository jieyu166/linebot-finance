"""Rule loading and matching for statement emails."""
from __future__ import annotations

import re
from dataclasses import dataclass

import yaml


@dataclass
class Rule:
    bank: str
    kind: str
    subject_regex: str
    pw_env: str
    account_hint: str = ""
    from_regex: str = ""


def load_rules(path) -> list[Rule]:
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return [Rule(**item) for item in data.get("rules", [])]


def match_rule(subject: str, sender: str, rules: list[Rule]) -> Rule | None:
    for rule in rules:
        if not re.search(rule.subject_regex, subject or "", re.IGNORECASE):
            continue
        if rule.from_regex and not re.search(rule.from_regex, sender or "", re.IGNORECASE):
            continue
        return rule
    return None


def pick_pdf_parts(payload: dict) -> list[dict]:
    """Walk a Gmail message payload tree; return PDF parts with an attachmentId."""
    found: list[dict] = []

    def walk(part: dict) -> None:
        name = part.get("filename") or ""
        att = (part.get("body") or {}).get("attachmentId")
        if name.lower().endswith(".pdf") and att:
            found.append(part)
        for child in part.get("parts") or []:
            walk(child)

    walk(payload or {})
    return found
