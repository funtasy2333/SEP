import zipfile
import xml.etree.ElementTree as ET
import sys
import io
import re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

docx_path = r"C:\Users\92569\Downloads\标准文件.docx"
z = zipfile.ZipFile(docx_path, "r")

# 1. Check for empty directory entries (Word hates these)
print("=" * 60)
print("1. ZIP ENTRY ANALYSIS")
print("=" * 60)
for info in z.infolist():
    if info.filename.endswith('/'):
        print(f"  [DIR ENTRY] {info.filename} (size={info.file_size}) -- SUSPICIOUS: bare directory entry")
    elif info.file_size == 0:
        print(f"  [EMPTY FILE] {info.filename} -- SUSPICIOUS")

# 2. Check Content_Types.xml for completeness
print("\n" + "=" * 60)
print("2. [Content_Types].xml ANALYSIS")
print("=" * 60)
ct_xml = z.read("[Content_Types].xml").decode("utf-8")
ct_root = ET.fromstring(ct_xml)
ns = {"ct": "http://schemas.openxmlformats.org/package/2006/content-types"}

defaults = {}
overrides = {}
for child in ct_root:
    tag = child.tag.split("}")[-1]
    if tag == "Default":
        ext = child.get("Extension", "")
        ctype = child.get("ContentType", "")
        defaults[ext] = ctype
        print(f"  Default: .{ext} -> {ctype}")
    elif tag == "Override":
        pname = child.get("PartName", "")
        ctype = child.get("ContentType", "")
        overrides[pname] = ctype
        print(f"  Override: {pname} -> {ctype}")

# Check if TIFF has a content type
print("\n  --- TIFF check ---")
if "tiff" in defaults or "tif" in defaults:
    print("  OK: TIFF default content type exists")
else:
    has_tiff_override = any("tiff" in k or "tif" in k for k in overrides)
    if has_tiff_override:
        print("  OK: TIFF override exists")
    else:
        print("  WARNING: No content type for TIFF images!")

# 3. Check relationships for issues
print("\n" + "=" * 60)
print("3. RELATIONSHIPS ANALYSIS")
print("=" * 60)
rels_xml = z.read("word/_rels/document.xml.rels").decode("utf-8")
rels_root = ET.fromstring(rels_xml)
for rel in rels_root:
    rtype = rel.get("Type", "").split("/")[-1]
    target = rel.get("Target", "")
    rid = rel.get("Id", "")
    # Check if target file exists
    full_target = f"word/{target}" if not target.startswith("/") and not target.startswith("..") else target.lstrip("/")
    if target.startswith(".."):
        full_target = target.replace("../", "")
    exists = full_target in z.namelist()
    status = "OK" if exists else "MISSING"
    print(f"  {rid}: {rtype} -> {target} [{status}]")

# 4. Validate each XML file for well-formedness
print("\n" + "=" * 60)
print("4. XML WELL-FORMEDNESS CHECK")
print("=" * 60)
for name in z.namelist():
    if name.endswith('.xml') or name.endswith('.rels'):
        try:
            content = z.read(name).decode("utf-8")
            ET.fromstring(content)
            # Check for unusual characters
            if '\x00' in content:
                print(f"  WARNING: {name} contains null bytes")
        except ET.ParseError as e:
            print(f"  ERROR: {name} - XML parse error: {e}")
        except Exception as e:
            print(f"  ERROR: {name} - {e}")

# 5. Check document.xml structure more closely
print("\n" + "=" * 60)
print("5. DOCUMENT.XML STRUCTURE")
print("=" * 60)
doc_xml = z.read("word/document.xml").decode("utf-8")

# Check for sectPr (section properties)
sect_count = doc_xml.count("sectPr")
print(f"  Section properties (sectPr) count: {sect_count}")

# Check for unusual namespaces
if "mc:AlternateContent" in doc_xml:
    print("  Contains mc:AlternateContent (compatibility markup)")
if "w14:" in doc_xml or "w15:" in doc_xml or "w16:" in doc_xml:
    print("  Contains Word 2010+ extended namespaces")

# Check declared namespaces on root
doc_root = ET.fromstring(doc_xml)
print(f"  Root tag: {doc_root.tag}")
print(f"  Root attribs: {dict(doc_root.attrib)}")

# 6. Check glossary document
print("\n" + "=" * 60)
print("6. GLOSSARY DOCUMENT CHECK")
print("=" * 60)
try:
    gloss_xml = z.read("word/glossary/document.xml").decode("utf-8")
    gloss_root = ET.fromstring(gloss_xml)
    print(f"  Glossary doc parsed OK, size={len(gloss_xml)} bytes")
    print(f"  Root tag: {gloss_root.tag}")
except Exception as e:
    print(f"  ERROR: {e}")

# 7. Check settings.xml for potential issues
print("\n" + "=" * 60)
print("7. SETTINGS.XML CHECK")
print("=" * 60)
try:
    settings_xml = z.read("word/settings.xml").decode("utf-8")
    print(f"  Settings size: {len(settings_xml)} bytes")
    if "compatSetting" in settings_xml:
        print("  Contains compatibility settings")
    if "mathPr" in settings_xml:
        print("  Contains math properties")
    if "rsid" in settings_xml.lower():
        print("  Contains revision save IDs")
except Exception as e:
    print(f"  ERROR: {e}")

z.close()
print("\nDone.")
