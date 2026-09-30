#!/usr/bin/env python3
"""重建 WP7.5 封面 PNG 与静态常量。
GB 使用仓库 GB/T 1.1-2020 原件的高分辨率图。其余图片来自用户提供的模板，
--template-dir 可重新提取；不提供时使用仓库已保存的原像素 PNG。转换不提高分辨率。
仅本地素材制备工具，不引入 shared 运行时依赖。
"""
import argparse
import base64
import hashlib
import io
from pathlib import Path
import subprocess
import tempfile
from zipfile import ZipFile
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'rules/GBT 1.1-2020 标准化工作导则 第1部分：标准化文件的结构和起草规则.pdf'
DEST = ROOT / 'docs/素材'
# 固定原始媒体指纹，源图发生变化时先人工复核，不能把近似替换自动称为同一素材。
TEMPLATE_MEDIA = [
    ('国家标准.docx', 'word/media/image2.tiff', '国家标准发布机构_含发布.png', (690, 131), '0c643f4a7523080622f8c3df3013eae5c8c6c0d7392ede4ba94fafe2fba63385', 220),
    ('地方标准.docx', 'word/media/image1.tiff', 'DB标志.png', (196, 98), '6af249be58821df7dad304dac73d6e9ff51a71b189d89dcb2a7c3b2b60549a25', 220),
    ('团体标准.docx', 'word/media/image1.png', 'T标志.png', (100, 103), '87a25869339d8fa2dc2992e22e4965c691cb7281e11e2e006412756c15554b7c', 220),
    ('团体标准.docx', 'word/media/image2.png', '团体斜杠.png', (53, 135), '189cd61f4f8e4d105ad50f3ae3dfaf7cea96271b1a5d2007b2a9a7993f11c80a', None),
    ('企业标准.docx', 'word/media/image1.tif', 'Q标志.png', (34, 35), 'a227a3a8a4dd9706c945d7b8e98e7462a6ca7aba9dd298d2f8ea06e758a282b9', 72),
]
ASSETS = [
    ('gbLogo', 'GB标志.png', 40, 20),
    ('nationalIssuer', '国家标准发布机构_含发布.png', 79.69, 15.15),
    ('dbLogo', 'DB标志.png', 22.131, 11.049),
    ('groupLogo', 'T标志.png', 11.520, 11.960),
    ('groupSlash', '团体斜杠.png', 4.748, 12.128),
    ('enterpriseLogo', 'Q标志.png', 11.994, 12.347),
]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--template-dir', type=Path, help='用户提供的六类模板目录；只读')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='ses-cover-') as scratch:
        prefix = str(Path(scratch) / 'gb')
        subprocess.run(['pdfimages', '-f', '1', '-l', '1', '-png', str(SOURCE), prefix], check=True)
        with Image.open(prefix + '-000.png') as logo:
            if logo.size != (948, 474):
                raise RuntimeError('GB 原件嵌图尺寸改变，请人工复核')
            logo.save(DEST / 'GB标志.png', dpi=(600, 600))
    if args.template_dir:
        for source_doc, member, filename, size, digest, dpi in TEMPLATE_MEDIA:
            with ZipFile(args.template_dir / source_doc) as z:
                data = z.read(member)
            if hashlib.sha256(data).hexdigest() != digest:
                raise RuntimeError(f'{source_doc}/{member} 指纹变化，请人工复核')
            with Image.open(io.BytesIO(data)) as image:
                if image.size != size:
                    raise RuntimeError(f'{source_doc}/{member} 像素尺寸变化')
                if member.endswith('.png'):
                    (DEST / filename).write_bytes(data)
                else:
                    image.convert('RGB').save(DEST / filename, dpi=(dpi, dpi))
    header = '/** WP7.5 内置 PNG；来源和原像素限制见 docs/wp7.5-cover-assets.md。\n * GB 为标准原件600dpi嵌图；其它图片按用户提供模板提取，不声明官方来源。\n * 国家发布图已含发布文字；Q仅34×35px，PNG转换不提高其72dpi清晰度。\n */\nexport const COVER_ASSETS = {\n'
    for key, filename, width, height in ASSETS:
        data = (DEST / filename).read_bytes()
        header += f"  {key}: {{ base64: '{base64.b64encode(data).decode('ascii')}', widthMm: {width}, heightMm: {height} }},\n"
    (ROOT / 'packages/shared/src/renderers/docx/assets.ts').write_text(header + '} as const\n')
    print('已按原像素重建图片与 assets.ts；来源与低清限制不因转换消失。')

if __name__ == '__main__':
    main()
