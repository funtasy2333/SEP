#!/usr/bin/env python3
"""expect.py <pdf>

用 PyMuPDF 按 span 取文字：同一页上基线（span origin 的 y）相差不到 1pt 的 span 归为一个
「视觉行」，行内按 x 排序拼接。在视觉行里找三种期望标记（docs/wp7-docx-delivery.md §9
WP7.2、§10.3）：

  「〔期望X〕」    ：本行去掉全部空白后以 X（同样去掉空白）开头，且紧接 X 的字符不是数字
                     或「.」（避免「4」误配到「4.1」这样的更长编号头上）；
  「〔前段期望X〕」：同一页的上一个视觉行去掉空白后等于 X；
  「〔附录期望X〕」：同一页往上第二个视觉行去掉空白后等于 X。

逐条输出通过或失败及实际文字；有失败、或一个标记也没找到时退出码为 1。

用法：
  python3 scripts/docx-check/expect.py numbering.pdf

只用标准库 + PyMuPDF（本机已装，import 名为 fitz）；不是项目依赖，不进 CI。
"""

import re
import sys

import fitz  # PyMuPDF

Y_TOLERANCE = 1.0  # pt：同一视觉行的基线容差

MARKER_RE = re.compile(r'〔(期望|前段期望|附录期望)([^〕]+)〕')


def build_visual_lines(page):
    """该页的视觉行列表，每项 {'text', 'stripped'}，按从上到下、行内按 x 从左到右排序。"""
    d = page.get_text('dict')
    spans = []
    for block in d.get('blocks', []):
        for line in block.get('lines', []):
            for span in line.get('spans', []):
                text = span.get('text', '')
                if text == '':
                    continue
                origin = span.get('origin', [0.0, 0.0])
                spans.append({'x': origin[0], 'y': origin[1], 'text': text})

    spans.sort(key=lambda s: (s['y'], s['x']))

    groups = []
    current = None
    for s in spans:
        if current is None or s['y'] - current['ref_y'] >= Y_TOLERANCE:
            current = {'ref_y': s['y'], 'spans': []}
            groups.append(current)
        current['spans'].append(s)

    lines = []
    for g in groups:
        ordered = sorted(g['spans'], key=lambda s: s['x'])
        text = ''.join(s['text'] for s in ordered)
        lines.append({'text': text, 'stripped': re.sub(r'\s+', '', text)})
    return lines


def check_self(stripped, expected):
    """本行去掉空白后以 expected 开头，且紧接的字符不是数字或「.」"""
    if not stripped.startswith(expected):
        return False
    next_char = stripped[len(expected) : len(expected) + 1]
    if next_char == '':
        return True
    return not (next_char.isdigit() or next_char == '.')


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    pdf_path = sys.argv[1]

    doc = fitz.open(pdf_path)
    results = []  # [(ok, message)]

    for page_no in range(doc.page_count):
        lines = build_visual_lines(doc[page_no])
        for i, line in enumerate(lines):
            for m in MARKER_RE.finditer(line['text']):
                # 规格写法「〔期望 X〕」带空格（§9 WP7.2）；X 两侧空白 strip 掉再比较，
                # 兼容 fixture 里不带空格的写法（#34 审查）。
                kind, expected = m.group(1), m.group(2).strip()
                where = f'第 {page_no + 1} 页 第 {i + 1} 行'

                if kind == '期望':
                    ok = check_self(line['stripped'], expected)
                    actual = line['stripped']
                    results.append((ok, f'{where}「期望{expected}」：{"通过" if ok else "失败"}（本行文字：{actual}）'))

                elif kind == '前段期望':
                    if i - 1 < 0:
                        results.append((False, f'{where}「前段期望{expected}」：失败（本页没有上一行）'))
                        continue
                    prev = lines[i - 1]['stripped']
                    ok = prev == expected
                    results.append((ok, f'{where}「前段期望{expected}」：{"通过" if ok else "失败"}（上一行文字：{prev}）'))

                elif kind == '附录期望':
                    if i - 2 < 0:
                        results.append((False, f'{where}「附录期望{expected}」：失败（本页往上不足两行）'))
                        continue
                    target = lines[i - 2]['stripped']
                    ok = target == expected
                    results.append((ok, f'{where}「附录期望{expected}」：{"通过" if ok else "失败"}（往上第二行文字：{target}）'))

    for _ok, message in results:
        print(message)

    if not results:
        print('未在任何视觉行里找到期望标记', file=sys.stderr)
        sys.exit(1)

    failed = [r for r in results if not r[0]]
    if failed:
        print(f'\n共 {len(results)} 条，失败 {len(failed)} 条', file=sys.stderr)
        sys.exit(1)

    print(f'\n共 {len(results)} 条，全部通过')


if __name__ == '__main__':
    main()
