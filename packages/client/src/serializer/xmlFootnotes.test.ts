// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { buildXml46687Package, importXml46687, type ContentValidator } from '@ses/io'
import type { PMJsonNode } from '@ses/shared'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../extensions/editorExtensions'

function findNodes(node: PMNode, type: string): PMNode[] {
  const result: PMNode[] = []
  node.descendants((child) => { if (child.type.name === type) result.push(child) })
  return result
}

function validatorFor(schema: ReturnType<typeof getSchema>): ContentValidator {
  return (candidate) => {
    try {
      const node = schema.nodeFromJSON(candidate)
      node.check()
      return { ok: true, content: node.toJSON() as PMJsonNode }
    } catch (error) {
      return {
        ok: false,
        code: 'xml-schema-invalid',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

const sourceXml = `<?xml version="1.0" encoding="UTF-8"?>
<standard xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:mml="http://www.w3.org/1998/Math/MathML">
  <processing-meta base-tagset="interchange" mathml-version="3.0" table-model="xhtml" terminology-model="tbx" math-representation="mathml" tagset-family="sts" />
  <front>
    <std-meta>
      <title-wrap xml:lang="zh"><full>脚注测试标准</full></title-wrap>
      <std-org-group><std-org><std-org-name>机构</std-org-name></std-org></std-org-group>
      <content-language>zh</content-language>
      <std-ref type="dated">GB/T 1.1—2020</std-ref>
      <release-date>2026-01-01</release-date>
      <implementation-date>2026-06-01</implementation-date>
    </std-meta>
  </front>
  <body>
    <sec id="sec_1">
      <label>1</label>
      <title>范围</title>
      <p>选中文字<xref ref-type="fn" rid="fn_source_1">1)</xref><fn id="fn_source_1"><label><sup>1)</sup></label><p><bold>加粗说明</bold>内容</p></fn>后续正文。</p>
      <table-wrap id="tab_1">
        <label>表 1</label>
        <caption><title>脚注示例</title></caption>
        <table><tbody><tr><td><p>值<xref ref-type="table-fn" rid="tfn_source_1">a</xref>，再次引用<xref ref-type="table-fn" rid="tfn_source_1">a</xref></p></td></tr></tbody></table>
        <table-wrap-foot>
          <non-normative-note><label>注：</label><p>新表注行内容。</p></non-normative-note>
          <fn id="tfn_source_1"><label><sup>a</sup></label><p>表脚注<italic>强调</italic>内容。</p></fn>
        </table-wrap-foot>
      </table-wrap>
    </sec>
  </body>
</standard>`

async function importValid(schema: ReturnType<typeof getSchema>, xml = sourceXml): Promise<PMNode> {
  const result = await importXml46687(xml, { validateContent: validatorFor(schema) })
  expect(result.problems.filter((problem) => problem.severity === 'error')).toEqual([])
  const doc = schema.nodeFromJSON(result.pmDoc!)
  doc.check()
  return doc
}

async function expectExportBlocked(pmDoc: PMNode, pattern = /脚注/) {
  const result = await buildXml46687Package({ pmDoc: pmDoc.toJSON() as PMJsonNode })
  expect(result.xml).toBeNull()
  const errors = result.problems.filter((problem) => problem.severity === 'error')
  expect(errors.some((problem) => pattern.test(problem.message))).toBe(true)
}

describe('脚注与表脚注 GB/T 46687.2 XML round trip', () => {
  it.each(['orphan', 'missing', 'cross-table', 'empty', 'nested', 'term'])(
    'XML46687 出口拒绝 %s 脚注，异常后有效序列化仍完整',
    async (scenario) => {
      const schema = getSchema(createEditorExtensions())
      const valid = await importValid(schema)
      const expected = (await buildXml46687Package({ pmDoc: valid.toJSON() as PMJsonNode })).xml!
      const json = structuredClone(valid.toJSON()) as PMJsonNode
      const nodes: PMJsonNode[] = []
      const visit = (node: PMJsonNode) => { nodes.push(node); node.content?.forEach(visit) }
      visit(json)
      const bodyRef = nodes.find((node) => node.type === 'footnoteRef')!
      const table = nodes.find((node) => node.type === 'stdTable')!
      const entry = nodes.find((node) => node.type === 'tableFootnoteEntry')!
      if (scenario === 'orphan') {
        for (const node of nodes) {
          if (node.content) node.content = node.content.filter((child) => child.type !== 'tableFootnoteRef')
        }
      } else if (scenario === 'missing') {
        nodes.find((node) => node.type === 'tableFootnoteRef')!.attrs!.targetId = 'missing-target'
      } else if (scenario === 'cross-table') {
        table.content = table.content!.filter((node) => node.type !== 'tableFootnoteRow')
        nodes.find((node) => node.type === 'chapter')!.content!.push({
          type: 'stdTable',
          attrs: { nodeId: 'other-table' },
          content: [
            { type: 'tableCaption' },
            { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] },
            { type: 'tableFootnoteRow', content: [entry] },
          ],
        })
      } else if (scenario === 'empty') {
        bodyRef.attrs!.content = []
      } else if (scenario === 'nested') {
        bodyRef.attrs!.content = [{ type: 'footnoteRef', attrs: { nodeId: 'nested-note', content: [{ type: 'text', text: '非法嵌套' }] } }]
      } else {
        nodes.find((node) => node.type === 'chapter')!.content!.push({
          type: 'termDef',
          attrs: { nodeId: 'term-with-note' },
          content: [
            { type: 'termName', content: [{ type: 'text', text: '测试术语' }] },
            { type: 'termDefinition', content: [{ type: 'footnoteRef', attrs: { nodeId: 'term-note', content: [{ type: 'text', text: '术语内非法脚注' }] } }] },
          ],
        })
      }
      const invalid = schema.nodeFromJSON(json)
      invalid.check()
      await expectExportBlocked(invalid, /脚注关联无效/)
      const retry = await buildXml46687Package({ pmDoc: valid.toJSON() as PMJsonNode })
      expect(retry.xml).toBe(expected)
    },
  )

  it('正文 xref+fn 折叠成一个 atom，保留富文本；表脚注多次引用同一稳定目标并完整往返', async () => {
    const schema = getSchema(createEditorExtensions())
    const imported = await importValid(schema)

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
    expect(findNodes(imported, 'tableNoteRow')).toHaveLength(1)

    const exported = await buildXml46687Package({ pmDoc: imported.toJSON() as PMJsonNode })
    expect(exported.problems.filter((problem) => problem.severity === 'error')).toEqual([])
    const xml = exported.xml!
    expect(xml.match(/<xref ref-type="fn"/g)).toHaveLength(1)
    expect(xml.match(/<fn id="fn_1"/g)).toHaveLength(1)
    expect(xml).toContain('<p><bold>加粗说明</bold>内容</p>')
    expect(xml.match(/<xref ref-type="table-fn" rid="table-fn_1\.1">a<\/xref>/g)).toHaveLength(2)
    expect(xml).toContain('<fn id="table-fn_1.1">')
    expect(xml).toContain('<non-normative-note>')

    const reloaded = await importValid(schema, xml)
    const reloadedBodyRefs = findNodes(reloaded, 'footnoteRef')
    const reloadedTableRefs = findNodes(reloaded, 'tableFootnoteRef')
    const reloadedEntries = findNodes(reloaded, 'tableFootnoteEntry')
    expect(reloadedBodyRefs).toHaveLength(1)
    expect(reloadedBodyRefs[0]!.attrs.content).toEqual(bodyRefs[0]!.attrs.content)
    expect(reloadedTableRefs).toHaveLength(2)
    expect(reloadedTableRefs.every((ref) => ref.attrs.targetId === reloadedEntries[0]!.attrs.nodeId)).toBe(true)
    const reExported = await buildXml46687Package({ pmDoc: reloaded.toJSON() as PMJsonNode })
    expect(reExported.xml).toBe(xml)
  })

  it('表脚注多段保留，正文脚注多段与未知子块及孤立/悬空/多重引用脚注拒绝', async () => {
    const schema = getSchema(createEditorExtensions())
    const multiTableParagraph = sourceXml
      .replace('<p>表脚注<italic>强调</italic>内容。</p>', '<p>表脚注<italic>强调</italic>内容。</p><p>表脚注第二段。</p>')
    const imported = await importValid(schema, multiTableParagraph)
    expect(findNodes(imported, 'tableFootnoteEntry')[0]!.textContent).toContain('表脚注第二段')

    const multiBodyParagraph = sourceXml
      .replace('<p><bold>加粗说明</bold>内容</p>', '<p><bold>加粗说明</bold>内容</p><p>第二段脚注。</p>')
    const multiBodyResult = await importXml46687(multiBodyParagraph, { validateContent: validatorFor(schema) })
    expect(multiBodyResult.pmDoc).toBeNull()
    expect(multiBodyResult.problems.some((problem) => problem.severity === 'error' && problem.code === 'xml-unsupported')).toBe(true)

    const unsupported = sourceXml.replace('<p>表脚注<italic>强调</italic>内容。</p>', '<def-list><def-item><p>内容</p></def-item></def-list>')
    const unsupportedResult = await importXml46687(unsupported, { validateContent: validatorFor(schema) })
    expect(unsupportedResult.pmDoc).toBeNull()
    expect(unsupportedResult.problems.some((problem) => problem.severity === 'error')).toBe(true)

    const noDefinition = sourceXml.replace(
      /<xref ref-type="fn" rid="fn_source_1">1\)<\/xref><fn id="fn_source_1">[\s\S]*?<\/fn>/,
      '<xref ref-type="fn" rid="missing_fn">1)</xref>',
    )
    const noDefResult = await importXml46687(noDefinition, { validateContent: validatorFor(schema) })
    expect(noDefResult.pmDoc).toBeNull()
    expect(noDefResult.problems.some((problem) => problem.severity === 'error')).toBe(true)

    const repeatedRef = sourceXml
      .replace(
        '<p>选中文字<xref ref-type="fn" rid="fn_source_1">1)</xref>',
        '<p>选中文字<xref ref-type="fn" rid="fn_source_1">1)</xref><xref ref-type="fn" rid="fn_source_1">1)</xref>',
      )
    const repeatedResult = await importXml46687(repeatedRef, { validateContent: validatorFor(schema) })
    expect(repeatedResult.problems.filter((problem) => problem.severity === 'error')).toEqual([])
    const sharedDoc = schema.nodeFromJSON(repeatedResult.pmDoc!)
    expect(findNodes(sharedDoc, 'sharedFootnoteRef')).toHaveLength(2)
    expect(findNodes(sharedDoc, 'sharedFootnoteDefinition')).toHaveLength(1)
  })

  it('只含脚注的公式主体与参考文献标题脚注在 XML46687 出口统一拒绝且不改源文档', async () => {
    const schema = getSchema(createEditorExtensions())
    const valid = await importValid(schema)

    for (const onlyFootnote of [false, true]) {
      const json = structuredClone(valid.toJSON()) as PMJsonNode
      const chapter = json.content!.find((node) => node.type === 'chapter')!
      const note: PMJsonNode = { type: 'footnoteRef', attrs: { nodeId: 'formula-body-fn', content: [{ type: 'text', text: '公式主体中的说明' }] } }
      chapter.content!.push({
        type: 'formula',
        attrs: { nodeId: 'formula-body' },
        content: [
          { type: 'formulaContent', content: onlyFootnote ? [note] : [{ type: 'text', text: 'x' }, note, { type: 'text', text: '+1' }] },
        ],
      })
      const pasted = schema.nodeFromJSON(json)
      pasted.check()
      const before = pasted.toJSON()
      await expectExportBlocked(pasted, /脚注关联无效/)
      expect(pasted.toJSON()).toEqual(before)
    }

    const bibJson = structuredClone(valid.toJSON()) as PMJsonNode
    bibJson.content!.push({
      type: 'bibliography',
      content: [
        {
          type: 'bibliographyTitle',
          content: [
            { type: 'text', text: '参考文献' },
            { type: 'footnoteRef', attrs: { nodeId: 'bib-note', content: [{ type: 'text', text: '非法标题说明' }] } },
          ],
        },
        { type: 'bibEntry', attrs: { nodeId: 'bib-entry' }, content: [{ type: 'text', text: '文献甲' }] },
      ],
    })
    const bibInvalid = schema.nodeFromJSON(bibJson)
    bibInvalid.check()
    await expectExportBlocked(bibInvalid, /脚注关联无效/)

    const validExport = await buildXml46687Package({ pmDoc: valid.toJSON() as PMJsonNode })
    expect(validExport.xml).toContain('<fn id="fn_1">')
  })
})
