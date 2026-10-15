/**
 * 文档操作引擎测试用的 ProseMirror JSON 构造器与示例文档（只被测试引用）。
 *
 * `richDocument()` 是一篇较完整的文档：封面、前言、引言、范围/引用文件/术语章（含 TBX 术语）、
 * 技术要求章（多级条、列项、注、示例、表、图、公式、交叉引用）、规范性与资料性附录、参考文献，
 * 并刻意包含写作片段表达不了的内容（样式表格、带资源引用的图、含 MathML 的公式、脚注、TBX 语言集、结构化文献），
 * 用来检验 readNode 对「能否整体替换」的判定。
 */

import type { PMJsonNode } from '@ses/shared'

export const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export type Marks = NonNullable<PMJsonNode['marks']>

export const text = (value: string, marks?: Marks): PMJsonNode =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value }

export const node = (type: string, attrs?: Record<string, unknown>, content?: PMJsonNode[]): PMJsonNode => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content ? { content } : {}),
})

export const para = (nodeId: string, ...content: PMJsonNode[]): PMJsonNode =>
  node('stdParagraph', { nodeId }, content)

export const note = (nodeId: string, value: string): PMJsonNode => node('note', { nodeId }, [text(value)])
export const example = (nodeId: string, value: string): PMJsonNode => node('example', { nodeId }, [text(value)])

export const xref = (value: string, targetId: string, refType = 'clause'): PMJsonNode =>
  text(value, [{ type: 'crossRef', attrs: { targetId, refType } }])

export const chapter = (nodeId: string, title: string, ...children: PMJsonNode[]): PMJsonNode =>
  node('chapter', { nodeId, secType: title === '范围' ? 'scope' : title === '术语和定义' ? 'terms' : title === '规范性引用文件' ? 'norm-refs' : 'general' }, [
    node('chapterTitle', undefined, [text(title)]),
    ...children,
  ])

export const clause = (nodeId: string, level: number, title: string | null, ...children: PMJsonNode[]): PMJsonNode =>
  node('clause', { nodeId, level, hasTitle: title !== null }, [
    node('clauseTitle', { level }, title ? [text(title)] : []),
    ...children,
  ])

export const termDef = (
  nodeId: string, term: string, definition: string, ...tail: PMJsonNode[]
): PMJsonNode =>
  node('termDef', { nodeId, level: 1 }, [
    node('termName', undefined, [text(term)]),
    node('termDefinition', undefined, [text(definition)]),
    ...tail,
  ])

export const stdList = (nodeId: string, listType: string, ...items: [string, string][]): PMJsonNode =>
  node('stdList', { nodeId, listType, level: listType === 'numeric' || listType === 'dot' ? 2 : 1 },
    items.map(([itemId, value]) => node('stdListItem', { nodeId: itemId }, [text(value)])))

export function cell(
  kind: 'tableCell' | 'tableHeader', nodeId: string, value: string, attrs: Record<string, unknown> = {},
): PMJsonNode {
  return node(kind, { nodeId, colspan: 1, rowspan: 1, ...attrs }, [para(`${nodeId}-p`, text(value))])
}

export const row = (nodeId: string, ...cells: PMJsonNode[]): PMJsonNode => node('tableRow', { nodeId }, cells)

export function table(
  nodeId: string, caption: string, rows: PMJsonNode[],
  options: { captionEn?: string; attrs?: Record<string, unknown>; notes?: [string, string][] } = {},
): PMJsonNode {
  const content: PMJsonNode[] = [node('tableCaption', undefined, [text(caption)])]
  if (options.captionEn) content.push(node('tableCaptionEn', undefined, [text(options.captionEn)]))
  content.push(node('table', undefined, rows))
  if (options.notes) content.push(node('tableNoteRow', undefined, options.notes.map(([id, value]) => note(id, value))))
  return node('stdTable', { nodeId, orientation: 'portrait', headerRowCount: 1, ...options.attrs }, content)
}

export function simpleTable(nodeId: string, caption: string, options: Parameters<typeof table>[3] = {}): PMJsonNode {
  return table(nodeId, caption, [
    row(`${nodeId}-r1`, cell('tableHeader', `${nodeId}-r1c1`, '项目'), cell('tableHeader', `${nodeId}-r1c2`, '指标')),
    row(`${nodeId}-r2`, cell('tableCell', `${nodeId}-r2c1`, '精度'), cell('tableCell', `${nodeId}-r2c2`, '0.1')),
  ], options)
}

export function figure(nodeId: string, caption: string, imageAttrs: Record<string, unknown> = {}, extra: PMJsonNode[] = []): PMJsonNode {
  return node('figure', { nodeId, orientation: 'portrait' }, [
    node('figureImage', { src: PNG, alt: '示意', ...imageAttrs }),
    node('figureCaption', undefined, [text(caption)]),
    ...extra,
  ])
}

export function formula(
  nodeId: string, latex: string, options: { numbered?: boolean; where?: [string, string][]; attrs?: Record<string, unknown> } = {},
): PMJsonNode {
  const content: PMJsonNode[] = [node('formulaContent', undefined, [text(latex)])]
  if (options.where) {
    content.push(node('whereList', undefined, options.where.map(([id, term], position) =>
      node('whereItem', { nodeId: `${nodeId}-w${position}` }, [
        node('whereTerm', undefined, [text(id)]),
        node('whereDefinition', undefined, [text(term)]),
      ]))))
  }
  return node('formula', { nodeId, latex, numbered: options.numbered ?? true, ...options.attrs }, content)
}

export const appendix = (nodeId: string, normative: boolean, title: string, ...children: PMJsonNode[]): PMJsonNode =>
  node('appendix', { nodeId, normative }, [
    node('appendixLabel', undefined, [text(normative ? '（规范性）' : '（资料性）')]),
    node('appendixTitle', undefined, [text(title)]),
    ...children,
  ])

export const bibEntry = (nodeId: string, value: string, ...extra: PMJsonNode[]): PMJsonNode =>
  node('bibEntry', { nodeId }, [text(value), ...extra])

export const bibliography = (...entries: PMJsonNode[]): PMJsonNode =>
  node('bibliography', undefined, [node('bibliographyTitle', undefined, [text('参考文献')]), ...entries])

export const foreword = (...blocks: PMJsonNode[]): PMJsonNode => node('foreword', undefined, blocks)
export const introduction = (...blocks: PMJsonNode[]): PMJsonNode => node('introduction', undefined, blocks)
export const coverPage = (): PMJsonNode =>
  node('coverPage', { nodeId: 'cover', standardNo: 'GB/T 00000—0000', standardType: 'national', titleCn: '测试标准' },
    [node('paragraph')])

export const doc = (...content: PMJsonNode[]): PMJsonNode => node('doc', undefined, content)

/** 只含一章的最小文档。 */
export function smallDocument(): PMJsonNode {
  return doc(chapter('ch-1', '范围', para('p-1', text('本文件规定了……'))))
}

/**
 * 较完整的文档。可单独整体替换的节点与不可替换的节点见 roundTrip.test.ts 的断言。
 * 编号（Resolver）：第 1 章 范围，2 规范性引用文件，3 术语和定义（3.1~3.3），4 技术要求
 * （4.1 总体要求；4.2 详细要求 → 4.2.1 无题条、4.2.2 性能 → 表1、图1、公式(1)……），附录A、附录B，[1]~[3]。
 */
export function richDocument(): PMJsonNode {
  return doc(
    coverPage(),
    foreword(
      para('fw-p1', text('本文件按照 GB/T 1.1—2020 的规定起草。')),
      note('fw-note', '前言中的注。'),
    ),
    introduction(para('intro-p1', text('引言内容，见'), xref('4.1', 'cl-41'), text('。'))),
    chapter('ch-scope', '范围',
      para('scope-p1', text('本文件规定了……'), node('footnoteRef', { nodeId: 'fn-1', content: [text('脚注内容。')] }), text('。'))),
    chapter('ch-refs', '规范性引用文件', para('refs-p1', text('下列文件对于本文件的应用是必不可少的。'))),
    chapter('ch-terms', '术语和定义',
      para('terms-p0', text('下列术语和定义适用于本文件。')),
      termDef('term-1', '标准', '通过标准化活动制定的文件。',
        note('term-1-note', '术语的注。'),
        example('term-1-ex', '术语的示例。'),
        node('termSource', undefined, [text('GB/T 20000.1—2014，5.3')])),
      termDef('term-2', '编号', '为要素赋予序号。'),
      node('termDef', { nodeId: 'term-3', level: 1 }, [
        node('termName', undefined, [text('多语术语')]),
        node('termDefinition', undefined, [text('带 TBX 语言集的术语。')]),
        node('tbxLangSet', { nodeId: 'tbx-1', lang: 'en' }, [
          node('tbxTig', { nodeId: 'tig-1' }, [
            node('tbxTermVariant', { nodeId: 'var-1' }, [node('tbxTerm', undefined, [text('multilingual term')])]),
          ]),
        ]),
      ])),
    chapter('ch-4', '技术要求',
      clause('cl-41', 1, '总体要求',
        para('p-411', text('应满足'), xref('4.2', 'cl-42'), text('、'), xref('表1', 'tbl-1', 'table'), text('的要求。')),
        stdList('list-1', 'alpha', ['li-1', '第一项'], ['li-2', '第二项']),
        note('n-41a', '第一条注。'),
        note('n-41b', '第二条注。'),
        example('ex-41a', '第一个示例。'),
        example('ex-41b', '第二个示例。')),
      clause('cl-42', 1, '详细要求',
        clause('cl-421', 2, null, para('p-4211', text('无题条内容，见'), xref('图1', 'fig-1', 'figure'), text('、'), xref('(1)', 'f-1', 'formula'), text('。'))),
        clause('cl-422', 2, '性能',
          simpleTable('tbl-1', '性能指标', { captionEn: 'Performance', notes: [['tbl-1-n1', '表内的注。']] }),
          figure('fig-1', '系统架构图'),
          formula('f-1', 'E = mc^2', { where: [['E', '能量'], ['m', '质量']] }),
          para('p-4221', text('引用文献'), text('[1]', [{ type: 'bibRef', attrs: { targetId: 'bib-2' } }]), text('。')),
          // 以下节点含写作片段表达不了的内容
          table('tbl-styled', '带列宽的表', [
            row('ts-r1', cell('tableHeader', 'ts-r1c1', '项目', { colwidth: [120] }), cell('tableHeader', 'ts-r1c2', '值')),
            row('ts-r2', cell('tableCell', 'ts-r2c1', '甲', { colwidth: [120] }), cell('tableCell', 'ts-r2c2', '乙')),
          ]),
          figure('fig-res', '带资源引用的图', { resourceId: 'res-1', width: 120, widthUnit: 'px' }),
          formula('f-mathml', 'a+b', { attrs: { mathml: '<math><mi>a</mi><mo>+</mo><mi>b</mi></math>' } }),
          node('warning', { nodeId: 'warn-1' }, [para('warn-1-p', text('警告块。'))])))),
    appendix('app-a', true, '附加技术内容',
      clause('cl-a1', 1, '附录条', para('p-a11', text('附录正文。'))),
      clause('cl-a2', 1, '附录图表',
        figure('fig-a1', '附录图'),
        simpleTable('tbl-a1', '附录表'),
        formula('f-a1', 'x = y'))),
    appendix('app-b', false, '资料性附录', para('p-b1', text('资料性内容。'))),
    bibliography(
      bibEntry('bib-1', 'GB/T 20000.1—2014 标准化工作指南'),
      bibEntry('bib-2', 'ISO/IEC Directives, Part 2'),
      bibEntry('bib-3', '带结构化字段的文献', node('bibStructured', undefined, [
        node('bibIdentifier', { nodeId: 'bib-3-id', scheme: 'doi', value: '10.1000/1' }),
      ]))),
    node('figureResource', { nodeId: 'res-1', encoding: 'dataUrl', mediaType: 'image/png', name: 'a.png', data: PNG }),
  )
}

/** 递归冻结，用于证明引擎不修改入参（严格模式下写入冻结对象会抛 TypeError）。 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** 确定性 id 序列：g1、g2 …（测试里的显式 id 避免以 g 开头）。 */
export function seqIds(prefix = 'g'): () => string {
  let n = 0
  return () => `${prefix}${++n}`
}

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** 根节点类型序列，用于断言根节点顺序。 */
export const rootTypes = (pmDoc: PMJsonNode): string[] => (pmDoc.content ?? []).map(child => child.type)
