# -*- coding: utf-8 -*-
"""
深入分析参考 DOCX 文档的样式体系：
1. 所有样式定义（名称、ID、字体、字号、缩进、对齐等）
2. 编号定义（大纲编号规则）
3. 页面设置（页边距、页眉页脚）
4. 段落结构（每段使用的样式）
"""
import sys, io, zipfile, re, json, pathlib
import xml.etree.ElementTree as ET
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

docx_path = r"C:\Users\92569\Downloads\国家标准.docx"
z = zipfile.ZipFile(docx_path, "r")

# ============================================================
# 1. 样式定义
# ============================================================
print("=" * 70)
print("1. STYLES (word/styles.xml)")
print("=" * 70)

ns = {
    'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}

styles_xml = z.read("word/styles.xml").decode("utf-8")
styles_root = ET.fromstring(styles_xml)

# Extract default styles
defaults = styles_root.find('.//w:docDefaults', ns)
if defaults:
    rpr = defaults.find('.//w:rPrDefault/w:rPr', ns)
    if rpr:
        font = rpr.find('w:rFonts', ns)
        sz = rpr.find('w:sz', ns)
        print(f"Default font: {font.attrib if font is not None else 'N/A'}")
        print(f"Default size: {sz.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val') if sz is not None else 'N/A'} half-points")

print("\n--- All paragraph/character styles ---")
for style in styles_root.findall('.//w:style', ns):
    style_type = style.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}type', '')
    style_id = style.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}styleId', '')

    name_el = style.find('w:name', ns)
    name = name_el.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val', '') if name_el is not None else ''

    based_on = style.find('w:basedOn', ns)
    based_on_val = based_on.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val', '') if based_on is not None else ''

    # Get key formatting properties
    ppr = style.find('w:pPr', ns)
    rpr = style.find('w:rPr', ns)

    props = []
    if ppr is not None:
        jc = ppr.find('w:jc', ns)
        if jc is not None:
            props.append(f"align={jc.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val')}")
        ind = ppr.find('w:ind', ns)
        if ind is not None:
            for attr in ['firstLine', 'left', 'hanging']:
                val = ind.get(f'{{{ns["w"]}}}{attr}')
                if val:
                    props.append(f"ind.{attr}={val}")
        spacing = ppr.find('w:spacing', ns)
        if spacing is not None:
            for attr in ['before', 'after', 'line', 'lineRule']:
                val = spacing.get(f'{{{ns["w"]}}}{attr}')
                if val:
                    props.append(f"sp.{attr}={val}")
        outline = ppr.find('w:outlineLvl', ns)
        if outline is not None:
            props.append(f"outlineLvl={outline.get(f'{{{ns["w"]}}}val')}")
        num_pr = ppr.find('w:numPr', ns)
        if num_pr is not None:
            num_id = num_pr.find('w:numId', ns)
            ilvl = num_pr.find('w:ilvl', ns)
            if num_id is not None:
                props.append(f"numId={num_id.get(f'{{{ns["w"]}}}val')}")
            if ilvl is not None:
                props.append(f"ilvl={ilvl.get(f'{{{ns["w"]}}}val')}")

    if rpr is not None:
        fonts = rpr.find('w:rFonts', ns)
        if fonts is not None:
            east = fonts.get(f'{{{ns["w"]}}}eastAsia', '')
            ascii_ = fonts.get(f'{{{ns["w"]}}}ascii', '')
            if east or ascii_:
                props.append(f"font={east or ascii_}")
        sz = rpr.find('w:sz', ns)
        if sz is not None:
            half_pt = int(sz.get(f'{{{ns["w"]}}}val', '0'))
            props.append(f"size={half_pt/2}pt")
        bold = rpr.find('w:b', ns)
        if bold is not None:
            val = bold.get(f'{{{ns["w"]}}}val', 'true')
            if val != '0' and val != 'false':
                props.append("bold")

    if style_type == 'paragraph' or (style_type == 'character' and props):
        prop_str = ', '.join(props) if props else ''
        based = f" (based: {based_on_val})" if based_on_val else ''
        print(f"  [{style_type[0]}] {style_id:<30s} {name:<40s}{based}")
        if prop_str:
            print(f"      {prop_str}")

# ============================================================
# 2. 段落内容与样式使用
# ============================================================
print("\n" + "=" * 70)
print("2. DOCUMENT PARAGRAPHS (word/document.xml)")
print("=" * 70)

doc_xml = z.read("word/document.xml").decode("utf-8")
doc_root = ET.fromstring(doc_xml)

body = doc_root.find('.//w:body', ns)
if body:
    for i, para in enumerate(body.findall('.//w:p', ns)):
        ppr = para.find('w:pPr', ns)
        style = ''
        if ppr is not None:
            ps = ppr.find('w:pStyle', ns)
            if ps is not None:
                style = ps.get(f'{{{ns["w"]}}}val', '')

        # Extract text
        texts = []
        for t in para.iter(f'{{{ns["w"]}}}t'):
            if t.text:
                texts.append(t.text)
        text = ''.join(texts).strip()

        if text or style:
            print(f"  [{i:03d}] style={style:<35s} | {text[:70]}")

# ============================================================
# 3. 页面设置
# ============================================================
print("\n" + "=" * 70)
print("3. PAGE SETUP (sectPr)")
print("=" * 70)

for sect in doc_root.iter(f'{{{ns["w"]}}}sectPr'):
    pg_sz = sect.find('w:pgSz', ns)
    if pg_sz is not None:
        w = pg_sz.get(f'{{{ns["w"]}}}w', '')
        h = pg_sz.get(f'{{{ns["w"]}}}h', '')
        print(f"  Page size: {w} x {h} twips ({int(w)/567:.0f}mm x {int(h)/567:.0f}mm)")

    pg_mar = sect.find('w:pgMar', ns)
    if pg_mar is not None:
        margins = {}
        for attr in ['top', 'right', 'bottom', 'left', 'header', 'footer']:
            val = pg_mar.get(f'{{{ns["w"]}}}{attr}', '0')
            margins[attr] = f"{int(val)/567:.1f}mm"
        print(f"  Margins: top={margins['top']}, bottom={margins['bottom']}, left={margins['left']}, right={margins['right']}")
        print(f"  Header={margins['header']}, Footer={margins['footer']}")

# ============================================================
# 4. ZIP contents list
# ============================================================
print("\n" + "=" * 70)
print("4. ZIP CONTENTS")
print("=" * 70)
for info in z.infolist():
    print(f"  {info.filename} ({info.file_size} bytes)")

z.close()
print("\nDone.")
