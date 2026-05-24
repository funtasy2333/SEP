# -*- coding: utf-8 -*-
import sys
import io
import os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from docx2pdf import convert
import pypdfium2 as pdfium

out_dir = r"C:\Users\92569\Downloads\compare"

# Convert new DOCX to PDF
docx_path = os.path.join(out_dir, "new_export.docx")
pdf_out = os.path.join(out_dir, "docx_v2.pdf")

print(f"Converting: {docx_path}")
convert(docx_path, pdf_out)
print("DOCX converted to PDF")

# Then PDF to images
pdf = pdfium.PdfDocument(pdf_out)
print(f"DOCX v2 pages: {len(pdf)}")
for i in range(len(pdf)):
    page = pdf[i]
    bitmap = page.render(scale=2.5)
    img = bitmap.to_pil()
    out = os.path.join(out_dir, f"docx_v2_p{i+1}.png")
    img.save(out)
    print(f"  Saved: {out}")
pdf.close()
print("Done")
