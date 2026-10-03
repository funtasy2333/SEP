// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { pmToIr, renderHtml, resolve, type PMJsonNode } from '@ses/shared'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { buildDocxBlob } from './docxExporter'
import { parseXmlToEditorJson } from './xmlParser'
import { serializeToXml } from './xmlSerializer'

function bodyFootnoteDoc(content: unknown) {
  const schema = getSchema(createEditorExtensions())
  const pmDoc = schema.nodeFromJSON({
    type: 'doc',
    content: [{
      type: 'chapter',
      attrs: { nodeId: 'chapter-1' },
      content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
        {
          type: 'stdParagraph',
          content: [
            { type: 'text', text: '正文' },
            { type: 'footnoteRef', attrs: { nodeId: 'fn-1', content } },
          ],
        },
      ],
    }],
  })
  pmDoc.check()
  return { schema, pmDoc }
}

describe('正文脚注内容的导出边界', () => {
  it('含未支持块结构的已保存脚注不能在 XML、HTML 或 DOCX 导出时静默截断', async () => {
    const schema = getSchema(createEditorExtensions())
    const pmDoc = schema.nodeFromJSON({
      type: 'doc',
      content: [{
        type: 'chapter',
        attrs: { nodeId: 'chapter-1' },
        content: [
          { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
          {
            type: 'stdParagraph',
            content: [
              { type: 'text', text: '正文' },
              { type: 'footnoteRef', attrs: { nodeId: 'fn-1', content: [
                { type: 'text', text: '可保留的行内内容' },
                { type: 'paragraph', content: [{ type: 'text', text: '不能丢失的块内容' }] },
              ] } },
            ],
          },
        ],
      }],
    })
    pmDoc.check()

    const { doc } = pmToIr(pmDoc.toJSON() as PMJsonNode)
    const { labels } = resolve(doc)
    expect(() => serializeToXml(pmDoc)).toThrow(/脚注校验未通过/)
    expect(() => renderHtml(doc, labels, { variant: 'print' })).toThrow(/脚注关联无效/)
    await expect(buildDocxBlob({ pmDoc, createdAt: '2026-10-03T00:00:00Z' }))
      .rejects.toThrow(/脚注关联无效/)
  })

  it('表脚注中的 IR 不支持格式会阻断全部导出路径', async () => {
    const schema = getSchema(createEditorExtensions())
    const pmDoc = schema.nodeFromJSON({
      type: 'doc',
      content: [{
        type: 'chapter',
        attrs: { nodeId: 'chapter-1' },
        content: [
          { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
          {
            type: 'stdTable',
            attrs: { nodeId: 'table-1' },
            content: [
              { type: 'tableCaption', content: [{ type: 'text', text: '表' }] },
              { type: 'table', content: [{ type: 'tableRow', content: [{
                type: 'tableCell',
                content: [{ type: 'paragraph', content: [{ type: 'tableFootnoteRef', attrs: { targetId: 'tfn-1' } }] }],
              }] }] },
              { type: 'tableFootnoteRow', content: [{
                type: 'tableFootnoteEntry',
                attrs: { nodeId: 'tfn-1' },
                content: [{ type: 'text', text: '表脚注内容', marks: [{ type: 'strike' }] }],
              }] },
            ],
          },
        ],
      }],
    })
    pmDoc.check()

    const { doc } = pmToIr(pmDoc.toJSON() as PMJsonNode)
    const { labels } = resolve(doc)
    expect(resolve(doc).problems.some(problem => problem.message.includes('格式「strike」'))).toBe(true)
    expect(() => serializeToXml(pmDoc)).toThrow(/格式「strike」/)
    expect(() => renderHtml(doc, labels, { variant: 'print' })).toThrow(/格式「strike」/)
    await expect(buildDocxBlob({ pmDoc, createdAt: '2026-10-03T00:00:00Z' }))
      .rejects.toThrow(/格式「strike」/)
  })

  it.each([
    ['非数组内容', '不是数组'],
    ['null 和 primitive 条目', [null, 7, '坏值']],
    ['非字符串脚注文本', [{ type: 'text', text: 7 }]],
    ['缺少脚注文本属性', [{ type: 'text' }]],
    ['缺少节点类型', [{}]],
    ['格式列表里的 null', [{ type: 'text', text: '文字', marks: [null] }]],
    ['行内图像、未知 attrs 和换行', [
      { type: 'text', text: '保留文字' },
      { type: 'image', attrs: { src: 'data:image/png;base64,AA==', futureAttr: '保留限制' } },
      { type: 'hardBreak' },
    ]],
    ['嵌入的表脚注引用', [{ type: 'tableFootnoteRef', attrs: { targetId: 'table-fn-1' } }]],
  ])('%s 可识别为脚注错误，不抛 TypeError', (scenario, content) => {
    const { pmDoc } = bodyFootnoteDoc(content)
    expect(() => pmToIr(pmDoc.toJSON() as PMJsonNode)).not.toThrow()
    const { doc } = pmToIr(pmDoc.toJSON() as PMJsonNode)
    const problems = resolve(doc).problems
    expect(problems.some(problem =>
      ['invalid-footnote', 'dangling-footnote'].includes(problem.code),
    )).toBe(true)
    if (scenario === '嵌入的表脚注引用') {
      expect(problems.some(problem => problem.code === 'invalid-footnote')).toBe(true)
    }
    if (['非字符串脚注文本', '缺少脚注文本属性'].includes(scenario)) {
      expect(problems.some(problem =>
        problem.code === 'invalid-footnote' && problem.message.includes('无效的文本内容'),
      )).toBe(true)
    }
    if (scenario === '缺少节点类型') {
      expect(problems.some(problem =>
        problem.code === 'invalid-footnote' && problem.message.includes('无效的行内节点'),
      )).toBe(true)
    }
    expect(() => serializeToXml(pmDoc)).toThrow(/脚注校验未通过/)
  })

  it.each(['strong', 'em'])('%s 别名不属于脚注导出的规范格式，阻断所有导出', async markType => {
    const { pmDoc } = bodyFootnoteDoc([
      { type: 'text', text: '别名格式', marks: [{ type: markType }] },
    ])
    const { doc } = pmToIr(pmDoc.toJSON() as PMJsonNode)
    const { labels, problems } = resolve(doc)
    expect(problems.some(problem =>
      problem.code === 'invalid-footnote' && problem.message.includes(`格式「${markType}」`),
    )).toBe(true)
    expect(() => serializeToXml(pmDoc)).toThrow(/脚注校验未通过/)
    expect(() => renderHtml(doc, labels, { variant: 'print' })).toThrow(/脚注关联无效/)
    await expect(buildDocxBlob({ pmDoc, createdAt: '2026-10-03T00:00:00Z' }))
      .rejects.toThrow(/脚注关联无效/)
  })

  it('粗体、斜体、上下标、换行和交叉引用在 XML 脚注中保留', () => {
    const { schema, pmDoc } = bodyFootnoteDoc([
      { type: 'text', text: '粗体', marks: [{ type: 'bold' }] },
      { type: 'text', text: '斜体', marks: [{ type: 'italic' }] },
      { type: 'text', text: '下标', marks: [{ type: 'subscript' }] },
      { type: 'text', text: '上标', marks: [{ type: 'superscript' }] },
      { type: 'hardBreak' },
      { type: 'text', text: '引用', marks: [{ type: 'crossRef', attrs: {
        refId: 'chapter-1', refType: 'chapter', futureAttr: '保留为来源信息',
      } }] },
    ])

    const xml = serializeToXml(pmDoc)
    expect(xml).toContain('<bold>粗体</bold>')
    expect(xml).toContain('<italic>斜体</italic>')
    expect(xml).toContain('<sub>下标</sub>')
    expect(xml).toContain('<sup>上标</sup>')
    expect(xml).toContain('<break />')
    expect(xml).toContain('<xref ref-type="chapter" rid="chapter-1">引用</xref>')

    const reopened = schema.nodeFromJSON(parseXmlToEditorJson(xml, schema.topNodeType.name))
    reopened.check()
    let footnoteContent: PMJsonNode[] = []
    reopened.descendants(node => {
      if (node.type.name === 'footnoteRef' && Array.isArray(node.attrs.content)) {
        footnoteContent = node.attrs.content as PMJsonNode[]
      }
    })
    expect(footnoteContent.some(node =>
      node.type === 'text' && node.text === '引用'
      && node.marks?.some(mark => mark.type === 'crossRef' && mark.attrs?.refId === 'chapter-1'),
    )).toBe(true)
    const { doc } = pmToIr(reopened.toJSON() as PMJsonNode)
    expect(resolve(doc).problems.filter(problem =>
      ['invalid-footnote', 'dangling-footnote', 'unreferenced-footnote'].includes(problem.code),
    )).toEqual([])
  })
})
