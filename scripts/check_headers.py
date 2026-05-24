# -*- coding: utf-8 -*-
import sys, io, zipfile, re, pathlib
import xml.etree.ElementTree as ET
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

downloads = pathlib.Path(r"C:\Users\92569\Downloads")
candidates = sorted(downloads.glob("*.docx"), key=lambda p: p.stat().st_mtime, reverse=True)
docx_path = candidates[0]
print(f"Checking: {docx_path.name}")

z = zipfile.ZipFile(str(docx_path), "r")

# Check all XML files for well-formedness
print("\n=== XML well-formedness check ===")
for name in z.namelist():
    if name.endswith('.xml') or name.endswith('.rels'):
        try:
            data = z.read(name).decode("utf-8")
            ET.fromstring(data)
        except ET.ParseError as e:
            print(f"BROKEN: {name} -> {e}")
        except Exception as e:
            print(f"ERROR reading {name}: {e}")

print("All XML files checked.")

# Also compare with the old working file
old_candidates = sorted(downloads.glob("*.docx"), key=lambda p: p.stat().st_mtime, reverse=True)
if len(old_candidates) > 1:
    old_path = old_candidates[1]
    print(f"\n=== Comparing with older: {old_path.name} ===")
    z_old = zipfile.ZipFile(str(old_path), "r")

    new_names = set(z.namelist())
    old_names = set(z_old.namelist())

    missing = old_names - new_names
    added = new_names - old_names
    if missing:
        print(f"MISSING in new: {missing}")
    if added:
        print(f"ADDED in new: {added}")

    # Compare sizes of key files
    for name in sorted(new_names & old_names):
        new_size = z.getinfo(name).file_size
        old_size = z_old.getinfo(name).file_size
        if new_size != old_size:
            print(f"  SIZE DIFF: {name}: {old_size} -> {new_size} ({new_size-old_size:+d})")

    z_old.close()

z.close()
print("\nDone")
