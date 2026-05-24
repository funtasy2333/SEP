# -*- coding: utf-8 -*-
import sys, io, zipfile, pathlib, re
import xml.etree.ElementTree as ET
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Open the broken file
downloads = pathlib.Path(r"C:\Users\92569\Downloads")
candidates = sorted(downloads.glob("*.docx"), key=lambda p: p.stat().st_mtime, reverse=True)
broken = candidates[0]
print(f"Broken: {broken.name}")

# Open the working file
working = candidates[1]
print(f"Working: {working.name}")

z_broken = zipfile.ZipFile(str(broken), "r")
z_working = zipfile.ZipFile(str(working), "r")

# Check which XML files differ
for name in z_broken.namelist():
    if not name.endswith('.xml'):
        continue
    if name not in z_working.namelist():
        continue
    broken_data = z_broken.read(name).decode("utf-8")
    working_data = z_working.read(name).decode("utf-8")
    if broken_data != working_data:
        # Check if broken one is valid XML
        try:
            ET.fromstring(broken_data)
            valid = "VALID"
        except ET.ParseError as e:
            valid = f"BROKEN: {e}"
        print(f"\nDIFF in {name}: {valid}")
        print(f"  Working size: {len(working_data)}, Broken size: {len(broken_data)}")

        # Find the specific differences
        # Search for each placeholder in the working version
        placeholders = [
            '草案版次选择',
            '在提交反馈意见时，请将您知道的相关专利连同支持性文件一并附上。',
            '（本草案完成时间：',
            '本草案完成时间：',
            '点击此处添加标准的国际标准编号',
        ]
        for p in placeholders:
            in_working = p in working_data
            in_broken = p in broken_data
            if in_working and not in_broken:
                print(f"  REPLACED: '{p}'")
                # Find context around it in working version
                idx = working_data.index(p)
                ctx = working_data[max(0,idx-200):idx+len(p)+200]
                print(f"  Context in working: ...{ctx}...")

z_broken.close()
z_working.close()
