# -*- coding: utf-8 -*-
import sys, io, zipfile, re, pathlib
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

downloads = pathlib.Path(r"C:\Users\92569\Downloads")
candidates = sorted(downloads.glob("*.docx"), key=lambda p: p.stat().st_mtime, reverse=True)
docx_path = candidates[0]
print(f"Checking: {docx_path.name} ({docx_path.stat().st_size} bytes)")

z = zipfile.ZipFile(str(docx_path), "r")

# 1. List all entries
print("\n=== ZIP entries ===")
for info in z.infolist():
    flag = " [DIR]" if info.filename.endswith('/') else ""
    print(f"  {info.filename}{flag} ({info.file_size} bytes)")

# 2. Check Content_Types
ct = z.read("[Content_Types].xml").decode("utf-8")
print("\n=== Content_Types check ===")
if "template.main+xml" in ct:
    print("ERROR: Still has template.main+xml!")
else:
    print("OK: No template.main+xml")
if "document.main+xml" in ct:
    print("OK: Has document.main+xml")
else:
    print("ERROR: Missing document.main+xml!")

# 3. Check relationships
print("\n=== Relationships ===")
for name in z.namelist():
    if name.endswith('.rels'):
        rels = z.read(name).decode("utf-8")
        # Check for broken references
        for m in re.finditer(r'Target="([^"]+)"', rels):
            target = m.group(1)
            if not target.startswith("http") and not target.startswith("mailto"):
                # relative path - check if file exists
                if name == "_rels/.rels":
                    full = target.lstrip('/')
                else:
                    base = '/'.join(name.split('/')[:-2]) + '/'
                    full = base + target.lstrip('/')
                full = full.lstrip('/')
                if full not in z.namelist() and full.replace('/', '\\') not in z.namelist():
                    print(f"  WARNING: {name} -> {target} (not found as {full})")

# 4. Try opening with python-docx
print("\n=== python-docx test ===")
try:
    from docx import Document
    doc = Document(str(docx_path))
    print(f"OK: python-docx opened successfully, {len(doc.paragraphs)} paragraphs")
    # Check numbering
    numbering_part = doc.part.numbering_part
    if numbering_part:
        print("OK: Has numbering part")
    else:
        print("INFO: No numbering part")
except Exception as e:
    print(f"ERROR: python-docx failed: {e}")

# 5. Check for the specific issue with empty w:r elements
print("\n=== Empty element check ===")
xml = z.read("word/document.xml").decode("utf-8")
empty_runs = len(re.findall(r'<w:r>\s*</w:r>', xml))
print(f"Empty w:r elements: {empty_runs}")
empty_paras = len(re.findall(r'<w:p>\s*</w:p>', xml))
print(f"Empty w:p elements: {empty_paras}")
# Check for self-closing p
selfclose_p = len(re.findall(r'<w:p\s*/>', xml))
print(f"Self-closing w:p elements: {selfclose_p}")

z.close()
print("\nDone")
