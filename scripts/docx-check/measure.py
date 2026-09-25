#!/usr/bin/env python3
"""measure.py <pdf> [--pages A-B|N] [--json]

300 dpi 灰度渲染每一页，灰度 < 128 的像素记为墨迹；纵向连续的「有墨迹的行」归为一个
「行块」。每页报告（单位 mm，保留一位小数）：

  - 首个行块的字顶，以及左右范围（有书眉的页，首个行块就是书眉）；
  - 第二个行块的字顶（书眉之后的首行，或没有书眉的页的标题行）；
  - 末个行块的底边距纸底（页码所在行）；
  - 末个行块距外侧纸边：页序从 1 起算，单数页量右侧、双数页量左侧（镜像页边距下，
    单数页的外侧在右、双数页的外侧在左，与 §2.3 页脚缩进方向一致）。

整页无墨迹时该页只报告「空白页」。

用法：
  measure.py spike.pdf                 处理全部页
  measure.py spike.pdf --pages 3-9     只处理第 3–9 页（页序从 1 起算，闭区间）
  measure.py spike.pdf --pages 5       只处理第 5 页
  measure.py spike.pdf --json          输出 JSON 数组而不是文字表格

只用标准库 + PyMuPDF（本机已装，import 名为 fitz）；不是项目依赖，不进 CI。
"""

import argparse
import json
import sys

import fitz  # PyMuPDF

DPI = 300
INK_THRESHOLD = 128
MM_PER_PX = 25.4 / DPI

# 256 项查表：灰度 < 128 记 1（墨迹），否则记 0；配合 bytes.translate 做 C 级别的行扫描，
# 避免在纯 Python 里逐像素循环（一页 300dpi A4 约 870 万像素）。
INK_TABLE = bytes(1 if v < INK_THRESHOLD else 0 for v in range(256))


def parse_pages_arg(spec, page_count):
    """"3-9" → range(2, 9)（0 起算左闭右开）；"5" → range(4, 5)；None → 全部页。"""
    if spec is None:
        return range(0, page_count)
    if '-' in spec:
        a, b = spec.split('-', 1)
        start, end = int(a), int(b)
    else:
        start = end = int(spec)
    if start < 1 or end < start:
        raise ValueError(f'--pages 参数不合法: "{spec}"')
    return range(start - 1, min(end, page_count))


def row_ink_extent(row_bytes):
    """行内墨迹像素的 (最左列, 最右列)，0 起算；整行无墨迹返回 None。"""
    marks = row_bytes.translate(INK_TABLE)
    left = marks.find(1)
    if left == -1:
        return None
    right = marks.rfind(1)
    return left, right


def find_blocks(pix):
    """扫描整页像素，返回 (行块列表, 页宽像素, 页高像素)。
    行块字段 top/bottom/left/right 均为像素坐标，0 起算，闭区间（含端点像素）。"""
    width, height, stride = pix.width, pix.height, pix.stride
    samples = pix.samples
    blocks = []
    current = None
    for y in range(height):
        row = samples[y * stride : y * stride + width]
        extent = row_ink_extent(row)
        if extent is None:
            if current is not None:
                blocks.append(current)
                current = None
            continue
        left, right = extent
        if current is None:
            current = {'top': y, 'bottom': y, 'left': left, 'right': right}
        else:
            current['bottom'] = y
            current['left'] = min(current['left'], left)
            current['right'] = max(current['right'], right)
    if current is not None:
        blocks.append(current)
    return blocks, width, height


def mm(px):
    return round(px * MM_PER_PX, 1)


def measure_page(page, page_no_1based):
    zoom = DPI / 72.0
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csGRAY, alpha=False)
    blocks, width_px, height_px = find_blocks(pix)

    if not blocks:
        return {'page': page_no_1based, 'blank': True}

    first = blocks[0]
    second = blocks[1] if len(blocks) > 1 else None
    last = blocks[-1]
    is_odd = page_no_1based % 2 == 1

    if is_odd:
        outside_mm = mm(width_px - last['right'] - 1)
    else:
        outside_mm = mm(last['left'])

    return {
        'page': page_no_1based,
        'blank': False,
        'first_block_top_mm': mm(first['top']),
        'first_block_left_mm': mm(first['left']),
        'first_block_right_mm': mm(first['right'] + 1),
        'second_block_top_mm': mm(second['top']) if second else None,
        'last_block_bottom_distance_mm': mm(height_px - last['bottom'] - 1),
        'last_block_outside_distance_mm': outside_mm,
    }


def format_text(results):
    lines = []
    for r in results:
        if r['blank']:
            lines.append(f"页 {r['page']:>3}：空白页")
            continue
        second = '—' if r['second_block_top_mm'] is None else f"{r['second_block_top_mm']}mm"
        lines.append(
            f"页 {r['page']:>3}："
            f"首块字顶={r['first_block_top_mm']}mm 左={r['first_block_left_mm']}mm 右={r['first_block_right_mm']}mm"
            f" | 次块字顶={second}"
            f" | 末块距底={r['last_block_bottom_distance_mm']}mm"
            f" | 末块距外侧={r['last_block_outside_distance_mm']}mm"
        )
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('pdf')
    parser.add_argument('--pages', default=None, help='页范围，如 "3-9" 或 "5"；页序从 1 起算')
    parser.add_argument('--json', action='store_true', help='输出 JSON 数组')
    args = parser.parse_args()

    doc = fitz.open(args.pdf)
    try:
        page_range = parse_pages_arg(args.pages, doc.page_count)
    except ValueError as e:
        print(f'错误：{e}', file=sys.stderr)
        sys.exit(2)

    results = [measure_page(doc[i], i + 1) for i in page_range]

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        print(format_text(results))


if __name__ == '__main__':
    main()
