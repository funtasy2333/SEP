// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { PMJsonNode } from '@ses/shared'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { parseXmlToEditorJson } from './xmlParser'
import { serializeToXml } from './xmlSerializer'

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
