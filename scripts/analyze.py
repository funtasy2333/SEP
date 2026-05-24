import zipfile
import xml.etree.ElementTree as ET
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# ===== Analyze DOCX =====
docx_path = r"C:\Users\92569\Downloads\标准文件.docx"
print("=" * 60)
print("DOCX ANALYSIS")
print("=" * 60)

try:
    z = zipfile.ZipFile(docx_path, "r")
    doc_xml = z.read("word/document.xml").decode("utf-8")
    styles_xml = z.read("word/styles.xml").decode("utf-8")
    numbering_xml = z.read("word/numbering.xml").decode("utf-8")
    ct_xml = z.read("[Content_Types].xml").decode("utf-8")
    rels_xml = z.read("word/_rels/document.xml.rels").decode("utf-8")

    all_entries = z.namelist()
    z.close()

    ns_w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    root = ET.fromstring(doc_xml)

    # Extract all text by paragraph
    paragraphs = []
    for para in root.iter(f"{{{ns_w}}}p"):
        para_texts = []
        for t in para.iter(f"{{{ns_w}}}t"):
            if t.text:
                para_texts.append(t.text)
        line = "".join(para_texts).strip()
        if line:
            paragraphs.append(line)

    print(f"Total paragraphs with text: {len(paragraphs)}")
    print("\n--- Full Document Content ---")
    for i, p in enumerate(paragraphs):
        print(f"[P{i+1:02d}] {p}")

    # Check structure
    print("\n--- File Entries ---")
    for e in all_entries:
        print(f"  {e}")

    # Check relationships
    print("\n--- Relationships ---")
    rels_root = ET.fromstring(rels_xml)
    for rel in rels_root:
        print(f"  Type: {rel.get('Type', '').split('/')[-1]}  Target: {rel.get('Target', '')}")

    # Check content types
    print(f"\nDocument XML size: {len(doc_xml)} bytes")
    print(f"Styles XML size: {len(styles_xml)} bytes")
    print(f"Numbering XML size: {len(numbering_xml)} bytes")

    # Validate essential parts
    print("\n--- Validation ---")
    required = ["word/document.xml", "word/styles.xml", "[Content_Types].xml", "_rels/.rels"]
    for r in required:
        status = "OK" if r in all_entries else "MISSING"
        print(f"  {status}: {r}")

    # Check if images referenced exist
    import re
    image_refs = re.findall(r'Target="(media/[^"]+)"', rels_xml)
    for img in image_refs:
        full_path = f"word/{img}"
        status = "OK" if full_path in all_entries else "MISSING"
        print(f"  {status}: {full_path}")

except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()

# ===== Analyze PDF via OCR-like approach =====
print("\n" + "=" * 60)
print("PDF ANALYSIS (image-based, attempting extraction)")
print("=" * 60)

pdf_path = r"C:\Users\92569\Downloads\标准文件.pdf"

try:
    from pypdf import PdfReader
    reader = PdfReader(pdf_path)
    print(f"Total pages: {len(reader.pages)}")
    meta = reader.metadata
    if meta:
        print(f"Title: {meta.title}")
        print(f"Author: {meta.author}")
        print(f"Creator: {meta.creator}")
        print(f"Producer: {meta.producer}")

    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        print(f"\n--- Page {i+1} ---")
        if text and text.strip():
            print(text)
        else:
            print("[Image-based page, no extractable text]")

except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()
