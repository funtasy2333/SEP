#!/usr/bin/env python3
"""比较两次 Word 渲染的页数、尺寸、文字和150dpi灰度像素；任一不同退出1。

用法：compare_pdf.py <baseline.pdf> <current.pdf> > comparison.json
只证明所比较样稿未发生渲染变化，不代表任意文稿或标准符合性。
"""
import argparse
import hashlib
import json
from pathlib import Path

import fitz


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def compare(baseline, current):
    with fitz.open(baseline) as before, fitz.open(current) as after:
        pages = []
        for index in range(min(len(before), len(after))):
            a, b = before[index], after[index]
            kwargs = dict(matrix=fitz.Matrix(150 / 72, 150 / 72), colorspace=fitz.csGRAY, alpha=False)
            ap, bp = a.get_pixmap(**kwargs), b.get_pixmap(**kwargs)
            pages.append({
                'page': index + 1,
                'size_equal': a.rect == b.rect,
                'text_equal': a.get_text() == b.get_text(),
                'pixels_equal': (ap.width, ap.height, ap.stride, ap.samples) == (bp.width, bp.height, bp.stride, bp.samples),
                'before_pixel_sha256': hashlib.sha256(ap.samples).hexdigest(),
                'after_pixel_sha256': hashlib.sha256(bp.samples).hexdigest(),
            })
        passed = len(before) == len(after) and all(
            p['size_equal'] and p['text_equal'] and p['pixels_equal'] for p in pages)
        return {'baseline': str(baseline), 'current': str(current),
                'baseline_sha256': sha256(baseline), 'current_sha256': sha256(current),
                'dpi': 150, 'page_counts': [len(before), len(after)], 'pages': pages, 'pass': passed}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline')
    parser.add_argument('current')
    args = parser.parse_args()
    result = compare(args.baseline, args.current)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['pass'] else 1)
