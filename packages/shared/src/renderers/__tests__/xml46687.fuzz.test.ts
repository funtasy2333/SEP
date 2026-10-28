import { describe, expect, it } from 'vitest'
import type { IRBlock, IRClause, IRDoc, IRInline, IRList, IRMark } from '../../ir/types'
import { exportXml46687 } from '../xml46687'
import { EMPTY_OPTIONS, chapter, clause, labelsOf, makeDoc } from './xml46687Kit'
import { shouldSkipValidation, validateWithPython } from './xml46687PythonValidation'

/**
 * 确定性随机文档（固定种子）：只用 T2.4a-1 领域内的结构（段落、列项、注、示例、警告、摘录、代码、条）与行内标记组合。
 * 性质：① 导出不抛；② 同一输入两次导出逐字节相同；③ 导出成功的文档，`validate.py --profile export` 零错误。
 * 随机生成器刻意避开已知会报 error 的组合（无标识的列项引用、第三层有序列项），因此所有文档都应导出成功。
 */

function createRandom(seed: number) {
  let state = seed
  const next = (): number => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff }
  return {
    pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (probability: number): boolean => next() < probability,
    int: (limit: number): number => Math.floor(next() * limit),
  }
}

const TEXTS = ['甲', 'abc', '粗体', 'x', '2', 'a\nb', '\n', '', ' 空 ', '<&>', '长文本长文本']

function randomDoc(seed: number): IRDoc {
  const random = createRandom(seed)
  let counter = 0
  const id = (prefix: string): string => `${prefix}${++counter}`

  const randomMarks = (): IRMark[] => {
    const marks: IRMark[] = []
    for (const type of ['bold', 'italic', 'underline', 'strike', 'sup', 'sub'] as const) if (random.chance(0.15)) marks.push({ type })
    const roll = random.int(100) / 100
    if (roll < 0.08) marks.push({ type: 'code' })
    else if (roll < 0.14) marks.push({ type: 'variable', ...(random.chance(0.3) ? { kind: 'q' } : {}) })
    else if (roll < 0.17) { marks.length = 0; marks.push({ type: 'stdRef' }, ...(random.chance(0.5) ? [{ type: 'bold' } as IRMark] : [])) }
    else if (roll < 0.2) marks.push({ type: 'mixedCitation' })
    else if (roll < 0.28) marks.push({ type: 'externalLink', href: random.pick(['https://a.test/', 'mailto:a@b.test']) })
    else if (roll < 0.4) marks.push({ type: 'crossRef', targetId: '@@' })
    return marks
  }
  const randomRuns = (): IRInline[] => Array.from({ length: 1 + random.int(5) }, (): IRInline => {
    const marks = randomMarks()
    return { text: random.pick(TEXTS), ...(marks.length > 0 ? { marks } : {}) }
  })
  const randomPara = (): IRBlock => ({ kind: 'paragraph', id: id('p'), content: randomRuns() })
  const randomList = (depth = 0): IRList => ({
    kind: 'list', id: id('list'),
    listType: depth === 0 ? random.pick(['alpha', 'number', 'roman', 'dash', 'dot'] as const) : random.pick(['number', 'dash', 'dot'] as const),
    items: Array.from({ length: 1 + random.int(3) }, () => ({
      id: id('li'),
      content: [randomPara() as never, ...(depth < 1 && random.chance(0.3) ? [randomList(depth + 1) as never] : [])],
    })),
  })
  const randomBlock = (): IRBlock => {
    const roll = random.int(100) / 100
    if (roll < 0.4) return randomPara()
    if (roll < 0.55) return randomList()
    if (roll < 0.65) return { kind: 'note', id: id('n'), content: [randomPara()] }
    if (roll < 0.72) return { kind: 'example', id: id('e'), content: [randomPara(), randomList()] }
    if (roll < 0.8) return { kind: 'warning', id: id('w'), content: [randomPara()] }
    if (roll < 0.87) return { kind: 'quote', id: id('q'), content: [randomPara()] }
    return { kind: 'code', id: id('c'), text: random.pick(['a<b', 'x\n y', '']) }
  }
  const randomClause = (level: 1 | 2 | 3): IRClause => {
    const blocks = Array.from({ length: random.int(4) }, randomBlock)
    const subs = level < 3 && random.chance(0.4) ? [randomClause((level + 1) as 2 | 3)] : []
    return clause(id('cl'), level, random.chance(0.8) ? '条' : null, [...blocks, ...subs])
  }

  const doc = makeDoc([
    chapter('ch1', '范围', [randomPara(), randomClause(1), randomClause(1)]),
    chapter('ch2', '要求', Array.from({ length: 2 }, randomBlock)),
  ])
  // 交叉引用的目标：文档里真实存在的条、注、示例（引用无标识的列项会报 error，生成器避开）
  const targets: string[] = []
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(collect); return }
    if (!value || typeof value !== 'object') return
    const row = value as Record<string, unknown>
    if (typeof row.id === 'string' && (row.kind === 'clause' || row.kind === 'note' || row.kind === 'example')) targets.push(row.id)
    Object.values(row).forEach(collect)
  }
  collect(doc.body)
  const fix = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(fix); return }
    if (!value || typeof value !== 'object') return
    const row = value as Record<string, unknown>
    if (row.targetId === '@@') row.targetId = random.pick(targets)
    Object.values(row).forEach(fix)
  }
  fix(doc.body)
  return doc
}

describe('确定性随机文档（固定种子）', () => {
  const seeds = Array.from({ length: 150 }, (_, index) => 1000 + index * 7)

  it('导出不抛、全部成功，同一输入两次导出逐字节相同，输出不含 ext_ 占位 id', () => {
    for (const seed of seeds) {
      const doc = randomDoc(seed)
      const labels = labelsOf(doc)
      const first = exportXml46687(doc, labels, EMPTY_OPTIONS)
      const errors = first.problems.filter(problem => problem.severity === 'error')
      expect(errors, `seed ${seed}`).toEqual([])
      expect(first.xml, `seed ${seed}`).not.toBeNull()
      expect(exportXml46687(doc, labels, EMPTY_OPTIONS).xml, `seed ${seed}`).toBe(first.xml)
      expect(first.xml, `seed ${seed}`).not.toMatch(/\b(?:id|rid|target)="ext_/)
    }
  })

  describe.skipIf(shouldSkipValidation())('外部校验', () => {
    it('前 40 个种子的导出：validate.py --profile export 零错误', () => {
      for (const seed of seeds.slice(0, 40)) {
        const doc = randomDoc(seed)
        const xml = exportXml46687(doc, labelsOf(doc), EMPTY_OPTIONS).xml!
        expect(validateWithPython(xml).errors, `seed ${seed}`).toEqual([])
      }
    }, 60_000)
  })
})
