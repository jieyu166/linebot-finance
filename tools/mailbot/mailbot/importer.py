"""Build and POST the import payload to the Apps Script web app."""
from __future__ import annotations

import requests

SOURCE = "Gmail匯入"


def build_payload(text: str, rule, token: str, message_id: str) -> dict:
    prefix = f"[mailbot] bank={rule.bank} kind={rule.kind} hint={rule.account_hint}\n"
    return {
        "token": token,
        "text": prefix + text,
        "source": SOURCE,
        "bank": rule.bank,
        "kind": rule.kind,
        "hint": rule.account_hint,
        "messageId": message_id,
    }


def post_import(url: str, payload: dict, timeout: int = 330) -> dict:
    full = url + ("&" if "?" in url else "?") + "import=1"
    try:
        resp = requests.post(full, json=payload, timeout=timeout)
        resp.raise_for_status()
    except requests.RequestException as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        detail = f" {status}" if status else ""
        return {"ok": False, "error": f"http: {type(e).__name__}{detail}".strip()}
    try:
        body = resp.json()
    except ValueError:
        return {"ok": False, "error": "non-json response"}
    if not isinstance(body, dict):
        return {"ok": False, "error": "unexpected json response"}
    return body
