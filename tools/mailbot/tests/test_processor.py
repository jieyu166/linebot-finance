import datetime as dt

import pytest
from fakes import FakeClient, make_msg

from mailbot import importer, processor
from mailbot.config import Settings
from mailbot.rules import Rule
from pdf_factory import make_pdf

RULES = [Rule(bank="永豐", kind="銀行帳戶", subject_regex="永豐.*對帳單", pw_env="PDF_PW_SINOPAC",
              account_hint="永豐外幣")]
ENV = {"PDF_PW_SINOPAC": "pw123"}
SETTINGS = Settings(GAS_IMPORT_URL="https://gas/exec", WEBAPP_TOKEN="tok", LOOKBACK_DAYS=30)


class Calls(list):
    result: dict


@pytest.fixture
def posts(monkeypatch):
    calls = Calls()
    result = {"value": {"ok": True, "written": 2}}

    def fake_post(url, payload, timeout=120):
        calls.append((url, payload))
        return result["value"]

    monkeypatch.setattr(importer, "post_import", fake_post)
    calls.result = result
    return calls


def one_msg_client(subject="永豐銀行 綜合對帳單", pdf_count=1, pw="pw123", text="STATEMENT"):
    names = [f"s{i}.pdf" for i in range(pdf_count)]
    msg = make_msg("m1", subject, pdfs=names)
    atts = {f"m1-att{i}": make_pdf(f"{text} {i}", user_pw=pw) for i in range(pdf_count)}
    return FakeClient(messages={"m1": msg}, attachments=atts)


def run(client, tmp_path, dry_run=False, **kw):
    return processor.run_once(SETTINGS, RULES, ENV, client, dry_run, log_dir=str(tmp_path), **kw)


def test_skip_when_no_rule(posts, tmp_path):
    client = one_msg_client(subject="電子報")
    [out] = run(client, tmp_path)
    assert out.status == "skip"
    assert posts == []
    assert client.added == []


def test_done_posts_once_per_pdf_and_labels_done(posts, tmp_path):
    client = one_msg_client(pdf_count=2)
    [out] = run(client, tmp_path)
    assert out.status == "done" and out.posted == 2
    assert len(posts) == 2
    url, payload = posts[0]
    assert url == "https://gas/exec"
    assert payload["token"] == "tok" and payload["messageId"] == "m1"
    assert payload["text"].startswith("[mailbot] bank=永豐 kind=銀行帳戶 hint=永豐外幣\n")
    assert "STATEMENT 0" in payload["text"]
    assert client.added == [("m1", "ID-已記帳")]


def test_query_excludes_labels_and_uses_lookback(posts, tmp_path):
    client = one_msg_client()
    run(client, tmp_path)
    assert client.queries == ["newer_than:30d has:attachment filename:pdf -label:\"已記帳\" -label:\"記帳失敗\""]
    assert set(client.ensured) == {"已記帳", "記帳失敗"}


def test_fail_on_wrong_password_labels_fail(posts, tmp_path):
    client = one_msg_client(pw="other-pw")
    [out] = run(client, tmp_path)
    assert out.status == "fail" and "password" in out.reason
    assert posts == []
    assert client.added == [("m1", "ID-記帳失敗")]


def test_fail_when_post_returns_not_ok(posts, tmp_path):
    posts.result["value"] = {"ok": False, "error": "unauthorized"}
    client = one_msg_client()
    [out] = run(client, tmp_path)
    assert out.status == "fail" and "unauthorized" in out.reason
    assert out.posted == 0
    assert client.added == [("m1", "ID-記帳失敗")]


def test_dry_run_posts_nothing_labels_nothing(posts, tmp_path):
    client = one_msg_client(pdf_count=2)
    [out] = run(client, tmp_path, dry_run=True)
    assert out.status == "done"
    assert posts == []
    assert client.added == [] and client.ensured == []
    assert len(out.text_lengths) == 2 and all(n > 0 for n in out.text_lengths)


def test_only_message_id_skips_search(posts, tmp_path):
    client = one_msg_client()
    [out] = run(client, tmp_path, only_message_id="m1")
    assert client.queries == []
    assert out.message_id == "m1" and out.status == "done"


def test_rule_without_pdf_parts_is_skip(posts, tmp_path):
    msg = make_msg("m1", "永豐銀行 綜合對帳單", pdfs=())
    client = FakeClient(messages={"m1": msg})
    [out] = run(client, tmp_path)
    assert out.status == "skip"
    assert client.added == []


def test_exception_while_fetching_becomes_fail(posts, tmp_path):
    client = FakeClient(messages={}, search_ids=["ghost"])
    [out] = run(client, tmp_path)
    assert out.status == "fail"
    assert client.added == [("ghost", "ID-記帳失敗")]


def test_log_line_has_subject_status_but_no_text_or_password(posts, tmp_path):
    client = one_msg_client(text="SECRETTEXT")
    run(client, tmp_path)
    log = (tmp_path / f"{dt.date.today():%Y-%m-%d}.log").read_text(encoding="utf-8")
    assert "永豐銀行 綜合對帳單" in log and "done" in log
    assert "SECRETTEXT" not in log and "pw123" not in log and "tok" not in log.split("\t")


def test_build_query_quotes_label_names():
    class S:
        LOOKBACK_DAYS = 7
        LABEL_DONE = 'My "Done" label'
        LABEL_FAIL = "記帳 失敗"
    q = processor.build_query(S())
    assert '-label:"My Done label"' in q and '-label:"記帳 失敗"' in q
