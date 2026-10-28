import { describe, expect, it } from 'vitest'
import { pmToIr } from '../../ir/pmToIr'
import { resolve } from '../../ir/resolve'
import { createWp8mIrDoc } from '../../ir/__tests__/wp8mFixtures'
import { createWp6Fixture } from '../../../../client/src/extensions/__fixtures__/wp6'
import type { IRDoc } from '../../ir/types'
import { exportXml46687, renderXml46687, type RenderXml46687Options, type Xml46687Problem } from '../xml46687'
import { fullRendererFixture } from './fullRendererFixture'
import {
  patchFullRendererForXml, patchWp6ForXml, patchWp8mForXml, type Wp6PatchStep, type Wp8mPatchStep,
} from './xml46687GoldenFixtures'
import { buildGoldenSamples, type GoldenSample, type GoldenSampleName } from './xml46687GoldenSamples'
import { shouldSkipValidation, stsCompatWithPython, validateWithPython } from './xml46687PythonValidation'
import { stubManifest } from './xml46687StubKit'
import { stubMathMlFor } from './xml46687Wp82Fixture'

/**
 * 全要素黄金样例（T2.6，设计 §7.1③④、§7.2）：4 份夹具的 XML 文件快照 + 问题集合逐条断言 + 外部校验。
 *
 * - `wp82`：WP8.2 全要素夹具（手写 IRDoc，不经 PM），命中每个 shall/should 且 export≠not-applicable 的矩阵行；
 * - `fullRenderer`：`fullRendererFixture()` 经 `pmToIr`，只补 SES 必填元数据；
 * - `wp8m`：WP8.M 全要素 `createWp8mIrDoc()` 的派生夹具（`patchWp8mForXml`）；
 * - `wp6`：WP6 夹具（`createWp6Fixture()` 经 `pmToIr`）的派生夹具（`patchWp6ForXml`）。
 *
 * 每个派生夹具的改写步骤在 `xml46687GoldenFixtures.ts` 里逐项写明原因与错误码；“原始夹具的不可导出点”一节对每一步保留一条反例，
 * 钉住原样导出时的错误码（主导已定的夹具处置：附录术语、单元格注、crossRef+stdRef 保持 error，不改渲染器规则）。
 * 更新快照：`pnpm --filter @ses/shared exec vitest run -u`。
 */

const samples = buildGoldenSamples(createWp6Fixture())
const byName = (name: GoldenSampleName): GoldenSample => samples.find(sample => sample.name === name)!

/** 渲染器问题的稳定签名：严重度、码、节点（防止告警悄悄增多或换位置）。 */
const signature = (problems: readonly Xml46687Problem[]): string[] => problems.map(problem => `${problem.severity} ${problem.code} ${problem.nodeId ?? ''}`.trimEnd())

const EXPECTED_PROBLEMS: Record<GoldenSampleName, string[]> = {
  wp82: [
    'info meta-not-expressed',
    'warning term-subjectfield-promoted w82-term-2',
    'info term-language-merged w82-ls-3a',
    'warning term-subjectfield-duplicate w82-ls-3a.v0.d0',
    'warning mark-dropped-in-text-only w82-term-4',
    'warning term-descriptor-missing w82-term-1',
    'warning list-type-normalized w82-list-inner-alpha',
  ],
  fullRenderer: [
    'info meta-not-expressed',
    'warning caption-en-not-expressed tbl-1',
    'warning caption-en-not-expressed fig-1',
    'warning term-descriptor-missing term-1',
  ],
  wp8m: [
    'info meta-not-expressed',
    'warning mark-dropped-in-text-only g5-t332',
    'warning figure-attr-not-expressed g3-scope-p',
    'warning term-descriptor-missing g5-t1',
  ],
  wp6: [
    'info meta-not-expressed',
    'warning variable-attr-not-expressed paragraph-main',
    'warning link-attr-not-expressed paragraph-main',
    'warning link-attr-not-expressed paragraph-main',
    'warning link-attr-not-expressed paragraph-main',
    'warning code-language-not-expressed code-main',
    'info term-language-merged term-lang-zh',
    'warning term-subjectfield-promoted term-main',
    'warning bib-std-incomplete bib-entry',
    'warning link-attr-not-expressed bib-entry',
    'warning link-attr-not-expressed bib-entry',
    'warning link-attr-not-expressed bib-entry',
    'warning link-attr-not-expressed bib-entry',
    'warning index-seealso-not-expressed index-entry-main',
    'warning meta-not-expressed meta-identifier-scheme',
    'warning table-width-not-expressed table-main',
    'warning table-style-not-expressed table-main',
    'info cell-attr-not-expressed table-main',
    'info px-width-ignored table-cell-h1',
    'warning figure-attr-not-expressed figure-main',
    'warning term-descriptor-missing term-main',
    'warning term-descriptor-not-expressed term-status-short',
    'warning bib-field-not-expressed bib-entry',
  ],
}

/** `validate.py --profile export` 的 warning 规则集合：引言条“导入暂拒”（M-4.3.4-02/03 的 import 仍为 reject，WP8.3 改 accept）。 */
const INTRO_CLAUSE_REJECT = ['W-IMPL-REJECT', 'W-IMPL-REJECT', 'W-IMPL-REJECT', 'W-IMPL-REJECT', 'W-IMPL-REJECT']
const EXPECTED_VALIDATOR_WARNINGS: Record<GoldenSampleName, string[]> = {
  wp82: INTRO_CLAUSE_REJECT,
  fullRenderer: [],
  wp8m: INTRO_CLAUSE_REJECT,
  wp6: [],
}

describe.each(samples)('黄金样例：$name', sample => {
  const { name, doc, labels, options } = sample

  it('XML 文件快照（toMatchFileSnapshot，便于直接喂给 validate.py）', async () => {
    await expect(renderXml46687(doc, labels, options)).toMatchFileSnapshot(sample.snapshot)
  })

  it('没有 error；问题集合恰为预期（逐条断言，防止告警悄悄增多）', () => {
    const { xml, problems } = exportXml46687(doc, labels, options)
    expect(xml).not.toBeNull()
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(signature(problems)).toEqual(EXPECTED_PROBLEMS[name])
  })

  it('Resolver 没有 error（夹具本身合法）', () => {
    expect(resolve(doc).problems.filter(problem => problem.severity === 'error')).toEqual([])
  })

  describe.skipIf(shouldSkipValidation())('外部校验：python3 -I scripts/xml46687/validate.py --json --profile export', () => {
    const xml = renderXml46687(doc, labels, options)

    it('valid:true，errors:[]；warning 集合逐条断言', () => {
      const result = validateWithPython(xml, 'export')
      expect(result.errors).toEqual([])
      expect(result.valid).toBe(true)
      expect(result.warnings.map((warning: { rule: string }) => warning.rule)).toEqual(EXPECTED_VALIDATOR_WARNINGS[name])
      for (const warning of result.warnings as Array<{ message: string }>) expect(warning.message).toContain('引言中的条')
    })

    it('同一份导出按 import 档校验也没有 error', () => {
      const result = validateWithPython(xml, 'import')
      expect(result.errors).toEqual([])
      expect(result.valid).toBe(true)
    })

    it('sts_compat.py（与官方 NISO STS 1.2 DTD 对照）：退出码 0，零未解释偏差', () => {
      const result = stsCompatWithPython(xml)
      expect(result.status, result.stdout).toBe(0)
      expect(result.stdout).toContain('未解释偏差 0 个')
    })
  })
})

describe('派生夹具：纯函数，不修改输入', () => {
  it('patchWp8mForXml / patchWp6ForXml / patchFullRendererForXml 返回深拷贝，入参逐字节不变', () => {
    const wp8m = createWp8mIrDoc()
    const wp8mBefore = JSON.stringify(wp8m)
    const patched8 = patchWp8mForXml(wp8m)
    expect(JSON.stringify(wp8m)).toBe(wp8mBefore)
    expect(JSON.stringify(patched8)).not.toBe(wp8mBefore)

    const wp6 = pmToIr(createWp6Fixture()).doc
    const wp6Before = JSON.stringify(wp6)
    const patched6 = patchWp6ForXml(wp6)
    expect(JSON.stringify(wp6)).toBe(wp6Before)
    expect(JSON.stringify(patched6)).not.toBe(wp6Before)

    const full = pmToIr(fullRendererFixture()).doc
    const fullBefore = JSON.stringify(full)
    patchFullRendererForXml(full)
    expect(JSON.stringify(full)).toBe(fullBefore)
  })
})

describe('原始夹具的不可导出点：每一处保持 error / 阻断，不由渲染器静默改写', () => {
  const run = (doc: IRDoc, mathml?: RenderXml46687Options['mathml']) => {
    const { labels } = resolve(doc)
    return exportXml46687(doc, labels, { mathml: mathml ?? stubMathMlFor(doc), resources: stubManifest(doc, labels) })
  }
  const errorsOf = (problems: readonly Xml46687Problem[]) => problems.filter(problem => problem.severity === 'error')
  const wp8m = (...skip: Wp8mPatchStep[]) => run(patchWp8mForXml(createWp8mIrDoc(), skip))
  const wp6 = (...skip: Wp6PatchStep[]) => run(patchWp6ForXml(pmToIr(createWp6Fixture()).doc, skip))

  it('WP8.M：g1-ch3-p2 同一 run 同时带 crossRef 与 stdRef → error xml-mark-combination（xref 与 std 在 schema 中互不包含）', () => {
    const { xml, problems } = wp8m('split-crossref-stdref')
    expect(xml).toBeNull()
    expect(errorsOf(problems)).toMatchObject([{ code: 'xml-mark-combination', nodeId: 'g1-ch3-p2' }])
  })

  it('WP8.M：g7-t1-note 在表格单元格内 → error xml-cell-content（schema cm.cell-content 只允许 p/list）', () => {
    const { xml, problems } = wp8m('move-cell-note')
    expect(xml).toBeNull()
    expect(errorsOf(problems)).toMatchObject([{ code: 'xml-cell-content', nodeId: 'g7-t1-note' }])
  })

  it('WP8.M：g5-t-app 术语条目在附录里 → error xml-term-outside-terms（WP8.1 V-2、C-S-25、C-T-37；依据 9.1）', () => {
    const { xml, problems } = wp8m('move-appendix-term')
    expect(xml).toBeNull()
    expect(errorsOf(problems)).toMatchObject([{ code: 'xml-term-outside-terms', nodeId: 'g5-t-app' }])
  })

  it('WP8.M：不补元数据 → 缺题名为 error meta-required-missing；缺发布机构、语言、发布日期、实施日期为同码 warning（D-X-02）', () => {
    const { xml, problems } = wp8m('meta')
    expect(xml).toBeNull()
    expect(errorsOf(problems)).toMatchObject([{ code: 'meta-required-missing', path: 'doc.meta' }])
    expect(problems.filter(problem => problem.code === 'meta-required-missing' && problem.severity === 'warning').map(problem => problem.path)).toEqual([
      'doc.meta.publishers', 'doc.meta.languages', 'doc.meta.publishDate', 'doc.meta.implementDate',
    ])
  })

  it('WP6：figure.groups 与行内 style 由输出边界永久阻断 → unsupported-output（D-T-11、D-M-12、D-S-06）', () => {
    const groups = wp6('figure-groups')
    expect(groups.xml).toBeNull()
    expect(errorsOf(groups.problems)).toMatchObject([{ code: 'unsupported-output', nodeId: 'figure-main', path: expect.stringMatching(/\.groups$/) }])
    const style = wp6('inline-style')
    expect(style.xml).toBeNull()
    expect(errorsOf(style.problems)).toMatchObject([{ code: 'unsupported-output', nodeId: 'paragraph-main', path: expect.stringMatching(/\.style$/) }])
  })

  it('WP6：partOfSpeech=“名词”不在 noun/verb/adj/adv 内 → error xml-descriptor-value（D-X-14）', () => {
    const { xml, problems } = wp6('part-of-speech')
    expect(xml).toBeNull()
    expect(errorsOf(problems)).toMatchObject([{ code: 'xml-descriptor-value', nodeId: 'term-pos-zh' }])
  })

  it('WP6：行内与行间公式的 MathML 都没有命名空间 → error mathml-invalid（设计 §4.5）', () => {
    const { xml, problems } = wp6('mathml-namespace')
    expect(xml).toBeNull()
    expect(errorsOf(problems)).toMatchObject([
      { code: 'mathml-invalid', nodeId: 'formula-inline' },
      { code: 'mathml-invalid', nodeId: 'formula-block' },
    ])
  })

  it('WP6：术语条目在普通章的条里 → error xml-term-outside-terms，并连带 xml-block-after-subsec 与 xml-rid-unresolved', () => {
    const { xml, problems } = wp6('move-term')
    expect(xml).toBeNull()
    const codes = errorsOf(problems).map(problem => problem.code)
    expect(codes).toContain('xml-term-outside-terms')
    expect(codes).toContain('xml-block-after-subsec')
    expect(codes).toContain('xml-rid-unresolved')
    expect(errorsOf(problems).find(problem => problem.code === 'xml-term-outside-terms')).toMatchObject({ nodeId: 'term-main' })
  })

  it('WP6：非表头单元格带 unit → error cell-unit-unsupported（D-X-03）', () => {
    const { xml, problems } = wp6('cell-unit')
    expect(xml).toBeNull()
    expect(errorsOf(problems)).toMatchObject([{ code: 'cell-unit-unsupported', nodeId: 'table-cell-1' }])
  })

  it('WP6：不补元数据 → 缺发布日期、实施日期为 warning meta-required-missing（导出继续，输出可能通不过 validate.py）', () => {
    const { xml, problems } = wp6('meta')
    expect(xml).not.toBeNull()
    expect(problems.filter(problem => problem.code === 'meta-required-missing').map(problem => `${problem.severity} ${problem.path}`)).toEqual([
      'warning doc.meta.publishDate', 'warning doc.meta.implementDate',
    ])
  })

  it('fullRenderer：不补元数据 → 缺内容语言为 warning meta-required-missing（导出继续）', () => {
    const doc = patchFullRendererForXml(pmToIr(fullRendererFixture()).doc, ['meta'])
    const { xml, problems } = run(doc)
    expect(xml).not.toBeNull()
    expect(problems.filter(problem => problem.code === 'meta-required-missing').map(problem => `${problem.severity} ${problem.path}`)).toEqual([
      'warning doc.meta.languages',
    ])
  })

  describe.skipIf(shouldSkipValidation())('D-X-02：必填元数据缺失只是 warning', () => {
    it('四项 SES 必填元数据（发布机构、语言、发布日期、实施日期）全缺、只有题名：导出成功并给 4 条 warning；实测 validate.py --profile export 仍判 valid:true（schema 不强制，SES 必填由渲染器 warning 提示）', () => {
      const doc = patchWp8mForXml(createWp8mIrDoc(), ['meta'])
      doc.meta.title = '只有题名'
      const { xml, problems } = run(doc)
      expect(xml).not.toBeNull()
      expect(problems.filter(problem => problem.code === 'meta-required-missing').map(problem => `${problem.severity} ${problem.path}`)).toEqual([
        'warning doc.meta.publishers', 'warning doc.meta.languages', 'warning doc.meta.publishDate', 'warning doc.meta.implementDate',
      ])
      // 实测事实：validate.py 当前不要求这四项；若以后收紧，此处应改为 valid:false（验收文档的“已知限制”同步修改）。
      expect(validateWithPython(xml!, 'export').valid).toBe(true)
    })
  })
})
