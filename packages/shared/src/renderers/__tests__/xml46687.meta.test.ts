import { describe, expect, it } from 'vitest'
import type { IRDoc, IRDocMeta } from '../../ir/types'
import { chapter, codesOf, completeMeta, exportDoc, find, makeDoc, para, renderOk } from './xml46687Kit'

/** 前置元数据 std-meta（WP8.2 设计 §2.1 “std-meta 子元素”）。 */

const docWith = (meta: IRDocMeta): IRDoc => makeDoc([chapter('ch1', '范围', [para('p1', '正文')], 'scope')], { meta })
const squash = (xml: string): string => xml.replace(/>\s+</g, '><').trim()
const stdMeta = (meta: IRDocMeta): string => {
  const { xml } = renderOk(docWith(meta))
  return squash(/<std-meta>[\s\S]*<\/std-meta>/.exec(xml)![0])
}
const childNames = (meta: IRDocMeta): string[] => {
  const inner = stdMeta(meta).replace(/^<std-meta>/, '').replace(/<\/std-meta>$/, '')
  // 只取顶层子元素名：用栈扫描
  const names: string[] = []
  let depth = 0
  for (const match of inner.matchAll(/<(\/?)([a-z-]+)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = match
    if (closing) { depth -= 1; continue }
    if (depth === 0) names.push(name!)
    if (!selfClosing) depth += 1
  }
  return names
}

const fullMeta = (): IRDocMeta => completeMeta({
  title: undefined,
  issuer: undefined,
  titleParts: [{ id: 'tp1', lang: 'zh', role: 'full', content: [{ text: '全称' }] }],
  identifiers: [{ id: 'i1', scheme: 'dated', value: 'GB/T 1—2026', parts: [{ id: 'i1p', kind: 'doc-type', content: [{ text: 'GB/T' }] }] }],
  publishers: [{ id: 'pub1', name: [{ text: '机构' }] }],
  icsCode: '35.240', ccsCode: 'L 70', technicalCommittee: 'SAC/TC 1',
  replacedStandards: [{ id: 'rs1', reference: 'GB/T 2', relation: 'replaces' }, { id: 'rs2', reference: 'GB/T 3', relation: 'revises' }],
  copyrights: [{ id: 'cp1', statement: [{ text: '版权' }], year: '2026', holder: [{ text: '单位' }] }],
  filingNo: '备案号',
})

describe('std-meta 子元素次序（V-12 导出次序，写死，不依赖输入顺序）', () => {
  it('[M-4.1-07] [M-4.3.2-01] title-wrap、std-ident、std-org-group、content-language、std-ref、release-date、implementation-date、comm-ref、ics、ccs、std-supersedes、std-xref、permissions、custom-meta-group', () => {
    const meta = fullMeta()
    expect(childNames(meta)).toEqual([
      'title-wrap', 'std-ident', 'std-org-group', 'content-language', 'std-ref', 'release-date', 'implementation-date',
      'comm-ref', 'ics', 'ccs', 'std-supersedes', 'std-xref', 'permissions', 'custom-meta-group',
    ])
  })

  it('次序不依赖 IR 里字段的书写顺序（对象键序、数组内的 role/lang 顺序都不影响 std-meta 的结构）', () => {
    const reordered: IRDocMeta = Object.fromEntries(Object.entries(fullMeta()).reverse()) as unknown as IRDocMeta
    expect(stdMeta(reordered)).toBe(stdMeta(fullMeta()))
  })
})

describe('题名 title-wrap（M-4.3.2-04、-19～-22）', () => {
  it('[M-4.3.2-04] [M-4.3.2-19] [M-4.3.2-20] [M-4.3.2-21] [M-4.3.2-22] 每种语言一个 title-wrap，子元素顺序 intro、main、compl、full；zh 第一、en 第二、其余按首次出现', () => {
    const meta = completeMeta({
      title: undefined,
      titleParts: [
        { id: 't1', lang: 'fr', role: 'full', content: [{ text: 'Titre' }] },
        { id: 't2', lang: 'en', role: 'full', content: [{ text: 'Full' }] },
        { id: 't3', lang: 'zh', role: 'full', content: [{ text: '全称' }] },
        { id: 't4', lang: 'zh', role: 'compl', content: [{ text: '补充' }] },
        { id: 't5', lang: 'zh', role: 'main', content: [{ text: '主' }] },
        { id: 't6', lang: 'zh', role: 'intro', content: [{ text: '引' }] },
        { id: 't7', lang: 'de', role: 'main', content: [{ text: 'Haupt' }] },
      ],
    })
    const xml = stdMeta(meta)
    expect(xml).toContain('<title-wrap xml:lang="zh"><intro>引</intro><main>主</main><compl>补充</compl><full>全称</full></title-wrap>'
      + '<title-wrap xml:lang="en"><full>Full</full></title-wrap>'
      + '<title-wrap xml:lang="fr"><full>Titre</full></title-wrap>'
      + '<title-wrap xml:lang="de"><main>Haupt</main></title-wrap>')
  })

  it('[M-4.3.2-04] 无 role 视为 full；题名内容里的格式 mark 如实输出', () => {
    const meta = completeMeta({ title: undefined, titleParts: [{ id: 't1', lang: 'zh', content: [{ text: '题名', marks: [{ type: 'italic' }] }, { text: '（试行）' }] }] })
    expect(stdMeta(meta)).toContain('<title-wrap xml:lang="zh"><full><italic>题名</italic>（试行）</full></title-wrap>')
  })

  it('旧字段 title / titleEn：生成 zh / en 的 title-wrap/full；titleParts 缺 full 时才用旧字段补，已有 full 时以分段为准', () => {
    expect(stdMeta(completeMeta({ title: '旧题名', titleEn: 'Old title' }))).toContain('<title-wrap xml:lang="zh"><full>旧题名</full></title-wrap><title-wrap xml:lang="en"><full>Old title</full></title-wrap>')
    const supplemented = completeMeta({ title: '旧全称', titleParts: [{ id: 't1', lang: 'zh', role: 'main', content: [{ text: '主' }] }] })
    expect(stdMeta(supplemented)).toContain('<title-wrap xml:lang="zh"><main>主</main><full>旧全称</full></title-wrap>')
    const keep = completeMeta({ title: '旧全称', titleParts: [{ id: 't1', lang: 'zh', role: 'full', content: [{ text: '分段全称' }] }] })
    expect(stdMeta(keep)).toContain('<full>分段全称</full>')
    expect(stdMeta(keep)).not.toContain('旧全称')
  })

  it('meta-required-missing（error）：没有任何题名；分段缺 lang', () => {
    const none = exportDoc(docWith(completeMeta({ title: undefined })))
    expect(none.xml).toBeNull()
    expect(find(none.problems, 'meta-required-missing').filter(problem => problem.severity === 'error')).toHaveLength(1)
    const noLang = exportDoc(docWith(completeMeta({ title: undefined, titleParts: [{ id: 't1', content: [{ text: '题名' }] }] })))
    expect(noLang.xml).toBeNull()
    expect(find(noLang.problems, 'meta-required-missing')[0]).toMatchObject({ severity: 'error', nodeId: 't1', path: 'doc.meta.titleParts[0]' })
  })

  it('meta-not-expressed（warning）：role 不在 intro/main/compl/full 内或同语言重复的分段被跳过，合并为一条', () => {
    const meta = completeMeta({
      title: undefined,
      titleParts: [
        { id: 't1', lang: 'zh', role: 'full', content: [{ text: '全称' }] },
        { id: 't2', lang: 'zh', role: 'subtitle', content: [{ text: '副题' }] },
        { id: 't3', lang: 'zh', role: 'full', content: [{ text: '重复全称' }] },
      ],
    })
    const { xml, problems } = renderOk(docWith(meta))
    expect(xml).toContain('<full>全称</full>')
    expect(xml).not.toContain('副题')
    expect(xml).not.toContain('重复全称')
    const merged = find(problems, 'meta-not-expressed').filter(problem => problem.severity === 'warning')
    expect(merged).toHaveLength(1)
    expect(merged[0]!.message).toContain('共 2 处')
  })
})

describe('标准编号 std-ident / std-ref（C-S-14）', () => {
  it('[M-4.3.2-05] [M-4.3.2-23] [M-4.3.2-24] [M-4.3.2-25] [M-4.3.2-26] [M-4.3.2-27] [M-4.3.2-28] std-ident：originator、doc-type、doc-number、part-number、edition、version 按 schema 次序，同类按 position；edition/version 可含 sup/sub', () => {
    const meta = completeMeta({
      identifiers: [{
        id: 'i1', scheme: 'dated', value: 'GB/T 99999.1—2026',
        parts: [
          { id: 'p-version', kind: 'version', content: [{ text: '1' }, { text: 'a', marks: [{ type: 'sup' }] }] },
          { id: 'p-doc-number-2', kind: 'doc-number', position: 2, content: [{ text: '二' }] },
          { id: 'p-doc-number-1', kind: 'doc-number', position: 1, content: [{ text: '一' }] },
          { id: 'p-originator', kind: 'originator', content: [{ text: 'SAC' }] },
          { id: 'p-edition', kind: 'edition', content: [{ text: '2' }] },
          { id: 'p-part', kind: 'part-number', content: [{ text: '1' }] },
          { id: 'p-type', kind: 'doc-type', content: [{ text: 'GB/T' }] },
        ],
      }],
    })
    expect(stdMeta(meta)).toContain('<std-ident><originator>SAC</originator><doc-type>GB/T</doc-type><doc-number>一</doc-number><doc-number>二</doc-number><part-number>1</part-number><edition>2</edition><version>1<sup>a</sup></version></std-ident>')
  })

  it('std-ident 只写 IR 里有的组成部分；空组成部分不写；mark-dropped-in-text-only：纯文本组成部分里的格式 mark 被丢弃并告警', () => {
    const meta = completeMeta({ identifiers: [{ id: 'i1', parts: [{ id: 'a', kind: 'doc-type', content: [{ text: 'GB', marks: [{ type: 'bold' }] }] }, { id: 'b', kind: 'doc-number', content: [{ text: '' }] }] }] })
    const { xml, problems } = renderOk(docWith(meta))
    expect(squash(xml)).toContain('<std-ident><doc-type>GB</doc-type></std-ident>')
    expect(codesOf(problems)).toContain('mark-dropped-in-text-only')
  })

  it('meta-not-expressed：第二个有组成部分的编号、未知的组成部分 kind 未导出，合并为一条 warning', () => {
    const meta = completeMeta({ identifiers: [
      { id: 'i1', parts: [{ id: 'a', kind: 'doc-type', content: [{ text: 'GB' }] }, { id: 'b', kind: 'mystery', content: [{ text: 'x' }] }] },
      { id: 'i2', parts: [{ id: 'c', kind: 'doc-type', content: [{ text: 'GB/Z' }] }] },
    ] })
    const { xml, problems } = renderOk(docWith(meta))
    expect(squash(xml)).toContain('<std-ident><doc-type>GB</doc-type></std-ident>')
    expect(xml).not.toContain('GB/Z')
    const warnings = find(problems, 'meta-not-expressed').filter(problem => problem.severity === 'warning')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toContain('共 2 处')
  })

  it('[M-F-18] [M-G-02] std-ref：identifiers 的 value 按 scheme（dated/undated）写出；没有 dated 值时用旧字段 stdCode', () => {
    const both = completeMeta({ identifiers: [
      { id: 'i1', scheme: 'dated', value: 'GB/T 1—2026', parts: [] },
      { id: 'i2', scheme: 'undated', value: 'GB/T 1', parts: [] },
    ] })
    expect(stdMeta(both)).toContain('<std-ref type="dated">GB/T 1—2026</std-ref><std-ref type="undated">GB/T 1</std-ref>')
    expect(stdMeta(completeMeta({ stdCode: 'GB/T 7—2020' }))).toContain('<std-ref type="dated">GB/T 7—2020</std-ref>')
  })

  it('meta-not-expressed：stdCode 与标识符的完整编号不一致时以标识符为准；其他 scheme 的编号未导出', () => {
    const meta = completeMeta({ stdCode: 'GB/T 7—2020', identifiers: [{ id: 'i1', scheme: 'dated', value: 'GB/T 1—2026', parts: [] }, { id: 'i2', scheme: 'isbn', value: '978', parts: [] }] })
    const { xml, problems } = renderOk(docWith(meta))
    expect(xml).toContain('GB/T 1—2026')
    expect(xml).not.toContain('GB/T 7—2020')
    expect(xml).not.toContain('978')
    expect(find(problems, 'meta-not-expressed').filter(problem => problem.severity === 'warning')).toHaveLength(1)
  })
})

describe('发布机构、语言（SES 必填，D-X-02 决定 B）', () => {
  it('[M-4.3.2-06] [M-4.3.2-29] [M-F-19] std-org-group/std-org[@std-org-role]/std-org-name、std-org-abbrev；机构名可含 sup/sub', () => {
    const meta = completeMeta({ issuer: undefined, publishers: [
      { id: 'p1', name: [{ text: '国家市场监督管理总局' }], role: 'lead', identifier: 'SAMR' },
      { id: 'p2', name: [{ text: '机构', }, { text: '2', marks: [{ type: 'sup' }] }] },
    ] })
    expect(stdMeta(meta)).toContain('<std-org-group><std-org std-org-role="lead"><std-org-name>国家市场监督管理总局</std-org-name><std-org-abbrev>SAMR</std-org-abbrev></std-org><std-org><std-org-name>机构<sup>2</sup></std-org-name></std-org></std-org-group>')
  })

  it('无 publishers 时用旧字段 issuer 生成一个无 role 的 std-org', () => {
    expect(stdMeta(completeMeta({ issuer: '旧发布机构' }))).toContain('<std-org-group><std-org><std-org-name>旧发布机构</std-org-name></std-org></std-org-group>')
  })

  it('meta-required-missing（warning，D-X-02 B）：缺发布机构时省略 std-org-group，导出继续', () => {
    const { xml, problems } = renderOk(docWith(completeMeta({ issuer: undefined })))
    expect(xml).not.toContain('std-org-group')
    expect(find(problems, 'meta-required-missing')).toHaveLength(1)
    expect(find(problems, 'meta-required-missing')[0]).toMatchObject({ severity: 'warning', path: 'doc.meta.publishers' })
  })

  it('[M-4.3.2-07] [M-F-21] content-language：每个 tag 一个，trim；usage 没有对应元素给 meta-not-expressed；缺语言给 meta-required-missing（warning）', () => {
    const meta = completeMeta({ languages: [{ id: 'l1', tag: ' zh ' }, { id: 'l2', tag: 'en', usage: 'abstract' }, { id: 'l3', tag: ' ' }] })
    const { xml, problems } = renderOk(docWith(meta))
    expect(squash(xml)).toContain('<content-language>zh</content-language><content-language>en</content-language>')
    expect(find(problems, 'meta-not-expressed').filter(problem => problem.severity === 'warning')).toHaveLength(1)
    const missing = renderOk(docWith(completeMeta({ languages: undefined })))
    expect(missing.xml).not.toContain('content-language')
    expect(find(missing.problems, 'meta-required-missing')[0]).toMatchObject({ severity: 'warning', path: 'doc.meta.languages' })
  })
})

describe('日期（M-4.3.2-10、-11）', () => {
  it('[M-4.3.2-10] [M-F-04] [M-4.3.2-11] [M-F-05] release-date 与 implementation-date：不带 date-type；实施日期绝不写入 release-date', () => {
    const xml = stdMeta(completeMeta())
    expect(xml).toContain('<release-date>2026-04-30</release-date><implementation-date>2026-11-01</implementation-date>')
    expect(xml).not.toContain('date-type')
  })

  it('日期两端空白被去掉；晚于 12 月 31 日等非法值不输出猜测值', () => {
    expect(stdMeta(completeMeta({ publishDate: ' 2026-04-30 ' }))).toContain('<release-date>2026-04-30</release-date>')
  })

  it('xml-date-invalid（error）：不是真实日历日（格式不对、2 月 30 日、年 0000）', () => {
    for (const bad of ['2026-02-30', '2026/04/30', '2026-4-3', '0000-01-01', '2026-13-01', '二〇二六']) {
      const result = exportDoc(docWith(completeMeta({ publishDate: bad })))
      expect(result.xml, bad).toBeNull()
      expect(find(result.problems, 'xml-date-invalid'), bad).toHaveLength(1)
      expect(find(result.problems, 'xml-date-invalid')[0]).toMatchObject({ severity: 'error', path: 'doc.meta.publishDate' })
    }
    expect(find(exportDoc(docWith(completeMeta({ implementDate: '2026-02-29' }))).problems, 'xml-date-invalid')[0]).toMatchObject({ path: 'doc.meta.implementDate' })
    // 闰年的 2 月 29 日合法
    expect(codesOf(exportDoc(docWith(completeMeta({ publishDate: '2028-02-29' }))).problems, 'error')).toEqual([])
  })

  it('meta-required-missing（warning，D-X-02 B）：缺发布日期/实施日期时省略对应元素，导出继续', () => {
    const { xml, problems } = renderOk(docWith(completeMeta({ publishDate: undefined, implementDate: undefined })))
    expect(xml).not.toContain('release-date')
    expect(xml).not.toContain('implementation-date')
    expect(find(problems, 'meta-required-missing').map(problem => problem.path)).toEqual(['doc.meta.publishDate', 'doc.meta.implementDate'])
  })

  it('meta-date-order（warning）：发布日期晚于实施日期（疑似把实施日期写进了发布日期）', () => {
    const { problems } = renderOk(docWith(completeMeta({ publishDate: '2026-12-01', implementDate: '2026-11-01' })))
    expect(find(problems, 'meta-date-order')).toHaveLength(1)
    expect(find(problems, 'meta-date-order')[0]).toMatchObject({ severity: 'warning' })
    expect(find(renderOk(docWith(completeMeta())).problems, 'meta-date-order')).toEqual([])
  })
})

describe('其余元数据', () => {
  it('[M-4.3.2-02] [M-4.3.2-03] [M-F-02] [M-F-03] ics、ccs 原样输出；[M-F-27] [M-G-03] comm-ref 取 technicalCommittee；空值不写', () => {
    const xml = stdMeta(completeMeta({ icsCode: '35.240.30', ccsCode: 'L 72', technicalCommittee: 'SAC/TC 28' }))
    expect(xml).toContain('<comm-ref>SAC/TC 28</comm-ref><ics>35.240.30</ics><ccs>L 72</ccs>')
    expect(stdMeta(completeMeta({ icsCode: ' ', technicalCommittee: '' }))).not.toMatch(/<ics>|<comm-ref>/)
  })

  it('[M-4.3.2-13] [M-G-06] std-supersedes（replaces 或空 relation）与 std-xref[@type="revises"]/std-ref；无 replacedStandards 时用旧字段 replaces', () => {
    const meta = completeMeta({ replacedStandards: [
      { id: 'r1', reference: 'GB/T 2—2020' },
      { id: 'r2', reference: 'GB/T 3', relation: 'revises' },
      { id: 'r3', reference: 'GB/T 4', relation: 'replaces' },
    ] })
    expect(stdMeta(meta)).toContain('<std-supersedes>GB/T 2—2020</std-supersedes><std-supersedes>GB/T 4</std-supersedes><std-xref type="revises"><std-ref>GB/T 3</std-ref></std-xref>')
    expect(stdMeta(completeMeta({ replaces: 'GB/T 5—2019' }))).toContain('<std-supersedes>GB/T 5—2019</std-supersedes>')
  })

  it('meta-not-expressed：被代替标准的关系不是 replaces/revises 时没有已确认的表达', () => {
    const { xml, problems } = renderOk(docWith(completeMeta({ replacedStandards: [{ id: 'r1', reference: 'GB/T 2', relation: 'amends' }] })))
    expect(xml).not.toContain('GB/T 2')
    expect(find(problems, 'meta-not-expressed').filter(problem => problem.severity === 'warning')).toHaveLength(1)
  })

  it('[M-4.3.2-15] [M-4.3.2-16] [M-4.3.2-17] [M-4.3.2-18] [M-F-23] permissions：恰有一份版权时输出 copyright-statement、copyright-year、copyright-holder（holder 可含 sub/sup）', () => {
    const meta = completeMeta({ copyrights: [{ id: 'c1', statement: [{ text: '版权', marks: [{ type: 'bold' }] }, { text: '专有' }], year: '2026', holder: [{ text: 'H' }, { text: '2', marks: [{ type: 'sub' }] }] }] })
    expect(stdMeta(meta)).toContain('<permissions><copyright-statement><bold>版权</bold>专有</copyright-statement><copyright-year>2026</copyright-year><copyright-holder>H<sub>2</sub></copyright-holder></permissions>')
  })

  it('meta-not-expressed：多份版权声明全部不输出（原文没有多份 permissions 的写法）；版权的 language 没有对应属性', () => {
    const two = renderOk(docWith(completeMeta({ copyrights: [{ id: 'c1', statement: [{ text: '甲' }] }, { id: 'c2', statement: [{ text: '乙' }] }] })))
    expect(two.xml).not.toContain('permissions')
    expect(find(two.problems, 'meta-not-expressed').filter(problem => problem.severity === 'warning')).toHaveLength(1)
    const withLanguage = renderOk(docWith(completeMeta({ copyrights: [{ id: 'c1', statement: [{ text: '甲' }], language: 'en' }] })))
    expect(withLanguage.xml).toContain('<copyright-statement>甲</copyright-statement>')
    expect(find(withLanguage.problems, 'meta-not-expressed').filter(problem => problem.severity === 'warning')).toHaveLength(1)
  })

  it('[M-4.3.2-14] custom-meta-group：filing-no、industry-name、region-name、cover-designation、applicant、proposer（固定顺序，非空才写）', () => {
    const meta = completeMeta({ proposer: '提出', applicant: '起草', coverDesignation: '称谓', regionName: '地区', industryName: '行业', filingNo: '备案' })
    expect(stdMeta(meta)).toContain('<custom-meta-group><custom-meta><meta-name>filing-no</meta-name><meta-value>备案</meta-value></custom-meta>'
      + '<custom-meta><meta-name>industry-name</meta-name><meta-value>行业</meta-value></custom-meta>'
      + '<custom-meta><meta-name>region-name</meta-name><meta-value>地区</meta-value></custom-meta>'
      + '<custom-meta><meta-name>cover-designation</meta-name><meta-value>称谓</meta-value></custom-meta>'
      + '<custom-meta><meta-name>applicant</meta-name><meta-value>起草</meta-value></custom-meta>'
      + '<custom-meta><meta-name>proposer</meta-name><meta-value>提出</meta-value></custom-meta></custom-meta-group>')
    expect(stdMeta(completeMeta())).not.toContain('custom-meta-group')
  })
})

describe('IR 有数据而 XML 无表达（meta-not-expressed，聚合）', () => {
  it('[M-4.3.2-09] standardType 恒存在，std-type 没有内容模型：每次导出一条 info', () => {
    const { xml, problems } = renderOk(docWith(completeMeta()))
    expect(xml).not.toContain('std-type')
    const infos = find(problems, 'meta-not-expressed')
    expect(infos).toHaveLength(1)
    expect(infos[0]).toMatchObject({ severity: 'info', path: 'doc.meta.standardType' })
  })

  it('[M-4.3.2-08] [M-F-26] adoptions 与 consistency 不输出 equivalence，合并为一条 warning（含个数），与 info 分开', () => {
    const meta = completeMeta({ adoptions: [{ id: 'a1', reference: 'ISO 1', degree: 'IDT' }], consistency: 'IDT' })
    const { xml, problems } = renderOk(docWith(meta))
    expect(xml).not.toContain('equivalence')
    const warnings = find(problems, 'meta-not-expressed').filter(problem => problem.severity === 'warning')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toContain('共 2 处')
    expect(find(problems, 'meta-not-expressed').filter(problem => problem.severity === 'info')).toHaveLength(1)
  })
})
