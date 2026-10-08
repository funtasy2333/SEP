/**
 * WP3 测试 fixture：手工构造的 ProseMirror JSON（纯对象）。
 * fullFixture 为「全要素文档」，每种节点至少出现一次，后续 WP 复用。
 */

import type { PMJsonNode } from '../pmToIr'

// 有效的小型 PNG data URI（120×60 纯色），供图版式核对，避免 PDF 破图占位。
export const FIG_PNG_BLUE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAAa0lEQVR42u3QQQ0AAAgEoOsfzwRmMIEtnA82EpDq4UAUiBaNaNGiLYgWjWjRoi2IFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLRrRokUjWjSiRYtGtGhEixaNaNGiES0a0b8s0ipI1zvfEP8AAAAASUVORK5CYII='
export const FIG_PNG_GREEN =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAAa0lEQVR42u3QMQ0AAAgDsPkXyYECJOCCcDSpgqanOBAFokUjWrRoC6JFI1q0aAuiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItG9C8L4K2aZtr7WR4AAAAASUVORK5CYII='

// ---------- 构造器 ----------

export function text(t: string, marks?: PMJsonNode['marks']): PMJsonNode {
  return marks ? { type: 'text', text: t, marks } : { type: 'text', text: t }
}

export function xref(t: string, refId: string): PMJsonNode {
  return text(t, [{ type: 'crossRef', attrs: { refId, refType: 'clause' } }])
}

export function para(nodeId: string, ...content: PMJsonNode[]): PMJsonNode {
  return { type: 'stdParagraph', attrs: { nodeId }, content }
}

export function note(nodeId: string, t: string): PMJsonNode {
  return { type: 'note', attrs: { nodeId }, content: [text(t)] }
}

export function example(nodeId: string, t: string): PMJsonNode {
  return { type: 'example', attrs: { nodeId }, content: [text(t)] }
}

export function chapter(nodeId: string, title: string, ...children: PMJsonNode[]): PMJsonNode {
  return {
    type: 'chapter',
    attrs: { nodeId },
    content: [{ type: 'chapterTitle', content: title ? [text(title)] : [] }, ...children],
  }
}

export function clause(
  nodeId: string,
  level: number,
  title: string | null,
  ...children: PMJsonNode[]
): PMJsonNode {
  return {
    type: 'clause',
    attrs: { nodeId, level, hasTitle: title !== null },
    content: [
      { type: 'clauseTitle', attrs: { level }, content: title ? [text(title)] : [] },
      ...children,
    ],
  }
}

export function termDef(
  nodeId: string,
  termCn: string,
  opts: { termEn?: string; definition?: string; extra?: PMJsonNode[] } = {},
): PMJsonNode {
  const content: PMJsonNode[] = [
    { type: 'termName', content: [text(termCn)] },
  ]
  if (opts.termEn !== undefined) {
    content.push({ type: 'termNameEn', content: opts.termEn ? [text(opts.termEn)] : [] })
  }
  content.push({
    type: 'termDefinition',
    content: opts.definition ? [text(opts.definition)] : [],
  })
  if (opts.extra) content.push(...opts.extra)
  return { type: 'termDef', attrs: { nodeId, level: 1 }, content }
}

export function stdList(nodeId: string, listType: string, ...items: [string, string][]): PMJsonNode {
  return {
    type: 'stdList',
    attrs: { nodeId, listType, level: 1 },
    content: items.map(([itemId, t]) => ({
      type: 'stdListItem',
      attrs: { nodeId: itemId },
      content: [text(t)],
    })),
  }
}

export function tableCell(kind: 'tableCell' | 'tableHeader', t: string, attrs: Record<string, unknown> = {}): PMJsonNode {
  return {
    type: kind,
    attrs: { colspan: 1, rowspan: 1, ...attrs },
    content: [{ type: 'paragraph', content: t ? [text(t)] : [] }],
  }
}

export function stdTable(
  nodeId: string,
  caption: string,
  rows: PMJsonNode[],
  opts: { captionEn?: string; footnote?: string; orientation?: 'portrait' | 'landscape' } = {},
): PMJsonNode {
  const content: PMJsonNode[] = [
    { type: 'tableCaption', content: caption ? [text(caption)] : [] },
  ]
  if (opts.captionEn) content.push({ type: 'tableCaptionEn', content: [text(opts.captionEn)] })
  content.push({ type: 'table', content: rows })
  if (opts.footnote) content.push({ type: 'tableFootnote', content: [text(opts.footnote)] })
  const attrs: Record<string, unknown> = { nodeId }
  if (opts.orientation) attrs.orientation = opts.orientation
  return { type: 'stdTable', attrs, content }
}

export function tableRow(...cells: PMJsonNode[]): PMJsonNode {
  return { type: 'tableRow', content: cells }
}

export function figure(nodeId: string, src: string, caption: string, captionEn?: string): PMJsonNode {
  const content: PMJsonNode[] = [
    { type: 'figureImage', attrs: { src } },
    { type: 'figureCaption', content: caption ? [text(caption)] : [] },
  ]
  if (captionEn) content.push({ type: 'figureCaptionEn', content: [text(captionEn)] })
  return { type: 'figure', attrs: { nodeId }, content }
}

export function formula(nodeId: string, latex: string, description?: string): PMJsonNode {
  const content: PMJsonNode[] = [
    { type: 'formulaContent', content: [text(latex)] },
  ]
  if (description !== undefined) {
    content.push({ type: 'formulaDescription', content: [text(description)] })
  }
  return { type: 'formula', attrs: { nodeId }, content }
}

export function appendix(
  nodeId: string,
  normative: boolean,
  title: string,
  ...children: PMJsonNode[]
): PMJsonNode {
  return {
    type: 'appendix',
    attrs: { nodeId, normative },
    content: [
      { type: 'appendixLabel', content: [text(normative ? '（规范性）' : '（资料性）')] },
      { type: 'appendixTitle', content: [text(title)] },
      ...children,
    ],
  }
}

export function bibliography(...entries: [string, string][]): PMJsonNode {
  return {
    type: 'bibliography',
    content: [
      { type: 'bibliographyTitle', content: [text('参考文献')] },
      ...entries.map(([nodeId, t]) => ({
        type: 'bibEntry',
        attrs: { nodeId },
        content: [text(t)],
      })),
    ],
  }
}

export function standardDoc(
  attrs: Record<string, unknown>,
  ...content: PMJsonNode[]
): PMJsonNode {
  return { type: 'standardDoc', attrs, content }
}

// ---------- 全要素文档 ----------

/** 每种节点至少出现一次的全要素 fixture，编号规则与 problems 之外的后续 WP 复用 */
export function fullFixture(): PMJsonNode {
  return standardDoc(
    {
      standardNo: 'GB/T 12345—2026',
      icsCode: '35.240',
      ccsCode: 'L 70',
      titleCn: '标准化文件编辑系统',
      titleEn: 'Standardization document editing system',
      publishDate: '2026-06-01',
      implementDate: '2026-12-01',
      standardType: 'national',
    },
    {
      type: 'coverPage',
      attrs: { issuer: '国家市场监督管理总局', nodeId: 'cover' },
      content: [{ type: 'paragraph', attrs: { nodeId: 'cover-p' }, content: [text('封面')] }],
    },
    { type: 'foreword', attrs: { nodeId: 'fw' }, content: [
      para('fw-p1', text('本文件按照GB/T 1.1—2020的规定起草。')),
      note('fw-note', '前言中的注。'),
    ] },
    { type: 'introduction', attrs: { nodeId: 'intro' }, content: [
      para('intro-p1', text('引言内容。')),
    ] },
    chapter('ch-scope', '范围', para('scope-p1', text('本文件规定了……'))),
    chapter('ch-refs', '规范性引用文件', para('refs-p1', text('GB/T 1.1—2020'))),
    chapter(
      'ch-terms',
      '术语和定义',
      para('terms-p0', text('下列术语和定义适用于本文件。')),
      termDef('term-1', '标准', {
        termEn: 'standard',
        definition: '通过标准化活动制定的文件。',
        extra: [
          note('term-1-note', '术语注。'),
          example('term-1-ex', '术语示例。'),
          para('term-1-src', text('[来源：GB/T 20000.1—2014，5.3]')),
        ],
      }),
      termDef('term-2', '编号', { termEn: 'numbering', definition: '为要素赋予序号。' }),
    ),
    chapter(
      'ch-4',
      '技术要求',
      clause(
        'cl-41',
        1,
        '总体要求',
        para('p-411', text('应满足'), xref('4.2', 'cl-42'), text('与'), xref('表1', 'tbl-1'), text('的要求。')),
        stdList('list-1', 'alpha', ['li-1', '第一项'], ['li-2', '第二项']),
        note('n-41a', '第一条注。'),
        note('n-41b', '第二条注。'),
        example('ex-41a', '第一个示例。'),
        example('ex-41b', '第二个示例。'),
      ),
      clause(
        'cl-42',
        1,
        '详细要求',
        clause(
          'cl-421',
          2,
          null,
          para('p-4211', text('无题条内容，见'), xref('图1', 'fig-1'), text('、'), xref('公式(1)', 'f-1'), text('。')),
        ),
        clause(
          'cl-422',
          2,
          '性能',
          stdTable(
            'tbl-1',
            '性能指标',
            [
              tableRow(tableCell('tableHeader', '项目'), tableCell('tableHeader', '指标')),
              // 首列行表头：tableHeader 出现在非前导数据行，验证 body 行内 <th> 语义保留
              tableRow(tableCell('tableHeader', '精度'), tableCell('tableCell', '0.1')),
            ],
            { captionEn: 'Performance', footnote: '表内的注。' },
          ),
          figure('fig-1', FIG_PNG_BLUE, '系统架构图', 'System architecture'),
          formula('f-1', 'E = mc^2', '式中：E——能量，单位为焦耳（J）；m——质量；c——光速。'),
          para('p-4221', text('引用文献'), xref('[1]', 'bib-2'), text('。')),
        ),
      ),
    ),
    appendix(
      'app-a',
      true,
      '附加技术内容',
      clause('cl-a1', 1, '附录条', para('p-a11', text('附录正文。'))),
      clause(
        'cl-a2',
        1,
        '附录图表',
        figure('fig-a1', FIG_PNG_GREEN, '附录图'),
        stdTable('tbl-a1', '附录表', [
          tableRow(tableCell('tableHeader', '列')),
          tableRow(tableCell('tableCell', '值')),
        ]),
        formula('f-a1', 'x = y'),
      ),
    ),
    appendix('app-b', false, '资料性附录', para('p-b1', text('资料性内容。'))),
    bibliography(['bib-1', 'GB/T 20000.1—2014 标准化工作指南'], ['bib-2', 'ISO/IEC Directives, Part 2']),
  )
}

// ---------- 横排宽表 fixture（F12：核对横排页书眉/页码居中、A4 横向）----------

/**
 * 含一个超宽横排表的最小文档（WP4-fix F12）。列数足够触发横排（orientation: 'landscape'），
 * 用于经真实管线（pmToIr → resolve → renderHtml(print) → 两遍 vivliostyle）重渲染后，
 * 逐图核对横排页：A4 横向、书眉/页码居中。含前言与目次以便一并复核前置页。
 */
export function landscapeFixture(): PMJsonNode {
  const cols = ['项目', '参数A', '参数B', '参数C', '参数D', '参数E', '参数F', '参数G', '参数H']
  const headerRow = tableRow(...cols.map((c) => tableCell('tableHeader', c)))
  const dataRow = (i: number) =>
    tableRow(
      tableCell('tableHeader', `行${i}`),
      ...cols.slice(1).map((_, j) => tableCell('tableCell', `${i}-${j + 1}`)),
    )
  return standardDoc(
    {
      standardNo: 'GB/T 12345—2026',
      icsCode: '35.240',
      ccsCode: 'L 70',
      titleCn: '标准化文件编辑系统',
      titleEn: 'Standardization document editing system',
      standardType: 'national',
    },
    { type: 'foreword', attrs: { nodeId: 'lfw' }, content: [
      para('lfw-p1', text('本文件按照GB/T 1.1—2020的规定起草。')),
    ] },
    chapter('lch-1', '范围', para('lscope', text('本文件规定了横排宽表的版式核对内容。'))),
    chapter(
      'lch-2',
      '宽表',
      stdTable(
        'ltbl-1',
        '超宽性能指标',
        [headerRow, dataRow(1), dataRow(2), dataRow(3)],
        { orientation: 'landscape' },
      ),
    ),
  )
}
