import { describe, expect, it } from 'vitest'
import { createWp6Fixture } from '../../../../client/src/extensions/__fixtures__/wp6'
import { resolve } from '../../ir/resolve'
import type { IRDoc } from '../../ir/types'
import { exportXml46687, renderXml46687 } from '../xml46687'
import { buildGoldenSamples, type GoldenSample } from './xml46687GoldenSamples'
import { shouldSkipValidation, validateWithPython } from './xml46687PythonValidation'
import { allElements, childElements, hasAncestor, hasTextLabel, isCalendarDate, parseXml, textOf, type XNode } from './xml46687SemanticKit'
import { EMPTY_OPTIONS, chapter, codesOf, completeMeta, find, makeDoc, para } from './xml46687Kit'

/**
 * 语义检查（T2.6，设计 §7.5），对四份黄金样例**独立复算**：从写出的 XML 文本重新解析（`xml46687SemanticKit.ts` 的最小解析器），
 * 不复用渲染器的检查函数（`checkOutputTree` 等）；并与 `validate.py` 的 V-1 结论交叉核对。
 */

const samples = buildGoldenSamples(createWp6Fixture())
const wp82 = samples.find(sample => sample.name === 'wp82')!

const render = (sample: GoldenSample): string => renderXml46687(sample.doc, sample.labels, sample.options)
const idOf = (node: XNode): string | undefined => node.attrs.id

/** 文档中被 `xref/@rid` 或 `tbx:entailedTerm/@target` 引用的 id 集合。 */
function referencedIds(root: XNode): Set<string> {
  const ids = new Set<string>()
  for (const node of allElements(root)) {
    if (node.name === 'xref' && node.attrs.rid !== undefined) ids.add(node.attrs.rid)
    if (node.name === 'tbx:entailedTerm' && node.attrs.target !== undefined) ids.add(node.attrs.target)
  }
  return ids
}

describe.each(samples)('语义检查：$name', sample => {
  const xml = render(sample)
  const root = parseXml(xml)
  const elements = allElements(root)

  it('id 唯一；每个 xref/@rid 与 tbx:entailedTerm/@target 都能解析；rid 恒为单个标识符', () => {
    const ids = elements.map(idOf).filter((id): id is string => id !== undefined)
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
    expect(duplicates).toEqual([])
    const idSet = new Set(ids)
    const unresolved = [...referencedIds(root)].filter(id => !idSet.has(id))
    expect(unresolved).toEqual([])
    for (const id of referencedIds(root)) expect(id, `rid「${id}」含空白，不是单个标识符`).not.toMatch(/\s/)
    for (const node of elements) {
      if (node.name === 'xref') expect(node.attrs.rid, '每个 xref 都有 rid').toBeDefined()
    }
  })

  it('没有 ext_ 占位（id、rid、target 都不以 ext_ 开头）；没有 tex-math / alternatives；没有 DOCTYPE', () => {
    expect(xml).not.toMatch(/\b(?:id|rid|target)="ext_/)
    expect(xml).not.toMatch(/tex-math|alternatives/)
    expect(xml).not.toContain('<!DOCTYPE')
    expect(elements.some(node => node.name === 'tex-math' || node.name === 'alternatives')).toBe(false)
    expect(elements.some(node => node.name === 'mml:annotation' || node.name === 'mml:annotation-xml')).toBe(false)
  })

  it('XML 声明在首行；根是 standard，只声明 mml、tbx、xlink 三个命名空间，没有默认命名空间', () => {
    expect(xml.split('\n')[0]).toBe('<?xml version="1.0" encoding="UTF-8"?>')
    expect(root.name).toBe('standard')
    expect(Object.keys(root.attrs).sort()).toEqual(['xmlns:mml', 'xmlns:tbx', 'xmlns:xlink'])
    expect(root.attrs['xmlns:mml']).toBe('http://www.w3.org/1998/Math/MathML')
    expect(root.attrs['xmlns:tbx']).toBe('urn:iso:std:iso:30042:ed-1')
    expect(root.attrs['xmlns:xlink']).toBe('http://www.w3.org/1999/xlink')
    // 命名空间声明只在根上；任何元素的前缀都是已声明的三个之一（或无前缀）
    for (const node of elements.slice(1)) expect(Object.keys(node.attrs).filter(name => name === 'xmlns' || name.startsWith('xmlns:'))).toEqual([])
    for (const node of elements) {
      const prefix = node.name.includes(':') ? node.name.split(':')[0] : undefined
      if (prefix !== undefined) expect(['mml', 'tbx']).toContain(prefix)
    }
  })

  it('根的子元素次序 processing-meta、front、body、back(可选)；std-meta 子元素按 validate.py V-12 的导出次序；front 内 foreword 在 intro 之前', () => {
    const names = childElements(root).map(node => node.name)
    expect(names.slice(0, 3)).toEqual(['processing-meta', 'front', 'body'])
    expect(names.length === 3 || (names.length === 4 && names[3] === 'back')).toBe(true)
    const order = [
      'std-type', 'title-wrap', 'proj-id', 'release-version', 'std-ident', 'std-org', 'std-org-group', 'content-language', 'std-ref', 'doc-ref',
      'release-date', 'implementation-date', 'equivalence', 'comm-ref', 'secretariat', 'ics', 'ccs', 'page-count', 'std-supersedes', 'std-xref',
      'permissions', 'custom-meta-group',
    ]
    const meta = childElements(childElements(root).find(node => node.name === 'front')!).find(node => node.name === 'std-meta')!
    const ranks = childElements(meta).map(node => order.indexOf(node.name))
    expect(ranks.every(rank => rank >= 0), `std-meta 有未知子元素：${childElements(meta).map(node => node.name)}`).toBe(true)
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    const secTypes = childElements(childElements(root).find(node => node.name === 'front')!).filter(node => node.name === 'sec').map(node => node.attrs['sec-type'])
    expect(secTypes).toEqual(['foreword', 'intro'].filter(type => secTypes.includes(type)))
  })

  it('必备 id（validate.py V-13 清单）逐类断言存在：有 label 的 sec/app/term-sec/termEntry/参考文献 ref-list 与 ref/index/有 label 的 table-wrap/fig/有 label 的 disp-formula/各类 fn', () => {
    const missing: string[] = []
    const need = (condition: boolean, node: XNode, what: string): void => {
      if (condition && idOf(node) === undefined) missing.push(`${node.name}（${what}）`)
    }
    for (const node of elements) {
      switch (node.name) {
        case 'term-sec': need(true, node, '术语条'); break
        case 'tbx:termEntry': need(true, node, '术语条目'); break
        case 'sec': need(hasTextLabel(node) || node.attrs['sec-type'] === 'foreword' || node.attrs['sec-type'] === 'intro', node, '章条/前言/引言'); break
        case 'app': need(true, node, '附录'); break
        case 'ref-list': need(node.attrs['content-type'] === 'bibl', node, '参考文献表'); break
        case 'index': need(true, node, '索引'); break
        case 'ref': need((node.parent?.name === 'ref-list' && node.parent.attrs['content-type'] === 'bibl') || hasTextLabel(node), node, '参考文献条目'); break
        case 'table-wrap': need(hasTextLabel(node), node, '有编号的表'); break
        case 'fig': need(true, node, '图'); break
        case 'disp-formula': need(hasTextLabel(node), node, '有编号的行间公式'); break
        case 'fn': need(hasAncestor(node, 'table-wrap-foot') || childElements(node).some(child => child.name === 'p'), node, '脚注'); break
        default: break
      }
    }
    expect(missing).toEqual([])
    // 规定 ID 形态：章条 sec_*，术语 term_*，表脚注 table-fn_*，正文脚注 fn_*，参考文献 biblref_*
    for (const node of elements) {
      if (node.name === 'tbx:termEntry') expect(idOf(node)).toMatch(/^term_/)
      if (node.name === 'term-sec') expect(idOf(node)).toMatch(/^sec_/)
      if (node.name === 'fn') expect(idOf(node)).toMatch(hasAncestor(node, 'table-wrap-foot') ? /^table-fn_/ : /^fn_\d+$/)
      if (node.name === 'ref' && node.parent?.attrs['content-type'] === 'bibl') expect(idOf(node)).toMatch(/^biblref_\d+$/)
    }
  })

  it('仅被引用才有 id：note / example / list-item / def-item / tbx:note 有 id ⇒ 被引用；警告、摘录、代码、p 永不带 id', () => {
    const referenced = referencedIds(root)
    const onlyWhenReferenced = new Set(['non-normative-note', 'non-normative-example', 'list-item', 'def-item', 'tbx:note'])
    const unexpected = elements
      .filter(node => onlyWhenReferenced.has(node.name) && idOf(node) !== undefined && !referenced.has(idOf(node)!))
      .map(node => `${node.name}#${idOf(node)}`)
    expect(unexpected).toEqual([])
    for (const node of elements) {
      if (node.name === 'non-normative-note' && node.attrs['content-type'] === 'warning') expect(idOf(node)).toBeUndefined()
      if (['disp-quote', 'code', 'p', 'list', 'legend', 'tbx:example', 'tbx:definition'].includes(node.name)) expect(idOf(node), node.name).toBeUndefined()
      if (node.name === 'p') expect(node.attrs, 'p 不带任何属性（content-type=dimension 的单位段除外）').toEqual(node.attrs['content-type'] === 'dimension' ? { 'content-type': 'dimension' } : {})
    }
  })

  it('资源可定位：每个 graphic / inline-graphic 的 xlink:href 在资源清单里恰好一条，清单条目都被使用且 fileName 唯一、扩展名与媒体类型一致', () => {
    const hrefs = elements.filter(node => node.name === 'graphic' || node.name === 'inline-graphic').map(node => node.attrs['xlink:href'])
    for (const href of hrefs) expect(href).toBeDefined()
    expect(new Set(hrefs).size, 'href 不重复').toBe(hrefs.length)
    const entries = sample.options.resources.entries
    for (const href of hrefs) expect(entries.filter(entry => entry.href === href), `href「${href}」`).toHaveLength(1)
    expect(entries.map(entry => entry.href).sort()).toEqual([...(hrefs as string[])].sort())
    const fileNames = entries.map(entry => entry.fileName)
    expect(new Set(fileNames).size).toBe(fileNames.length)
    for (const entry of entries) {
      expect(entry.fileName).toMatch(new RegExp(`^${entry.href.replace(/[.]/g, '\\.')}\\.[a-z0-9]+$`))
      expect(entry.fileName).not.toMatch(/[\\/]/)
    }
    // href 无目录、无扩展名（C-T-27）；块图的 href 与所属 fig 的 id 相同
    for (const node of elements) {
      if (node.name === 'graphic') {
        expect(node.attrs['xlink:href']).not.toMatch(/[./]png|\//)
        expect(node.parent?.name).toBe('fig')
        expect(node.attrs['xlink:href']).toBe(idOf(node.parent!))
      }
      if (node.name === 'inline-graphic') expect(node.attrs['xlink:href']).toMatch(/^inl_\d+$/)
    }
  })

  it('日期语义：release-date / implementation-date 是真实日历日，发布不晚于实施', () => {
    const dates = (name: string): string[] => elements.filter(node => node.name === name).map(textOf)
    expect(dates('release-date')).toHaveLength(1)
    expect(dates('implementation-date')).toHaveLength(1)
    for (const value of [...dates('release-date'), ...dates('implementation-date')]) expect(isCalendarDate(value), value).toBe(true)
    expect(dates('release-date')[0]! <= dates('implementation-date')[0]!).toBe(true)
    // 发布日期永远只写在 release-date 里，implementation-date 不写进 release-date（V-4）
    expect(elements.filter(node => node.name === 'release-date')).toHaveLength(1)
    expect(elements.filter(node => node.name === 'release-date' && node.attrs['date-type'] !== undefined)).toEqual([])
  })

  it('mml:math 的 id 为 mml_m<k>，k 从 1 起连续，行间与行内合并按文档序计数；行间带 display="block"、行内不带', () => {
    const roots = elements.filter(node => node.name === 'mml:math' && !hasAncestor(node, 'mml:math'))
    expect(roots.map(idOf)).toEqual(roots.map((_, index) => `mml_m${index + 1}`))
    for (const math of roots) {
      if (math.parent?.name === 'disp-formula') expect(math.attrs.display).toBe('block')
      else {
        expect(math.parent?.name).toBe('inline-formula')
        expect(math.attrs.display).toBeUndefined()
      }
    }
    // 嵌套在 mml:math 内部的元素不带 id
    for (const node of elements) if (node.name.startsWith('mml:') && node.name !== 'mml:math') expect(idOf(node)).toBeUndefined()
    // 公式数量与 IR 一致（块公式 + 行内公式），一个都不丢
    expect(roots).toHaveLength(Object.keys(sample.options.mathml).length)
  })

  it('label 与 title 内不写 bold（2.0.2-8）；list-item 的 label 只在有序列表里（无序列项不写 label）', () => {
    for (const node of elements) {
      if (node.name === 'label') expect(allElements(node).some(child => child.name === 'bold'), textOf(node)).toBe(false)
      if (node.name === 'list-item') {
        const type = node.parent!.attrs['list-type']
        const labeled = childElements(node).some(child => child.name === 'label')
        expect(labeled, `list-type=${type}`).toBe(['alpha-lower', 'arabic', 'roman-lower'].includes(type!))
      }
    }
  })
})

describe('语义检查：WP8.2 全要素夹具的“被引用 / 未被引用”各一对（设计 §3.2）', () => {
  const root = parseXml(render(wp82))
  const elements = allElements(root)
  const referenced = referencedIds(root)
  const pairs: Array<[string, string]> = [
    ['non-normative-note', '注'], ['non-normative-example', '示例'], ['list-item', '列项'], ['def-item', '缩略语项'], ['tbx:note', '术语注'],
  ]
  it.each(pairs)('%s（%s）：既有带 id 且被引用的，也有不带 id 的', name => {
    const nodes = elements.filter(node => node.name === name && node.attrs['content-type'] !== 'warning')
    const withId = nodes.filter(node => idOf(node) !== undefined)
    const withoutId = nodes.filter(node => idOf(node) === undefined)
    expect(withId.length, `${name} 带 id`).toBeGreaterThan(0)
    expect(withoutId.length, `${name} 不带 id`).toBeGreaterThan(0)
    for (const node of withId) expect(referenced.has(idOf(node)!)).toBe(true)
  })

  it('每种 xref 类型至少出现一次（章条、附录、表、图、公式、注、示例、列项、缩略语、文献、术语、脚注、表脚注）', () => {
    const kinds = new Set(elements.filter(node => node.name === 'xref').map(node => `${node.attrs['ref-type']}${node.attrs['custom-type'] ? `:${node.attrs['custom-type']}` : ''}`))
    expect([...kinds].sort()).toEqual([
      'abbreviation', 'app', 'bibr', 'custom:example', 'custom:note', 'custom:term-entry', 'disp-formula', 'fig', 'fn', 'list', 'sec', 'table', 'table-fn',
    ].sort())
    expect(elements.some(node => node.name === 'tbx:entailedTerm')).toBe(true)
  })
})

describe('语义检查：与 validate.py 的 V-1 结论交叉核对（故意破坏 id/rid，两边都要发现）', () => {
  const xml = render(wp82)

  const danglingXml = xml.replace('rid="sec_2"', 'rid="sec_nowhere"')
  const duplicateXml = xml.replace('<sec id="sec_2" sec-type="norm-refs">', '<sec id="sec_1" sec-type="norm-refs">')

  it('TS 独立复算：悬空 rid 与重复 id 被发现', () => {
    expect(danglingXml).not.toBe(xml)
    expect(duplicateXml).not.toBe(xml)
    const danglingRoot = parseXml(danglingXml)
    const danglingIds = new Set(allElements(danglingRoot).map(idOf).filter(Boolean))
    expect([...referencedIds(danglingRoot)].filter(id => !danglingIds.has(id))).toEqual(['sec_nowhere'])
    const duplicateIds = allElements(parseXml(duplicateXml)).map(idOf).filter((id): id is string => id !== undefined)
    expect(duplicateIds.filter((id, index) => duplicateIds.indexOf(id) !== index)).toEqual(['sec_1'])
  })

  describe.skipIf(shouldSkipValidation())('validate.py --profile export', () => {
    it('悬空 rid 与重复 id 都报 V-1 error；未破坏的原文 valid:true', () => {
      expect(validateWithPython(xml, 'export').valid).toBe(true)
      for (const broken of [danglingXml, duplicateXml]) {
        const result = validateWithPython(broken, 'export')
        expect(result.valid).toBe(false)
        expect(result.errors.map((error: { rule: string }) => error.rule)).toContain('V-1')
      }
    })
  })
})

describe('日期语义（设计 §2.1、§7.5）：非法日期 error，顺序颠倒 warning，真实日历日通过', () => {
  const docWithDates = (publishDate: string, implementDate: string): IRDoc =>
    makeDoc([chapter('ch1', '范围', [para('p1', '正文')], 'scope')], { meta: completeMeta({ publishDate, implementDate }) })
  const labelsOf = (doc: IRDoc) => resolve(doc).labels

  it('[M-4.3.2-10] [M-4.3.2-11] 真实日历日（含闰日）写入 release-date / implementation-date，不报日期问题', () => {
    const doc = docWithDates('2024-02-29', '2024-03-01')
    const result = exportXml46687(doc, labelsOf(doc), EMPTY_OPTIONS)
    expect(codesOf(result.problems)).not.toContain('xml-date-invalid')
    expect(codesOf(result.problems)).not.toContain('meta-date-order')
    const root = parseXml(result.xml!)
    const text = (name: string) => textOf(allElements(root).find(node => node.name === name)!)
    expect([text('release-date'), text('implementation-date')]).toEqual(['2024-02-29', '2024-03-01'])
  })

  it.each([
    ['2026-02-30', '2026-11-01'],
    ['2026-13-01', '2026-11-01'],
    ['2026-04-30', '2026-4-1'],
    ['2025-02-29', '2026-11-01'],
    ['2026/04/30', '2026-11-01'],
  ])('[M-4.3.2-10] 非法日期（%s / %s）→ error xml-date-invalid，不输出猜测值', (publishDate, implementDate) => {
    const doc = docWithDates(publishDate, implementDate)
    const result = exportXml46687(doc, labelsOf(doc), EMPTY_OPTIONS)
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-date-invalid').length).toBeGreaterThan(0)
    expect(find(result.problems, 'xml-date-invalid')[0]).toMatchObject({ severity: 'error' })
  })

  it('[M-4.3.2-11] 发布日期晚于实施日期 → warning meta-date-order，导出继续，两个日期各写各的元素', () => {
    const doc = docWithDates('2026-12-01', '2026-11-01')
    const result = exportXml46687(doc, labelsOf(doc), EMPTY_OPTIONS)
    expect(find(result.problems, 'meta-date-order')).toMatchObject([{ severity: 'warning' }])
    const root = parseXml(result.xml!)
    const text = (name: string) => textOf(allElements(root).find(node => node.name === name)!)
    expect([text('release-date'), text('implementation-date')]).toEqual(['2026-12-01', '2026-11-01'])
  })
})
