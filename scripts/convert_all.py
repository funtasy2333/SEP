import pypdfium2 as pdfium
import zipfile
import xml.etree.ElementTree as ET
import os
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

out_dir = r"C:\Users\92569\Downloads\compare"
os.makedirs(out_dir, exist_ok=True)

# 1. Convert exported PDF to images
print("=== Converting exported PDF ===")
pdf_path = r"C:\Users\92569\Downloads\标准文件.pdf"
pdf = pdfium.PdfDocument(pdf_path)
print(f"Pages: {len(pdf)}")
for i in range(len(pdf)):
    page = pdf[i]
    bitmap = page.render(scale=2.5)
    img = bitmap.to_pil()
    out = os.path.join(out_dir, f"export_pdf_p{i+1}.png")
    img.save(out)
    print(f"  Saved: {out}")
pdf.close()

# 2. Convert GB/T 1.1-2020 reference PDF to images (first 10 pages for cover/foreword/body examples)
print("\n=== Converting GB/T 1.1-2020 reference ===")
ref_path = r"C:\Users\92569\Documents\SEP\rules\GBT 1.1-2020 标准化工作导则 第1部分：标准化文件的结构和起草规则.pdf"
ref_pdf = pdfium.PdfDocument(ref_path)
print(f"Pages: {len(ref_pdf)}")
# Convert first 6 pages (cover, foreword, TOC, body start) and some key pages
pages_to_convert = list(range(min(8, len(ref_pdf))))
for i in pages_to_convert:
    page = ref_pdf[i]
    bitmap = page.render(scale=2.5)
    img = bitmap.to_pil()
    out = os.path.join(out_dir, f"gbt11_p{i+1}.png")
    img.save(out)
    print(f"  Saved: {out}")
ref_pdf.close()

# 3. Convert DOCX to images via extracting content info
print("\n=== Analyzing DOCX ===")
docx_path = r"C:\Users\92569\Downloads\标准文件.docx"
z = zipfile.ZipFile(docx_path, "r")

# Extract text content
doc_xml = z.read("word/document.xml").decode("utf-8")
ns_w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
root = ET.fromstring(doc_xml)

paragraphs = []
for para in root.iter(f"{{{ns_w}}}p"):
    para_texts = []
    # Get style
    style = ""
    pPr = para.find(f"{{{ns_w}}}pPr")
    if pPr is not None:
        pStyle = pPr.find(f"{{{ns_w}}}pStyle")
        if pStyle is not None:
            style = pStyle.get(f"{{{ns_w}}}val", "")

    for t in para.iter(f"{{{ns_w}}}t"):
        if t.text:
            para_texts.append(t.text)
    line = "".join(para_texts).strip()
    paragraphs.append({"style": style, "text": line})

print(f"Total paragraphs: {len(paragraphs)}")
for i, p in enumerate(paragraphs):
    if p["text"] or p["style"]:
        print(f"  [{i:03d}] style={p['style']:<25s} | {p['text'][:80]}")

# Check Content_Types
ct_xml = z.read("[Content_Types].xml").decode("utf-8")
if "template.main+xml" in ct_xml:
    print("\n  WARNING: Still has template.main+xml content type!")
elif "document.main+xml" in ct_xml:
    print("\n  OK: Has correct document.main+xml content type")

# Check for directory entries
for info in z.infolist():
    if info.filename.endswith('/') and info.file_size == 0:
        print(f"  WARNING: Bare directory entry: {info.filename}")

z.close()
print("\nDone.")
