"""Decrypt (pikepdf) and extract layout text (pdfplumber) from PDF bytes, in memory."""
from __future__ import annotations

import io

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


def decrypt_and_extract(pdf_bytes: bytes, password: str) -> str:
    with _open(pdf_bytes, password) as pdf:
        plain = io.BytesIO()
        pdf.save(plain)  # saving without `encryption=` drops encryption
    plain.seek(0)
    with pdfplumber.open(plain) as doc:
        return "\n".join((page.extract_text(layout=True) or "") for page in doc.pages)
