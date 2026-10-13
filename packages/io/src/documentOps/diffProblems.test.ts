import { describe, expect, it } from 'vitest'
import type { IRProblem } from '@ses/shared'
import { applyDocumentOperations, diffProblems } from './apply'
import { chapter, clause, doc, para, seqIds, text } from './testFixtures'

const problem = (code: IRProblem['code'], nodeId: string | null, message: string, severity: IRProblem['severity'] = 'warning'): IRProblem =>
  ({ code, nodeId, message, severity })

describe('diffProblems：Resolver 问题的新旧对比', () => {
  it('完全相同的问题都不是新引入的', () => {
    const list = [problem('dangling-xref', 'a', '目标「x」不存在', 'error'), problem('empty-section', 'b', '「第1章」没有任何内容')]
    expect(diffProblems(list, list).map(item => item.introduced)).toEqual([false, false])
  })

  it('同一节点、同一代码的消息因编号变化而不同，仍视为原有问题', () => {
    const before = [problem('hanging-paragraph', 'c1', '「第1章」含有子条，同时直接含有正文段（悬置段），GB/T 1.1 不允许')]
    const after = [problem('hanging-paragraph', 'c1', '「第2章」含有子条，同时直接含有正文段（悬置段），GB/T 1.1 不允许')]
    expect(diffProblems(before, after)).toEqual([{ ...after[0], introduced: false }])
  })

  it('同一节点多个同代码问题：精确匹配优先，多出来的才是新引入', () => {
    const before = [problem('dangling-xref', 'p', '目标「甲」不存在', 'error')]
    const after = [problem('dangling-xref', 'p', '目标「乙」不存在', 'error'), problem('dangling-xref', 'p', '目标「甲」不存在', 'error')]
    expect(diffProblems(before, after).map(item => [item.message, item.introduced])).toEqual([
      ['目标「乙」不存在', true], ['目标「甲」不存在', false],
    ])
  })

  it('严重程度或节点不同的问题是新的；消失的问题不出现在结果里', () => {
    const before = [problem('empty-section', 'a', 'x'), problem('empty-section', 'gone', 'y')]
    const after = [problem('empty-section', 'a', 'x'), problem('empty-section', 'b', 'x'), problem('empty-section', 'a', 'x', 'error')]
    expect(diffProblems(before, after).map(item => [item.nodeId, item.severity, item.introduced])).toEqual([
      ['a', 'warning', false], ['b', 'warning', true], ['a', 'error', true],
    ])
  })

  it('缺少 id 的占位 id（编号会随位置变化）按同一个处理', () => {
    const before = [problem('missing-id', '__missing-3', '缺少 id', 'error')]
    const after = [problem('missing-id', '__missing-4', '缺少 id', 'error')]
    expect(diffProblems(before, after)[0]!.introduced).toBe(false)
    expect(diffProblems([], after)[0]!.introduced).toBe(true)
  })

  it('nodeId 为 null 的问题也能配对', () => {
    const list = [problem('unsupported-content', null, '某内容', 'error')]
    expect(diffProblems(list, list)[0]!.introduced).toBe(false)
  })
})

describe('规模', () => {
  it('3 千个块的文档上执行 40 个操作在合理时间内完成', () => {
    const chapters = Array.from({ length: 150 }, (_, c) => chapter(`c${c}`, `章${c}`,
      ...Array.from({ length: 4 }, (__, k) => clause(`c${c}k${k}`, 1, `条${k}`,
        ...Array.from({ length: 5 }, (___, p) => para(`c${c}k${k}p${p}`, text(`段落 ${c}-${k}-${p}`)))))))
    const big = doc(...chapters)
    const operations = Array.from({ length: 40 }, (_, i) => i % 2 === 0
      ? { op: 'insert', parent: `c${i}k1`, position: 'end', content: [`新段落 ${i}`] }
      : { op: 'delete', nodeId: `c${i}k2p3` })
    const started = Date.now()
    const result = applyDocumentOperations(big, operations, { generateId: seqIds() })
    const elapsed = Date.now() - started
    expect(result.ok).toBe(true)
    // 宽松的上限，只防止出现数量级的退化
    expect(elapsed).toBeLessThan(15000)
  })
})
