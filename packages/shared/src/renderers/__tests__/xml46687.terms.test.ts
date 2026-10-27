import { describe, expect, it } from 'vitest'
import type { IRBlock, IRClauseChild, IRDefList, IRDoc, IRTermDescriptor, IRTermEntry, IRTermLanguageSet } from '../../ir/types'
import { exportXml46687 } from '../xml46687'
import { EMPTY_OPTIONS, appendix, bodyOf, chapter, clause, codesOf, exportDoc, find, labelsOf, makeDoc, para, renderOk, run } from './xml46687Kit'
import { shouldSkipValidation, stsCompatWithPython, validateWithPython } from './xml46687PythonValidation'

/**
 * 术语条目（含 G5 领域规则、语言集合并、描述符）与缩略语（WP8.2 设计 §1.2、§2.9、§2.12）。
 * 整条管线（`exportXml46687`）渲染，断言 `<body>` 内的片段与问题；术语章是第 3 章（前面有范围、规范性引用文件两章），
 * 术语条目的编号因此是 `3.1`、`3.2`……（Resolver 给出，渲染器不拼接）。
 */

const note = (id: string, text: string): IRTermEntry['notes'][number] => ({ kind: 'note', id, content: [para(`${id}.p`, text)] })
const example = (id: string, text: string): IRTermEntry['examples'][number] => ({ kind: 'example', id, content: [para(`${id}.p`, text)] })

function term(id: string, name: string, definition = '定义。', extra: Partial<IRTermEntry> = {}): IRTermEntry {
  return { kind: 'termEntry', id, term: [{ text: name }], definition: [para(`${id}.d0`, definition)], notes: [], examples: [], ...extra }
}

const descriptor = (id: string, kind: string, value: string): IRTermDescriptor => ({ id, kind, value: [{ text: value }] })

/** 一个语言集，含一个术语组、若干变体（每个变体：[名称, 描述符]）。 */
function languageSet(id: string, language: string, variants: Array<[string, IRTermDescriptor[]?]>): IRTermLanguageSet {
  return {
    id, language,
    groups: [{ id: `${id}.g`, terms: variants.map(([name, descriptors], index) => ({ id: `${id}.v${index}`, content: [{ text: name }], descriptors: descriptors ?? [] })) }],
  }
}

/** 范围、规范性引用文件、术语和定义（第 3 章），`rest` 可补充文档字段。 */
function termsDoc(children: IRClauseChild[], rest: Partial<IRDoc> = {}, extraChapters: ReturnType<typeof chapter>[] = []): IRDoc {
  return makeDoc([
    chapter('ch-scope', '范围', [para('scope-p', '范围。')], 'scope'),
    chapter('ch-refs', '规范性引用文件', [para('refs-p', '无。')], 'norm-refs'),
    chapter('ch-terms', '术语和定义', [para('terms-p', '下列术语和定义适用于本文件。'), ...children], 'terms'),
    ...extraChapters,
  ], rest)
}

const compact = (xml: string): string => xml.replace(/>\s+</g, '><')
const termBody = (doc: IRDoc): string => compact(bodyOf(renderOk(doc).xml))
/** 取 `<term-sec ...>…</term-sec>` 整段（紧凑形式）。 */
const termSec = (doc: IRDoc, index = 0): string => [...termBody(doc).matchAll(/<term-sec [\s\S]*?<\/term-sec>/g)][index]![0]

describe('术语条的结构：term-sec、label、tbx:termEntry、tbx:langSet（设计 §2.9）', () => {
  it('[M-9.2.1-01] [M-9.2.1-02] [M-9.2.1-03] [M-9.2.1-04] [M-9.2.1-05] [M-E-07] [M-E-08] [M-F-12] [M-F-13] term-sec 的 id=sec_<n>、label；termEntry 的 id=term_<n>（均取 Resolver，渲染器不拼接）', () => {
    const doc = termsDoc([term('t1', '术语一'), term('t2', '术语二')])
    const labels = labelsOf(doc)
    expect(labels.t1).toMatchObject({ label: '3.1', xmlId: 'sec_3.1', termEntryXmlId: 'term_3.1' })
    expect(termSec(doc, 0)).toBe(
      '<term-sec id="sec_3.1"><label>3.1</label><tbx:termEntry id="term_3.1"><tbx:langSet xml:lang="zh">'
      + '<tbx:definition>定义。</tbx:definition><tbx:tig><tbx:term>术语一</tbx:term></tbx:tig></tbx:langSet></tbx:termEntry></term-sec>',
    )
    expect(termSec(doc, 1)).toContain('<term-sec id="sec_3.2"><label>3.2</label><tbx:termEntry id="term_3.2">')
  })

  it('[M-9.1-02] 术语章内的分组条是普通 sec，term-sec 在条内；术语条目的编号随条（3.1.1）', () => {
    const doc = termsDoc([clause('c31', 1, '一般概念', [term('t1', '术语一')])])
    expect(termBody(doc)).toContain('<sec id="sec_3.1"><label>3.1</label><title>一般概念</title><term-sec id="sec_3.1.1"><label>3.1.1</label><tbx:termEntry id="term_3.1.1">')
  })

  it('[M-9.2.1-06] [M-9.2.1-07] 隐含语言集：term → zh 的 langSet，termEn → en 的 langSet；条目级内容只在第一个 langSet，其余 langSet 只含 tig', () => {
    const doc = termsDoc([term('t1', '标准', '定义。', { termEn: [{ text: 'standard' }], source: [{ text: 'GB/T 1.1' }] })])
    expect(termSec(doc)).toBe(
      '<term-sec id="sec_3.1"><label>3.1</label><tbx:termEntry id="term_3.1">'
      + '<tbx:langSet xml:lang="zh"><tbx:definition>定义。</tbx:definition><tbx:source>GB/T 1.1</tbx:source><tbx:tig><tbx:term>标准</tbx:term></tbx:tig></tbx:langSet>'
      + '<tbx:langSet xml:lang="en"><tbx:tig><tbx:term>standard</tbx:term></tbx:tig></tbx:langSet>'
      + '</tbx:termEntry></term-sec>',
    )
  })

  it('[M-9.2.1-06] 只有 termEn、没有 term 时，英文集是第一个 langSet，条目级内容写入它', () => {
    const entry = term('t1', '', '定义。', { term: [], termEn: [{ text: 'standard' }] })
    expect(termSec(termsDoc([entry]))).toContain('<tbx:langSet xml:lang="en"><tbx:definition>定义。</tbx:definition><tbx:tig><tbx:term>standard</tbx:term></tbx:tig></tbx:langSet>')
  })
})

describe('术语名 tbx:tig 与描述符（M-9.2.3）', () => {
  const full = (): IRTermEntry => term('t1', '标准化文件', '定义。', {
    languageSets: [languageSet('ls', 'zh', [
      ['规范文件', [
        // 故意乱序：输出按 schema 次序 partOfSpeech、grammaticalNumber、normativeAuthorization、termType
        descriptor('d-tt', 'termType', 'fullForm'),
        descriptor('d-na', 'normativeAuthorization', 'admittedTerm'),
        descriptor('d-gn', 'grammaticalNumber', 'singular'),
        descriptor('d-pos', 'partOfSpeech', 'noun'),
      ]],
    ])],
  })

  it('[M-9.2.3-01] [M-9.2.3-02] 一个术语变体一个 tig；tbx:term 内是术语名（行内内容）；同一 IRTermGroup 的多个变体拆成多个 tig', () => {
    const entry = term('t1', '主名', '定义。', {
      languageSets: [{ id: 'ls', language: 'zh', groups: [{ id: 'g', terms: [
        { id: 'v1', content: [{ text: '同义一' }], descriptors: [] },
        { id: 'v2', content: [{ text: '同义', marks: [{ type: 'bold' }] }, { text: '二' }], descriptors: [] },
      ] }] }],
    })
    expect(termSec(termsDoc([entry]))).toContain(
      '<tbx:tig><tbx:term>主名</tbx:term></tbx:tig><tbx:tig><tbx:term>同义一</tbx:term></tbx:tig><tbx:tig><tbx:term><bold>同义</bold>二</tbx:term></tbx:tig>',
    )
  })

  it('[M-9.2.3-03] [M-9.2.3-04] [M-9.2.3-05] [M-9.2.3-08] [M-9.2.3-09] 描述符按 schema 次序（词性、语法数、采用级别、术语类型）输出为空元素 value 属性，与输入顺序无关', () => {
    expect(termSec(termsDoc([full()]))).toContain(
      '<tbx:tig><tbx:term>规范文件</tbx:term><tbx:partOfSpeech value="noun"/><tbx:grammaticalNumber value="singular"/>'
      + '<tbx:normativeAuthorization value="admittedTerm"/><tbx:termType value="fullForm"/></tbx:tig>',
    )
  })

  it.each([
    ['partOfSpeech', ['noun', 'verb', 'adj', 'adv']],
    ['grammaticalNumber', ['singular', 'plural']],
    ['normativeAuthorization', ['preferredTerm', 'admittedTerm', 'deprecatedTerm']],
    ['termType', ['fullForm', 'abbreviation', 'symbol', 'formula']],
  ] as const)('[M-9.2.3-03] [M-9.2.3-04] %s 的全部合法取值都被接受（带空白会 trim）', (kind, values) => {
    for (const value of values) {
      const entry = term('t1', '术语', '定义。', { languageSets: [languageSet('ls', 'zh', [['变体', [descriptor('d', kind, ` ${value} `)]]])] })
      expect(termSec(termsDoc([entry])), value).toContain(`<tbx:${kind} value="${value}"/>`)
    }
  })

  it('缺词性/采用级别只给 warning（term-descriptor-missing，全文合并为一条），不伪造描述符', () => {
    const doc = termsDoc([term('t1', '甲'), term('t2', '乙', '定义。', { languageSets: [languageSet('ls', 'zh', [['丙', [descriptor('d1', 'partOfSpeech', 'noun')]]])] })])
    const { xml, problems } = renderOk(doc)
    expect(xml).not.toContain('tbx:normativeAuthorization')
    const missing = find(problems, 'term-descriptor-missing')
    expect(missing).toHaveLength(1)
    expect(missing[0]).toMatchObject({ severity: 'warning' })
    expect(missing[0]!.message).toContain('共 3 处')
    expect(missing[0]!.message).toContain('术语名「甲」缺词性、采用级别')
    expect(missing[0]!.message).toContain('术语名「丙」缺采用级别')
  })

  it('词性、采用级别齐全的变体不产生 term-descriptor-missing', () => {
    const entry = term('t1', '', '定义。', {
      term: [],
      languageSets: [languageSet('ls', 'zh', [['规范文件', [descriptor('d1', 'partOfSpeech', 'noun'), descriptor('d2', 'normativeAuthorization', 'preferredTerm')]]])],
    })
    expect(codesOf(renderOk(termsDoc([entry])).problems)).not.toContain('term-descriptor-missing')
  })

  it('term-descriptor-not-expressed（warning，聚合）：其他 kind 的描述符没有 XML 元素，不输出', () => {
    const entry = term('t1', '术语', '定义。', {
      languageSets: [languageSet('ls', 'zh', [['变体一', [descriptor('d1', 'administrativeStatus', 'x'), descriptor('d2', 'usageStatus', 'y')]], ['变体二', [descriptor('d3', 'source', 'z')]]])],
    })
    const { xml, problems } = renderOk(termsDoc([entry]))
    expect(xml).not.toMatch(/administrativeStatus|usageStatus/)
    const merged = find(problems, 'term-descriptor-not-expressed')
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ severity: 'warning', nodeId: 'd1' })
    expect(merged[0]!.message).toContain('共 3 处')
    expect(merged[0]!.message).toContain('administrativeStatus')
  })

  it('描述符取值里的格式 mark 被丢弃（mark-dropped-in-text-only，warning），取值按纯文本判断', () => {
    const entry = term('t1', '术语', '定义。', {
      languageSets: [languageSet('ls', 'zh', [['变体', [{ id: 'd1', kind: 'partOfSpeech', value: [{ text: 'noun', marks: [{ type: 'bold' }] }] }]]])],
    })
    const { xml, problems } = renderOk(termsDoc([entry]))
    expect(xml).toContain('<tbx:partOfSpeech value="noun"/>')
    expect(find(problems, 'mark-dropped-in-text-only')).toHaveLength(1)
  })

  it('xml-descriptor-value（error，D-X-14）：取值不在 schema 枚举（如词性“名词”）；取值为空也算不在枚举内', () => {
    for (const [kind, value] of [['partOfSpeech', '名词'], ['normativeAuthorization', 'preferred'], ['termType', ''], ['grammaticalNumber', 'dual']] as const) {
      const entry = term('t1', '术语', '定义。', { languageSets: [languageSet('ls', 'zh', [['变体', [descriptor('d1', kind, value)]]])] })
      const result = exportDoc(termsDoc([entry]))
      expect(result.xml, kind).toBeNull()
      const errors = find(result.problems, 'xml-descriptor-value')
      expect(errors, kind).toHaveLength(1)
      expect(errors[0]).toMatchObject({ severity: 'error', nodeId: 'd1', path: 'doc.body[2].children[1].languageSets[0].groups[0].terms[0].descriptors[0]' })
      expect(errors[0]!.message).toContain(kind)
    }
  })

  it('xml-descriptor-duplicate（error）：同一变体里同一 kind 出现多次；不同变体各有一个不算重复', () => {
    const dup = term('t1', '术语', '定义。', { languageSets: [languageSet('ls', 'zh', [['变体', [descriptor('d1', 'termType', 'fullForm'), descriptor('d2', 'termType', 'symbol')]]])] })
    const result = exportDoc(termsDoc([dup]))
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-descriptor-duplicate')).toMatchObject([{ severity: 'error', nodeId: 'd2' }])
    const ok = term('t1', '术语', '定义。', { languageSets: [languageSet('ls', 'zh', [['变体一', [descriptor('d1', 'termType', 'fullForm')]], ['变体二', [descriptor('d2', 'termType', 'symbol')]]])] })
    expect(codesOf(exportDoc(termsDoc([ok])).problems, 'error')).toEqual([])
  })
})

describe('语言集的构成与合并（D-X-13）', () => {
  it('显式集与隐含集主语言相同（zh-Hans → zh）：tig 追加在隐含 tig 之后，xml:lang 沿用 zh，语言字符串不同时 info term-language-merged', () => {
    const entry = term('t1', '主名', '定义。', { languageSets: [languageSet('ls', 'zh-Hans', [['别名']])] })
    const { xml, problems } = renderOk(termsDoc([entry]))
    const sec = compact(bodyOf(xml))
    expect(sec.match(/<tbx:langSet /g)).toHaveLength(1)
    expect(sec).toContain('<tbx:langSet xml:lang="zh"><tbx:definition>定义。</tbx:definition><tbx:tig><tbx:term>主名</tbx:term></tbx:tig><tbx:tig><tbx:term>别名</tbx:term></tbx:tig></tbx:langSet>')
    expect(find(problems, 'term-language-merged')).toMatchObject([{ severity: 'info', nodeId: 'ls' }])
  })

  it('语言字符串相同时合并不报 info；大小写与下划线不同按主语言子标签合并（EN_us → en）', () => {
    const same = term('t1', '主名', '定义。', { termEn: [{ text: 'main' }], languageSets: [languageSet('ls', 'en', [['alias']])] })
    const result = renderOk(termsDoc([same]))
    expect(find(result.problems, 'term-language-merged')).toEqual([])
    expect(compact(bodyOf(result.xml))).toContain('<tbx:langSet xml:lang="en"><tbx:tig><tbx:term>main</tbx:term></tbx:tig><tbx:tig><tbx:term>alias</tbx:term></tbx:tig></tbx:langSet>')
    const mixed = term('t2', '主名', '定义。', { termEn: [{ text: 'main' }], languageSets: [languageSet('ls2', 'EN_us', [['alias']])] })
    const merged = renderOk(termsDoc([mixed]))
    expect(compact(bodyOf(merged.xml)).match(/<tbx:langSet /g)).toHaveLength(2)
    expect(find(merged.problems, 'term-language-merged')).toHaveLength(1)
  })

  it('新语言新增一个 langSet，xml:lang 取 language 原文（去首尾空白）；按数组序排在隐含集之后', () => {
    const entry = term('t1', '主名', '定义。', {
      termEn: [{ text: 'main' }],
      languageSets: [languageSet('ls1', ' fr ', [['principal']]), languageSet('ls2', 'de-CH', [['haupt']])],
    })
    const xml = compact(bodyOf(renderOk(termsDoc([entry])).xml))
    const langs = [...xml.matchAll(/<tbx:langSet xml:lang="([^"]*)"/g)].map(match => match[1])
    expect(langs).toEqual(['zh', 'en', 'fr', 'de-CH'])
    expect(xml).toContain('<tbx:langSet xml:lang="fr"><tbx:tig><tbx:term>principal</tbx:term></tbx:tig></tbx:langSet>')
  })

  it('同一语言的两个显式集也合并；条目级内容仍只写入第一个 langSet', () => {
    const entry = term('t1', '', '定义。', {
      term: [],
      languageSets: [languageSet('ls1', 'fr', [['un']]), languageSet('ls2', 'fr', [['deux']]), languageSet('ls3', 'es', [['tres']])],
    })
    const xml = compact(bodyOf(renderOk(termsDoc([entry])).xml))
    expect(xml).toContain('<tbx:langSet xml:lang="fr"><tbx:definition>定义。</tbx:definition><tbx:tig><tbx:term>un</tbx:term></tbx:tig><tbx:tig><tbx:term>deux</tbx:term></tbx:tig></tbx:langSet>')
    expect(xml).toContain('<tbx:langSet xml:lang="es"><tbx:tig><tbx:term>tres</tbx:term></tbx:tig></tbx:langSet>')
    expect(xml.match(/<tbx:definition>/g)).toHaveLength(1)
  })

  it('term-language-missing（error）：显式语言集没有 language', () => {
    const entry = term('t1', '术语', '定义。', { languageSets: [languageSet('ls', '  ', [['x']])] })
    const result = exportDoc(termsDoc([entry]))
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'term-language-missing')).toMatchObject([{ severity: 'error', nodeId: 'ls', path: 'doc.body[2].children[1].languageSets[0].language' }])
  })

  it('xml-term-empty（error）：条目没有任何术语名；新语言的显式集里没有任何术语变体', () => {
    const none = exportDoc(termsDoc([term('t1', '', '定义。', { term: [] })]))
    expect(none.xml).toBeNull()
    expect(find(none.problems, 'xml-term-empty')).toMatchObject([{ severity: 'error', nodeId: 't1' }])
    const emptySet = exportDoc(termsDoc([term('t2', '术语', '定义。', { languageSets: [{ id: 'ls', language: 'fr', groups: [{ id: 'g', terms: [] }] }] })]))
    expect(emptySet.xml).toBeNull()
    expect(find(emptySet.problems, 'xml-term-empty')).toMatchObject([{ severity: 'error', nodeId: 'ls' }])
  })

  it('没有术语名内容的变体被跳过并给 empty-content（warning），其余变体照常输出', () => {
    const entry = term('t1', '主名', '定义。', { languageSets: [languageSet('ls', 'zh', [['', [descriptor('d1', 'partOfSpeech', 'noun')]], ['别名']])] })
    const { xml, problems } = renderOk(termsDoc([entry]))
    expect(compact(bodyOf(xml)).match(/<tbx:tig>/g)).toHaveLength(2)
    expect(find(problems, 'empty-content')).toMatchObject([{ severity: 'warning', nodeId: 'ls.v0' }])
  })

  it('tailOrder 与 XML 固定次序一致时不提示；不一致时 info term-tail-order-normalized，输出仍按固定次序', () => {
    const base = term('t1', '主名', '定义。', {
      definition: [para('t1.d0', '定义。'), para('t1.d1', '续段。')],
      source: [{ text: 'GB/T 1' }],
      notes: [note('t1.n1', '注一')],
      examples: [example('t1.e1', '示例一')],
      languageSets: [languageSet('ls', 'fr', [['principal']])],
    })
    const canonical = { ...base, tailOrder: [{ kind: 'definition', index: 0 }, { kind: 'example', index: 0 }, { kind: 'note', index: 0 }, { kind: 'source', index: 0 }, { kind: 'languageSet', index: 0 }] } as IRTermEntry
    expect(find(renderOk(termsDoc([canonical])).problems, 'term-tail-order-normalized')).toEqual([])
    const authored = { ...base, tailOrder: [{ kind: 'source', index: 0 }, { kind: 'note', index: 0 }, { kind: 'languageSet', index: 0 }, { kind: 'definition', index: 0 }, { kind: 'example', index: 0 }] } as IRTermEntry
    const { xml, problems } = renderOk(termsDoc([authored]))
    expect(find(problems, 'term-tail-order-normalized')).toMatchObject([{ severity: 'info', nodeId: 't1' }])
    expect(compact(xml)).toContain('<tbx:definition>定义。<break/>续段。</tbx:definition><tbx:example>示例一</tbx:example><tbx:note>注一</tbx:note><tbx:source>GB/T 1</tbx:source><tbx:tig>')
  })
})

describe('定义、示例、注、来源（M-9.2.2、M-9.2.4、M-9.2.5、M-9.2.7、M-9.2.8）', () => {
  it('[M-9.2.2-01] [M-9.2.2-02] tbx:definition：行内内容；多个定义段用 break 连接（D-T-07），空段被跳过', () => {
    const entry = term('t1', '术语', '首段', { definition: [para('t1.d0', '首段'), para('t1.d1', ''), para('t1.d2', '续段', run('粗', { type: 'bold' }))] })
    expect(termSec(termsDoc([entry]))).toContain('<tbx:definition>首段<break/>续段<bold>粗</bold></tbx:definition>')
  })

  it('[M-9.2.4-01] tbx:example 行内内容、没有 id，多个示例依次排列', () => {
    const entry = term('t1', '术语', '定义。', { examples: [example('t1.e1', '示例一'), example('t1.e2', '示例二')] })
    const xml = termSec(termsDoc([entry]))
    expect(xml).toContain('<tbx:example>示例一</tbx:example><tbx:example>示例二</tbx:example>')
    expect(xml).not.toMatch(/<tbx:example [^>]*id=/)
  })

  it('[M-9.2.5-01] [M-9.2.7-01] [M-E-09] tbx:note：“注”字样与编号不写入；仅被引用时才有 id（nte_<术语号>-<k>），引用写成 xref[custom/note]', () => {
    const entry = term('t1', '术语', '定义。', { notes: [note('t1.n1', '第一条注'), note('t1.n2', '第二条注'), note('t1.n3', '第三条注')] })
    const reference = para('use-p', '见', run('注2', { type: 'crossRef', targetId: 't1.n2', targetKind: 'note' }), '。')
    const doc = termsDoc([entry], {}, [chapter('ch-use', '使用', [reference])])
    const xml = compact(bodyOf(renderOk(doc).xml))
    expect(xml).toContain('<tbx:note>第一条注</tbx:note><tbx:note id="nte_3.1-2">第二条注</tbx:note><tbx:note>第三条注</tbx:note>')
    expect(xml).toContain('<xref ref-type="custom" custom-type="note" rid="nte_3.1-2">注2</xref>')
    expect(xml).not.toMatch(/注：|注1/)
  })

  it('[M-9.2.7-01] 注内可含对其他章条的 xref（9.2.7）', () => {
    const entry = term('t1', '术语', '定义。', { notes: [{ kind: 'note', id: 't1.n1', content: [para('t1.n1.p', '参见', run('第1章', { type: 'crossRef', targetId: 'ch-scope', targetKind: 'chapter' }))] }] })
    expect(termSec(termsDoc([entry]))).toContain('<tbx:note>参见<xref ref-type="sec" rid="sec_1">第1章</xref></tbx:note>')
  })

  it('[M-9.2.8-01] tbx:source：纯文本（标准号原样），不加 std、方括号与“来源”字样；其中的 mark 丢弃并告警', () => {
    const entry = term('t1', '术语', '定义。', { source: [{ text: 'GB/T 20000.1—2014,5.2' }] })
    const xml = termSec(termsDoc([entry]))
    expect(xml).toContain('<tbx:source>GB/T 20000.1—2014,5.2</tbx:source>')
    expect(xml).not.toMatch(/<std|来源|\[/)
    const marked = term('t2', '术语', '定义。', { source: [{ text: 'GB/T 1', marks: [{ type: 'bold' }] }, { text: ',3.1' }] })
    const result = renderOk(termsDoc([marked]))
    expect(compact(bodyOf(result.xml))).toContain('<tbx:source>GB/T 1,3.1</tbx:source>')
    expect(find(result.problems, 'mark-dropped-in-text-only')).toHaveLength(1)
  })

  it('子元素次序固定：subjectField、definition、example、note、source、tig（与 IR 字段的书写次序无关）', () => {
    const entry: IRTermEntry = {
      kind: 'termEntry', id: 't1',
      source: [{ text: '来源' }], notes: [note('t1.n1', '注')], examples: [example('t1.e1', '示例')],
      definition: [para('t1.d0', '定义')], subjectField: [{ text: '领域' }], term: [{ text: '术语' }],
    }
    expect(termSec(termsDoc([entry]))).toContain(
      '<tbx:subjectField>领域</tbx:subjectField><tbx:definition>定义</tbx:definition><tbx:example>示例</tbx:example>'
      + '<tbx:note>注</tbx:note><tbx:source>来源</tbx:source><tbx:tig><tbx:term>术语</tbx:term></tbx:tig>',
    )
  })

  it('xml-term-no-definition（error，V-9）：没有任何非空定义段', () => {
    for (const definition of [[], [para('t1.d0', '')]] as IRBlock[][]) {
      const result = exportDoc(termsDoc([term('t1', '术语', '定义。', { definition })]))
      expect(result.xml).toBeNull()
      expect(find(result.problems, 'xml-term-no-definition')).toMatchObject([{ severity: 'error', nodeId: 't1' }])
    }
  })

  it('xml-term-definition-block（error，D-T-07、G-T-21）：定义里放了列表等非段落块', () => {
    const list: IRBlock = { kind: 'list', id: 't1.l', listType: 'dash', items: [{ id: 't1.l1', content: [para('t1.l1.p', '项')] }] }
    const result = exportDoc(termsDoc([term('t1', '术语', '定义。', { definition: [para('t1.d0', '定义。'), list] })]))
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-term-definition-block')).toMatchObject([{ severity: 'error', nodeId: 't1.l', path: 'doc.body[2].children[1].definition[1]' }])
  })

  it('xml-note-content（error）：术语注/示例含多个块或非段落块', () => {
    const twoParagraphs = { kind: 'example', id: 't1.e1', content: [para('t1.e1.a', '甲'), para('t1.e1.b', '乙')] } as IRTermEntry['examples'][number]
    const listNote = { kind: 'note', id: 't1.n1', content: [{ kind: 'list', id: 't1.l', listType: 'dash', items: [{ id: 't1.li', content: [para('t1.li.p', '项')] }] }] } as IRTermEntry['notes'][number]
    const result = exportDoc(termsDoc([term('t1', '术语', '定义。', { examples: [twoParagraphs], notes: [listNote] })]))
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-note-content').map(problem => problem.nodeId)).toEqual(['t1.e1', 't1.n1'])
  })

  it('空的示例/注写出空元素并给 empty-content（warning）', () => {
    const entry = term('t1', '术语', '定义。', { examples: [{ kind: 'example', id: 't1.e1', content: [] }], notes: [note('t1.n1', '')] })
    const { xml, problems } = renderOk(termsDoc([entry]))
    expect(compact(bodyOf(xml))).toContain('<tbx:example/><tbx:note/>')
    expect(find(problems, 'empty-content')).toHaveLength(2)
  })

  it('formula-in-text-only（error）：来源里不能放行内公式', () => {
    const entry = term('t1', '术语', '定义。', { source: [{ text: '', formula: { id: 'f1', latex: 'x' } }] })
    const result = exportDoc(termsDoc([entry]))
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'formula-in-text-only')).toHaveLength(1)
  })
})

describe('术语间的引用：tbx:entailedTerm 与 xref（M-9.2.6）', () => {
  const entries = [term('t1', '术语一', '见', { definition: [para('t1.d0', '规定了', run('术语二', { type: 'termRef', targetId: 't2' }), '。')] }), term('t2', '术语二', '定义。')]

  it('[M-9.2.6-01] 术语章内，definition/note/example 里的 termRef 写成 tbx:entailedTerm[@target=term_<n>]，内容取 run 自己的文本', () => {
    const doc = termsDoc([
      term('t1', '术语一', '见', {
        definition: [para('t1.d0', '规定了', run('术语二', { type: 'termRef', targetId: 't2' }), '。')],
        examples: [{ kind: 'example', id: 't1.e1', content: [para('t1.e1.p', '例', run('二', { type: 'termRef', targetId: 't2' }))] }],
        notes: [{ kind: 'note', id: 't1.n1', content: [para('t1.n1.p', '注', run('二', { type: 'crossRef', targetId: 't2', targetKind: 'term' }))] }],
      }),
      term('t2', '术语二', '定义。'),
    ])
    const xml = termSec(doc, 0)
    expect(xml).toContain('<tbx:definition>规定了<tbx:entailedTerm target="term_3.2">术语二</tbx:entailedTerm>。</tbx:definition>')
    expect(xml).toContain('<tbx:example>例<tbx:entailedTerm target="term_3.2">二</tbx:entailedTerm></tbx:example>')
    expect(xml).toContain('<tbx:note>注<tbx:entailedTerm target="term_3.2">二</tbx:entailedTerm></tbx:note>')
  })

  it('[M-9.2.6-02] [M-9.2.6-03] 术语章之外的引用（或 tbx:term 等不允许 entailedTerm 的位置）写成 xref[custom/term-entry]，rid=term_<n>', () => {
    const outside = para('use-p', '见', run('术语二', { type: 'termRef', targetId: 't2' }), '，另见', run('术语一', { type: 'crossRef', targetId: 't1', targetKind: 'term' }), '。')
    const doc = termsDoc(entries, {}, [chapter('ch-use', '使用', [outside])])
    const xml = compact(bodyOf(renderOk(doc).xml))
    expect(xml).toContain('<p>见<xref ref-type="custom" custom-type="term-entry" rid="term_3.2">术语二</xref>，另见<xref ref-type="custom" custom-type="term-entry" rid="term_3.1">术语一</xref>。</p>')
  })

  it('对术语示例的引用没有 id 方案：xml-xref-target-unsupported（error，tbx:example 无 @id）', () => {
    const entry = term('t1', '术语一', '定义。', { examples: [example('t1.e1', '例')] })
    const doc = termsDoc([entry], {}, [chapter('ch-use', '使用', [para('use-p', '见', run('示例', { type: 'crossRef', targetId: 't1.e1', targetKind: 'example' }))])])
    const result = exportDoc(doc)
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-xref-target-unsupported').length).toBeGreaterThan(0)
  })
})

describe('G5：tbx:subjectField（设计 §1.2，M-9.2.9-01）', () => {
  const withDescriptors = (...values: string[]): IRTermEntry['languageSets'] => [
    languageSet('ls', 'zh', values.map((value, index): [string, IRTermDescriptor[]] => [`变体${index}`, [descriptor(`sf${index}`, 'subjectField', value)]])),
  ]

  it('[M-9.2.9-01] 情形一：条目级领域存在且非空 → 首个 langSet 内写一个纯文本 tbx:subjectField，位于定义之前', () => {
    const doc = termsDoc([term('t1', '术语', '定义。', { subjectField: [{ text: '标准化' }] })])
    const { xml, problems } = renderOk(doc)
    expect(compact(bodyOf(xml))).toContain('<tbx:langSet xml:lang="zh"><tbx:subjectField>标准化</tbx:subjectField><tbx:definition>')
    expect(codesOf(problems)).not.toEqual(expect.arrayContaining(['term-subjectfield-promoted', 'term-subjectfield-duplicate', 'term-subjectfield-conflict']))
  })

  it('[M-9.2.9-01] 情形一（重复）：同时存在术语级 subjectField 描述符 → 各报 term-subjectfield-duplicate（warning，nodeId=描述符 id）并忽略，不写进 tig', () => {
    const doc = termsDoc([term('t1', '术语', '定义。', { subjectField: [{ text: '标准化' }], languageSets: withDescriptors('化学', '物理') })])
    const { xml, problems } = renderOk(doc)
    expect(compact(bodyOf(xml)).match(/<tbx:subjectField>/g)).toHaveLength(1)
    expect(xml).toContain('<tbx:subjectField>标准化</tbx:subjectField>')
    expect(xml).not.toMatch(/化学|物理/)
    const duplicates = find(problems, 'term-subjectfield-duplicate')
    expect(duplicates.map(problem => [problem.severity, problem.nodeId, problem.path])).toEqual([
      ['warning', 'sf0', 'doc.body[2].children[1].languageSets[0].groups[0].terms[0].descriptors[0]'],
      ['warning', 'sf1', 'doc.body[2].children[1].languageSets[0].groups[0].terms[1].descriptors[0]'],
    ])
  })

  it('[M-9.2.9-01] 情形二：条目级缺失，术语级取值（trim 后）全部一致 → 提升为条目级输出，一条 term-subjectfield-promoted（warning，nodeId=条目 id）', () => {
    const doc = termsDoc([term('t1', '术语', '定义。', { languageSets: withDescriptors('化学', ' 化学 ', '化学') })])
    const { xml, problems } = renderOk(doc)
    expect(compact(bodyOf(xml))).toContain('<tbx:subjectField>化学</tbx:subjectField>')
    expect(compact(bodyOf(xml)).match(/<tbx:subjectField>/g)).toHaveLength(1)
    const promoted = find(problems, 'term-subjectfield-promoted')
    expect(promoted).toHaveLength(1)
    expect(promoted[0]).toMatchObject({ severity: 'warning', nodeId: 't1' })
    expect(promoted[0]!.message).toContain('3 个')
  })

  it('[M-9.2.9-01] 情形三：条目级缺失，术语级取值不一致 → 不输出，error term-subjectfield-conflict（nodeId=条目 id，消息列出各取值与描述符 id）', () => {
    const doc = termsDoc([term('t1', '术语', '定义。', { languageSets: withDescriptors('化学', '物理') })])
    const result = exportDoc(doc)
    expect(result.xml).toBeNull()
    const conflict = find(result.problems, 'term-subjectfield-conflict')
    expect(conflict).toHaveLength(1)
    expect(conflict[0]).toMatchObject({ severity: 'error', nodeId: 't1' })
    expect(conflict[0]!.message).toMatch(/「化学」（描述符 sf0）.*「物理」（描述符 sf1）/)
  })

  it('[M-9.2.9-01] 情形四：两者都没有 → 不输出，没有任何 G5 问题；空取值的术语级描述符视为没有值', () => {
    const none = renderOk(termsDoc([term('t1', '术语', '定义。')]))
    expect(none.xml).not.toContain('subjectField')
    expect(codesOf(none.problems).filter(code => code.startsWith('term-subjectfield'))).toEqual([])
    const blank = renderOk(termsDoc([term('t1', '术语', '定义。', { subjectField: [{ text: '  ' }], languageSets: withDescriptors('', '  ') })]))
    expect(blank.xml).not.toContain('subjectField')
    expect(codesOf(blank.problems).filter(code => code.startsWith('term-subjectfield'))).toEqual([])
  })

  it('[M-9.2.9-01] marks 情形：取值带格式（如加粗）→ 取纯文本输出，mark-dropped-in-text-only（warning）：tbx:subjectField 只含文本', () => {
    const doc = termsDoc([term('t1', '术语', '定义。', { subjectField: [{ text: '化', marks: [{ type: 'bold' }] }, { text: '学' }] })])
    const { xml, problems } = renderOk(doc)
    expect(compact(bodyOf(xml))).toContain('<tbx:subjectField>化学</tbx:subjectField>')
    expect(find(problems, 'mark-dropped-in-text-only')).toHaveLength(1)
    // 术语级描述符（被提升）带 marks 同样如此
    const promoted = termsDoc([term('t1', '术语', '定义。', { languageSets: [languageSet('ls', 'zh', [['变体', [{ id: 'sf', kind: 'subjectField', value: [{ text: '化学', marks: [{ type: 'italic' }] }] }]]])] })])
    const result = renderOk(promoted)
    expect(compact(bodyOf(result.xml))).toContain('<tbx:subjectField>化学</tbx:subjectField>')
    expect(find(result.problems, 'mark-dropped-in-text-only')).toHaveLength(1)
    expect(find(result.problems, 'term-subjectfield-promoted')).toHaveLength(1)
  })

  it('领域里的行内公式 error formula-in-text-only；带〈〉原样输出并 warning term-subjectfield-brackets', () => {
    const formula = exportDoc(termsDoc([term('t1', '术语', '定义。', { subjectField: [{ text: '', formula: { id: 'f1', latex: 'x' } }] })]))
    expect(formula.xml).toBeNull()
    expect(find(formula.problems, 'formula-in-text-only')).toHaveLength(1)
    const brackets = renderOk(termsDoc([term('t1', '术语', '定义。', { subjectField: [{ text: '〈化学〉' }] })]))
    expect(compact(bodyOf(brackets.xml))).toContain('<tbx:subjectField>〈化学〉</tbx:subjectField>')
    expect(find(brackets.problems, 'term-subjectfield-brackets')).toMatchObject([{ severity: 'warning', nodeId: 't1' }])
  })

  it('术语级 subjectField 描述符无论如何都不出现在 tig 里', () => {
    const doc = termsDoc([term('t1', '术语', '定义。', { languageSets: withDescriptors('化学') })])
    const xml = compact(bodyOf(renderOk(doc).xml))
    const tigs = [...xml.matchAll(/<tbx:tig>[\s\S]*?<\/tbx:tig>/g)].map(match => match[0])
    expect(tigs.length).toBeGreaterThan(0)
    for (const tig of tigs) expect(tig).not.toContain('subjectField')
  })
})

describe('术语条目的位置与标签错误', () => {
  const entry = (): IRTermEntry => term('t1', '术语')

  it('xml-term-outside-terms（error）：术语条目不在术语章内（范围章、附录、引言条）', () => {
    const inScope = makeDoc([chapter('ch1', '范围', [clause('c', 1, '条', [entry()])], 'scope')])
    const inAppendix = makeDoc([chapter('ch1', '范围', [para('p', '正文')], 'scope')], { appendices: [appendix('app', false, '附录', [entry()])] })
    const inGeneral = makeDoc([chapter('ch1', '技术要求', [entry()])])
    for (const doc of [inScope, inAppendix, inGeneral]) {
      const result = exportDoc(doc)
      expect(result.xml).toBeNull()
      expect(find(result.problems, 'xml-term-outside-terms')).toMatchObject([{ severity: 'error', nodeId: 't1' }])
    }
  })

  it('xml-label-missing（error）：Resolver 的 labels 里缺少术语条目的编号/xmlId/termEntryXmlId', () => {
    const doc = termsDoc([entry()])
    const labels = { ...labelsOf(doc) }
    delete labels.t1
    const missing = exportXml46687(doc, labels, EMPTY_OPTIONS)
    expect(missing.xml).toBeNull()
    expect(find(missing.problems, 'xml-label-missing').filter(problem => problem.nodeId === 't1')).toHaveLength(2)
    const noTermEntryId = { ...labelsOf(doc) }
    noTermEntryId.t1 = { ...noTermEntryId.t1!, termEntryXmlId: undefined }
    const partial = exportXml46687(doc, noTermEntryId, EMPTY_OPTIONS)
    expect(partial.xml).toBeNull()
    expect(find(partial.problems, 'xml-label-missing').filter(problem => problem.nodeId === 't1')).toHaveLength(1)
  })

  it('嵌套术语（nestedEntries）仍由输出边界阻断（D-T-09）：unsupported-output，不进入渲染', () => {
    const nested = term('t1', '术语', '定义。', { nestedEntries: [term('t1c', '子术语')] })
    const result = exportDoc(termsDoc([nested]))
    expect(result.xml).toBeNull()
    expect(codesOf(result.problems)).toEqual(['unsupported-output'])
    expect(result.problems[0]!.path).toBe('doc.body[2].children[1].nestedEntries')
  })
})

describe('缩略语 def-list（设计 §2.12）', () => {
  const abbreviations = (): IRDefList => ({
    kind: 'defList', id: 'abbr-list',
    items: [
      { id: 'abbr-cpu', term: [{ text: 'CPU' }], definition: [{ text: '中央处理器（Central Processing Unit）' }] },
      { id: 'abbr-gps', term: [{ text: 'GPS' }], definition: [{ text: '全球定位系统', marks: [{ type: 'italic' }] }, { text: '（Global Positioning System）' }] },
    ],
  })
  const abbrDoc = (list: IRBlock[], referencing: IRBlock[] = []): IRDoc => termsDoc([clause('c-abbr', 1, '缩略语', list)], {}, referencing.length > 0 ? [chapter('ch-use', '使用', referencing)] : [])

  it('[M-10.1.4-01] [M-10.1.4-03] [M-10.1.4-04] [M-10.1.4-05] def-list[@list-content="abbreviation"] > def-item > term + def>p；没有 @id、没有 title；缩略语与释义之间不含冒号', () => {
    const xml = compact(bodyOf(renderOk(abbrDoc([abbreviations()])).xml))
    expect(xml).toContain(
      '<def-list list-content="abbreviation">'
      + '<def-item><term>CPU</term><def><p>中央处理器（Central Processing Unit）</p></def></def-item>'
      + '<def-item><term>GPS</term><def><p><italic>全球定位系统</italic>（Global Positioning System）</p></def></def-item>'
      + '</def-list>',
    )
    expect(xml).not.toMatch(/<def-list [^>]*id=|<def-item [^>]*id=/)
    expect(xml).not.toContain('：')
  })

  it('[M-10.1.4-03] [M-10.1.1-04] def-item 仅被引用时写 id（abb_<k>，Resolver 按文档序赋号）；引用写成 xref[abbreviation]，内容取 refText（缩略语文本）', () => {
    const reference = para('use-p', '见', run('GPS', { type: 'crossRef', targetId: 'abbr-gps', targetKind: 'abbreviation' }), '。')
    const xml = compact(bodyOf(renderOk(abbrDoc([abbreviations()], [reference])).xml))
    expect(xml).toContain('<xref ref-type="abbreviation" rid="abb_2">GPS</xref>')
    expect(xml).toContain('<def-item><term>CPU</term>')
    expect(xml).toContain('<def-item id="abb_2"><term>GPS</term>')
    expect(xml.match(/<def-item id=/g)).toHaveLength(1)
  })

  it('xml-list-empty（error）：没有任何项', () => {
    const result = exportDoc(abbrDoc([{ kind: 'defList', id: 'empty-list', items: [] }]))
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-list-empty')).toMatchObject([{ severity: 'error', nodeId: 'empty-list' }])
  })

  it('empty-content（warning）：缩略语或释义为空时写出空元素', () => {
    const list: IRDefList = { kind: 'defList', id: 'l', items: [{ id: 'i1', term: [{ text: 'AB' }], definition: [] }, { id: 'i2', term: [], definition: [{ text: '释义' }] }] }
    const { xml, problems } = renderOk(abbrDoc([list]))
    expect(compact(bodyOf(xml))).toContain('<def-item><term>AB</term><def><p/></def></def-item><def-item><term/><def><p>释义</p></def></def-item>')
    expect(find(problems, 'empty-content').map(problem => problem.nodeId)).toEqual(['i1', 'i2'])
  })

  it('缩略语的行内内容沿用 term / inline 容器：term 里不允许 break，释义里允许；项内的条文脚注报 xml-footnote-position', () => {
    const list: IRDefList = { kind: 'defList', id: 'l', items: [{ id: 'i1', term: [{ text: 'A\nB' }], definition: [{ text: '甲\n乙' }] }] }
    const { xml, problems } = renderOk(abbrDoc([list]))
    expect(compact(bodyOf(xml))).toContain('<term>A B</term><def><p>甲<break/>乙</p></def>')
    expect(find(problems, 'newline-flattened')).toHaveLength(1)
  })
})

/** 域快照夹具：术语章（含 G5、语言集、描述符、引用、注）与缩略语，元数据齐全。 */
function goldenDoc(): IRDoc {
  const t1 = term('g-t1', '标准化文件', '为在一定范围内获得最佳秩序，经协商一致制定并由公认机构批准，共同使用和重复使用的一种文件。', {
    termEn: [{ text: 'standardized document' }],
    subjectField: [{ text: '标准化' }],
    definition: [
      para('g-t1.d0', '为获得最佳秩序而制定的文件，规定了', run('要求', { type: 'termRef', targetId: 'g-t2' }), '。'),
      para('g-t1.d1', '续段说明，见', run('范围', { type: 'crossRef', targetId: 'ch-scope', targetKind: 'chapter' }), '。'),
    ],
    examples: [example('g-t1.e1', '标准、技术规范、规程。')],
    notes: [note('g-t1.n1', '文件可以有各种载体。'), note('g-t1.n2', '另见注1。')],
    source: [{ text: 'GB/T 20000.1—2014,5.2' }],
    languageSets: [
      languageSet('g-ls-zh', 'zh-Hans', [
        ['规范文件', [descriptor('g-d1', 'partOfSpeech', 'noun'), descriptor('g-d2', 'normativeAuthorization', 'admittedTerm'), descriptor('g-d13', 'subjectField', '标准化')]],
        ['规格书', [descriptor('g-d3', 'normativeAuthorization', 'deprecatedTerm'), descriptor('g-d4', 'termType', 'fullForm')]],
      ]),
      languageSet('g-ls-en', 'en', [['NDoc', [descriptor('g-d5', 'termType', 'abbreviation')]]]),
      languageSet('g-ls-fr', 'fr', [['document normatif', [descriptor('g-d6', 'partOfSpeech', 'noun'), descriptor('g-d7', 'grammaticalNumber', 'singular'), descriptor('g-d8', 'normativeAuthorization', 'preferredTerm')]]]),
    ],
  })
  const t2 = term('g-t2', '要求', '需要满足的条件，参见', {
    definition: [para('g-t2.d0', '需要满足的条件，参见', run('文件', { type: 'termRef', targetId: 'g-t1' }), '，注', run('1', { type: 'crossRef', targetId: 'g-t1.n1', targetKind: 'note' }), '。')],
    languageSets: [languageSet('g-ls2', 'zh', [['要求项', [descriptor('g-d9', 'partOfSpeech', 'noun'), descriptor('g-d10', 'normativeAuthorization', 'preferredTerm'), descriptor('g-d11', 'subjectField', '标准化')]]])],
  })
  const t3 = term('g-t3', '合格', '满足要求。', { languageSets: [languageSet('g-ls3', 'zh', [['符合', [descriptor('g-d12', 'subjectField', '合格评定')]]])] })
  const abbreviations: IRDefList = {
    kind: 'defList', id: 'g-abbr',
    items: [
      { id: 'g-abbr-cpu', term: [{ text: 'CPU' }], definition: [{ text: '中央处理器（Central Processing Unit）' }] },
      { id: 'g-abbr-gps', term: [{ text: 'GPS' }], definition: [{ text: '全球定位系统（Global Positioning System）' }] },
    ],
  }
  return termsDoc([
    clause('g-c31', 1, '通用概念', [t1, t2, t3]),
    clause('g-c32', 1, '缩略语', [para('g-c32-p', '下列缩略语适用于本文件。'), abbreviations]),
  ], {}, [chapter('ch-use', '引用', [
    para('g-use-p', '引用缩略语：', run('GPS', { type: 'crossRef', targetId: 'g-abbr-gps', targetKind: 'abbreviation' }), '；引用术语：', run('要求', { type: 'termRef', targetId: 'g-t2' }), '；引用术语注：', run('注2', { type: 'crossRef', targetId: 'g-t1.n2', targetKind: 'note' }), '。'),
  ])])
}

describe('域快照与外部校验', () => {
  const doc = goldenDoc()
  const labels = labelsOf(doc)

  it('XML 文件快照（toMatchFileSnapshot）：术语条目（G5、语言集、描述符、引用、注）与缩略语', async () => {
    const result = exportXml46687(doc, labels, EMPTY_OPTIONS)
    expect(codesOf(result.problems, 'error')).toEqual([])
    await expect(result.xml).toMatchFileSnapshot('__snapshots__/xml46687.terms.xml')
  })

  it('问题集合恰为预期（防止告警悄悄增多）', () => {
    const { problems } = exportXml46687(doc, labels, EMPTY_OPTIONS)
    expect(problems.map(problem => `${problem.severity} ${problem.code}`)).toEqual([
      'info meta-not-expressed',
      'info term-language-merged',
      'warning term-subjectfield-duplicate',
      'warning term-subjectfield-promoted',
      'warning term-subjectfield-promoted',
      'warning term-descriptor-missing',
    ])
  })

  it('导出幂等：连续两次逐字节相同', () => {
    const first = exportXml46687(doc, labels, EMPTY_OPTIONS).xml
    expect(exportXml46687(doc, labels, EMPTY_OPTIONS).xml).toBe(first)
  })

  describe.skipIf(shouldSkipValidation())('python3 -I scripts/xml46687/validate.py --json --profile export', () => {
    it('valid:true，errors:[]', () => {
      const result = validateWithPython(exportXml46687(doc, labels, EMPTY_OPTIONS).xml!, 'export')
      expect(result.errors).toEqual([])
      expect(result.valid).toBe(true)
    })

    it('sts_compat.py：退出码 0，零未解释偏差', () => {
      const result = stsCompatWithPython(exportXml46687(doc, labels, EMPTY_OPTIONS).xml!)
      expect(result.status, result.stdout).toBe(0)
    })
  })
})
