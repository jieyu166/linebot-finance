import importlib.util
from pathlib import Path

from fakes import FakeClient, make_msg

from mailbot import importer
from pdf_factory import make_pdf

RUN_PY = Path(__file__).resolve().parents[1] / "run.py"


def load_run():
    spec = importlib.util.spec_from_file_location("mailbot_run", RUN_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def write_workdir(tmp_path, url="https://gas/exec"):
    (tmp_path / ".env").write_text(
        f"GAS_IMPORT_URL={url}\nWEBAPP_TOKEN=tok\nPDF_PW_SINOPAC=pw\n", encoding="utf-8")
    (tmp_path / "rules.yaml").write_text(
        "rules:\n  - bank: 永豐\n    kind: 銀行帳戶\n    subject_regex: 永豐\n    pw_env: PDF_PW_SINOPAC\n",
        encoding="utf-8")


def client_with(pw="pw"):
    return FakeClient(messages={
        "m1": make_msg("m1", "永豐 對帳單", pdfs=["a.pdf"]),
        "m2": make_msg("m2", "電子報", pdfs=["b.pdf"]),
    }, attachments={"m1-att0": make_pdf("X", user_pw=pw), "m2-att0": make_pdf("Y")})


def test_main_dry_run_prints_table_and_returns_zero(tmp_path, monkeypatch, capsys):
    write_workdir(tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(importer, "post_import", lambda *a, **k: (_ for _ in ()).throw(AssertionError))
    client = client_with()
    rc = load_run().main(["--dry-run"], client=client)
    out = capsys.readouterr().out
    assert rc == 0
    assert "total=2 done=1 fail=0 skip=1" in out
    assert client.added == []
    assert any((tmp_path / "log").iterdir())


def test_main_returns_one_when_any_fail(tmp_path, monkeypatch, capsys):
    write_workdir(tmp_path)
    monkeypatch.chdir(tmp_path)
    rc = load_run().main([], client=client_with(pw="other"))
    assert rc == 1
    assert "fail=1" in capsys.readouterr().out


def test_main_requires_url_and_token_for_real_run(tmp_path, monkeypatch):
    write_workdir(tmp_path, url="")
    monkeypatch.chdir(tmp_path)
    client = client_with()
    assert load_run().main([], client=client) == 2
    assert client.queries == []


def test_main_message_id(tmp_path, monkeypatch, capsys):
    write_workdir(tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(importer, "post_import", lambda *a, **k: {"ok": True})
    client = client_with()
    rc = load_run().main(["--message-id", "m1"], client=client)
    assert rc == 0 and client.queries == []
    assert client.added == [("m1", "ID-已記帳")]
