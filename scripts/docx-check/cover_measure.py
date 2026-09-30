#!/usr/bin/env python3
"""封面墨迹测量：cover_measure.py <pdf> [--json]，300dpi阈值128，沿用measure.py算法。
固定窗口仅用于定位元素，判断依据是实际像素，不是OOXML frame坐标。
名称及译名随行数自然流动，输出全部行块供复核相对间距。
"""
import argparse
import json
import fitz
from measure import find_blocks, DPI, MM_PER_PX


def region(page, box):
    rect = fitz.Rect(*(v * 72 / 25.4 for v in box))
    pix = page.get_pixmap(matrix=fitz.Matrix(DPI / 72, DPI / 72), colorspace=fitz.csGRAY, clip=rect, alpha=False)
    blocks, _, _ = find_blocks(pix)
    # clip的起点按设备像素向下取整，使用pix.x/y还原真实页面坐标。
    return [{k: round((b[k] + (pix.y if k in ('top', 'bottom') else pix.x) + (1 if k in ('bottom', 'right') else 0)) * MM_PER_PX, 2) for k in ('left', 'top', 'right', 'bottom')} for b in blocks]


def measure(path, kind=None, sample_flow=False):
    with fitz.open(path) as doc:
        p = doc[0]
        zones = {
            'classification': (20, 7, 115, 30), 'logo': (135, 7, 190, 38),
            'designation': (20, 38, 200, 54), 'number': (80, 54, 196, 63),
            'replaces': (75, 63, 196, 71), 'rule': (20, 71, 200, 80),
            'name_block': (20, 105, 200, 240), 'dates': (20, 246, 200, 256),
            'date_rule': (20, 256, 200, 260), 'issuer': (20, 260, 200, 283),
        }
        blocks = {key: region(p, box) for key, box in zones.items()}
        targets = [('classification', 'left', 25), ('classification', 'top', 10.6),
                   ('designation', 'top', 41.5), ('number', 'top', 58.3), ('number', 'right', 190),
                   ('replaces', 'top', 65.4), ('replaces', 'right', 190), ('rule', 'top', 75),
                   ('rule', 'left', 25), ('rule', 'right', 195), ('name_block', 'top', 115.4),
                   ('dates', 'top', 251.5), ('dates', 'left', 25), ('dates', 'right', 195),
                   ('date_rule', 'top', 257)]
        checks = []
        if kind:
            targets += [('logo', 'left', 143), ('logo', 'top', 13), ('logo', 'right', 183), ('logo', 'bottom', 33),
                        ('designation', 'left', 25), ('designation', 'right', 195), ('designation', 'bottom', 50.2)]
            # 发布机构国标为两行原件图片，其他类型是不同长度的一行可编辑文字。
            if kind in ('gb', 'guide'):
                targets += [('issuer', 'left', 68.6), ('issuer', 'right', 151.4), ('issuer', 'top', 264), ('issuer', 'bottom', 276)]
            else:
                targets += [('issuer', 'top', 264)]

        for key, edge, target in targets:
            element_blocks = blocks[key]
            # logo/issuer覆盖整个元素；名称等只测首行，避免多行内容混入首行位置。
            if element_blocks and key in ('logo', 'issuer'):
                actual = (min if edge in ('left', 'top') else max)(b[edge] for b in element_blocks)
            else:
                actual = element_blocks[0][edge] if element_blocks else None
            checks.append({'element': key, 'edge': edge, 'target_mm': target, 'actual_mm': actual,
                           'delta_mm': round(actual - target, 2) if actual is not None else None,
                           'pass': actual is not None and abs(actual-target) <= 1})
        relative_checks = []
        if sample_flow:
            if not kind:
                raise ValueError('--sample-flow 必须同时指定 --kind')
            # 仅wp75-samples.mjs：两行中文名称；四类有两行英文；一致性标识一行。
            flow = blocks['name_block']
            has_english = kind in ('gb', 'guide', 'industry', 'group')
            if len(flow) < (5 if has_english else 3):
                raise ValueError('样稿名称流动块行数不足，不能按预定样稿测量')
            values = [('name_line_pitch', flow[1]['top']-flow[0]['top'], 12.9),
                      ('name_center', (flow[0]['left']+flow[0]['right'])/2, 110)]
            if has_english:
                values += [('english_gap', flow[2]['top']-flow[1]['bottom'], 10.5),
                           ('consistency_gap', flow[4]['top']-flow[3]['bottom'], 14.5),
                           ('english_line_pitch', flow[3]['top']-flow[2]['top'], 7.0)]
            else:
                values += [('consistency_gap', flow[2]['top']-flow[1]['bottom'], 14.5)]
            relative_checks = [{'element': key, 'target_mm': target, 'actual_mm': round(actual, 2),
                                'delta_mm': round(actual-target, 2), 'pass': abs(actual-target) <= 1}
                               for key, actual, target in values]
        return {'relative_checks': relative_checks, 'pdf': path, 'page_count': len(doc), 'method': '300dpi grayscale <128; pixel bounds in mm', 'blocks': blocks, 'checks': checks}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf')
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--kind', choices=['gb', 'guide', 'industry', 'local', 'group', 'enterprise'])
    parser.add_argument('--sample-flow', action='store_true', help='核对wp75-samples.mjs固定样稿的名称、英文和一致性间距')
    args = parser.parse_args()
    result = measure(args.pdf, args.kind, args.sample_flow)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        for c in result['checks']:
            print(f"{'PASS' if c['pass'] else 'FAIL'} {c['element']}.{c['edge']}: {c['actual_mm']} mm (目标 {c['target_mm']} ±1)")
        print(json.dumps(result['blocks'], ensure_ascii=False, indent=2))
        print(json.dumps(result['relative_checks'], ensure_ascii=False, indent=2))
    raise SystemExit(0 if all(c['pass'] for c in result['checks'] + result['relative_checks']) else 1)
