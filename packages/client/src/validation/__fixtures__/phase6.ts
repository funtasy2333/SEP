import type { PMJsonNode } from '@ses/shared'

export const text = (value: string, marks?: PMJsonNode['marks']): PMJsonNode => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
export const paragraph = (id: string, ...content: PMJsonNode[]): PMJsonNode => ({ type: 'stdParagraph', attrs: { nodeId: id }, content })
export const chapter = (id: string, title: string, secType: string, ...children: PMJsonNode[]): PMJsonNode => ({
  type: 'chapter', attrs: { nodeId: id, secType }, content: [{ type: 'chapterTitle', content: [text(title)] }, ...children],
})
export const clause = (id: string, ...children: PMJsonNode[]): PMJsonNode => ({
  type: 'clause', attrs: { nodeId: id, level: 1, hasTitle: true }, content: [{ type: 'clauseTitle', content: [text('要求')] }, ...children],
})

/** Deterministic production-PM fixture: no external resources, real editable standard elements. */
export function phase6Fixture(): PMJsonNode {
  return {
    type: 'doc', content: [
      chapter('scope', '范围', 'scope', paragraph('scope-p', text('本文件规定了检验要求。'))),
      chapter('norms', '规范性引用文件', 'norm-refs', paragraph('norms-p', text('本文件没有规范性引用文件。'))),
      chapter('terms', '术语和定义', 'terms',
        paragraph('terms-lead', text('下列术语和定义适用于本文件。')),
        { type: 'termDef', attrs: { nodeId: 'term-valve', level: 1 }, content: [
          { type: 'termName', content: [text('阀门')] },
          { type: 'termDefinition', content: [text('控制流体通断的装置。')] },
        ] }),
      chapter('requirements', '要求', 'general',
        paragraph('objects-lead', text('阀门的结构见图1，参数见表1。阀门应按附录A检验。')),
        { type: 'figure', attrs: { nodeId: 'figure-one' }, content: [
          { type: 'figureImage', attrs: { src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4=' } },
          { type: 'figureCaption', content: [text('结构示意')] },
        ] },
        { type: 'stdTable', attrs: { nodeId: 'table-one' }, content: [
          { type: 'tableCaption', content: [text('检验参数')] },
          { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph', content: [text('合格')] }] }] }] },
        ] },
        paragraph('list-lead', text('检验包括下列项目：')),
        { type: 'stdList', attrs: { nodeId: 'list-one', listType: 'dash', level: 1 }, content: [
          { type: 'stdListItem', attrs: { nodeId: 'list-item-one' }, content: [text('外观检查；')] },
          { type: 'stdListItem', attrs: { nodeId: 'list-item-two' }, content: [text('性能检查。')] },
        ] }),
      { type: 'appendix', attrs: { nodeId: 'appendix-a', normative: false }, content: [
        { type: 'appendixLabel', content: [text('（资料性）')] },
        { type: 'appendixTitle', content: [text('检验示例')] },
        paragraph('appendix-text', text('本附录提供检验记录样例。')),
      ] },
    ],
  }
}
