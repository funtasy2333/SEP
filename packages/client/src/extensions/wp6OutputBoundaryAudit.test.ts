// @vitest-environment happy-dom
import JSZip from 'jszip'
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { UnsupportedOutputError, getOutputSupportProblems, pmToIr, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { exportSemanticHtml } from '../serializer/htmlExporter'
import { buildDocxBlob } from '../serializer/docxExporter'
import { exportSemanticJson } from '../serializer/jsonExporter'
import { buildXml46687Package } from '@ses/io'

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
      { type: 'table', content: [
        {
          type: 'tableRow', content: [{
            type: cellType, attrs: { nodeId: 'header-count-cell' },
            content: [{ type: 'paragraph', content: [text('列名')] }],
          }],
        },
        {
          type: 'tableRow', content: [{
            type: 'tableCell', attrs: { nodeId: 'body-cell' },
            content: [{ type: 'paragraph', content: [text('数据')] }],
          }],
        },
      ] },
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

describe('WP6 输出边界审计：生产 client 导出入口', () => {
  it('阻止含格式的公式主体被 HTML、DOCX 或 XML46687 降为 LaTeX 纯文本，同时保留 JSON', async () => {
    const doc = productionDoc({ formula: formattedFormula() })
    const ir = pmToIr(doc.toJSON() as PMJsonNode).doc
    expect(getOutputSupportProblems(ir, 'HTML')).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'rich-formula', path: expect.stringContaining('.sourceInlines') }),
    ]))
    expect(() => exportSemanticHtml(doc)).toThrow(UnsupportedOutputError)
    await expect(buildDocxBlob({ pmDoc: doc, createdAt: '2026-10-07T00:00:00Z' })).rejects.toThrow(UnsupportedOutputError)
    const xmlPkg = await buildXml46687Package({ pmDoc: doc.toJSON() as PMJsonNode })
    expect(xmlPkg.xml).toBeNull()
    expect(xmlPkg.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', nodeId: 'rich-formula', path: expect.stringContaining('.sourceInlines') }),
    ]))
    expect(JSON.stringify(exportSemanticJson(doc))).toContain('"type":"bold"')
  })

  it('XML46687 同时支持 typed whereList 与旧自由 formulaDescription', async () => {
    const typed = productionDoc({ formula: typedWhereFormula() })
    const typedPkg = await buildXml46687Package({ pmDoc: typed.toJSON() as PMJsonNode })
    expect(typedPkg.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(typedPkg.xml).toContain('<def-list list-content="formula">')

    const legacy = productionDoc({ formula: {
      type: 'formula', attrs: { nodeId: 'legacy-formula', latex: 'x' },
      content: [
        { type: 'formulaContent', content: [text('x')] },
        { type: 'formulaDescription', content: [text('式中：x——变量')] },
      ],
    } })
    const legacyPkg = await buildXml46687Package({ pmDoc: legacy.toJSON() as PMJsonNode })
    expect(legacyPkg.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(legacyPkg.xml).toContain('<def-list')
  })

  it('XML46687、HTML 与 DOCX 均支持表格单元格列项', async () => {
    const doc = productionDoc({ table: tableWithListCell() })
    const pkg = await buildXml46687Package({ pmDoc: doc.toJSON() as PMJsonNode })
    expect(pkg.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(pkg.xml).toContain('单元格列项')
    expect(exportSemanticHtml(doc)).toContain('单元格列项')
    await expect(buildDocxBlob({ pmDoc: doc, createdAt: '2026-10-07T00:00:00Z' })).resolves.toBeDefined()
  })

  it.each(['note', 'example'] as const)('HTML/DOCX 保留单元格内 %s textblock，XML46687 按 §6.5 阻断提示', async type => {
    const doc = productionDoc({ table: tableWithSemanticTextblockCell(type) })
    const pkg = await buildXml46687Package({ pmDoc: doc.toJSON() as PMJsonNode })
    expect(pkg.xml).toBeNull()
    expect(pkg.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', code: 'xml-cell-content' }),
    ]))
    expect(exportSemanticHtml(doc)).toContain(`单元格${type}`)
    await expect(buildDocxBlob({ pmDoc: doc, createdAt: '2026-10-07T00:00:00Z' })).resolves.toBeDefined()
  })

  it.each([
    { title: '方法', secType: 'scope' as const },
    { title: '范围', secType: 'general' as const },
  ])('显式章角色优先并直接写入 XML46687 与 HTML：$title / $secType', async ({ title, secType }) => {
    const doc = productionDoc({ chapterTitle: title, chapterSecType: secType })
    const before = doc.toJSON()
    const pkg = await buildXml46687Package({ pmDoc: doc.toJSON() as PMJsonNode })
    expect(pkg.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(pkg.xml).toContain(`<title>${title}</title>`)
    if (secType !== 'general') expect(pkg.xml).toContain(`sec-type="${secType}"`)
    expect(doc.toJSON()).toEqual(before)
    expect(exportSemanticHtml(doc)).toContain(`data-sec-type="${secType}"`)
  })

  it.each([
    { title: '范围', secType: 'scope' as const },
    { title: '方法', secType: 'general' as const },
  ])('标题推断与显式章角色一致时导出 XML46687：$title / $secType', async ({ title, secType }) => {
    const doc = productionDoc({ chapterTitle: title, chapterSecType: secType })
    const pkg = await buildXml46687Package({ pmDoc: doc.toJSON() as PMJsonNode })
    expect(pkg.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(pkg.xml).toContain(`<title>${title}</title>`)
  })

  it('XML46687 拒绝无法由 tableHeader 标签表达的显式表头行数，并保留可表达的稿件', async () => {
    const mismatch = productionDoc({ table: tableWithExplicitHeaderCount('tableCell') })
    const ir = pmToIr(mismatch.toJSON() as PMJsonNode).doc
    expect(getOutputSupportProblems(ir, 'XML46687')).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'header-count-table', path: expect.stringContaining('.headerRowCount') }),
    ]))
    const mismatchPkg = await buildXml46687Package({ pmDoc: mismatch.toJSON() as PMJsonNode })
    expect(mismatchPkg.xml).toBeNull()
    expect(mismatchPkg.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', nodeId: 'header-count-table', path: expect.stringContaining('.headerRowCount') }),
    ]))

    const equivalent = productionDoc({ table: tableWithExplicitHeaderCount('tableHeader') })
    const pkg = await buildXml46687Package({ pmDoc: equivalent.toJSON() as PMJsonNode })
    expect(pkg.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(pkg.xml).toContain('<th>')
  })

  it('HTML、DOCX 与 XML46687 均保留申请单位元数据与中文题名', async () => {
    const applicant = '起草单位 <甲> & "乙"'
    const doc = productionDoc({ applicant })
    const ir = pmToIr(doc.toJSON() as PMJsonNode).doc
    expect(ir.meta.applicant).toBe(applicant)
    expect(getOutputSupportProblems(ir, 'HTML')).toEqual([])
    expect(getOutputSupportProblems(ir, 'DOCX')).toEqual([])
    expect(getOutputSupportProblems(ir, 'XML46687')).toEqual([])

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
    const xmlPkg = await buildXml46687Package({ pmDoc: doc.toJSON() as PMJsonNode })
    expect(xmlPkg.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(xmlPkg.xml).toContain('<full>边界测试</full>')
    expect(xmlPkg.xml).toContain('<meta-name>applicant</meta-name>')
  })
})
