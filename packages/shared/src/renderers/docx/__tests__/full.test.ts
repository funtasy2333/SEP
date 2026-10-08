/**
 * `full` 一致性 fixture 测试（docs/wp7-docx-delivery.md §9 WP7.2）。
 *
 * `pmToIr(fullRendererFixture()).doc` 经 `resolve` 的结果。列项手写期望 li-1 → a）、
 * li-2 → b）（stdList('list-1', 'alpha', ['li-1', ...], ['li-2', ...])，Resolver 不给列项编号）。
 */

import { describe, expect, it } from 'vitest'
import { fullRendererFixture } from '../../__tests__/fullRendererFixture'
import { pmToIr } from '../../../ir/pmToIr'
import { resolve } from '../../../ir/resolve'
import { renderDocxTraced } from '../render'
import { assertChildOrder, assertNumberingIntegrity, assertWellFormed } from './helpers/checks'
import { assertCoverage, assertNumberingConsistency, collectNumberedNodeIds } from './helpers/consistency'
import { docxOutline } from './helpers/outline'

const LIST_ITEM_EXPECTED = new Map<string, string>([
  ['li-1', 'a）'],
  ['li-2', 'b）'],
])

function buildResult() {
  const { doc } = pmToIr(fullRendererFixture())
  const { labels, problems } = resolve(doc)
  expect(problems.filter((problem) => problem.code === 'dangling-xref' || problem.code === 'dangling-typed-ref')).toEqual([])
  const { pkg, numbered } = renderDocxTraced(doc, labels, {
    formulaOmml: {},
    images: {},
    stage: 'approval_draft',
    createdAt: '2026-09-25T08:00:00.000Z',
  })
  return { doc, labels, problems, pkg, numbered }
}

describe('full fixture (pmToIr(fullFixture()) → resolve)', () => {
  const { doc, labels, pkg, numbered } = buildResult()

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
    expect(() => assertNumberingConsistency(pkg, numbered, labels, LIST_ITEM_EXPECTED)).not.toThrow()
  })

  it('§4.7 覆盖：IR 中每个章/条/术语条目/附录/图/表/注/示例/参考文献条目在 numbered 中恰好出现一次', () => {
    expect(() => assertCoverage(numbered, collectNumberedNodeIds(doc))).not.toThrow()
  })

  it('大纲快照', () => {
    expect(docxOutline(pkg)).toMatchSnapshot()
  })

  it('golden 目录：每个部件落一个文件，供 Word 核对', async () => {
    for (const path of Object.keys(pkg.parts).sort()) {
      await expect(pkg.parts[path]).toMatchFileSnapshot(`./__golden__/full/${path}`)
    }
    for (const path of Object.keys(pkg.binaries).sort()) {
      await expect(pkg.binaries[path]).toMatchFileSnapshot(`./__golden__/full/${path}.b64`)
    }
  })
})
