"""Build tiny PDFs for tests (pikepdf only, no reportlab)."""
import io

import pikepdf


def make_pdf(text="HELLO MAILBOT", user_pw=None, owner_pw="owner"):
    pdf = pikepdf.new()
    font = pdf.make_indirect(pikepdf.Dictionary(
        Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica,
    ))
    content = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("latin-1")
    page = pikepdf.Dictionary(
        Type=pikepdf.Name.Page,
        MediaBox=[0, 0, 612, 792],
        Resources=pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font)),
        Contents=pdf.make_stream(content),
    )
    pdf.pages.append(pikepdf.Page(page))
    buf = io.BytesIO()
    if user_pw is None:
        pdf.save(buf)
    else:
        pdf.save(buf, encryption=pikepdf.Encryption(owner=owner_pw, user=user_pw, R=6))
    return buf.getvalue()
