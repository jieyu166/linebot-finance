"""Decrypt (pikepdf) and extract layout text (pdfplumber) from PDF bytes, in memory."""
from __future__ import annotations

import io
import re

import pdfplumber
import pikepdf


class PdfPasswordError(Exception):
    """PDF is encrypted and the supplied password (if any) does not open it."""


def _open(pdf_bytes: bytes, password: str) -> pikepdf.Pdf:
    try:
        return pikepdf.open(io.BytesIO(pdf_bytes))
    except pikepdf.PasswordError:
        pass
    if not password:
        raise PdfPasswordError("encrypted PDF and no password configured")
    try:
        return pikepdf.open(io.BytesIO(pdf_bytes), password=password)
    except pikepdf.PasswordError:
        raise PdfPasswordError("wrong PDF password") from None


_WS_RUN = re.compile(r"[ \t\u3000]+")


def normalize_statement_text(text: str) -> str:
    """Collapse layout padding: single spaces, no blank lines, form feeds -> newlines."""
    lines = (_WS_RUN.sub(" ", ln).strip() for ln in text.replace("\f", "\n").split("\n"))
    return "\n".join(ln for ln in lines if ln)


def decrypt_and_extract(pdf_bytes: bytes, password: str, *, raw: bool = False) -> str:
    with _open(pdf_bytes, password) as pdf:
        plain = io.BytesIO()
        pdf.save(plain)  # saving without `encryption=` drops encryption
    plain.seek(0)
    with pdfplumber.open(plain) as doc:
        text = "\n".join((page.extract_text(layout=True) or "") for page in doc.pages)
    return text if raw else normalize_statement_text(text)
