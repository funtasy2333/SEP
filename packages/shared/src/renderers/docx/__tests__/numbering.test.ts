/**
 * `numbering` 一致性 fixture 测试（docs/wp7-docx-delivery.md §9 WP7.2）。
 */

import { describe, expect, it } from 'vitest'
import { resolve } from '../../../ir/resolve'
import type { DocxPackage } from '../types'
import { renderDocxTraced } from '../render'
import { assertChildOrder, assertNumberingIntegrity, assertWellFormed } from './helpers/checks'
import { assertCoverage, assertExpectMarkers, assertNumberingConsistency, collectNumberedNodeIds } from './helpers/consistency'
import { docxOutline } from './helpers/outline'
import { simulateNumbering } from './helpers/numberingSim'
import { buildNumberingFixture } from './fixtures/numbering'

function buildResult() {
  const { doc, listItemExpected, applyExpectMarkers } = buildNumberingFixture()
  const { labels, problems } = resolve(doc)
  applyExpectMarkers(labels)
  const { pkg, numbered } = renderDocxTraced(doc, labels, {
    formulaOmml: {},
    images: {},
    stage: 'approval_draft',
    createdAt: '2026-09-25T08:00:00.000Z',
  })
  return { doc, labels, problems, listItemExpected, pkg, numbered }
}

describe('numbering fixture', () => {
  const { doc, labels, listItemExpected, pkg, numbered } = buildResult()

  it('assertWellFormed', () => {
    expect(() => assertWellFormed(pkg)).not.toThrow()
  })

  it('assertChildOrder', () => {
    expect(() => assertChildOrder(pkg)).not.toThrow()
  })

  it('assertNumberingIntegrity', () => {
    expect(() => assertNumberingIntegrity(pkg)).not.toThrow()
  })

  it('同一输入两次输出深度相等（纯函数）', () => {
    const again = buildResult()
    expect(pkg).toEqual(again.pkg)
    expect(numbered).toEqual(again.numbered)
  })

  it('JSON.parse(JSON.stringify(pkg)) 与原值深度相等', () => {
    expect(JSON.parse(JSON.stringify(pkg))).toEqual(pkg)
  })

  it('§4.7 比对：模拟器输出与 numbered/labels 逐段一致', () => {
    expect(() => assertNumberingConsistency(pkg, numbered, labels, listItemExpected)).not.toThrow()
  })

  it('§4.7 覆盖：IR 中每个章/条/术语条目/附录/图/表/注/示例/参考文献条目在 numbered 中恰好出现一次', () => {
    expect(() => assertCoverage(numbered, collectNumberedNodeIds(doc))).not.toThrow()
  })

  it('期望标记：〔期望…〕/〔前段期望…〕/〔附录期望…〕都与模拟器标识一致', () => {
    expect(() => assertExpectMarkers(simulateNumbering(pkg))).not.toThrow()
  })

  it('warnings 与期望列表完全一致（封面素材提示、boxed退化、两处三层嵌套）', () => {
    const codes = pkg.warnings.map((w) => w.code).sort()
    const structural = codes.filter((code) => code !== 'image-missing' && code !== 'formula-missing-omml')
    expect(structural).toEqual(['cover-asset-approximation', 'list-format-fallback', 'list-too-deep', 'list-too-deep', 'toc-pages-pending'].sort())
  })

  it('术语和定义章的术语另行起排，其他章节和附录的测试术语与编号同排', () => {
    const outline = docxOutline(pkg)
    expect(outline).toContain('SesTermNum │ 3.1 │')
    expect(outline).toContain('SesTermHead │ — │ 标准')
    expect(outline).toContain('SesTermNum │ 4.1.2 │ 图序术语')
    expect(outline).toContain('SesTermNum │ A.1 │ 附录术语')
    expect(outline).not.toContain('SesTermHead │ — │ 图序术语')
    expect(outline).not.toContain('SesTermHead │ — │ 附录术语')
  })

  it('术语来源使用专用宋体段落样式', () => {
    expect(docxOutline(pkg)).toContain('SesTermSource │ — │ [来源：GB/T 20000.1—2014，5.3]')
  })

  it('附录编号、性质、标题分段，后两行由独立居中样式承载', () => {
    const outline = docxOutline(pkg)
    expect(outline).toContain('SesAppendix │ 附录A │')
    expect(outline).toContain('SesAppendixKind │ — │ （规范性）')
    expect(outline).toContain('SesAppendixTitle │ — │ 附录内容一')
  })

  it('大纲快照', () => {
    expect(docxOutline(pkg)).toMatchSnapshot()
  })

  it('golden 目录：每个部件落一个文件，供 Word 核对', async () => {
    for (const path of Object.keys(pkg.parts).sort()) {
      await expect(pkg.parts[path]).toMatchFileSnapshot(`./__golden__/numbering/${path}`)
    }
    for (const path of Object.keys(pkg.binaries).sort()) {
      await expect(pkg.binaries[path]).toMatchFileSnapshot(`./__golden__/numbering/${path}.b64`)
    }
  })
})

// 供其他测试文件（如 word 核对脚本前置检查）复用的构建函数
export { buildResult as buildNumberingFixtureResult }
export type { DocxPackage }
