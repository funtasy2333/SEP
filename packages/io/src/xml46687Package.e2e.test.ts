/**
 * T2.6：`buildXml46687Package` 端到端（WP8.2 设计 §5.3、§7.2 末段）。
 *
 * 输入是 WP8.2 全要素夹具（手写 IRDoc，含真实 LaTeX 公式与 data URL 图片；经 `irToPm` 变成生产 PM JSON，
 * 与产品里“PM JSON → IR → Resolver”的入口完全一致）。真实链路：KaTeX 转换 → 资源收集 → 真实渲染器 → 打包 → 解包 →
 * `validate.py` 零错误 → `manifest.json` 与 XML 里的 `xlink:href` 一一对应 → 同输入两次包字节相同。
 */

import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { irToPm, type ResourceManifestEntry } from '@ses/shared'
import { createWp82PmRepresentableDoc, formulaIdsOf } from '../../shared/src/renderers/__tests__/xml46687Wp82Fixture'
import { buildXml46687Package, type BuildXml46687PackageResult } from './xml46687Package'
import { shouldSkipValidation, stsCompatWithPython, validateWithPython } from './xml46687PythonValidation'

const FORMULA_COUNT = formulaIdsOf(createWp82PmRepresentableDoc()).length

let cached: Promise<BuildXml46687PackageResult> | undefined
const build = (): Promise<BuildXml46687PackageResult> => {
  cached ??= buildXml46687Package({ pmDoc: irToPm(createWp82PmRepresentableDoc()) })
  return cached
}

/** 从 XML 文本里取全部 `graphic` / `inline-graphic` 的 `xlink:href`（按文档序）。 */
const graphicHrefs = (xml: string): string[] =>
  [...xml.matchAll(/<(?:inline-)?graphic\b[^>]*?\sxlink:href="([^"]*)"/g)].map(match => match[1]!)

describe('buildXml46687Package：WP8.2 全要素夹具端到端', () => {
  it('真实 KaTeX 转换 → 真实渲染 → 无 error；每个公式一个 mml:math，没有 tex-math / alternatives / annotation', async () => {
    const result = await build()
    const errors = result.problems.filter(problem => problem.severity === 'error')
    expect(errors, errors.map(problem => `${problem.code} ${problem.path}: ${problem.message}`).join('\n')).toEqual([])
    expect(result.xml).not.toBeNull()
    expect(result.bytes.length).toBeGreaterThan(0)
    // 问题集合恰为预期（防止告警悄悄增多）；准备层没有任何问题（公式都转换成功、图片都读到）
    expect(result.problems.map(problem => `${problem.severity} ${problem.code} ${problem.nodeId ?? ''}`.trimEnd())).toEqual([
      'info meta-not-expressed',
      'info term-tail-order-normalized w82-term-1',
      'warning term-subjectfield-promoted w82-term-2',
      'info term-language-merged w82-ls-3a',
      'warning term-subjectfield-duplicate w82-ls-3a.v0.d0',
      'warning mark-dropped-in-text-only w82-term-4',
      'warning term-descriptor-missing w82-term-1',
    ])
    const xml = result.xml!
    expect(xml.match(/<mml:math\b/g)).toHaveLength(FORMULA_COUNT)
    expect([...xml.matchAll(/<mml:math id="mml_m(\d+)"/g)].map(match => Number(match[1]))).toEqual(Array.from({ length: FORMULA_COUNT }, (_, index) => index + 1))
    expect(xml).not.toMatch(/tex-math|alternatives|annotation/)
    // 真实 KaTeX 的产物：E = mc^2 里有 msup；\frac 有 mfrac；\sqrt 有 msqrt
    expect(xml).toContain('<mml:msup>')
    expect(xml).toContain('<mml:mfrac>')
    expect(xml).toContain('<mml:msqrt>')
  })

  it('解包：standard.xml、manifest.json、resources/<fileName> 三类条目，standard.xml 与返回的 xml 一致', async () => {
    const result = await build()
    const zip = await JSZip.loadAsync(result.bytes)
    const names = Object.keys(zip.files)
    expect(names[0]).toBe('standard.xml')
    expect(names).toContain('manifest.json')
    expect(names.filter(name => name !== 'standard.xml' && name !== 'manifest.json').every(name => name.startsWith('resources/'))).toBe(true)
    expect(await zip.file('standard.xml')!.async('string')).toBe(result.xml)
  })

  it('manifest.json 的条目与 XML 里的 xlink:href 一一对应；fileName 都在 resources/ 里；dataUrl 条目的 key 是占位 data:<mediaType>;base64,…', async () => {
    const result = await build()
    const zip = await JSZip.loadAsync(result.bytes)
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as { entries: ResourceManifestEntry[] }
    const hrefs = graphicHrefs(result.xml!)
    expect(hrefs.length).toBeGreaterThanOrEqual(8)
    expect(new Set(hrefs).size).toBe(hrefs.length)
    // 一一对应：每个 href 恰好一条清单条目，每个清单条目恰好被一处使用
    expect(manifest.entries.map(entry => entry.href).sort()).toEqual([...hrefs].sort())
    for (const href of hrefs) expect(manifest.entries.filter(entry => entry.href === href)).toHaveLength(1)
    // 文件在包里：fileName 无目录、唯一，且 resources/<fileName> 存在、字节非空
    expect(new Set(manifest.entries.map(entry => entry.fileName)).size).toBe(manifest.entries.length)
    for (const entry of manifest.entries) {
      expect(entry.fileName).not.toMatch(/[\\/]/)
      const file = zip.file(`resources/${entry.fileName}`)
      expect(file, entry.fileName).not.toBeNull()
      expect((await file!.async('uint8array')).length).toBeGreaterThan(0)
    }
    expect(Object.keys(zip.files).filter(name => name.startsWith('resources/')).sort()).toEqual(manifest.entries.map(entry => `resources/${entry.fileName}`).sort())
    // 来源：夹具里既有资源键（resource）也有内联 data URL（dataUrl）；dataUrl 条目的 key 是占位
    const sources = new Set(manifest.entries.map(entry => entry.source))
    expect(sources).toEqual(new Set(['resource', 'dataUrl']))
    for (const entry of manifest.entries) {
      if (entry.source === 'dataUrl') expect(entry.key).toBe(`data:${entry.mediaType};base64,…`)
      else expect(entry.key).toMatch(/^w82-res-/)
    }
    expect(new Set(manifest.entries.map(entry => entry.mediaType))).toEqual(new Set(['image/png', 'image/svg+xml']))
    // 块图的 href 与所属 fig 的 id 相同；行内图是 inl_<k>
    for (const match of result.xml!.matchAll(/<fig id="([^"]*)"[^>]*>[\s\S]*?<graphic [^>]*xlink:href="([^"]*)"/g)) expect(match[2]).toBe(match[1])
    expect(hrefs.filter(href => href.startsWith('inl_'))).toEqual(['inl_1', 'inl_2', 'inl_3', 'inl_4'])
    // 清单与返回值里的清单一致（键序固定的写法除外）
    expect(manifest.entries.map(entry => [entry.href, entry.fileName, entry.mediaType, entry.source])).toEqual(
      result.manifest.entries.map(entry => [entry.href, entry.fileName, entry.mediaType, entry.source]).sort((a, b) => (a[1]! < b[1]! ? -1 : 1)),
    )
  })

  it('同输入两次打包，字节逐一相同', async () => {
    const first = await build()
    const second = await buildXml46687Package({ pmDoc: irToPm(createWp82PmRepresentableDoc()) })
    expect(second.xml).toBe(first.xml)
    expect(Buffer.from(second.bytes).equals(Buffer.from(first.bytes))).toBe(true)
  })

  describe.skipIf(shouldSkipValidation())('解包后的 standard.xml：python3 -I scripts/xml46687/validate.py --json --profile export', () => {
    it('valid:true，errors:[]；warning 只有引言条“导入暂拒”', async () => {
      const zip = await JSZip.loadAsync((await build()).bytes)
      const result = validateWithPython(await zip.file('standard.xml')!.async('string'), 'export')
      expect(result.errors).toEqual([])
      expect(result.valid).toBe(true)
      expect(new Set(result.warnings.map((warning: { rule: string }) => warning.rule))).toEqual(new Set())
    })

    it('sts_compat.py：退出码 0，零未解释偏差', async () => {
      const zip = await JSZip.loadAsync((await build()).bytes)
      const result = stsCompatWithPython(await zip.file('standard.xml')!.async('string'))
      expect(result.status, result.stdout).toBe(0)
      expect(result.stdout).toContain('未解释偏差 0 个')
    })
  })
})
