import io

import pikepdf
import pytest

from mailbot.pdf_text import PdfPasswordError, decrypt_and_extract
from pdf_factory import make_pdf


def test_unencrypted_pdf_extracts_text_without_password():
    assert "HELLO MAILBOT" in decrypt_and_extract(make_pdf(), "")


def test_unencrypted_pdf_ignores_supplied_password():
    assert "HELLO MAILBOT" in decrypt_and_extract(make_pdf(), "whatever")


def test_encrypted_pdf_with_correct_password():
    data = make_pdf("SECRET STATEMENT", user_pw="A123456789")
    assert "SECRET STATEMENT" in decrypt_and_extract(data, "A123456789")


def test_encrypted_pdf_wrong_password_raises():
    data = make_pdf(user_pw="right")
    with pytest.raises(PdfPasswordError):
        decrypt_and_extract(data, "wrong")


def test_encrypted_pdf_missing_password_raises():
    data = make_pdf(user_pw="right")
    with pytest.raises(PdfPasswordError):
        decrypt_and_extract(data, "")


def test_password_error_message_does_not_leak_password():
    data = make_pdf(user_pw="right")
    with pytest.raises(PdfPasswordError) as ei:
        decrypt_and_extract(data, "s3cr3t-guess")
    assert "s3cr3t-guess" not in str(ei.value)


def test_multiple_pages_joined_by_newline():
    a = pikepdf.open(io.BytesIO(make_pdf("PAGE ONE")))
    b = pikepdf.open(io.BytesIO(make_pdf("PAGE TWO")))
    a.pages.extend(b.pages)
    buf = io.BytesIO()
    a.save(buf)
    text = decrypt_and_extract(buf.getvalue(), "")
    assert text.index("PAGE ONE") < text.index("PAGE TWO")


def test_normalize_collapses_padding_and_fullwidth_space():
    from mailbot.pdf_text import normalize_statement_text

    line = "A" + " " * 30 + "B\u3000\u3000C\t\tD  "
    assert normalize_statement_text("  " + line) == "A B C D"


def test_normalize_drops_blank_lines_and_keeps_order():
    from mailbot.pdf_text import normalize_statement_text

    assert normalize_statement_text("a\n   \n\n\u3000\nb") == "a\nb"


def test_normalize_form_feed_splits_pages():
    from mailbot.pdf_text import normalize_statement_text

    assert normalize_statement_text("p1 x\fp2   y") == "p1 x\np2 y"


def test_decrypt_and_extract_normalizes_by_default_and_raw_skips():
    data = make_pdf("HELLO   MAILBOT")
    assert "\n\n" not in decrypt_and_extract(data, "")
    raw = decrypt_and_extract(data, "", raw=True)
    norm = decrypt_and_extract(data, "")
    assert len(raw) > len(norm)
    assert norm == "HELLO MAILBOT"
