import { describe, expect, it } from 'vitest'
import { pmToIr, renderHtml, renderSemanticJson, resolve, type PMJsonNode } from '@ses/shared'
import { exportSemanticHtml, exportSemanticJson } from './semanticExport'

const text = (value: string): PMJsonNode => ({ type: 'text', text: value })
const paragraph = (nodeId: string, value: string): PMJsonNode => ({
  type: 'stdParagraph',
  attrs: { nodeId },
  content: [text(value)],
})

/** 节点都带稳定 ID 的文档：章 + 条 + 附录。 */
function identifiedDoc(): PMJsonNode {
  return {
    type: 'doc',
    content: [
      {
        type: 'chapter',
        attrs: { nodeId: 'c1' },
        content: [
          { type: 'chapterTitle', content: [text('范围 & <A>')] },
          {
            type: 'clause',
            attrs: { nodeId: 'cl1', level: 1, hasTitle: true },
            content: [{ type: 'clauseTitle', attrs: { level: 1 }, content: [text('总则')] }, paragraph('p1', '正文')],
          },
        ],
      },
      {
        type: 'appendix',
        attrs: { nodeId: 'a1', normative: false },
        content: [
          { type: 'appendixLabel', content: [text('（资料性）')] },
          { type: 'appendixTitle', content: [text('说明')] },
          paragraph('p2', '附录正文'),
        ],
      },
    ],
  }
}

/** 旧版文档：章/条/附录没有 nodeId（早期保存的内容），编号靠 Resolver 临时 ID。 */
function legacyDoc(): PMJsonNode {
  return {
    type: 'doc',
    content: [
      {
        type: 'chapter',
        content: [
          { type: 'chapterTitle', content: [text('范围')] },
          {
            type: 'clause',
            attrs: { level: 1 },
            content: [{ type: 'clauseTitle', attrs: { level: 1 }, content: [text('总则')] }],
          },
        ],
      },
      { type: 'chapter', content: [{ type: 'chapterTitle', content: [text('规范性引用文件')] }] },
      {
        type: 'appendix',
        content: [
          { type: 'appendixLabel', content: [text('（资料性）')] },
          { type: 'appendixTitle', content: [text('说明')] },
        ],
      },
    ],
  }
}

describe('exportSemanticHtml', () => {
  it('输出 screen 变体，与 pmToIr → resolve → renderHtml 的直接结果相同', () => {
    const doc = identifiedDoc()
    const { doc: ir } = pmToIr(doc)
    const expected = renderHtml(ir, resolve(ir).labels, { variant: 'screen' })

    const html = exportSemanticHtml(doc)
    expect(html).toBe(expected)
    expect(html).toContain('data-variant="screen"')
    expect(html).toContain('范围 &amp; &lt;A&gt;')
  })

  it('不修改入参', () => {
    const doc = identifiedDoc()
    const snapshot = JSON.parse(JSON.stringify(doc)) as PMJsonNode
    exportSemanticHtml(doc)
    expect(doc).toEqual(snapshot)
  })
})

describe('exportSemanticJson', () => {
  it('节点都有 ID 时，等同于用 Resolver 标签直接渲染语义 JSON', () => {
    const doc = identifiedDoc()
    const { doc: ir } = pmToIr(doc)
    const expected = renderSemanticJson(doc, resolve(ir).labels, { labelsByPath: {} })

    expect(exportSemanticJson(doc)).toEqual(expected)
    expect(JSON.stringify(exportSemanticJson(doc))).not.toContain('__ses_json_export__')
  })

  it('缺 nodeId 的旧版章/条/附录仍得到 Resolver 编号，临时 ID 不外泄，入参不被修改', () => {
    const doc = legacyDoc()
    const snapshot = JSON.parse(JSON.stringify(doc)) as PMJsonNode
    const json = exportSemanticJson(doc)

    expect(doc).toEqual(snapshot)
    expect(JSON.stringify(json)).not.toContain('__ses_json_export__')
    const [scope, refs, appendix] = json.content ?? []
    expect(scope).toMatchObject({ type: 'chapter', number: '1' })
    expect(scope?.content?.find((node) => node.type === 'clause')).toMatchObject({ number: '1.1' })
    expect(refs).toMatchObject({ type: 'chapter', number: '2' })
    expect(appendix).toMatchObject({ type: 'appendix', number: 'A' })
  })

  it('序列化结果是确定的：同一文档重复导出逐字节相同', () => {
    const first = JSON.stringify(exportSemanticJson(legacyDoc()), null, 2)
    expect(JSON.stringify(exportSemanticJson(legacyDoc()), null, 2)).toBe(first)
  })
})
