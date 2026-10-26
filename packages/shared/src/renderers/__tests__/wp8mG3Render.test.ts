/**
 * WP8.M G3 渲染回归：图注 figure.notes（M-8.2-11）在 HTML（screen/print）与 DOCX 中的排版。
 *
 * 设计 §3.4/§4.3：figure.notes 是 G3 唯一的“新放行”——渲染器（html.ts renderFigure、docx/body/block.ts renderFigure）
 * 早已逐条输出图注，只是此前生产 PM 存不住图注（irToPm 直接报错），现在经 PM 保存的图注首次到达渲染器。
 * 这里补回归：标签只来自 Resolver（作用域 = 本图：单条 `注：`，多条 `注1：/注2：`），渲染器不自行编号；
 * 既有快照（不含图注的图）不受影响。
 *
 * 图例 legend、图中示例 examples、行内图 image 本阶段不排版，被边界阻断（见 wp8mG3Boundary.test.ts）。
 */

import { describe, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '../../ir/pmToIr'
import { resolve } from '../../ir/resolve'
import type { IRDoc } from '../../ir/types'
import { chapter as pmChapter, text as pmText } from '../../ir/__tests__/fixtures'
import { g3Figure, g3Note, para, pmFigure, pmFigureNote } from '../../ir/__tests__/wp8mG3Fixtures'
import { renderDocx } from '../docx'
import { renderDocxTraced } from '../docx/render'
import { assertChildOrder, assertNumberingIntegrity, assertWellFormed } from '../docx/__tests__/helpers/checks'
import { assertCoverage, assertNumberingConsistency, collectNumberedNodeIds } from '../docx/__tests__/helpers/consistency'
import { docxOutline } from '../docx/__tests__/helpers/outline'
import { renderHtml } from '../html'
import { getOutputSupportProblems } from '../outputBoundary'

const docxOptions = { formulaOmml: {}, images: {}, stage: 'approval_draft' as const, createdAt: '2026-10-26T00:00:00.000Z' }

/** 图一两条注、图二一条注、章内一条注（用来证明图注作用域独立于章）；另有一幅没有注的图。 */
function notesDoc(): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb', title: 'G3 图注', stdCode: 'GB/T 99999—2026' },
    front: { foreword: [], introduction: [] },
    body: [{
      kind: 'chapter', id: 'r-ch', secType: 'general', title: [{ text: '图注测试' }],
      children: [
        para('r-p', { text: '引导语。' }),
        g3Figure('r-f1', '图一', { notes: [g3Note('r-f1-n1', { text: '图注一。' }), g3Note('r-f1-n2', { text: '图注二。' })] }),
        g3Figure('r-f2', '图二', { notes: [g3Note('r-f2-n1', { text: '唯一图注。' })] }),
        g3Figure('r-f3', '图三'),
        g3Note('r-cn', { text: '章内的注。' }),
      ],
    }],
    appendices: [],
    bibliography: [],
  }
}

function html(doc: IRDoc, variant: 'screen' | 'print'): string {
  return renderHtml(doc, resolve(doc).labels, { variant })
}

/** 取出某幅图的 <figure> 片段，并把 data URI 换成占位以便断言。 */
function figureHtml(output: string, id: string): string {
  const start = output.indexOf(`data-node-id="${id}"`)
  expect(start, id).toBeGreaterThanOrEqual(0)
  const from = output.lastIndexOf('<figure', start)
  return output.slice(from, output.indexOf('</figure>', start) + '</figure>'.length).replace(/data:image[^"]+/g, 'DATA')
}

describe('[M-8.2-11] HTML：图注逐条输出，标签只取自 Resolver（作用域 = 本图）', () => {
  for (const variant of ['screen', 'print'] as const) {
    it(`${variant}：图一两条注 注1：/注2：，图二唯一注 注：；注位于图题之后、</figure> 之前；id 取 note_<n>`, () => {
      const output = html(notesDoc(), variant)
      expect(figureHtml(output, 'r-f1')).toBe([
        '<figure class="ses-figure-block" data-type="figure" data-orientation="portrait" data-node-id="r-f1" id="fig_1">',
        '<img class="ses-figure-image" src="DATA" alt="图一" />',
        '<figcaption class="ses-figure-caption">图1　图一</figcaption>',
        '<div class="ses-note" data-type="note" data-node-id="r-f1-n1" id="note_1"><span class="ses-note-marker">注1：</span>图注一。</div>',
        '<div class="ses-note" data-type="note" data-node-id="r-f1-n2" id="note_2"><span class="ses-note-marker">注2：</span>图注二。</div>',
        '</figure>',
      ].join('\n'))
      expect(figureHtml(output, 'r-f2')).toContain('<div class="ses-note" data-type="note" data-node-id="r-f2-n1" id="note_3"><span class="ses-note-marker">注：</span>唯一图注。</div>')
    })
  }

  it('没有图注的图输出与此前逐字相同（无注区块）；章内的注不受图注影响，仍是 注：', () => {
    const output = html(notesDoc(), 'print')
    const third = figureHtml(output, 'r-f3')
    expect(third).not.toContain('ses-note')
    expect(third).toBe([
      '<figure class="ses-figure-block" data-type="figure" data-orientation="portrait" data-node-id="r-f3" id="fig_3">',
      '<img class="ses-figure-image" src="DATA" alt="图三" />',
      '<figcaption class="ses-figure-caption">图3　图三</figcaption>',
      '</figure>',
    ].join('\n'))
    expect(output).toContain('<div class="ses-note" data-type="note" data-node-id="r-cn" id="note_4"><span class="ses-note-marker">注：</span>章内的注。</div>')
  })

  it('渲染器不自行编号：把 Resolver 的标签换掉，输出里的标记随之改变', () => {
    const doc = notesDoc()
    const labels = structuredClone(resolve(doc).labels)
    labels['r-f1-n1']!.label = '注甲：'
    const output = renderHtml(doc, labels, { variant: 'print' })
    expect(figureHtml(output, 'r-f1')).toContain('<span class="ses-note-marker">注甲：</span>图注一。')
  })

  it('纯函数：同样输入两次输出字节级相同', () => {
    for (const variant of ['screen', 'print'] as const) expect(html(notesDoc(), variant)).toBe(html(notesDoc(), variant))
  })
})

describe('[M-8.2-11] DOCX：图注逐条输出（SesNoteN/SesNote），位于图片之后、图题之前，编号与 Resolver 一致', () => {
  const doc = notesDoc()
  const { labels, problems } = resolve(doc)
  const { pkg, numbered } = renderDocxTraced(doc, labels, docxOptions)

  it('Resolver 无 error；边界对 DOCX / HTML 放行', () => {
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(getOutputSupportProblems(doc, 'DOCX')).toEqual([])
    expect(getOutputSupportProblems(doc, 'HTML')).toEqual([])
  })

  it('大纲（Word 编号模拟器）：图一 注1：/注2：（SesNoteN），图二 注：（SesNote），再到图题；章内的注 注：', () => {
    const lines = docxOutline(pkg).split('\n')
    const body = lines.slice(lines.indexOf('SesPara │ — │ 引导语。'), lines.indexOf('SesEndMark │ — │'))
    expect(body).toEqual([
      'SesPara │ — │ 引导语。',
      'SesFigure │ — │ 〔图片缺失〕',
      'SesNoteN │ 注1： │ 图注一。',
      'SesNoteN │ 注2： │ 图注二。',
      'SesFigCap │ 图1 │ 图一',
      'SesFigure │ — │ 〔图片缺失〕',
      'SesNote │ 注： │ 唯一图注。',
      'SesFigCap │ 图2 │ 图二',
      'SesFigure │ — │ 〔图片缺失〕',
      'SesFigCap │ 图3 │ 图三',
      'SesNote │ 注： │ 章内的注。',
    ])
  })

  it('§4.7 一致性：模拟器标识与 Resolver 标签逐段一致；图注在 numbered 中恰好出现一次，顺序即文档序', () => {
    expect(() => assertNumberingConsistency(pkg, numbered, labels, new Map())).not.toThrow()
    expect(() => assertCoverage(numbered, collectNumberedNodeIds(doc))).not.toThrow()
    expect(numbered.filter(trace => trace.kind === 'note').map(trace => trace.nodeId)).toEqual(['r-f1-n1', 'r-f1-n2', 'r-f2-n1', 'r-cn'])
  })

  it('包结构合法：well-formed、子元素顺序、编号完整性；输出确定', () => {
    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
    expect(() => assertNumberingIntegrity(pkg)).not.toThrow()
    expect(renderDocx(doc, resolve(doc).labels, docxOptions)).toEqual(pkg)
  })

  it('XML 片段：多条注的首段挂 SesNoteN 编号实例（numPr），单条注无 numPr；图注段落不带书签以外的额外内容', () => {
    const xml = pkg.parts['word/document.xml']!
    expect(xml.match(/<w:pStyle w:val="SesNoteN"\/>/g)).toHaveLength(2)
    expect(xml.match(/<w:pStyle w:val="SesNote"\/>/g)).toHaveLength(2) // 图二唯一注 + 章内注
    expect(xml).toContain('<w:t xml:space="preserve">图注一。</w:t>')
    expect(xml).toContain('<w:t xml:space="preserve">唯一图注。</w:t>')
  })
})

describe('[M-8.2-11] 经生产 PM 保存的图注到达渲染器：PM → IR → HTML / DOCX 与手写 IR 输出一致', () => {
  const pm: PMJsonNode = {
    type: 'doc',
    content: [pmChapter('r-ch', '图注测试',
      pmFigure('r-f1', '图一', pmFigureNote('r-f1-n1', pmText('图注一。')), pmFigureNote('r-f1-n2', pmText('图注二。'))),
      pmFigure('r-f2', '图二', pmFigureNote('r-f2-n1', pmText('唯一图注。'))),
    )],
  }
  const { doc, warnings } = pmToIr(pm)

  it('pmToIr 无警告；图注进入 IRFigure.notes；边界放行', () => {
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent ?? []).toEqual([])
    expect(getOutputSupportProblems(doc, 'HTML')).toEqual([])
    expect(getOutputSupportProblems(doc, 'DOCX')).toEqual([])
  })

  it('HTML：图注标签 注1：/注2：/注：', () => {
    const output = html(doc, 'print')
    expect(output).toContain('<span class="ses-note-marker">注1：</span>图注一。')
    expect(output).toContain('<span class="ses-note-marker">注2：</span>图注二。')
    expect(output).toContain('<span class="ses-note-marker">注：</span>唯一图注。')
  })

  it('DOCX：图注段落样式与编号', () => {
    const { pkg } = renderDocxTraced(doc, resolve(doc).labels, docxOptions)
    const lines = docxOutline(pkg).split('\n')
    expect(lines).toEqual(expect.arrayContaining(['SesNoteN │ 注1： │ 图注一。', 'SesNoteN │ 注2： │ 图注二。', 'SesNote │ 注： │ 唯一图注。']))
  })
})
