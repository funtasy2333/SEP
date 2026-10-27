/**
 * WP8.M G5 排版：术语领域在定义之前输出“〈领域〉”（HTML 与 DOCX，设计 §7.1 / D-M-14）。
 *
 * 规格依据：GB/T 46687.2—2026 9.2.9（印刷页 43，原 PDF 第 47 页，已按图像核对）的示例
 * “3.1 协会 association ⏎ 〈顾客满意〉由成员组织或个人组成的组织（3.12）。”——
 * 尖括号为 〈 U+3008 与 〉 U+3009，紧接在定义之前、与定义同一行、中间无空格；
 * “附加标点符号需在渲染阶段添加”，故 IR 的 subjectField 只存领域名称，括号由本渲染器输出。
 */

import { describe, expect, it } from 'vitest'
import { resolve } from '../../ir/resolve'
import type { IRDoc, IRTermEntry } from '../../ir/types'
import { g5PrintDoc, g5Term } from '../../ir/__tests__/wp8mG5Fixtures'
import { renderDocx } from '../docx'
import { docxOutline } from '../docx/__tests__/helpers/outline'
import { assertChildOrder, assertWellFormed } from '../docx/__tests__/helpers/checks'
import { renderHtml } from '../html'

const DOCX_OPTIONS = { formulaOmml: {}, images: {}, stage: 'approval_draft' as const, createdAt: '2026-09-25T08:00:00.000Z' }

function html(doc: IRDoc, variant: 'screen' | 'print'): string {
  return renderHtml(doc, resolve(doc).labels, { variant })
}

function docx(doc: IRDoc) {
  return renderDocx(doc, resolve(doc).labels, DOCX_OPTIONS)
}

function termEntryHtml(output: string, id: string): string {
  const start = output.indexOf(`<div class="ses-term-entry" data-type="term-entry" data-node-id="${id}"`)
  expect(start, id).toBeGreaterThanOrEqual(0)
  return output.slice(start, output.indexOf('</div>', start) + '</div>'.length)
}

function firstTerm(doc: IRDoc): IRTermEntry {
  return doc.body[2]!.children[0] as IRTermEntry
}

describe('[M-9.2.9-01] HTML：“〈领域〉”在定义之前、与定义同一行', () => {
  for (const variant of ['screen', 'print'] as const) {
    it(`${variant}：领域并入定义段开头，括号由渲染器添加且仅一对`, () => {
      const entry = termEntryHtml(html(g5PrintDoc(), variant), 'g5-t1')
      expect(entry).toBe([
        '<div class="ses-term-entry" data-type="term-entry" data-node-id="g5-t1" id="sec_3.1">',
        '<p class="ses-term-num-line">3.1</p>',
        '<p class="ses-term-head"><span class="ses-term-name">协会</span>　<span class="ses-term-name-en" lang="en">association</span></p>',
        '<p class="ses-term-def" data-node-id="g5-t1.def0"><span class="ses-term-subject-field" data-type="term-subject-field">〈顾客满意〉</span>由成员组织或个人组成的组织。</p>',
        '</div>',
      ].join('\n'))
    })
  }

  it('领域排在术语名与英文名所在行之后、定义之前；不单独占段', () => {
    const entry = termEntryHtml(html(g5PrintDoc(), 'print'), 'g5-t1')
    expect(entry.indexOf('ses-term-head')).toBeLessThan(entry.indexOf('ses-term-subject-field'))
    expect(entry.indexOf('ses-term-subject-field')).toBeLessThan(entry.indexOf('由成员组织'))
    expect(entry.match(/<p /g)).toHaveLength(3) // 编号行、术语行、定义段
  })

  it('无领域的术语条目输出与此前逐字相同（不出现 span、不出现 〈〉）', () => {
    const entry = termEntryHtml(html(g5PrintDoc(), 'print'), 'g5-t2')
    expect(entry).toContain('<p class="ses-term-def" data-node-id="g5-t2.def0">没有领域字段的旧式术语条目。</p>')
    expect(entry).not.toMatch(/subject-field|〈|〉/)
    const legacy = g5PrintDoc()
    firstTerm(legacy).subjectField = []
    expect(termEntryHtml(html(legacy, 'print'), 'g5-t1')).not.toMatch(/subject-field|〈|〉/)
  })

  it('领域内的行内格式保留在括号之内；特殊字符被转义', () => {
    const output = html(g5PrintDoc(), 'print')
    expect(termEntryHtml(output, 'g5-t-marked')).toContain('〈<strong>化学</strong><sup>2</sup>〉</span>领域含粗体与上标的术语。')
    const doc = g5PrintDoc()
    firstTerm(doc).subjectField = [{ text: 'a<b & "c"' }]
    expect(termEntryHtml(html(doc, 'print'), 'g5-t1')).toContain('〈a&lt;b &amp; "c"〉')
  })

  it('多段定义时领域只加在首个定义段之前', () => {
    const doc = g5PrintDoc()
    const entry = firstTerm(doc)
    entry.definition.push({ kind: 'paragraph', id: 'g5-t1.def1', content: [{ text: '定义续段。' }] })
    const output = termEntryHtml(html(doc, 'print'), 'g5-t1')
    expect(output.match(/ses-term-subject-field"/g)).toHaveLength(1)
    expect(output).toContain('<p class="ses-term-def" data-node-id="g5-t1.def1">定义续段。</p>')
  })

  it('定义首块不是段落（原生 IR）时，领域单独成行排在定义块之前，内容不丢', () => {
    const doc = g5PrintDoc()
    const entry = firstTerm(doc)
    entry.definition = [{ kind: 'list', id: 'g5-t1.list', listType: 'dash', items: [{ id: 'g5-t1.li', content: [{ kind: 'paragraph', id: 'g5-t1.li.p', content: [{ text: '列项式定义' }] }] }] }]
    const output = termEntryHtml(html(doc, 'print'), 'g5-t1')
    expect(output).toContain('<p class="ses-term-def ses-term-subject-line"><span class="ses-term-subject-field" data-type="term-subject-field">〈顾客满意〉</span></p>')
    expect(output.indexOf('ses-term-subject-line')).toBeLessThan(output.indexOf('列项式定义'))
  })

  it('附录中的术语条目同样输出领域；渲染为纯函数', () => {
    const output = html(g5PrintDoc(), 'print')
    expect(termEntryHtml(output, 'g5-t-app')).toContain('〈附录领域〉</span>附录中的术语。')
    expect(html(g5PrintDoc(), 'print')).toBe(html(g5PrintDoc(), 'print'))
    expect(html(g5PrintDoc(), 'screen')).toBe(html(g5PrintDoc(), 'screen'))
  })

  it('全文括号数量 = 带领域条目数 × 2（IR 内容不含 〈〉，渲染器不重复添加）', () => {
    const output = html(g5PrintDoc(), 'print')
    expect(output.match(/〈/g)).toHaveLength(4)
    expect(output.match(/〉/g)).toHaveLength(4)
  })
})

describe('[M-9.2.9-01] DOCX：“〈领域〉”并入定义首段开头', () => {
  it('大纲：领域与定义在同一个 SesPara 段内，括号紧邻，术语行不含领域', () => {
    const outline = docxOutline(docx(g5PrintDoc()))
    expect(outline).toContain([
      'SesTermNum │ 3.1 │',
      'SesTermHead │ — │ 协会　association',
      'SesPara │ — │ 〈顾客满意〉由成员组织或个人组成的组织。',
      'SesTermNum │ 3.2 │',
      'SesTermHead │ — │ 无领域术语',
      'SesPara │ — │ 没有领域字段的旧式术语条目。',
    ].join('\n'))
    expect(outline).toContain('SesPara │ — │ 〈ISO 和/或 IEC 发布的〉现阶段由于标准化对象涉及的技术内容仍处在发展阶段的标准化文件。')
    expect(outline).toContain('SesPara │ — │ 〈化学2〉领域含粗体与上标的术语。')
    expect(outline.split('\n').filter(line => line.startsWith('SesTermHead') && line.includes('〈'))).toEqual([])
  })

  it('附录（非“术语和定义”章）中的术语条目同样输出领域', () => {
    expect(docxOutline(docx(g5PrintDoc()))).toContain([
      'SesTermNum │ A.1 │ 附录术语',
      'SesPara │ — │ 〈附录领域〉附录中的术语。',
    ].join('\n'))
  })

  it('XML 片段：〈、领域、〉、定义各为独立 w:r，同在一个 w:p 内；行内格式保留', () => {
    const xml = docx(g5PrintDoc()).parts['word/document.xml']!
    expect(xml).toContain([
      '<w:p><w:pPr><w:pStyle w:val="SesPara"/></w:pPr>',
      '<w:r><w:t xml:space="preserve">〈</w:t></w:r>',
      '<w:r><w:t xml:space="preserve">顾客满意</w:t></w:r>',
      '<w:r><w:t xml:space="preserve">〉</w:t></w:r>',
      '<w:r><w:t xml:space="preserve">由成员组织或个人组成的组织。</w:t></w:r></w:p>',
    ].join(''))
    expect(xml).toContain('<w:r><w:t xml:space="preserve">〈</w:t></w:r><w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">化学</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">2</w:t></w:r><w:r><w:t xml:space="preserve">〉</w:t></w:r>')
  })

  it('每个术语条目仍恰有一个定义段（领域不额外产生段落）', () => {
    const withField = docxOutline(docx(g5PrintDoc())).split('\n')
    const legacy = g5PrintDoc()
    for (const chapter of legacy.body) {
      const strip = (children: unknown[]): void => {
        for (const child of children as Array<Record<string, unknown>>) {
          if (child.kind === 'termEntry') delete child.subjectField
          else if (child.kind === 'clause') strip(child.children as unknown[])
        }
      }
      strip(chapter.children)
    }
    for (const appendix of legacy.appendices) for (const child of appendix.children) if (child.kind === 'termEntry') delete child.subjectField
    const withoutField = docxOutline(docx(legacy)).split('\n')
    expect(withField).toHaveLength(withoutField.length)
    // 去掉领域前缀后与无领域版本逐行一致。
    const stripped = withField.map(line => line.replace(/〈[^〉]*〉/, ''))
    expect(stripped).toEqual(withoutField)
  })

  it('多段定义时领域只加在首个定义段；其余段落不变', () => {
    const doc = g5PrintDoc()
    firstTerm(doc).definition.push({ kind: 'paragraph', id: 'g5-t1.def1', content: [{ text: '定义续段。' }] })
    const outline = docxOutline(docx(doc))
    expect(outline).toContain('SesPara │ — │ 〈顾客满意〉由成员组织或个人组成的组织。\nSesPara │ — │ 定义续段。')
  })

  it('定义首块不是段落（原生 IR）时，领域单独成段排在定义块之前', () => {
    const doc = g5PrintDoc()
    firstTerm(doc).definition = [{ kind: 'list', id: 'g5-t1.list', listType: 'dash', items: [{ id: 'g5-t1.li', content: [{ kind: 'paragraph', id: 'g5-t1.li.p', content: [{ text: '列项式定义' }] }] }] }]
    const lines = docxOutline(docx(doc)).split('\n')
    const subject = lines.findIndex(line => line === 'SesPara │ — │ 〈顾客满意〉')
    const list = lines.findIndex(line => line.includes('列项式定义'))
    expect(subject).toBeGreaterThan(0)
    expect(list).toBeGreaterThan(subject)
  })

  it('包结构合法、输出确定且可 JSON 往返；无新增降级告警', () => {
    const pkg = docx(g5PrintDoc())
    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
    expect(docx(g5PrintDoc())).toEqual(pkg)
    expect(JSON.parse(JSON.stringify(pkg))).toEqual(pkg)
    expect(pkg.warnings.filter(warning => warning.nodeId?.startsWith('g5-t'))).toEqual([])
  })

  it('无领域的文档输出与 subjectField=[] 逐字节一致（空数组等价于缺省）', () => {
    const empty = g5PrintDoc()
    firstTerm(empty).subjectField = []
    const absent = g5PrintDoc()
    delete firstTerm(absent).subjectField
    expect(docx(empty).parts['word/document.xml']).toBe(docx(absent).parts['word/document.xml'])
    expect(html(empty, 'print')).toBe(html(absent, 'print'))
  })
})

describe('[M-9.2.9-01] 渲染边界：单个术语条目独立验证（不依赖整篇 fixture）', () => {
  it('g5Term 构造的条目在 HTML 与 DOCX 中都输出 “〈领域〉定义”', () => {
    const doc = g5PrintDoc()
    doc.body[2]!.children = [g5Term('solo', '独立术语', '独立定义。', { subjectField: [{ text: '测量' }] })]
    expect(html(doc, 'print')).toContain('<span class="ses-term-subject-field" data-type="term-subject-field">〈测量〉</span>独立定义。</p>')
    expect(docxOutline(docx(doc))).toContain('SesPara │ — │ 〈测量〉独立定义。')
  })
})
