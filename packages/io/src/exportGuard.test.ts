import { describe, expect, it } from 'vitest'
import { getOutputSupportProblems, pmToIr, resolve, type PMJsonNode } from '@ses/shared'
import {
  checkExportGuard,
  formatFootnoteExportError,
  formatOutputBoundaryDetail,
  formatOutputBoundaryMessage,
  getFootnoteExportError,
  getFootnoteExportProblems,
  getOutputBoundaryProblems,
  outputBoundaryFormatOf,
  type ExportGuardFormat,
} from './exportGuard'

const text = (value: string, marks?: PMJsonNode['marks']): PMJsonNode =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value }

function standardDoc(...children: PMJsonNode[]): PMJsonNode {
  return {
    type: 'standardDoc',
    attrs: { standardType: 'national' },
    content: [{
      type: 'chapter',
      attrs: { nodeId: 'chapter-1' },
      content: [{ type: 'chapterTitle', content: [text('范围')] }, ...children],
    }],
  }
}

function paragraph(nodeId: string, ...content: PMJsonNode[]): PMJsonNode {
  return { type: 'stdParagraph', attrs: { nodeId }, content }
}

/** 一张只有一个单元格的表；refs 为单元格内的表脚注引用，definitions 为表脚注定义 id。 */
function footnoteTable(nodeId: string, refs: string[], definitions: string[]): PMJsonNode {
  const content: PMJsonNode[] = [
    { type: 'tableCaption', content: [text('尺寸表')] },
    {
      type: 'table',
      content: [{
        type: 'tableRow',
        content: [{
          type: 'tableCell',
          attrs: { colspan: 1, rowspan: 1 },
          content: [{
            type: 'paragraph',
            content: [text('尺寸'), ...refs.map((targetId): PMJsonNode => ({ type: 'tableFootnoteRef', attrs: { targetId } }))],
          }],
        }],
      }],
    },
  ]
  if (definitions.length) {
    content.push({
      type: 'tableFootnoteRow',
      content: definitions.map((id): PMJsonNode => ({
        type: 'tableFootnoteEntry', attrs: { nodeId: id }, content: [text(`${id}的说明`)],
      })),
    })
  }
  return { type: 'stdTable', attrs: { nodeId }, content }
}

const subSup = (): PMJsonNode['marks'] => [{ type: 'subscript' }, { type: 'superscript' }]

const CLEAN = standardDoc(paragraph('p1', text('正文')))
const DANGLING = standardDoc(footnoteTable('t1', ['missing'], []))
const UNREFERENCED = standardDoc(footnoteTable('t1', [], ['unused']))
const MANY_FOOTNOTE_ERRORS = standardDoc(
  footnoteTable('t1', ['missing'], ['unused']),
  footnoteTable('t2', ['missing'], []),
)
const SUB_SUP_ONE = standardDoc(paragraph('p1', text('H2O', subSup())))
const SUB_SUP_MANY = standardDoc(
  paragraph('p1', text('甲', subSup())),
  paragraph('p2', text('乙', subSup())),
  paragraph('p3', text('丙', subSup())),
)
// 脚注错误与输出边界问题同时存在时，脚注校验优先。
const FOOTNOTE_AND_BOUNDARY = standardDoc(footnoteTable('t1', ['missing'], []), paragraph('p1', text('H2O', subSup())))

const ALL_DOCS: Record<string, PMJsonNode> = {
  CLEAN, DANGLING, UNREFERENCED, MANY_FOOTNOTE_ERRORS, SUB_SUP_ONE, SUB_SUP_MANY, FOOTNOTE_AND_BOUNDARY,
}
const ALL_FORMATS: ExportGuardFormat[] = ['docx', 'pdf', 'xml', 'html', 'json']

/** 迁移前 EditorView.vue 的脚注校验原文（逐字保留），作为文本一致性的对照。 */
function legacyGetFootnoteExportError(doc: { toJSON(): unknown }): string {
  const { doc: irDoc } = pmToIr(doc.toJSON() as PMJsonNode)
  const errors = resolve(irDoc).problems.filter((problem) =>
    problem.severity === 'error'
    && ['dangling-footnote', 'unreferenced-footnote', 'invalid-footnote'].includes(problem.code),
  )
  if (!errors.length) return ''
  const details = [...new Set(errors.map((problem) => problem.message))]
  return `脚注校验未通过，暂不能导出：${details.join('；')}`
}

/** 迁移前 EditorView.vue handleExportFormat 中两道检查的原文（逐字保留），返回 exportError 与 ElMessage 文本。 */
function legacyHandleExportChecks(
  doc: { toJSON(): unknown },
  format: ExportGuardFormat,
): { exportError: string; message: string } | null {
  if (format !== 'json') {
    const footnoteError = legacyGetFootnoteExportError(doc)
    if (footnoteError) return { exportError: footnoteError, message: footnoteError }
  }
  if (format !== 'json') {
    const outputFormat = format === 'docx' ? 'DOCX' : format === 'xml' ? 'XML' : 'HTML'
    const problems = getOutputSupportProblems(pmToIr(doc.toJSON() as PMJsonNode).doc, outputFormat)
    if (problems.length) {
      const details = problems.map((problem) => {
        const location = [
          problem.nodeId ? `节点 ${problem.nodeId}` : '',
          problem.path ? `位置 ${problem.path}` : '',
        ].filter(Boolean).join('，')
        return `${problem.message}${location ? `【${location}】` : ''}`
      }).join('；')
      const exportError = `导出被阻止：${details}`
      const firstProblem = problems[0]!
      const message = problems.length > 1
        ? `导出被阻止：${firstProblem.message}（另有 ${problems.length - 1} 项，详见导出详情）`
        : `导出被阻止：${firstProblem.message}`
      return { exportError, message }
    }
  }
  return null
}

describe('exportGuard 脚注校验', () => {
  it('悬空引用与未引用定义给出与迁移前逐字一致的提示', () => {
    const dangling = getFootnoteExportError(DANGLING)
    expect(dangling).toMatch(/^脚注校验未通过，暂不能导出：/)
    expect(dangling).toBe(legacyGetFootnoteExportError({ toJSON: () => DANGLING }))
    expect(getFootnoteExportError(UNREFERENCED)).toMatch(/^脚注校验未通过，暂不能导出：/)
    expect(getFootnoteExportError(CLEAN)).toBe('')
  })

  it('接受带 toJSON() 的对象（如 ProseMirror 节点），与直接传 JSON 结果相同', () => {
    for (const json of [DANGLING, UNREFERENCED, CLEAN]) {
      expect(getFootnoteExportError({ toJSON: () => json })).toBe(getFootnoteExportError(json))
    }
  })

  it('同一条消息只出现一次，多条消息以全角分号连接', () => {
    const { doc } = pmToIr(MANY_FOOTNOTE_ERRORS)
    const problems = getFootnoteExportProblems(doc)
    expect(problems.length).toBeGreaterThanOrEqual(3)
    expect(problems.every((problem) => problem.source === 'footnote')).toBe(true)
    const messages = [...new Set(problems.map((problem) => problem.message))]
    expect(formatFootnoteExportError(problems)).toBe(`脚注校验未通过，暂不能导出：${messages.join('；')}`)
    expect(formatFootnoteExportError([])).toBe('')
  })

  it('返回结构化问题：code、中文 message，且只含会阻止导出的脚注错误', () => {
    const { doc } = pmToIr(DANGLING)
    const problems = getFootnoteExportProblems(doc)
    expect(problems).toEqual([
      expect.objectContaining({ source: 'footnote', code: 'dangling-footnote', message: expect.any(String) }),
    ])
    expect(getFootnoteExportProblems(pmToIr(CLEAN).doc)).toEqual([])
  })
})

describe('exportGuard 输出边界检查', () => {
  it('格式映射：docx→DOCX、xml→XML、其余→HTML、json 不检查', () => {
    expect(outputBoundaryFormatOf('docx')).toBe('DOCX')
    expect(outputBoundaryFormatOf('xml')).toBe('XML')
    expect(outputBoundaryFormatOf('html')).toBe('HTML')
    expect(outputBoundaryFormatOf('pdf')).toBe('HTML')
    expect(outputBoundaryFormatOf('json')).toBeUndefined()
  })

  it('下标与上标同时存在时仅 DOCX 被阻止，文本与迁移前逐字一致', () => {
    const { doc } = pmToIr(SUB_SUP_ONE)
    const problems = getOutputBoundaryProblems(doc, 'docx')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ source: 'output-boundary', code: 'unsupported-output', nodeId: 'p1' })
    expect(formatOutputBoundaryDetail(problems)).toBe(
      `导出被阻止：DOCX 不能在同一文本中同时保留下标和上标；行内格式只能保存一种垂直对齐。请保留 JSON 文档。【节点 p1，位置 ${problems[0]!.path}】`,
    )
    expect(formatOutputBoundaryMessage(problems)).toBe(
      '导出被阻止：DOCX 不能在同一文本中同时保留下标和上标；行内格式只能保存一种垂直对齐。请保留 JSON 文档。',
    )
    for (const format of ['xml', 'html', 'pdf', 'json'] as const) {
      expect(getOutputBoundaryProblems(doc, format)).toEqual([])
    }
  })

  it('多项问题时简短提示带“另有 N 项”，详情逐项以全角分号连接', () => {
    const { doc } = pmToIr(SUB_SUP_MANY)
    const problems = getOutputBoundaryProblems(doc, 'docx')
    expect(problems).toHaveLength(3)
    expect(formatOutputBoundaryMessage(problems)).toBe(
      `导出被阻止：${problems[0]!.message}（另有 2 项，详见导出详情）`,
    )
    const detail = formatOutputBoundaryDetail(problems)
    expect(detail.startsWith('导出被阻止：')).toBe(true)
    expect(detail.split('；').filter((part) => part.includes('【节点 p'))).toHaveLength(3)
    expect(formatOutputBoundaryDetail([])).toBe('')
    expect(formatOutputBoundaryMessage([])).toBe('')
  })

  it('无节点或路径时详情省略位置后缀', () => {
    expect(formatOutputBoundaryDetail([
      { source: 'output-boundary', code: 'unsupported-output', message: '无定位', path: '' },
    ])).toBe('导出被阻止：无定位')
    expect(formatOutputBoundaryDetail([
      { source: 'output-boundary', code: 'unsupported-output', message: '仅路径', path: 'doc.meta.x' },
      { source: 'output-boundary', code: 'unsupported-output', message: '仅节点', path: '', nodeId: 'n1' },
    ])).toBe('导出被阻止：仅路径【位置 doc.meta.x】；仅节点【节点 n1】')
  })
})

describe('checkExportGuard 与迁移前 EditorView 逻辑逐项一致', () => {
  for (const [name, json] of Object.entries(ALL_DOCS)) {
    for (const format of ALL_FORMATS) {
      it(`${name} / ${format}`, () => {
        // 同时验证 JSON 与带 toJSON() 的对象两种入参
        for (const input of [json, { toJSON: () => json }]) {
          const legacy = legacyHandleExportChecks({ toJSON: () => json }, format)
          const actual = checkExportGuard(input, format)
          if (!legacy) {
            expect(actual).toBeNull()
          } else {
            expect(actual).not.toBeNull()
            expect(actual!.detail).toBe(legacy.exportError)
            expect(actual!.message).toBe(legacy.message)
          }
        }
      })
    }
  }

  it('脚注错误优先于输出边界问题，且两者的 source 区分明确', () => {
    const footnoteFirst = checkExportGuard(FOOTNOTE_AND_BOUNDARY, 'docx')
    expect(footnoteFirst?.source).toBe('footnote')
    expect(footnoteFirst?.detail).toBe(footnoteFirst?.message)
    expect(footnoteFirst?.problems.every((problem) => problem.source === 'footnote')).toBe(true)

    const boundary = checkExportGuard(SUB_SUP_ONE, 'docx')
    expect(boundary?.source).toBe('output-boundary')
    expect(boundary?.problems).toHaveLength(1)
    expect(boundary?.detail).toContain('【节点 p1，位置 ')
  })

  it('json 格式两道检查都跳过；干净文档全部格式通过', () => {
    for (const name of Object.keys(ALL_DOCS)) {
      expect(checkExportGuard(ALL_DOCS[name]!, 'json')).toBeNull()
    }
    for (const format of ALL_FORMATS) expect(checkExportGuard(CLEAN, format)).toBeNull()
  })
})
