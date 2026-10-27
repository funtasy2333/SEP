/**
 * WP8.M M-Z-a：Resolver unsupported-content error 阻断非 JSON 出口，在 io 导出前检查与真实出件链路上的表现
 * （docs/wp8.m/design.md §7.1「主导人决定（2026-10-26）」；规则与 shared 侧边界测试见
 * shared/src/renderers/__tests__/wp8mResolverBoundary.test.ts）。
 *
 * 用例：规范性引用清单放在非 norm-refs 章（M-4.4.2.3-02），生产 PM 文档合法、pmToIr 无诊断，
 * 但 Resolver 报 unsupported-content error。导出前检查对 docx / pdf / xml / html 报 output-boundary 失败，
 * json 不检查；buildDocx 等真实出件入口不会静默输出。
 */

import { describe, expect, it } from 'vitest'
import { UnsupportedOutputError, pmToIr, resolve, type PMJsonNode } from '@ses/shared'
import { buildDocx } from './docx'
import { checkExportGuard, type ExportGuardFormat } from './exportGuard'

const text = (value: string): PMJsonNode => ({ type: 'text', text: value })
const paragraph = (nodeId: string, value: string): PMJsonNode => ({ type: 'stdParagraph', attrs: { nodeId }, content: [text(value)] })
const std = (nodeId: string, ref: string, title: string): PMJsonNode => ({
  type: 'normRefStd', attrs: { nodeId }, content: [
    { type: 'normRefStdRef', content: [text(ref)] },
    { type: 'normRefStdTitle', content: [text(title)] },
  ],
})

function pmWith(secType: string): PMJsonNode {
  return {
    type: 'standardDoc',
    attrs: { standardType: 'national', titleCn: '边界样稿', standardNo: 'GB/T 12345—2026', extensionVersion: 1 },
    content: [
      { type: 'chapter', attrs: { nodeId: 'ch1', secType: 'scope' }, content: [
        { type: 'chapterTitle', content: [text('范围')] },
        paragraph('ch1-p', '本文件规定了引用写法。'),
      ] },
      { type: 'chapter', attrs: { nodeId: 'ch2', secType }, content: [
        { type: 'chapterTitle', content: [text('规范性引用文件')] },
        paragraph('ch2-lead', '下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。'),
        { type: 'normRefList', attrs: { nodeId: 'nrl' }, content: [std('nr-1', 'GB/T 321', '优先数和优先数系')] },
      ] },
    ],
  }
}

const BLOCKED: ExportGuardFormat[] = ['docx', 'pdf', 'xml', 'html']

describe('[M-4.4.2.3-02] io 导出前检查：清单位置非法（Resolver unsupported-content error）阻断 docx / pdf / xml / html', () => {
  it('前提：生产 PM 合法、pmToIr 无诊断；Resolver 报 unsupported-content error，节点为清单', () => {
    const { doc } = pmToIr(pmWith('general'))
    expect(doc.unsupportedContent).toBeUndefined()
    expect(resolve(doc).problems.filter(problem => problem.code === 'unsupported-content' && problem.severity === 'error').map(problem => problem.nodeId)).toEqual(['nrl'])
  })

  it.each(BLOCKED)('%s：checkExportGuard 返回 output-boundary 失败，问题带 nodeId、固定路径与 Resolver 原文案', format => {
    const failure = checkExportGuard(pmWith('general'), format)
    expect(failure).not.toBeNull()
    expect(failure!.source).toBe('output-boundary')
    // xml 另有 G1 既有的 kind 阻断（清单 kind 本身不在旧 XML 字段表内），这里只看 Resolver 来源的一条
    expect(failure!.problems.filter(problem => problem.path === 'resolver.problems[unsupported-content]')).toEqual([expect.objectContaining({
      source: 'output-boundary', code: 'unsupported-output', nodeId: 'nrl', path: 'resolver.problems[unsupported-content]',
      message: expect.stringContaining('规范性引用文件清单只能出现在「规范性引用文件」章'),
    })])
    expect(failure!.detail).toContain('节点 nrl')
  })

  it('json：不做导出前检查，保留原稿', () => {
    expect(checkExportGuard(pmWith('general'), 'json')).toBeNull()
  })

  it('清单在 norm-refs 章的同一文档：docx / pdf / html 的前置检查通过（回归）；xml 仍只因清单 kind 被阻断（G1 既有口径），没有 Resolver 来源的问题', () => {
    for (const format of ['docx', 'pdf', 'html'] as const) expect(checkExportGuard(pmWith('norm-refs'), format), format).toBeNull()
    const xml = checkExportGuard(pmWith('norm-refs'), 'xml')
    expect(xml!.problems.map(problem => problem.path)).toEqual(['doc.body[1].children[1].kind'])
  })

  it('buildDocx 直接抛 UnsupportedOutputError，不会生成含违规清单的 DOCX；合法位置的同一文档可以生成', async () => {
    await expect(buildDocx({ pmDoc: pmWith('general'), createdAt: '2026-10-26T08:00:00Z' })).rejects.toBeInstanceOf(UnsupportedOutputError)
    const ok = await buildDocx({ pmDoc: pmWith('norm-refs'), createdAt: '2026-10-26T08:00:00Z' })
    expect(ok.bytes.byteLength).toBeGreaterThan(0)
  })
})
