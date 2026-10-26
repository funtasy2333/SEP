// @vitest-environment node
/**
 * WP8.M 矩阵覆盖断言（docs/wp8.m/design.md §3.6.5、§4.9 第 3 项）。
 *
 * WP8.1 README 要求从 WP8.2 起测试引用矩阵 id，WP8.M 提前执行：内置 32 个 WP8.M 必做缺口的矩阵 id，
 * 断言每个 id 至少出现在一个 `wp8m*.test.ts` 的 describe / it / test 标题里（扫描 packages 下各包 src 里的全部 wp8m 测试文件，
 * 不含本文件）。M-7.4-13（公式图片）已决定为 not-applicable（design.md §2.2、§7.1 D-M-13），不在清单内。
 *
 * 另外核对 WP8.1 矩阵工件已同步：这 32 行的 status 全部为 mapped 且填了 irPath / pmNode，M-7.4-13 为 not-applicable。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'

/** 32 个必做缺口（design.md §2.1 表去掉 M-7.4-13），按组排列。 */
const WP8M_MATRIX_IDS = {
  G1: ['M-4.4.2.3-02', 'M-4.4.2.3-03', 'M-4.4.2.3-04', 'M-4.4.2.3.2-01', 'M-10.2-01', 'M-10.2-02', 'M-10.1.7-01', 'M-4.5.3-02'],
  G2: ['M-10.1.4-01', 'M-10.1.4-03', 'M-10.1.4-04', 'M-10.1.4-05', 'M-10.1.1-04'],
  G3: ['M-8.5-01', 'M-8.5-02', 'M-8.5-03', 'M-8.5-04', 'M-8.5-05', 'M-8.5-06', 'M-8.3-02', 'M-8.2-11', 'M-8.4-03'],
  G4: ['M-10.1.5-01', 'M-10.1.5-02'],
  G5: ['M-9.2.9-01', 'M-9.2.1-05'],
  G6: ['M-4.3.4-02', 'M-4.3.4-03'],
  G7: ['M-5.7-04', 'M-5.6-05'],
  G8: ['M-6.1-03', 'M-6.3.3.1-01'],
} as const

const ALL_IDS: string[] = Object.values(WP8M_MATRIX_IDS).flat()
const NOT_APPLICABLE_ID = 'M-7.4-13'
const SELF = 'wp8mMatrixCoverage.test.ts'

// 测试在 packages/client 下运行（与 jsonExporter.test.ts 读取 ../shared/... 的做法一致）
const PACKAGES_DIR = resolvePath(process.cwd(), '..')
const REPO_ROOT = resolvePath(PACKAGES_DIR, '..')

function wp8mTestFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...wp8mTestFiles(path))
    else if (/^wp8m.*\.test\.ts$/.test(entry.name) && entry.name !== SELF) found.push(path)
  }
  return found
}

/**
 * 提取 describe / it / test 调用的标题字面量（单引号、双引号、反引号），
 * 含 `it.each(表)('标题', …)`、`describe.skip(…)` 这类链式写法。
 */
function testTitles(source: string): string[] {
  const head = /\b(?:describe|it|test)(?:\.(?:each|skip|only|concurrent|todo|sequential)(?:\([^)]*\))?)*\(\s*(?:'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`)/g
  const titles: string[] = []
  for (const match of source.matchAll(head)) titles.push(match[1] ?? match[2] ?? match[3] ?? '')
  return titles
}

const idPattern = (id: string) => new RegExp(`(?<![\\w.-])${id.replace(/[.\-]/g, '\\$&')}(?![\\w])`)

const files = wp8mTestFiles(PACKAGES_DIR)
const titlesByFile = new Map(files.map(file => [relative(PACKAGES_DIR, file), testTitles(readFileSync(file, 'utf8'))]))

describe('WP8.M 矩阵覆盖：32 个必做缺口的矩阵 id 都出现在 wp8m*.test.ts 的标题里', () => {
  it('清单本身：32 个互不相同的 id，不含 M-7.4-13；八个组各自的行数与设计 §2.1 一致', () => {
    expect(ALL_IDS).toHaveLength(32)
    expect(new Set(ALL_IDS).size).toBe(32)
    expect(ALL_IDS).not.toContain(NOT_APPLICABLE_ID)
    expect(Object.fromEntries(Object.entries(WP8M_MATRIX_IDS).map(([group, ids]) => [group, ids.length]))).toEqual({
      G1: 8, G2: 5, G3: 9, G4: 2, G5: 2, G6: 2, G7: 2, G8: 2,
    })
  })

  it('扫描到 shared、client、io 三个包里的 wp8m 测试文件，并且每个文件都至少有一个带矩阵 id 的标题（防止扫描落空而空转通过）', () => {
    const packages = new Set([...titlesByFile.keys()].map(file => file.split(/[\\/]/)[0]))
    expect([...packages].sort()).toEqual(['client', 'io', 'shared'])
    expect(titlesByFile.size).toBeGreaterThanOrEqual(30)
    expect(testTitles("describe('[M-1.2-03] 标题', () => { it.each(['a'])('%s [M-9.9-99]', () => {}) })")).toEqual(['[M-1.2-03] 标题', '%s [M-9.9-99]'])
    const withoutTitle = [...titlesByFile.entries()].filter(([, titles]) => titles.length === 0).map(([file]) => file)
    expect(withoutTitle).toEqual([])
  })

  it.each(ALL_IDS)('%s 至少出现在一个 wp8m*.test.ts 的用例或 describe 标题里', id => {
    const pattern = idPattern(id)
    const where = [...titlesByFile.entries()].filter(([, titles]) => titles.some(title => pattern.test(title))).map(([file]) => file)
    expect(where, `${id} 没有出现在任何 wp8m*.test.ts 的标题里`).not.toEqual([])
  })

  it('id 匹配有边界：M-4.4.2.3-02 不会被 M-4.4.2.3-020 或 M-4.4.2.3.2-01 之类的相近 id 误命中', () => {
    expect(idPattern('M-4.4.2.3-02').test('[M-4.4.2.3-02] 标题')).toBe(true)
    expect(idPattern('M-4.4.2.3-02').test('[M-4.4.2.3-020] 标题')).toBe(false)
    expect(idPattern('M-4.4.2.3-02').test('[M-4.4.2.3.2-01] 标题')).toBe(false)
    expect(idPattern('M-8.5-01').test('XM-8.5-01')).toBe(false)
  })
})

describe('WP8.M 矩阵覆盖：WP8.1 矩阵工件已同步（design.md §6.3、§7.1 D-M-13）', () => {
  type MatrixRow = { id: string; status: string; irPath?: unknown; pmNode?: unknown; notes?: string }
  const rows = new Map<string, MatrixRow>()
  for (const name of ['matrix-S.json', 'matrix-T.json']) {
    const parsed = JSON.parse(readFileSync(join(REPO_ROOT, 'docs/wp8.1', name), 'utf8')) as { rows?: MatrixRow[] } | MatrixRow[]
    const list = Array.isArray(parsed) ? parsed : parsed.rows ?? []
    for (const row of list) rows.set(row.id, row)
  }

  it.each(ALL_IDS)('%s 在矩阵里的状态为 mapped，并填了 irPath 与 pmNode', id => {
    const row = rows.get(id)
    expect(row, `${id} 不在 matrix-S/T.json 里`).toBeDefined()
    expect(row!.status).toBe('mapped')
    expect(row!.irPath, `${id} 缺 irPath`).toBeTruthy()
    expect(row!.pmNode, `${id} 缺 pmNode`).toBeTruthy()
  })

  it('M-7.4-13 为 not-applicable（SES 无 PDF 来源，导入忽略并告警）；M-C.1-02 注明模型层已覆盖', () => {
    expect(rows.get(NOT_APPLICABLE_ID)).toMatchObject({ status: 'not-applicable' })
    expect(rows.get(NOT_APPLICABLE_ID)!.notes).toContain('SES 无 PDF 来源，导入忽略并告警')
    expect(rows.get('M-C.1-02')!.notes).toContain('模型层已覆盖，colgroup 展开待 WP8.3')
  })
})
