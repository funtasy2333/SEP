// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { buildXml46687Package, importXml46687 } from '@ses/io'
import { pmToIr, renderHtml, resolve, type PMJsonNode } from '@ses/shared'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { buildDocxBlob } from './docxExporter'

async function expectXmlFootnoteBlocked(pmDoc: PMNode, messagePattern: RegExp) {
  const result = await buildXml46687Package({ pmDoc: pmDoc.toJSON() as PMJsonNode })
  expect(result.xml).toBeNull()
  const errors = result.problems.filter(problem => problem.severity === 'error')
  expect(errors.some(problem => messagePattern.test(problem.message))).toBe(true)
}

function bodyFootnoteDoc(content: unknown, referenceMarks?: PMJsonNode['marks']) {
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
            { type: 'footnoteRef', attrs: { nodeId: 'fn-1', content }, ...(referenceMarks ? { marks: referenceMarks } : {}) },
          ],
        },
      ],
    }],
  })
  pmDoc.check()
  return { schema, pmDoc }
}

function tableFootnoteDoc(referenceMarks?: PMJsonNode['marks']) {
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
              attrs: { colspan: 1, rowspan: 1 },
              content: [{ type: 'paragraph', content: [
                { type: 'tableFootnoteRef', attrs: { nodeId: 'table-call-1', targetId: 'table-fn-1' }, ...(referenceMarks ? { marks: referenceMarks } : {}) },
              ] }],
            }] }] },
            { type: 'tableFootnoteRow', content: [{
              type: 'tableFootnoteEntry',
              attrs: { nodeId: 'table-fn-1' },
              content: [{ type: 'text', text: '表脚注内容' }],
            }] },
          ],
        },
      ],
    }],
  })
  pmDoc.check()
  return { schema, pmDoc }
}

describe('正文脚注内容的导出边界', () => {
  it.each([
    ['正文脚注引用', () => bodyFootnoteDoc([{ type: 'text', text: '保留的脚注内容' }], [{ type: 'bold' }])],
    ['表脚注上标', () => tableFootnoteDoc([{ type: 'bold' }])],
  ])('%s atom 自身带 mark 时阻断所有导出且不改源 JSON', async (_scenario, createDoc) => {
    const { pmDoc } = createDoc()
    const sourceBefore = JSON.parse(JSON.stringify(pmDoc.toJSON()))
    const { doc } = pmToIr(pmDoc.toJSON() as PMJsonNode)
    const { labels, problems } = resolve(doc)
    expect(problems.some(problem =>
      problem.code === 'invalid-footnote' && problem.message.includes('上标格式标记（请先取消上标的附加格式）'),
    )).toBe(true)
    await expectXmlFootnoteBlocked(pmDoc, /上标格式标记（请先取消上标的附加格式）/)
    expect(() => renderHtml(doc, labels, { variant: 'print' })).toThrow(/脚注关联无效/)
    await expect(buildDocxBlob({ pmDoc, createdAt: '2026-10-03T00:00:00Z' }))
      .rejects.toThrow(/脚注关联无效/)
    expect(pmDoc.toJSON()).toEqual(sourceBefore)
  })

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
    await expectXmlFootnoteBlocked(pmDoc, /脚注关联无效/)
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
    await expectXmlFootnoteBlocked(pmDoc, /格式「strike」/)
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
  ])('%s 可识别为脚注错误，不抛 TypeError', async (scenario, content) => {
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
    await expectXmlFootnoteBlocked(pmDoc, /脚注/)
  })

  it.each([
    ['text.content', [{ type: 'text', text: '可见', content: [{ type: 'text', text: '丢失子内容' }] }]],
    ['text.attrs.content', [{ type: 'text', text: '可见', attrs: { content: [{ type: 'text', text: '丢失属性内容' }] } }]],
    ['hardBreak.marks', [{ type: 'text', text: '可见' }, { type: 'hardBreak', marks: [{ type: 'bold' }] }, { type: 'text', text: '下一行' }]],
    ['hardBreak.content', [{ type: 'text', text: '可见' }, { type: 'hardBreak', content: [{ type: 'text', text: '丢失子内容' }] }]],
    ['hardBreak.text', [{ type: 'text', text: '可见' }, { type: 'hardBreak', text: '丢失文本' }]],
    ['hardBreak.attrs.content', [{ type: 'text', text: '可见' }, { type: 'hardBreak', attrs: { content: [{ type: 'text', text: '丢失属性内容' }] } }]],
    ['bold.content', [{ type: 'text', text: '可见', marks: [{ type: 'bold', content: [{ type: 'text', text: '丢失标记内容' }] }] }]],
    ['bold.attrs.content', [{ type: 'text', text: '可见', marks: [{ type: 'bold', attrs: { content: [{ type: 'text', text: '丢失标记内容' }] } }] }]],
    ['bold.attrs.text', [{ type: 'text', text: '可见', marks: [{ type: 'bold', attrs: { text: '丢失标记文本' } }] }]],
    ['bold.attrs.object', [{ type: 'text', text: '可见', marks: [{ type: 'bold', attrs: { futureAttr: { content: [{ type: 'text', text: '丢失未知属性内容' }] } } }] }]],
    ['crossRef.attrs.content', [{ type: 'text', text: '引用', marks: [{ type: 'crossRef', attrs: { refId: 'chapter-1', refType: 'chapter', content: [{ type: 'text', text: '丢失引用内容' }] } }] }]],
    ['crossRef.attrs.text', [{ type: 'text', text: '引用', marks: [{ type: 'crossRef', attrs: { refId: 'chapter-1', refType: 'chapter', text: '丢失引用文本' } }] }]],
    ['crossRef.refType', [{ type: 'text', text: '引用', marks: [{ type: 'crossRef', attrs: { refId: 'chapter-1', refType: 7 } }] }]],
    ['crossRef.refTypeNull', [{ type: 'text', text: '引用', marks: [{ type: 'crossRef', attrs: { refId: 'chapter-1', refType: null } }] }]],
    ['crossRef.refText', [{ type: 'text', text: '引用', marks: [{ type: 'crossRef', attrs: { refId: 'chapter-1', refType: 'chapter', refText: 7 } }] }]],
  ])('%s 等未支持的嵌套内容统一阻断导出且保留源 JSON', async (_shape, content) => {
    const { pmDoc } = bodyFootnoteDoc(content)
    const sourceBefore = JSON.parse(JSON.stringify(pmDoc.toJSON()))
    const { doc } = pmToIr(pmDoc.toJSON() as PMJsonNode)
    const { labels, problems } = resolve(doc)
    expect(problems.some(problem => problem.code === 'invalid-footnote')).toBe(true)
    await expectXmlFootnoteBlocked(pmDoc, /脚注关联无效/)
    expect(() => renderHtml(doc, labels, { variant: 'print' })).toThrow(/脚注关联无效/)
    await expect(buildDocxBlob({ pmDoc, createdAt: '2026-10-03T00:00:00Z' }))
      .rejects.toThrow(/脚注关联无效/)
    expect(pmDoc.toJSON()).toEqual(sourceBefore)
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
    await expectXmlFootnoteBlocked(pmDoc, /脚注关联无效/)
    expect(() => renderHtml(doc, labels, { variant: 'print' })).toThrow(/脚注关联无效/)
    await expect(buildDocxBlob({ pmDoc, createdAt: '2026-10-03T00:00:00Z' }))
      .rejects.toThrow(/脚注关联无效/)
  })

  it('粗体、斜体、下划线、上下标、换行和交叉引用在各导出路径中保留', async () => {
    const { schema, pmDoc } = bodyFootnoteDoc([
      { type: 'text', text: '粗体', marks: [{ type: 'bold' }] },
      { type: 'text', text: '斜体', marks: [{ type: 'italic' }] },
      { type: 'text', text: '下划线', marks: [{ type: 'underline' }] },
      { type: 'text', text: '下标', marks: [{ type: 'subscript' }] },
      { type: 'text', text: '上标', marks: [{ type: 'superscript' }] },
      { type: 'hardBreak' },
      { type: 'text', text: '引用', marks: [{ type: 'crossRef', attrs: {
        refId: 'chapter-1', refType: 'chapter', refText: '引用', futureAttr: '保留为来源信息',
      } }] },
      { type: 'text', text: '默认引用', marks: [{ type: 'crossRef', attrs: {
        refId: 'chapter-1', refType: 'chapter', refText: null,
      } }] },
    ])

    const sourceBefore = JSON.parse(JSON.stringify(pmDoc.toJSON()))
    const exported = await buildXml46687Package({
      pmDoc: pmDoc.toJSON() as PMJsonNode,
      documentMeta: { standardType: 'national', titleCn: '脚注载荷测试' },
    })
    expect(exported.problems.filter(problem => problem.severity === 'error')).toEqual([])
    const xml = exported.xml!
    expect(xml).toContain('<bold>粗体</bold>')
    expect(xml).toContain('<italic>斜体</italic>')
    expect(xml).toContain('<underline>下划线</underline>')
    expect(xml).toContain('<sub>下标</sub>')
    expect(xml).toContain('<sup>上标</sup>')
    expect(xml).toMatch(/<break\s*\/>/)
    const xmlDocument = new DOMParser().parseFromString(xml, 'application/xml')
    const chapterDefinition = Array.from(xmlDocument.getElementsByTagName('*')).find(element =>
      element.tagName === 'sec' && element.textContent?.includes('范围'),
    )
    const chapterId = chapterDefinition?.getAttribute('id')
    expect(chapterId).toBe('sec_1')

    const emittedIds = Array.from(xmlDocument.getElementsByTagName('*'))
      .map(element => element.getAttribute('id'))
      .filter((id): id is string => id !== null)
    expect(emittedIds.filter(id => id === chapterId)).toHaveLength(1)

    const footnoteEl = xmlDocument.getElementsByTagName('fn')[0]!
    const payloadReferences = Array.from(footnoteEl.getElementsByTagName('xref'))
    expect(payloadReferences.map(element => [element.getAttribute('ref-type'), element.textContent, element.getAttribute('rid')])).toEqual([
      ['sec', '第1章', chapterId],
    ])
    for (const reference of payloadReferences) {
      const rid = reference.getAttribute('rid')
      expect(emittedIds.filter(id => id === rid)).toHaveLength(1)
    }

    const importedResult = await importXml46687(xml, {
      validateContent: (candidate) => {
        const node = schema.nodeFromJSON(candidate)
        node.check()
        return { ok: true, content: node.toJSON() as PMJsonNode }
      },
    })
    expect(importedResult.problems.filter(problem => problem.severity === 'error')).toEqual([])
    const reopened = schema.nodeFromJSON(importedResult.pmDoc!)
    reopened.check()
    const importedChapterNodeId = reopened.toJSON().content?.find((node: PMJsonNode) => node.type === 'chapter')?.attrs?.nodeId
    let footnoteContent: PMJsonNode[] = []
    reopened.descendants(node => {
      if (node.type.name === 'footnoteRef' && Array.isArray(node.attrs.content)) {
        footnoteContent = node.attrs.content as PMJsonNode[]
      }
    })
    expect(footnoteContent.some(node =>
      node.type === 'text' && node.text === '第1章'
      && node.marks?.some(mark => mark.type === 'crossRef' && mark.attrs?.targetId === importedChapterNodeId),
    )).toBe(true)
    const printJson = structuredClone(reopened.toJSON()) as PMJsonNode
    for (const key of ['titleParts', 'identifiers', 'publishers', 'replacedStandards', 'languages', 'copyrights', 'adoptions']) {
      if (printJson.attrs) delete printJson.attrs[key]
      const cover = printJson.content?.find(child => child.type === 'coverPage')
      if (cover?.attrs) delete cover.attrs[key]
    }
    printJson.content = (printJson.content ?? []).filter(child => child.type !== 'metadataBlock')
    const printReopened = schema.nodeFromJSON(printJson)
    const { doc } = pmToIr(printReopened.toJSON() as PMJsonNode)
    const resolved = resolve(doc)
    expect(resolved.problems.filter(problem =>
      ['invalid-footnote', 'dangling-footnote', 'unreferenced-footnote'].includes(problem.code),
    )).toEqual([])
    expect(() => renderHtml(doc, resolved.labels, { variant: 'print' })).not.toThrow()
    const docx = await buildDocxBlob({ pmDoc: printReopened, createdAt: '2026-10-03T00:00:00Z' })
    expect(docx.blob).toBeInstanceOf(Blob)
    expect(pmDoc.toJSON()).toEqual(sourceBefore)
  })
})
