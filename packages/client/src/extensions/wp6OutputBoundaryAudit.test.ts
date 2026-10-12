// @vitest-environment happy-dom
import JSZip from 'jszip'
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { UnsupportedOutputError, getOutputSupportProblems, pmToIr, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { exportSemanticHtml } from '../serializer/htmlExporter'
import { buildDocxBlob } from '../serializer/docxExporter'
import { exportSemanticJson } from '../serializer/jsonExporter'
import { serializeToXml } from '../serializer/xmlSerializer'

const text = (value: string, marks?: PMJsonNode['marks']): PMJsonNode => ({
  type: 'text', text: value, ...(marks ? { marks } : {}),
})

function productionDoc(options: {
  applicant?: string
  formula?: PMJsonNode
  table?: PMJsonNode
  chapterTitle?: string
  chapterSecType?: 'scope' | 'norm-refs' | 'terms' | 'general'
} = {}) {
  const schema = getSchema(createEditorExtensions())
  const pmJson: PMJsonNode = {
    type: schema.topNodeType.name,
    content: [
      {
        type: 'coverPage',
        attrs: { nodeId: 'cover', standardNo: 'GB/T 1000—2026', standardType: 'national', titleCn: '边界测试', applicant: options.applicant ?? '' },
        content: [{ type: 'paragraph' }],
      },
      {
        type: 'chapter', attrs: { nodeId: 'chapter', ...(options.chapterSecType ? { secType: options.chapterSecType } : {}) },
        content: [
          { type: 'chapterTitle', content: [text(options.chapterTitle ?? '范围')] },
          {
            type: 'clause', attrs: { nodeId: 'clause', level: 1 },
            content: [
              { type: 'clauseTitle', content: [text('基本要求')] },
              { type: 'stdParagraph', attrs: { nodeId: 'paragraph' }, content: [text('正文')] },
              ...(options.formula ? [options.formula] : []),
              ...(options.table ? [options.table] : []),
            ],
          },
        ],
      },
    ],
  }
  const doc = schema.nodeFromJSON(pmJson)
  doc.check()
  return doc
}

function formattedFormula(): PMJsonNode {
  return {
    type: 'formula', attrs: { nodeId: 'rich-formula', latex: 'x' },
    content: [{ type: 'formulaContent', content: [text('x', [{ type: 'bold' }])] }],
  }
}

function typedWhereFormula(): PMJsonNode {
  return {
    type: 'formula', attrs: { nodeId: 'typed-formula', latex: 'x' },
    content: [
      { type: 'formulaContent', content: [text('x')] },
      {
        type: 'whereList', content: [{
          type: 'whereItem', attrs: { nodeId: 'where-item' },
          content: [
            { type: 'whereTerm', content: [text('x')] },
            { type: 'whereDefinition', content: [text('变量')] },
          ],
        }],
      },
    ],
  }
}


function tableWithExplicitHeaderCount(cellType: 'tableCell' | 'tableHeader'): PMJsonNode {
  return {
    type: 'stdTable', attrs: { nodeId: 'header-count-table', headerRowCount: 1 },
    content: [
      { type: 'tableCaption', content: [text('表题')] },
      { type: 'table', content: [{
        type: 'tableRow', content: [{
          type: cellType, attrs: { nodeId: 'header-count-cell' },
          content: [{ type: 'paragraph', content: [text('列名')] }],
        }],
      }] },
    ],
  }
}

function tableWithListCell(): PMJsonNode {
  return {
    type: 'stdTable', attrs: { nodeId: 'table' },
    content: [
      { type: 'tableCaption', content: [text('表题')] },
      { type: 'table', content: [{
        type: 'tableRow', content: [{
          type: 'tableCell', attrs: { nodeId: 'cell' },
          content: [{
            type: 'stdList', attrs: { listType: 'dash', level: 1 },
            content: [{ type: 'stdListItem', content: [text('单元格列项')] }],
          }],
        }],
      }] },
    ],
  }
}

function tableWithSemanticTextblockCell(type: 'note' | 'example'): PMJsonNode {
  return {
    type: 'stdTable', attrs: { nodeId: 'semantic-cell-table' },
    content: [
      { type: 'tableCaption', content: [text('表题')] },
      { type: 'table', content: [{
        type: 'tableRow', content: [{
          type: 'tableCell', attrs: { nodeId: 'semantic-cell' },
          content: [{ type, content: [text(`单元格${type}`)] }],
        }],
      }] },
    ],
  }
}

function expectXmlUnsupported(
  operation: () => unknown,
  nodeId: string,
  pathPart: string,
): UnsupportedOutputError {
  let error: unknown
  try { operation() } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(UnsupportedOutputError)
  expect((error as UnsupportedOutputError).problems).toEqual(expect.arrayContaining([
    expect.objectContaining({ nodeId, path: expect.stringContaining(pathPart) }),
  ]))
  return error as UnsupportedOutputError
}

describe('WP6 输出边界审计：生产 client 导出入口', () => {
  it('阻止含格式的公式主体被 HTML、DOCX 或旧 XML 降为 LaTeX 纯文本，同时保留 JSON', async () => {
    const doc = productionDoc({ formula: formattedFormula() })
    const ir = pmToIr(doc.toJSON() as PMJsonNode).doc
    expect(getOutputSupportProblems(ir, 'HTML')).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'rich-formula', path: expect.stringContaining('.sourceInlines') }),
    ]))
    expect(() => exportSemanticHtml(doc)).toThrow(UnsupportedOutputError)
    await expect(buildDocxBlob({ pmDoc: doc, createdAt: '2026-10-07T00:00:00Z' })).rejects.toThrow(UnsupportedOutputError)
    expect(() => serializeToXml(doc)).toThrow(UnsupportedOutputError)
    expect(JSON.stringify(exportSemanticJson(doc))).toContain('"type":"bold"')
  })

  it('只对新 typed whereList 阻断旧 XML，旧自由 formulaDescription 仍保持可导出', () => {
    const typed = productionDoc({ formula: typedWhereFormula() })
    expectXmlUnsupported(() => serializeToXml(typed), 'typed-formula', '.content[1]')

    const legacy = productionDoc({ formula: {
      type: 'formula', attrs: { nodeId: 'legacy-formula', latex: 'x' },
      content: [
        { type: 'formulaContent', content: [text('x')] },
        { type: 'formulaDescription', content: [text('式中：x——变量')] },
      ],
    } })
    expect(serializeToXml(legacy)).toContain('<def-list>')
  })

  it('报告旧 XML 会忽略的表格单元格块，HTML 与 DOCX 仍走支持路径', async () => {
    const doc = productionDoc({ table: tableWithListCell() })
    expectXmlUnsupported(() => serializeToXml(doc), 'cell', '.content[0]')
    expect(exportSemanticHtml(doc)).toContain('单元格列项')
    await expect(buildDocxBlob({ pmDoc: doc, createdAt: '2026-10-07T00:00:00Z' })).resolves.toBeDefined()
  })

  it.each(['note', 'example'] as const)('拒绝被旧 XML 单元格展平的 %s textblock，并保留 HTML/DOCX 路径', async type => {
    const doc = productionDoc({ table: tableWithSemanticTextblockCell(type) })
    expectXmlUnsupported(() => serializeToXml(doc), 'semantic-cell', '.content[0]')
    expect(exportSemanticHtml(doc)).toContain(`单元格${type}`)
    await expect(buildDocxBlob({ pmDoc: doc, createdAt: '2026-10-07T00:00:00Z' })).resolves.toBeDefined()
  })

  it.each([
    { title: '方法', secType: 'scope' as const, inferred: 'general' },
    { title: '范围', secType: 'general' as const, inferred: 'scope' },
  ])('仅当显式章角色与标题推断冲突时阻断 XML：$title / $secType', ({ title, secType, inferred }) => {
    const doc = productionDoc({ chapterTitle: title, chapterSecType: secType })
    const before = doc.toJSON()
    const error = expectXmlUnsupported(() => serializeToXml(doc), 'chapter', '.attrs.secType')
    expect(error.message).toContain(`「${inferred}」`)
    expect(doc.toJSON()).toEqual(before)
    expect(exportSemanticHtml(doc)).toContain(`data-sec-type="${secType}"`)
  })

  it.each([
    { title: '范围', secType: 'scope' as const },
    { title: '方法', secType: 'general' as const },
  ])('标题推断与显式章角色一致时仍可导出 XML：$title / $secType', ({ title, secType }) => {
    const doc = productionDoc({ chapterTitle: title, chapterSecType: secType })
    expect(serializeToXml(doc)).toContain(`<title>${title}</title>`)
  })

  it('旧 XML 拒绝无法由 tableHeader 标签表达的显式表头行数，并保留可表达的旧稿', () => {
    const mismatch = productionDoc({ table: tableWithExplicitHeaderCount('tableCell') })
    const ir = pmToIr(mismatch.toJSON() as PMJsonNode).doc
    expect(getOutputSupportProblems(ir, 'XML')).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'header-count-table', path: expect.stringContaining('.headerRowCount') }),
    ]))
    expect(() => serializeToXml(mismatch)).toThrow(UnsupportedOutputError)

    const equivalent = productionDoc({ table: tableWithExplicitHeaderCount('tableHeader') })
    expect(serializeToXml(equivalent)).toContain('<th>')
  })

  it('HTML 与 DOCX 保留申请单位元数据；旧 XML 延续编辑器维护字段的既有契约', async () => {
    const applicant = '起草单位 <甲> & "乙"'
    const doc = productionDoc({ applicant })
    const ir = pmToIr(doc.toJSON() as PMJsonNode).doc
    expect(ir.meta.applicant).toBe(applicant)
    expect(getOutputSupportProblems(ir, 'HTML')).toEqual([])
    expect(getOutputSupportProblems(ir, 'DOCX')).toEqual([])
    expect(getOutputSupportProblems(ir, 'XML')).toEqual([])

    expect(exportSemanticHtml(doc)).toContain('<meta name="ses-applicant" content="起草单位 &lt;甲&gt; &amp; &quot;乙&quot;" />')
    const { blob } = await buildDocxBlob({
      pmDoc: doc,
      documentMeta: { titleCn: '边界测试', standardType: 'national', applicant },
      createdAt: '2026-10-07T00:00:00Z',
    })
    const archive = await JSZip.loadAsync(blob)
    const custom = await archive.file('docProps/custom.xml')!.async('string')
    expect(custom).toContain('name="ses-applicant"')
    expect(custom).toContain('起草单位 &lt;甲&gt; &amp; "乙"')
    // applicant is not part of this legacy XML front. The cover export remains available and XML
    // import preserves applicant from the current editor metadata, as documented by xmlDocumentMeta.
    expect(serializeToXml(doc)).toContain('<main>边界测试</main>')
  })
})
