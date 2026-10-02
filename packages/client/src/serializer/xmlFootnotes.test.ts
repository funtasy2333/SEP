// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { PMJsonNode } from '@ses/shared'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { parseXmlToEditorJson } from './xmlParser'
import { serializeToXml, XmlFootnoteValidationError } from './xmlSerializer'

function findNodes(node: PMNode, type: string): PMNode[] {
  const result: PMNode[] = []
  node.descendants((child) => { if (child.type.name === type) result.push(child) })
  return result
}

const sourceXml = `<?xml version="1.0" encoding="UTF-8"?>
<standard xmlns="urn:csbts:std:xml:1.0">
  <front><std-meta><std-ref>GB/T 1.1—2020</std-ref></std-meta></front>
  <body>
    <sec id="sec-1">
      <title>范围</title>
      <p>选中文字<xref ref-type="fn" rid="fn-source-1">1)</xref><fn id="fn-source-1"><label>1)</label><p><bold>加粗说明</bold>内容</p></fn>后续正文。</p>
      <table-wrap id="table-1">
        <caption><title>脚注示例</title></caption>
        <table><tr><td><p>值<xref ref-type="table-fn" rid="tfn-source-1">a</xref>，再次引用<xref ref-type="table-fn" rid="tfn-source-1">a</xref></p></td></tr></table>
        <table-wrap-foot>
          <p>旧式表注内容。</p>
          <non-normative-note><p>新表注行内容。</p></non-normative-note>
          <fn fn-type="table" id="tfn-source-1"><label>a</label><p>表脚注<italic>强调</italic>内容。</p></fn>
        </table-wrap-foot>
      </table-wrap>
    </sec>
  </body>
</standard>`

describe('脚注与表脚注 XML round trip', () => {
  it.each(['orphan', 'missing', 'cross-table', 'empty', 'nested', 'term'])('XML 入口拒绝 %s 脚注，异常后有效序列化仍完整', (scenario) => {
    const schema = getSchema(createEditorExtensions())
    const valid = schema.nodeFromJSON(parseXmlToEditorJson(sourceXml, schema.topNodeType.name))
    const expected = serializeToXml(valid)
    const json = structuredClone(valid.toJSON()) as PMJsonNode
    const nodes: PMJsonNode[] = []
    const visit = (node: PMJsonNode) => { nodes.push(node); node.content?.forEach(visit) }
    visit(json)
    const bodyRef = nodes.find(node => node.type === 'footnoteRef')!
    const table = nodes.find(node => node.type === 'stdTable')!
    const entry = nodes.find(node => node.type === 'tableFootnoteEntry')!
    if (scenario === 'orphan') {
      for (const node of nodes) if (node.content) node.content = node.content.filter(child => child.type !== 'tableFootnoteRef')
    } else if (scenario === 'missing') {
      nodes.find(node => node.type === 'tableFootnoteRef')!.attrs!.targetId = 'missing-target'
    } else if (scenario === 'cross-table') {
      table.content = table.content!.filter(node => node.type !== 'tableFootnoteRow')
      nodes.find(node => node.type === 'chapter')!.content!.push({ type: 'stdTable', attrs: { nodeId: 'other-table' }, content: [
        { type: 'tableCaption' },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] },
        { type: 'tableFootnoteRow', content: [entry] },
      ] })
    } else if (scenario === 'empty') {
      bodyRef.attrs!.content = []
    } else if (scenario === 'nested') {
      bodyRef.attrs!.content = [{ type: 'footnoteRef', attrs: { nodeId: 'nested-note', content: [{ type: 'text', text: '非法嵌套' }] } }]
    } else {
      nodes.find(node => node.type === 'chapter')!.content!.push({ type: 'termDef', attrs: { nodeId: 'term-with-note' }, content: [
        { type: 'termName', content: [{ type: 'text', text: '测试术语' }] },
        { type: 'termDefinition', content: [{ type: 'footnoteRef', attrs: { nodeId: 'term-note', content: [{ type: 'text', text: '术语内非法脚注' }] } }] },
      ] })
    }
    const invalid = schema.nodeFromJSON(json)
    invalid.check()
    expect(() => serializeToXml(invalid)).toThrow(XmlFootnoteValidationError)
    expect(() => serializeToXml(invalid)).toThrow(/脚注校验未通过/)
    expect(serializeToXml(valid)).toBe(expected)
  })

  it('缺少 toJSON 的旧调用不能生成带伪造标签的脚注 XML', () => {
    const schema = getSchema(createEditorExtensions())
    const valid = schema.nodeFromJSON(parseXmlToEditorJson(sourceXml, schema.topNodeType.name))
    const legacy = { type: valid.type, attrs: valid.attrs, forEach: valid.forEach.bind(valid) } as unknown as PMNode
    expect(() => serializeToXml(legacy)).toThrow(XmlFootnoteValidationError)
    expect(serializeToXml(valid)).toContain('<fn id="fn_1">')
  })

  it('正文 xref+fn 折叠成一个 atom，保留富文本；表脚注多次引用同一稳定目标', () => {
    const schema = getSchema(createEditorExtensions())
    const imported = schema.nodeFromJSON(parseXmlToEditorJson(sourceXml, schema.topNodeType.name))
    imported.check()

    const bodyRefs = findNodes(imported, 'footnoteRef')
    const tableRefs = findNodes(imported, 'tableFootnoteRef')
    const entries = findNodes(imported, 'tableFootnoteEntry')
    expect(bodyRefs).toHaveLength(1)
    expect(bodyRefs[0]!.attrs.content).toEqual([
      { type: 'text', text: '加粗说明', marks: [{ type: 'bold' }] },
      { type: 'text', text: '内容' },
    ])
    expect(tableRefs).toHaveLength(2)
    expect(tableRefs[0]!.attrs.targetId).toBe(entries[0]!.attrs.nodeId)
    expect(tableRefs[1]!.attrs.targetId).toBe(entries[0]!.attrs.nodeId)
    expect(findNodes(imported, 'tableFootnote')).toHaveLength(1)
    expect(findNodes(imported, 'tableNoteRow')).toHaveLength(1)

    const xml = serializeToXml(imported)
    expect(xml.match(/<xref ref-type="fn"/g)).toHaveLength(1)
    expect(xml.match(/<fn id="fn_1"/g)).toHaveLength(1)
    expect(xml).toContain('<p><bold>加粗说明</bold>内容</p>')
    expect(xml.match(/<xref ref-type="table-fn" rid="tabfn_tab_1_a">a<\/xref>/g)).toHaveLength(2)
    expect(xml).toContain('<fn fn-type="table" id="tabfn_tab_1_a">')
    expect(xml).toContain('<p>旧式表注内容。</p>')
    expect(xml).toContain('<non-normative-note>')

    const reloaded = schema.nodeFromJSON(parseXmlToEditorJson(xml, schema.topNodeType.name))
    reloaded.check()
    const reloadedBodyRefs = findNodes(reloaded, 'footnoteRef')
    const reloadedTableRefs = findNodes(reloaded, 'tableFootnoteRef')
    const reloadedEntries = findNodes(reloaded, 'tableFootnoteEntry')
    expect(reloadedBodyRefs).toHaveLength(1)
    expect(reloadedBodyRefs[0]!.attrs.content).toEqual(bodyRefs[0]!.attrs.content)
    expect(reloadedTableRefs).toHaveLength(2)
    expect(reloadedTableRefs.every((ref) => ref.attrs.targetId === reloadedEntries[0]!.attrs.nodeId)).toBe(true)
    expect(serializeToXml(reloaded)).toBe(xml)
  })

  it('多个脚注段落保留为换行；支持无 p 包裹的行内标记并拒绝未知块', () => {
    const schema = getSchema(createEditorExtensions())
    const multiParagraph = sourceXml
      .replace('<p><bold>加粗说明</bold>内容</p>', '<p><bold>加粗说明</bold>内容</p><p>第二段脚注。</p>')
      .replace('<p>旧式表注内容。</p>', '<p>旧式表注内容。</p><p>旧式第二段。</p>')
      .replace('<p>表脚注<italic>强调</italic>内容。</p>', '<p>表脚注<italic>强调</italic>内容。</p><p>表脚注第二段。</p>')
    const imported = schema.nodeFromJSON(parseXmlToEditorJson(multiParagraph, schema.topNodeType.name))
    const bodyContent = findNodes(imported, 'footnoteRef')[0]!.attrs.content as PMJsonNode[]
    expect(bodyContent.some((node) => node.type === 'hardBreak')).toBe(true)
    expect(findNodes(imported, 'tableFootnote')[0]!.textContent).toContain('旧式第二段')
    expect(findNodes(imported, 'tableFootnoteEntry')[0]!.textContent).toContain('表脚注第二段')

    const inlineOnly = sourceXml.replace('<p><bold>加粗说明</bold>内容</p>', '<bold>加粗说明</bold>内容')
    const inlineImported = schema.nodeFromJSON(parseXmlToEditorJson(inlineOnly, schema.topNodeType.name))
    expect((findNodes(inlineImported, 'footnoteRef')[0]!.attrs.content as PMJsonNode[])[0]!.marks).toEqual([{ type: 'bold' }])

    const unsupported = sourceXml.replace('<p>表脚注<italic>强调</italic>内容。</p>', '<def-list><def-item><p>内容</p></def-item></def-list>')
    expect(() => parseXmlToEditorJson(unsupported, schema.topNodeType.name)).toThrow(/暂不支持 <def-list> 子元素，原 XML 未作修改/)
  })

  it('表注区 fn-group 保留为表脚注定义；孤立正文 fn-group 仍明确拒绝', () => {
    const schema = getSchema(createEditorExtensions())
    const groupedTableFootnote = sourceXml.replace(
      /<fn fn-type="table" id="tfn-source-1">([\s\S]*?)<\/fn>/,
      '<fn-group><fn fn-type="table" id="tfn-source-1">$1</fn></fn-group>',
    )
    const imported = schema.nodeFromJSON(parseXmlToEditorJson(groupedTableFootnote, schema.topNodeType.name))
    imported.check()
    const entries = findNodes(imported, 'tableFootnoteEntry')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.attrs.nodeId).toBe('tfn-source-1')
    expect(entries[0]!.textContent).toBe('表脚注强调内容。')

    const orphanBodyGroup = sourceXml.replace(
      '</body>',
      '<fn-group><fn id="orphan-body-fn"><label>1)</label><p>孤立正文脚注。</p></fn></fn-group></body>',
    )
    expect(() => parseXmlToEditorJson(orphanBodyGroup, schema.topNodeType.name)).toThrow(/没有引用/)
  })

  it('fn-group 的未配对、多重引用或孤立定义明确拒绝，避免导入时丢内容', () => {
    const schema = getSchema(createEditorExtensions())
    const noDefinition = sourceXml.replace(/<xref ref-type="fn" rid="fn-source-1">1\)<\/xref><fn id="fn-source-1"><label>1\)<\/label><p><bold>加粗说明<\/bold>内容<\/p><\/fn>/, '<xref ref-type="fn" rid="missing">1)</xref>')
    expect(() => parseXmlToEditorJson(noDefinition, schema.topNodeType.name)).toThrow(/未找到相邻 fn 或 fn-group 定义/)

    const repeatedExternalRef = sourceXml
      .replace(/<xref ref-type="fn" rid="fn-source-1">1\)<\/xref><fn id="fn-source-1"><label>1\)<\/label><p><bold>加粗说明<\/bold>内容<\/p><\/fn>/, '<xref ref-type="fn" rid="fn-group-1">1)</xref>')
      .replace('</p>\n      <table-wrap', '</p>\n      <p><xref ref-type="fn" rid="fn-group-1">1)</xref></p>\n      <table-wrap')
      .replace('</body>', '<fn-group><fn id="fn-group-1"><label>1)</label><p>外置脚注。</p></fn></fn-group></body>')
    expect(() => parseXmlToEditorJson(repeatedExternalRef, schema.topNodeType.name)).toThrow(/同一脚注有多个引用/)
  })
})


describe('XML 导入的非法脚注位置不能再次导出', () => {
  const noteXml = '<xref ref-type="fn" rid="forbidden-fn">1)</xref><fn id="forbidden-fn"><p>保留的非法位置说明</p></fn>'
  const variants = [
    ['附录标题', `<app-group><app id="app"><title>附录${noteXml}</title><p>正文</p></app></app-group>`],
    ['章标题', `<sec id="ch"><title>章${noteXml}</title><p>正文</p></sec>`],
    ['条标题', `<sec id="ch"><title>章</title><sec id="cl"><title>条${noteXml}</title><p>正文</p></sec></sec>`],
    ['图题', `<sec id="ch"><title>章</title><fig id="fig"><graphic href="image.png"/><caption><title>图${noteXml}</title></caption></fig></sec>`],
    ['英文图题', `<sec id="ch"><title>章</title><fig id="fig"><graphic href="image.png"/><caption><title xml:lang="en">Figure${noteXml}</title></caption></fig></sec>`],
    ['公式说明', `<sec id="ch"><title>章</title><disp-formula id="formula"><tex-math>x</tex-math><def-list><p>式中：x——变量${noteXml}</p></def-list></disp-formula></sec>`],
    ['仅有脚注的公式说明', `<sec id="ch"><title>章</title><disp-formula id="formula"><tex-math>x</tex-math><def-list><p>${noteXml}</p></def-list></disp-formula></sec>`],
  ]
  it.each(variants)('%s 保留引用与内容，序列化入口拒绝', (_name, body) => {
    const schema = getSchema(createEditorExtensions())
    const xml = _name === '附录标题'
      ? `<standard><body/><back>${body}</back></standard>`
      : `<standard><body>${body}</body></standard>`
    const imported = schema.nodeFromJSON(parseXmlToEditorJson(xml, schema.topNodeType.name))
    imported.check()
    expect(findNodes(imported, 'footnoteRef')).toHaveLength(1)
    expect(findNodes(imported, 'footnoteRef')[0]!.attrs.content).toEqual([{ type: 'text', text: '保留的非法位置说明' }])
    expect(() => serializeToXml(imported)).toThrow(XmlFootnoteValidationError)
  })
})
