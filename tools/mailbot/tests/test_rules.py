from pathlib import Path

import pytest

from mailbot.rules import Rule, load_rules, match_rule, pick_pdf_parts

EX = Path(__file__).resolve().parents[1] / "rules.example.yaml"

CASES = [
    ("中國信託信用卡電子帳單 11510", "", "中信信用卡", "中信", "信用卡"),
    ("中國信託銀行電子對帳單 11509", "", "中信", "中信", "銀行帳戶"),
    ("台新證券電子月對帳單-2026年09月", "", "台新", "台新", "證券"),
    ("台新信用卡電子帳單 2026年9月", "", "台新信用卡", "台新", "信用卡"),
    ("第一銀行信用卡電子對帳單2026年10月05日", "", "一銀信用卡", "第一銀行", "信用卡"),
    ("O-Bank通知-2026年9月綜合對帳單", "", "王道", "王道", "銀行帳戶"),
    ("台北富邦銀行2026年9月 銀行對帳單", "", "富邦", "富邦", "銀行帳戶"),
    ("國泰世華銀行信用卡2026年9月電子帳單", "", "國泰信用卡", "國泰", "信用卡"),
    ("玉山銀行2026年08月信用卡電子帳單", "", "玉山信用卡", "玉山", "信用卡"),
    ("玉山銀行2026年09月綜合對帳單", "", "玉山", "玉山", "銀行帳戶"),
    ("【玉山證券】綜合月對帳單 2026年9月", "", "玉山", "玉山", "證券"),
    ("永豐銀行信用卡2026年09月份電子帳單通知", "", "永豐信用卡", "永豐", "信用卡"),
    ("證券月對帳單", "noreply@sinopac.com", "永豐證券", "永豐", "證券"),
    ("複委託月對帳單", "", "永豐外幣", "永豐", "證券"),
    ("王O明君 永豐銀行2026年9月份電子綜合對帳單", "", "永豐大戶", "永豐", "銀行帳戶"),
    ("第一銀行 115 年 09 月綜合業務對帳單 [郵件編號:x]", "", "一銀", "一銀", "銀行帳戶"),
    ("台新銀行綜合對帳單 2026年8月份", "", "台新", "台新", "銀行帳戶"),
    ("「樂天國際銀行2026年9月份電子綜合對帳單」暨「個人資訊更新提醒」", "", "樂天", "樂天", "銀行帳戶"),
]


@pytest.fixture(scope="module")
def rules():
    return load_rules(EX)


def test_eighteen_rules(rules):
    assert len(rules) == 18


@pytest.mark.parametrize("subject,sender,hint,bank,kind", CASES)
def test_match(rules, subject, sender, hint, bank, kind):
    r = match_rule(subject, sender, rules)
    assert r is not None, subject
    assert r.account_hint == hint
    assert r.bank == bank
    assert r.kind == kind


def test_securities_requires_sender(rules):
    assert match_rule("證券月對帳單", "someone@other.com", rules) is None


def test_no_match(rules):
    assert match_rule("週末聚餐", "a@b.com", rules) is None


def test_case_insensitive():
    rs = [Rule("x", "k", "o-bank", "P")]
    assert match_rule("O-BANK hi", "", rs) is rs[0]


def test_pick_pdf_parts_nested():
    pdf = {"filename": "A.PDF", "body": {"attachmentId": "a1"}}
    payload = {
        "parts": [
            {"filename": "", "body": {}, "parts": [pdf, {"filename": "x.png", "body": {"attachmentId": "z"}}]},
            {"filename": "b.pdf", "body": {"size": 3}},
            {"filename": "c.pdf", "body": {"attachmentId": "c1"}},
        ]
    }
    got = pick_pdf_parts(payload)
    assert [p["body"]["attachmentId"] for p in got] == ["a1", "c1"]


def test_first_bank_statement_rule():
    rules = load_rules(EX)
    assert rules is not None
    r = match_rule('第一銀行 115 年 08 月綜合對帳單 [郵件編號:20260904Jvl]', 'ebill@firstbank.com.tw', rules)
    assert r is not None and r.bank == '一銀' and r.kind == '銀行帳戶' and r.account_hint == '一銀'


def test_pick_pdf_parts_ignores_payment_slips():
    payload = {"parts": [
        {"filename": "對帳單.pdf", "body": {"attachmentId": "a"}},
        {"filename": "信用卡繳款聯.PDF", "body": {"attachmentId": "b"}},
        {"filename": "PaymentSlip_2026.pdf", "body": {"attachmentId": "c"}},
        {"filename": "my_payment_slip.pdf", "body": {"attachmentId": "d"}},
    ]}
    assert [p["body"]["attachmentId"] for p in pick_pdf_parts(payload)] == ["a"]
    assert len(pick_pdf_parts(payload, ignore_regex=None)) == 4
    assert len(pick_pdf_parts(payload, ignore_regex="對帳")) == 3
