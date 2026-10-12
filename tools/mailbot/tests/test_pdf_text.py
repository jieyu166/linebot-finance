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
