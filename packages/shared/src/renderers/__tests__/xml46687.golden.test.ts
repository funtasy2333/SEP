import { describe, expect, it } from 'vitest'
import { exportXml46687, renderXml46687 } from '../xml46687'
import { EMPTY_OPTIONS, codesOf, labelsOf } from './xml46687Kit'
import { shouldSkipValidation, stsCompatWithPython, validateWithPython } from './xml46687PythonValidation'
import { skeletonDoc } from './xml46687SkeletonFixture'

/**
 * 黄金样例（T2.4a-1，设计 §7.1③④）：骨架夹具（元数据、前言/引言/引言条、章/条/无标题条/附录、行内标记与引用、脚注、外链、
 * 列项、注/示例/警告/摘录/代码）的 XML 文件快照 + 幂等 + 外部校验。
 *
 * fullRendererFixture 含表、图、公式、术语与参考文献，T2.4a-1 的领域桩无法导出，所以它的黄金样例留给 T2.6
 * （xml46687.stubs.test.ts 钉住了“当前不能导出”）。更新快照：`pnpm --filter @ses/shared exec vitest run -u`。
 */

const doc = skeletonDoc()
const labels = labelsOf(doc)

describe('黄金样例：骨架夹具', () => {
  it('XML 文件快照（toMatchFileSnapshot，便于直接喂给 validate.py）', async () => {
    const xml = renderXml46687(doc, labels, EMPTY_OPTIONS)
    await expect(xml).toMatchFileSnapshot('__snapshots__/xml46687.skeleton.xml')
  })

  it('导出幂等：连续两次逐字节相同，export 与 render 一致', () => {
    const first = renderXml46687(doc, labels, EMPTY_OPTIONS)
    expect(renderXml46687(doc, labels, EMPTY_OPTIONS)).toBe(first)
    expect(exportXml46687(doc, labels, EMPTY_OPTIONS).xml).toBe(first)
  })

  it('问题集合恰为预期（防止告警悄悄增多）：一条标准类型 info、一条代码语言 warning，没有 error', () => {
    const { problems } = exportXml46687(doc, labels, EMPTY_OPTIONS)
    expect(problems.map(problem => `${problem.severity} ${problem.code}`)).toEqual([
      'info meta-not-expressed',
      'warning code-language-not-expressed',
    ])
    expect(codesOf(problems, 'error')).toEqual([])
  })

  it('独立复算 id 与 rid（不复用渲染器的检查函数）：id 唯一，每个 xref/@rid 与 tbx:entailedTerm/@target 都能解析；没有 ext_ 占位', () => {
    const xml = renderXml46687(doc, labels, EMPTY_OPTIONS)
    const ids = [...xml.matchAll(/ id="([^"]*)"/g)].map(match => match[1]!)
    expect(new Set(ids).size).toBe(ids.length)
    const references = [...xml.matchAll(/<xref [^>]*? rid="([^"]*)"/g)].map(match => match[1]!)
    expect(references.length).toBeGreaterThan(0)
    for (const rid of references) expect(ids, rid).toContain(rid)
    expect(xml).not.toMatch(/\b(?:id|rid|target)="ext_/)
    // 仅被引用才有 id：被引用的注、示例、列项带 id，没被引用的不带
    expect(xml).toContain('<non-normative-note id="note_3">')
    expect(xml.match(/<non-normative-note id=/g)).toHaveLength(1)
    expect(xml.match(/<non-normative-example id=/g)).toHaveLength(1)
    expect(xml.match(/<list-item id=/g)).toHaveLength(1)
  })

  it('必备 id（validate.py V-13）：有 label 的 sec、app、正文脚注 fn 都有 id；p 没有任何属性', () => {
    const xml = renderXml46687(doc, labels, EMPTY_OPTIONS)
    for (const match of xml.matchAll(/<sec([^>]*)>\s*<label>/g)) expect(match[1], match[0]).toMatch(/ id="/)
    for (const match of xml.matchAll(/<app( [^>]*)>/g)) expect(match[1], match[0]).toMatch(/ id="/)
    for (const match of xml.matchAll(/<fn([^>]*)>/g)) expect(match[1], match[0]).toMatch(/ id="fn_\d+"/)
    expect(xml).not.toMatch(/<p [^>]*>/)
  })
})

describe.skipIf(shouldSkipValidation())('外部校验：python3 -I scripts/xml46687/validate.py --json --profile export', () => {
  it('骨架夹具的导出：valid:true，errors:[]；warning 恰为引言条“导入暂拒”的三条（M-4.3.4-02/03 的 import 仍为 reject，WP8.3 改 accept）', () => {
    const xml = renderXml46687(doc, labels, EMPTY_OPTIONS)
    const result = validateWithPython(xml, 'export')
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.warnings.map((warning: { rule: string }) => warning.rule)).toEqual(['W-IMPL-REJECT', 'W-IMPL-REJECT', 'W-IMPL-REJECT'])
    expect(result.warnings.every((warning: { message: string }) => warning.message.includes('引言中的条'))).toBe(true)
  })

  it('同一份导出按 import 档校验也通过', () => {
    const result = validateWithPython(renderXml46687(doc, labels, EMPTY_OPTIONS), 'import')
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('sts_compat.py（与官方 NISO STS 1.2 DTD 对照）：退出码 0，零未解释偏差（已知偏差都在白名单内）', () => {
    const result = stsCompatWithPython(renderXml46687(doc, labels, EMPTY_OPTIONS))
    expect(result.status, result.stdout).toBe(0)
    expect(result.stdout).toContain('未解释偏差 0 个')
  })
})
