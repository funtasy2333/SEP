import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface MatrixRow { id: string; obligation: string; import: string; path: string }
interface CollectedTest { name: string; file: string }
const rows = ['matrix-S.json', 'matrix-T.json'].flatMap(name =>
  JSON.parse(readFileSync(resolve(process.cwd(), '../../docs/wp8.1', name), 'utf8')) as MatrixRow[])
const required = rows.filter(r => ['shall', 'should'].includes(r.obligation) && ['accept', 'required'].includes(r.import))
const allIds = new Set(rows.map(r => r.id))

// 使用 Vitest 真实收集的测试标题；只看具体测试名，不把父 describe 的标签扩散到无关测试。
// 标题引用是候选覆盖，仍须审查断言是否真正验证对应行；WP8.2 输出测试不计入。
function collectedTitles(): CollectedTest[] {
  const vitest = resolve(process.cwd(), 'node_modules/.bin/vitest')
  const output = execFileSync(vitest, ['list', 'src/xml46687/import', '--json', '--hideSkippedTests'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
  })
  return (JSON.parse(output) as CollectedTest[]).filter(t => /[\\/]xml46687[\\/]import[\\/]/.test(t.file))
}
const directTitle = (name: string): string => name.split(' > ').at(-1) ?? ''
const matrixTags = (name: string): string[] =>
  [...directTitle(name).matchAll(/\[(M-[A-Za-z0-9][A-Za-z0-9.-]*)\]/g)].map(m => m[1]!)
// 负例验证拒绝，不证明该行合法写法可导入；保守排除，仅作初筛，仍需逐条审查断言。
const isPositive = (name: string): boolean => !/拒绝|阻断|报错|错误|非法|不支持|无法保存/.test(directTitle(name))

describe('WP8.3 导入矩阵标题收集', () => {
  it('每个真实导入测试标签都存在于矩阵', () => {
    const tests = collectedTitles()
    expect(tests.length).toBeGreaterThan(0)
    const unknown = [...new Set(tests.flatMap(t => matrixTags(t.name)).filter(id => !allIds.has(id)))].sort()
    expect(unknown, `不存在的矩阵标签：${unknown.join('、')}`).toEqual([])
  }, 70000)

  it('动态计算的所有 shall/should 接收行均有真实导入测试标题引用', () => {
    const tests = collectedTitles()
    const referenced = new Set(tests.filter(t => isPositive(t.name)).flatMap(t => matrixTags(t.name)))
    const missing = required.filter(r => !referenced.has(r.id))
    const summary = `需覆盖 ${required.length} 行，正向标题候选 ${required.length - missing.length} 行，缺 ${missing.length} 行`
    expect(required.length).toBeGreaterThan(0)
    expect(missing.map(r => `${r.id} ${r.path}`), summary).toEqual([])
  }, 70000)
})
