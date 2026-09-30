#!/usr/bin/env python3
"""从仓库 GB/T 1.1-2020 原件重建 WP7.5 封面PNG和base64常量。
本地素材工具：Python+PyMuPDF+Pillow+Poppler，不引入shared依赖。
"""
from pathlib import Path
import base64
import subprocess
import tempfile
import fitz
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'rules/GBT 1.1-2020 标准化工作导则 第1部分：标准化文件的结构和起草规则.pdf'
DEST = ROOT / 'docs/素材'
with tempfile.TemporaryDirectory(prefix='ses-cover-') as scratch:
    prefix = str(Path(scratch) / 'gb')
    subprocess.run(['pdfimages', '-f', '1', '-l', '1', '-png', str(SOURCE), prefix], check=True)
    with Image.open(prefix + '-000.png') as logo:
        if logo.size != (948, 474):
            raise RuntimeError('原件嵌图尺寸改变，请人工复核')
        logo.save(DEST / 'GB标志.png', dpi=(600, 600))
with fitz.open(SOURCE) as pdf:
    clip = fitz.Rect(*(v * 72 / 25.4 for v in (68.6, 263, 135.5, 277)))
    pix = pdf[0].get_pixmap(matrix=fitz.Matrix(600/72, 600/72), colorspace=fitz.csGRAY, clip=clip)
    issuer = Image.frombytes('L', (pix.width, pix.height), pix.samples).point(lambda v: 0 if v < 128 else 255, '1').convert('L')
    issuer = issuer.crop(ImageChops.invert(issuer).getbbox())
    issuer.save(DEST / '国家标准发布机构.png', dpi=(600, 600))
with Image.open(DEST / 'DB标志.tiff') as db:
    db.convert('RGB').save(DEST / 'DB标志.png', dpi=(220, 220))
assets = [('gbLogo', 'GB标志.png', 40, 20), ('nationalIssuer', '国家标准发布机构.png', 65, 12), ('dbLogo', 'DB标志.png', 22, 11)]
header = '''/** WP7.5 内置 PNG 素材；来源与限制见 docs/wp7.5-cover-assets.md。
 * GB 为 GB/T 1.1-2020 第1页的600dpi原嵌图；发布机构为同页600dpi二值裁切。
 * DB 为仓库220dpi TIFF转换，原始来源未核实。T/Q不用第三方或不合格素材。
 */
export const COVER_ASSETS = {
'''
for key, name, width, height in assets:
    encoded = base64.b64encode((DEST/name).read_bytes()).decode('ascii')
    header += f"  {key}: {{ base64: '{encoded}', widthMm: {width}, heightMm: {height} }},\n"
(ROOT / 'packages/shared/src/renderers/docx/assets.ts').write_text(header + '} as const\n')
print('重建 GB/DB/发布机构 PNG 与 assets.ts；T/Q 未使用不合格来源。')
