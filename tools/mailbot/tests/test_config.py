import pytest

from mailbot.config import Settings, load_env, password_for
from mailbot.rules import Rule


def test_load_env(tmp_path):
    p = tmp_path / ".env"
    p.write_text("# c\n\nA=1\nB=\"two\"\nC='three'\nD = x y \n", encoding="utf-8")
    assert load_env(p) == {"A": "1", "B": "two", "C": "three", "D": "x y"}


def test_load_env_missing(tmp_path):
    assert load_env(tmp_path / "nope") == {}


def test_settings_defaults():
    s = Settings.from_env({})
    assert s.LOOKBACK_DAYS == 45
    assert s.LABEL_DONE == "已記帳"
    assert s.LABEL_FAIL == "記帳失敗"
    assert s.GAS_IMPORT_URL == ""


def test_settings_values():
    s = Settings.from_env({"LOOKBACK_DAYS": "7", "WEBAPP_TOKEN": "t"})
    assert s.LOOKBACK_DAYS == 7 and s.WEBAPP_TOKEN == "t"


def test_password_for():
    r = Rule("b", "k", "s", "PDF_PW_X")
    assert password_for(r, {"PDF_PW_X": "pw"}) == "pw"
    assert password_for(r, {}) == ""


@pytest.mark.parametrize("bad", ["abc", "4.5", "0", "-3"])
def test_lookback_days_invalid(bad):
    with pytest.raises(ValueError, match="LOOKBACK_DAYS"):
        Settings.from_env({"LOOKBACK_DAYS": bad})
