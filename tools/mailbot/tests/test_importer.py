import requests

from mailbot import importer
from mailbot.rules import Rule

RULE = Rule(bank="永豐", kind="銀行帳戶", subject_regex="x", pw_env="PDF_PW_SINOPAC", account_hint="永豐外幣")


def test_build_payload_shape_and_prefix():
    p = importer.build_payload("line1\nline2", RULE, "tok", "msg-1")
    assert p == {
        "token": "tok",
        "text": "[mailbot] bank=永豐 kind=銀行帳戶 hint=永豐外幣\nline1\nline2",
        "source": "Gmail匯入",
        "bank": "永豐",
        "kind": "銀行帳戶",
        "hint": "永豐外幣",
        "messageId": "msg-1",
    }


class Resp:
    def __init__(self, status=200, body=None, text=""):
        self.status_code = status
        self._body = body
        self.text = text

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError("Server Error", response=self)

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body


def test_post_import_appends_query_and_parses_json(monkeypatch):
    seen = {}

    def fake_post(url, json=None, timeout=None):
        seen.update(url=url, json=json, timeout=timeout)
        return Resp(body={"ok": True, "written": 3})

    monkeypatch.setattr(importer.requests, "post", fake_post)
    out = importer.post_import("https://x/exec", {"a": 1})
    assert out == {"ok": True, "written": 3}
    assert seen == {"url": "https://x/exec?import=1", "json": {"a": 1}, "timeout": 330}


def test_post_import_uses_ampersand_when_query_present(monkeypatch):
    seen = {}

    def fake_post(url, json=None, timeout=None):
        seen.update(url=url, timeout=timeout)
        return Resp(body={"ok": True})

    monkeypatch.setattr(importer.requests, "post", fake_post)
    importer.post_import("https://x/exec?v=1", {}, timeout=5)
    assert seen == {"url": "https://x/exec?v=1&import=1", "timeout": 5}


def test_post_import_non_json(monkeypatch):
    monkeypatch.setattr(importer.requests, "post", lambda *a, **k: Resp(text="<html>"))
    out = importer.post_import("https://x/exec", {})
    assert out["ok"] is False and "json" in out["error"]


def test_post_import_http_error(monkeypatch):
    monkeypatch.setattr(importer.requests, "post", lambda *a, **k: Resp(status=500, body={"ok": True}))
    out = importer.post_import("https://x/exec", {})
    assert out["ok"] is False and "500" in out["error"]


def test_post_import_network_error(monkeypatch):
    def boom(*a, **k):
        raise requests.ConnectionError("down")

    monkeypatch.setattr(importer.requests, "post", boom)
    out = importer.post_import("https://x/exec", {})
    assert out["ok"] is False and "ConnectionError" in out["error"]


def test_post_import_json_not_object(monkeypatch):
    monkeypatch.setattr(importer.requests, "post", lambda *a, **k: Resp(body=[1, 2]))
    assert importer.post_import("https://x/exec", {})["ok"] is False
