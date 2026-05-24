# -*- coding: utf-8 -*-
import sys, io, zipfile, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import pathlib
# Use glob to find the file to avoid encoding issues
downloads = pathlib.Path(r"C:\Users\92569\Downloads")
candidates = sorted(downloads.glob("*.docx"), key=lambda p: p.stat().st_mtime, reverse=True)
docx_path = candidates[0]
print(f"Using: {docx_path.name}")
z = zipfile.ZipFile(str(docx_path), "r")
xml = z.read("word/document.xml").decode("utf-8")

# Check Content_Types
ct = z.read("[Content_Types].xml").decode("utf-8")
if "template.main+xml" in ct:
    print("ERROR: Still has template.main+xml!")
elif "document.main+xml" in ct:
    print("OK: Has document.main+xml")

# Check for bare directory entries
for info in z.infolist():
    if info.filename.endswith('/') and info.file_size == 0:
        print(f"WARNING: bare directory entry: {info.filename}")

# Find the body section - look for page break
if '<w:br w:type="page"' in xml:
    print("Found page break in document.xml")
    idx = xml.index('<w:br w:type="page"')
    print(f"  Context: ...{xml[max(0,idx-100):idx+80]}...")
else:
    print("No page break found")

# Look for chapter titles
for m in re.finditer(r'<w:pStyle w:val="affc"/>', xml):
    start = max(0, m.start()-50)
    end = min(len(xml), m.end()+300)
    snippet = xml[start:end]
    texts = re.findall(r'<w:t[^>]*>([^<]*)</w:t>', snippet)
    print(f"Chapter title (affc) texts: {texts}")

# Look for foreword
for m in re.finditer(r'<w:pStyle w:val="affb"/>', xml):
    start = max(0, m.start()-50)
    end = min(len(xml), m.end()+200)
    snippet = xml[start:end]
    texts = re.findall(r'<w:t[^>]*>([^<]*)</w:t>', snippet)
    print(f"Foreword title (affb) texts: {texts}")

# Check XML well-formedness
try:
    import xml.etree.ElementTree as ET
    ET.fromstring(xml)
    print("XML is well-formed: OK")
except ET.ParseError as e:
    print(f"XML PARSE ERROR: {e}")

z.close()
print("Done")
