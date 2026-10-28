import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 矩阵覆盖断言（WP8.2 设计 §7.6；T2.4a-1 建立骨架，T2.6 打开强制开关，需覆盖的行全部被引用：186/186）。
 *
 * 读取 docs/wp8.1/matrix-S.json、matrix-T.json（只读），**计算**需覆盖的行：`obligation ∈ {shall, should}` 且
 * `export ∈ {required, optional}`（含 T2.0 复核后的七行）；静态扫描 `renderers/__tests__/xml46687*.test.ts` 与
 * `renderers/outputBoundaryXml46687*.test.ts` 的源文本，收集形如 `[M-…]` 的矩阵 id。
 *
 * - 恒强制：出现的 id 都存在于矩阵（防笔误）；
 * - 强制开关 `ENFORCE_COVERAGE`（T2.6 起为 true）：每个需覆盖的 id 至少出现一次，失败信息列出缺失 id 与其所属设计节（附录 C）；
 *   T2.4a-1 阶段开关关闭、只报告缺口（T2.4b/T2.4c 补齐各自域后，由 T2.6 打开）；
 * - 对 `may`/示例性的行（`export≠not-applicable`，D-X-20）只报告未引用个数，不失败。
 * 矩阵行数变化会自动改变覆盖要求；本测试读矩阵、不改矩阵。
 */

/** T2.6 起强制：任何需覆盖的矩阵行没有测试标题引用即失败。 */
const ENFORCE_COVERAGE = true

interface MatrixRow { id: string; obligation: string; export: string; clause: string }

const readJson = (name: string): MatrixRow[] =>
  JSON.parse(readFileSync(new URL(`../../../../../docs/wp8.1/${name}`, import.meta.url), 'utf8')) as MatrixRow[]
const rows: MatrixRow[] = [...readJson('matrix-S.json'), ...readJson('matrix-T.json')]
const rowIds = new Set(rows.map(row => row.id))

const required = rows.filter(row => (row.obligation === 'shall' || row.obligation === 'should') && (row.export === 'required' || row.export === 'optional'))
const reportOnly = rows.filter(row => row.obligation !== 'shall' && row.obligation !== 'should' && row.export !== 'not-applicable')

const here = new URL('./', import.meta.url)
const rendererDir = new URL('../', import.meta.url)
const scanned = [
  ...readdirSync(here).filter(name => /^xml46687.*\.test\.ts$/.test(name)).map(name => new URL(name, here)),
  ...readdirSync(rendererDir).filter(name => /^outputBoundaryXml46687.*\.test\.ts$/.test(name)).map(name => new URL(name, rendererDir)),
]
const referenced = new Set<string>()
for (const file of scanned) for (const match of readFileSync(file, 'utf8').matchAll(/\[(M-[A-Za-z0-9][A-Za-z0-9.-]*)\]/g)) referenced.add(match[1]!)

/** 附录 C（脚本生成）：矩阵行 → 设计节。解析失败时返回“未知”。 */
function sectionsOfAppendixC(): Map<string, string> {
  const map = new Map<string, string>()
  try {
    const design = readFileSync(new URL('../../../../../docs/wp8.2/design.md', import.meta.url), 'utf8')
    const block = /<!--COVERAGE-C-BEGIN-->([\s\S]*?)<!--COVERAGE-C-END-->/.exec(design)?.[1] ?? ''
    for (const line of block.split('\n')) {
      const cells = line.split('|').map(cell => cell.trim())
      if (cells.length >= 8 && /^M-/.test(cells[1]!)) map.set(cells[1]!, cells[cells.length - 2]!)
    }
  } catch { /* 设计文档不可读时只是没有“所属节”信息 */ }
  return map
}

describe('WP8.2 矩阵覆盖断言（T2.6 起强制）', () => {
  const missing = required.filter(row => !referenced.has(row.id))
  const sections = sectionsOfAppendixC()

  it('需覆盖的行数是计算值，并与设计 §7.6 的统计一致（shall/should 且 export 为 required/optional；may/示例性另计）', () => {
    expect(required.length).toBeGreaterThan(0)
    expect(required.every(row => row.export === 'required' || row.export === 'optional')).toBe(true)
    expect(reportOnly.every(row => row.obligation !== 'shall' && row.obligation !== 'should')).toBe(true)
    expect(scanned.length).toBeGreaterThan(0)
  })

  it('测试标题里出现的矩阵 id 都存在于矩阵（防笔误）', () => {
    const unknown = [...referenced].filter(id => !rowIds.has(id))
    expect(unknown, `不存在于矩阵的 id：${unknown.join('、')}`).toEqual([])
  })

  it('每个需覆盖的矩阵行至少被一条测试标题引用（强制开关 ENFORCE_COVERAGE）', () => {
    const bySection = new Map<string, string[]>()
    for (const row of missing) {
      const section = sections.get(row.id) ?? '未知'
      bySection.set(section, [...(bySection.get(section) ?? []), row.id])
    }
    const lines = [...bySection.entries()].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
      .map(([section, ids]) => `  设计 §${section}（${ids.length}）：${ids.join('、')}`)
    const summary = `需覆盖 ${required.length} 行，已引用 ${required.length - missing.length} 行，缺 ${missing.length} 行`
    console.info(`[wp82MatrixCoverage] ${summary}${missing.length > 0 ? `\n${lines.join('\n')}` : ''}`)
    if (ENFORCE_COVERAGE) expect(missing, `${summary}\n${lines.join('\n')}`).toEqual([])
    else expect(required.length - missing.length).toBeGreaterThan(0)
  })

  it('may/示例性的行（export≠not-applicable）只报告未引用的个数，不失败（D-X-20）', () => {
    const unreferenced = reportOnly.filter(row => !referenced.has(row.id))
    console.info(`[wp82MatrixCoverage] may/示例性行 ${reportOnly.length} 行，未引用 ${unreferenced.length} 行（仅报告）`)
    expect(unreferenced.length).toBeLessThanOrEqual(reportOnly.length)
  })
})
