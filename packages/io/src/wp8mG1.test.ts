/**
 * WP8.M G1：规范性引用文件清单、标准引用 mark、参考文献标题在 io 里的行为
 * （矩阵 M-4.4.2.3-02/-03/-04、M-10.2-01/-02、M-10.1.7-01、M-4.5.3-02、M-E-06）。
 *
 * 两部分：① 文档操作引擎（AI 读写文档）——清单可读成 IR 块但不可单独寻址，整体替换含清单的章必须被拦截（否则清单会丢失）；
 * ② 真实出件链路（DOCX / 语义 HTML / PDF 请求）——清单按 10.3.4 排版，自定义参考文献标题进入标题与目次。
 */

import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '@ses/shared'
import { applyDocumentOperations, buildOutline, readNode } from './documentOps'
import { buildDocx } from './docx'
import { getOutputBoundaryProblems } from './exportGuard'
import { buildPdfExportRequest } from './pdfExport'
import { exportSemanticHtml } from './semanticExport'

const text = (value: string, marks?: PMJsonNode['marks']): PMJsonNode => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const paragraph = (nodeId: string, ...content: PMJsonNode[]): PMJsonNode => ({ type: 'stdParagraph', attrs: { nodeId }, content })
const std = (nodeId: string, ref: string, title: string): PMJsonNode => ({
  type: 'normRefStd', attrs: { nodeId }, content: [
    { type: 'normRefStdRef', content: [text(ref)] },
    { type: 'normRefStdTitle', content: [text(title)] },
  ],
})

function pmWithNormRefs(): PMJsonNode {
  return {
    type: 'standardDoc',
    attrs: { standardType: 'national', titleCn: '规范性引用样稿', standardNo: 'GB/T 12345—2026', extensionVersion: 1 },
    content: [
      { type: 'chapter', attrs: { nodeId: 'ch1', secType: 'scope' }, content: [
        { type: 'chapterTitle', content: [text('范围')] },
        paragraph('ch1-p', text('本文件规定了引用写法，符合'), text('GB/T 321', [{ type: 'stdRef' }]), text('的要求。')),
      ] },
      { type: 'chapter', attrs: { nodeId: 'ch2', secType: 'norm-refs' }, content: [
        { type: 'chapterTitle', content: [text('规范性引用文件')] },
        paragraph('ch2-lead', text('下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。')),
        { type: 'normRefList', attrs: { nodeId: 'nrl' }, content: [
          std('nr-1', 'GB/T 321', '优先数和优先数系'),
          std('nr-2', 'GB/T 3102（所有部分）', '量和单位'),
          { type: 'normRefMixed', attrs: { nodeId: 'nr-3' }, content: [text('《中华人民共和国计量法》')] },
        ] },
      ] },
      { type: 'bibliography', content: [
        { type: 'bibliographyTitle', content: [text('参考书目')] },
        { type: 'bibEntry', attrs: { nodeId: 'bib-1' }, content: [text('张三.计量学基础[M].北京:出版社,2020.')] },
      ] },
    ],
  }
}

const types = (nodes: PMJsonNode[] | undefined): string[] => (nodes ?? []).map(child => child.type)

describe('[M-4.4.2.3-02] documentOps：清单可读成 IR 块，但不可单独寻址', () => {
  it('pmToIr 读出清单，条目 id 为 ref_<n>；文档无 unsupportedContent', () => {
    const { doc } = pmToIr(pmWithNormRefs())
    expect(doc.unsupportedContent).toBeUndefined()
    expect(doc.body[1]!.children.map(child => child.kind)).toEqual(['paragraph', 'normRefList'])
  })

  it('结构树：norm-refs 章的块数把清单计为一个块；清单与条目不单独列出', () => {
    const outline = buildOutline(pmWithNormRefs())
    const chapter = outline.body[1]!
    expect(chapter).toMatchObject({ nodeId: 'ch2', title: '规范性引用文件' })
    expect(chapter.blockCount).toBe(2)
    expect(JSON.stringify(outline)).not.toContain('nr-1')
  })

  it('readNode：清单与条目是 node-not-addressable，提示它们位于哪个可寻址节点内', () => {
    for (const id of ['nrl', 'nr-1', 'nr-3']) {
      const result = readNode(pmWithNormRefs(), id)
      expect(result, id).toMatchObject({ ok: false, code: 'node-not-addressable' })
    }
    const entry = readNode(pmWithNormRefs(), 'nr-1')
    if (entry.ok) throw new Error('条目不应可读')
    expect(entry.reason).toContain('ch2')
  })

  it('readNode(章)：含清单的章不能无损整体替换，给出 unsupported-kind 原因（提示模型已支持）；不含清单的章可以', () => {
    const chapter = readNode(pmWithNormRefs(), 'ch2')
    if (!chapter.ok) throw new Error(JSON.stringify(chapter))
    expect(chapter.node.replaceable).toBe(false)
    expect(chapter.node.notReplaceable).toEqual([expect.objectContaining({ code: 'unsupported-kind', message: expect.stringContaining('规范性引用文件清单') })])
    const scope = readNode(pmWithNormRefs(), 'ch1')
    if (!scope.ok) throw new Error(JSON.stringify(scope))
    // 范围章的段落带 stdRef：整体替换会丢失该标记
    expect(scope.node.replaceable).toBe(false)
    expect(scope.node.notReplaceable?.[0]).toMatchObject({ code: 'unsupported-field', message: expect.stringContaining('stdRef') })
  })

  it('replace 含清单的章：默认被拒绝（replace-loses-content），不会静默丢清单', () => {
    const result = applyDocumentOperations(pmWithNormRefs(), [{ op: 'replace', nodeId: 'ch2', content: [{ kind: 'chapter', title: '规范性引用文件', children: ['本文件没有规范性引用文件。'] }] }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]).toMatchObject({ code: 'replace-loses-content' })
  })

  it('在清单前后插入段落、删除引导语：清单与条目原样保留（位置按 PM 下标解析，不受“清单不可寻址”影响）', () => {
    const result = applyDocumentOperations(pmWithNormRefs(), [
      { op: 'insert', parent: 'ch2', position: { after: 'ch2-lead' }, content: ['插在引导语与清单之间的说明。'] },
      { op: 'insert', parent: 'ch2', position: 'end', content: ['清单之后的段落。'] },
    ], { generateId: (() => { let n = 0; return () => `gen-${++n}` })() })
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    const chapter = result.doc.content!.find(node => node.attrs?.nodeId === 'ch2')!
    expect(types(chapter.content)).toEqual(['chapterTitle', 'stdParagraph', 'stdParagraph', 'normRefList', 'stdParagraph'])
    const list = chapter.content!.find(node => node.type === 'normRefList')!
    expect(list).toEqual(pmWithNormRefs().content![1]!.content!.find(node => node.type === 'normRefList'))

    const removed = applyDocumentOperations(pmWithNormRefs(), [{ op: 'delete', nodeId: 'ch2-lead' }])
    if (!removed.ok) throw new Error(JSON.stringify(removed.issues))
    const remaining = removed.doc.content!.find(node => node.attrs?.nodeId === 'ch2')!
    expect(types(remaining.content)).toEqual(['chapterTitle', 'normRefList'])
  })

  it('start 位置在章标题之后、清单之前插入；清单内的节点不能作为锚点（node-not-addressable 类错误）', () => {
    const inserted = applyDocumentOperations(pmWithNormRefs(), [{ op: 'insert', parent: 'ch2', position: 'start', content: ['开头。'] }], { generateId: () => 'gen-start' })
    if (!inserted.ok) throw new Error(JSON.stringify(inserted.issues))
    const chapter = inserted.doc.content!.find(node => node.attrs?.nodeId === 'ch2')!
    expect(types(chapter.content)).toEqual(['chapterTitle', 'stdParagraph', 'stdParagraph', 'normRefList'])
    const anchored = applyDocumentOperations(pmWithNormRefs(), [{ op: 'insert', parent: 'ch2', position: { after: 'nr-1' }, content: ['x'] }])
    expect(anchored.ok).toBe(false)
  })
})

describe('[M-4.4.2.3-03] [M-4.4.2.3-04] [M-4.5.3-02] io：真实出件链路', () => {
  it('buildDocx：清单每项一个 SesPara 段（文件编号 + U+3000 + 文件名称），自定义标题替换“参考文献”，无新增样式', async () => {
    const { bytes, warnings } = await buildDocx({ pmDoc: pmWithNormRefs(), createdAt: '2026-10-22T08:00:00Z' })
    const zip = await JSZip.loadAsync(bytes)
    const documentXml = await zip.file('word/document.xml')!.async('string')
    const stylesXml = await zip.file('word/styles.xml')!.async('string')
    expect(documentXml).toContain('<w:t xml:space="preserve">GB/T 321</w:t></w:r><w:r><w:t xml:space="preserve">　</w:t></w:r><w:r><w:t xml:space="preserve">优先数和优先数系</w:t></w:r></w:p>')
    expect(documentXml).toContain('<w:t xml:space="preserve">GB/T 3102（所有部分）</w:t></w:r><w:r><w:t xml:space="preserve">　</w:t></w:r><w:r><w:t xml:space="preserve">量和单位</w:t></w:r></w:p>')
    expect(documentXml).toContain('<w:t xml:space="preserve">《中华人民共和国计量法》</w:t></w:r></w:p>')
    expect(documentXml).toContain('<w:t xml:space="preserve">书</w:t>')
    expect(documentXml).not.toContain('参考文献')
    expect(stylesXml).not.toMatch(/NormRef/)
    expect(warnings.filter(warning => warning.code !== 'cover-asset-approximation' && warning.code !== 'toc-pages-pending')).toEqual([])
  })

  it('exportSemanticHtml（screen）：清单按 10.3.4 输出，条目 id 为 ref_<n>，标题为自定义标题', () => {
    const html = exportSemanticHtml(pmWithNormRefs())
    expect(html).toContain('<div class="ses-norm-ref-list" data-type="norm-ref-list" data-node-id="nrl">')
    expect(html).toContain('<p class="ses-paragraph ses-norm-ref" data-type="norm-ref" data-entry-type="std" data-node-id="nr-1" id="ref_1"><span class="ses-norm-ref-no">GB/T 321</span>　<span class="ses-norm-ref-title">优先数和优先数系</span></p>')
    expect(html).toContain('data-entry-type="mixed" data-node-id="nr-3" id="ref_3">《中华人民共和国计量法》</p>')
    expect(html).toContain('<h2 class="ses-bib-title">参考书目</h2>')
    // 正文里的 stdRef 按普通文本输出
    expect(html).toContain('符合GB/T 321的要求。')
  })

  it('PDF 出件请求：print HTML 含清单；目次与标题都是自定义的“参考书目”，目次目标 sec_bibliography 保持', () => {
    const request = buildPdfExportRequest(pmWithNormRefs(), {})
    expect(request.html).toContain('<span class="ses-norm-ref-no">GB/T 321</span>　<span class="ses-norm-ref-title">优先数和优先数系</span>')
    expect(request.html).toContain('<h2 class="ses-bib-title">参考书目</h2>')
    expect(request.toc.map(item => [item.target, item.text, item.division])).toEqual([
      ['sec_1', '1　范围', 'body'], ['sec_2', '2　规范性引用文件', 'body'], ['sec_bibliography', '参考书目', 'body'],
    ])
  })

  it('导出前检查：docx / pdf / html 放行；旧 XML 阻断（清单、stdRef mark、自定义标题各一项）', () => {
    const { doc } = pmToIr(pmWithNormRefs())
    expect(doc.bibliographyTitle).toEqual([{ text: '参考书目' }])
    for (const format of ['docx', 'pdf', 'html', 'json'] as const) expect(getOutputBoundaryProblems(doc, format), format).toEqual([])
    expect(getOutputBoundaryProblems(doc, 'xml').map(problem => problem.path)).toEqual([
      'doc.body[0].children[0].content[1].marks[0].type',
      'doc.body[1].children[1].kind',
      'doc.bibliographyTitle',
    ])
  })
})
