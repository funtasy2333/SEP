import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseXml46687 } from '../parse'
import { getXmlAttr, XLINK_NS } from '../tree'
import type { XmlElement } from '../tree'
import { detectLegacyXml46687 } from './legacy'
import { validateXml46687 } from './validate'
import { mapXml46687 } from './facade'
import { resolve as resolveIr } from '../../ir/resolve'
import type { IRArray, IRFigure, IRFigureSet, IRFormula, IRFormulaGroup, IRTable, IRNormRefList, IRTermEntry, IRDefList, IRDoc, IRInline, IRExample, IRList } from '../../ir/types'

const sampleDir = resolve(process.cwd(), '../../schemas/gbt46687.2/samples')
// 实际 1×1 PNG 的完整字节，固定为可持久化资源；一个 href 对应一个准备好的资源。
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
function prepare(root: XmlElement) {
  const nodeIdsByPath = new Map<string, string>()
  const resources = new Map<string, { src: string; mediaType: string; resourceId: string }>()
  function visit(el: XmlElement) {
    nodeIdsByPath.set(el.position!.path, `node-${nodeIdsByPath.size}`)
    if (el.name.ns === null && ['graphic', 'inline-graphic'].includes(el.name.local)) {
      const href = getXmlAttr(el, XLINK_NS, 'href')
      if (href) resources.set(href, { src: png, mediaType: 'image/png', resourceId: `resource:${href}` })
    }
    for (const c of el.children) if (c.type === 'element') visit(c)
  }
  visit(root)
  return { nodeIdsByPath, resources }
}
const markers: Record<string, string> = {
  '01-minimal.xml': '本文件给出一个只含必需结构的最小文档。',
  '02-full-metadata.xml': '本文件规定了网络设备的安全要求。',
  '03-structure.xml': '这是一个无标题条，没有 title，带 numbered-paragraph 属性。',
  '04-tables.xml': '多段单元格',
  '05-formulas-figures.xml': '图形与图题之间的说明段落。',
  '06-terms-references.xml': '下列术语和定义适用于本文件。',
  '07-import-variants.xml': '无标题条，不带 sec-type 属性。',
  '08-original-forms-vs-sts.xml': '行内正文脚注，紧随其 xref。',
  '09-import-pending.xml': '引言中的有标题条。',
}

describe('WP8.3 完整有效样例的共享解析、校验与映射', () => {
  const files = readdirSync(resolve(sampleDir, 'valid')).filter(n => n.endsWith('.xml')).sort()
  it('按文件清单覆盖全部有效样例', () => expect(files).toEqual(Object.keys(markers).sort()))
  for (const file of files) {
    it(`真实资源与节点 ID 下保留 ${file} 的正文`, () => {
      const source = readFileSync(resolve(sampleDir, 'valid', file), 'utf8')
      const parsed = parseXml46687(source)
      expect(parsed.problems, file).toEqual([])
      expect(parsed.tree, file).not.toBeNull()
      const tree = parsed.tree!
      expect(detectLegacyXml46687(tree), file).toEqual([])
      const errors = validateXml46687(tree).problems.filter(p => p.severity === 'error')
      expect(errors, `${file}: ${JSON.stringify(errors)}`).toEqual([])
      const result = mapXml46687(tree, prepare(tree.root))
      expect(result.problems.filter(p => p.severity === 'error'), `${file}: ${JSON.stringify(result.problems)}`).toEqual([])
      expect(result.ir, file).not.toBeNull()
      expect(JSON.stringify(result.ir), file).toContain(markers[file])
    })
  }
})

function mapValid(file: string) {
  const parsed = parseXml46687(readFileSync(resolve(sampleDir, 'valid', file), 'utf8'))
  expect(parsed.problems).toEqual([])
  const tree = parsed.tree!
  const result = mapXml46687(tree, prepare(tree.root))
  expect(result.problems.filter(p => p.severity === 'error'), JSON.stringify(result.problems)).toEqual([])
  expect(result.ir).not.toBeNull()
  return result.ir!
}
function mapSource(source: string) {
  const parsed = parseXml46687(source)
  expect(parsed.problems).toEqual([])
  const tree = parsed.tree!
  const result = mapXml46687(tree, prepare(tree.root))
  expect(result.problems.filter(p => p.severity === 'error'), JSON.stringify(result.problems)).toEqual([])
  expect(result.ir).not.toBeNull()
  return result.ir!
}
function collectKind<T>(value: unknown, kind: string): T[] {
  if (Array.isArray(value)) return value.flatMap(item => collectKind<T>(item, kind))
  if (value === null || typeof value !== 'object') return []
  const object = value as Record<string, unknown>
  return [...(object.kind === kind ? [object as T] : []), ...Object.values(object).flatMap(item => collectKind<T>(item, kind))]
}

function allInlines(value: unknown): IRInline[] {
  if (Array.isArray(value)) return value.flatMap(allInlines)
  if (value === null || typeof value !== 'object') return []
  const object = value as Record<string, unknown>
  return [...(typeof object.text === 'string' ? [object as unknown as IRInline] : []), ...Object.values(object).flatMap(allInlines)]
}
function findMarkedInline(value: unknown, text: string): IRInline {
  const runs = allInlines(value).filter(run => run.text === text && run.marks?.length)
  expect(runs, `文本 ${text} 的带标记节点`).toHaveLength(1)
  return runs[0]!
}
const referenceCases: Array<{title: string; text: string; mark: string; target: (doc: IRDoc) => string; targetKind?: string}> = [
  {title:'[M-10.1.2-01] 章引用指向目标章',text:'第 1 章',mark:'crossRef',target:d => d.body[0]!.id,targetKind:'chapter'},
  {title:'[M-9.2.7-02] 附录引用指向目标附录',text:'附录',mark:'crossRef',target:d => d.appendices[0]!.id,targetKind:'appendix'},
  {title:'[M-10.1.2-02] 表引用指向目标表',text:'表1',mark:'crossRef',target:d => collectKind<IRTable>(d,'table')[0]!.id,targetKind:'table'},
  {title:'[M-10.1.2-03] 图引用指向目标图',text:'图1',mark:'crossRef',target:d => collectKind<IRFigure>(d,'figure')[0]!.id,targetKind:'figure'},
  {title:'[M-10.1.2-04] 公式引用指向目标公式',text:'(1)',mark:'crossRef',target:d => collectKind<IRFormula>(d,'formula')[0]!.id,targetKind:'formula'},
  {title:'[M-10.1.6-01] 参考文献引用指向文献条目',text:'[1]',mark:'bibRef',target:d => d.bibliography[0]!.id},
  {title:'[M-10.1.3-01] 注引用指向术语内的注',text:'注 1',mark:'crossRef',target:d => collectKind<IRTermEntry>(d,'termEntry')[0]!.notes[0]!.id,targetKind:'note'},
  {title:'[M-10.1.3-02] 示例引用指向目标示例',text:'示例',mark:'crossRef',target:d => collectKind<IRExample>(d,'example').find(e => JSON.stringify(e).includes('被引用的示例带 id。'))!.id,targetKind:'example'},
  {title:'[M-9.2.6-02] [M-9.2.6-03] 正文术语引用指向目标术语',text:'要求 (3.1.2)',mark:'termRef',target:d => collectKind<IRTermEntry>(d,'termEntry')[1]!.id},
  {title:'[M-10.1.5-01] [M-10.1.5-02] 列项引用指向对应列项',text:'列项 b)',mark:'crossRef',target:d => collectKind<IRList>(d,'list').flatMap(l => l.items).find(item => JSON.stringify(item).includes('被引用的列项条目带 id。'))!.id,targetKind:'listItem'},
  {title:'[M-10.1.1-04] 缩略语引用指向对应术语项',text:'GPS',mark:'crossRef',target:d => collectKind<IRDefList>(d,'defList')[0]!.items[1]!.id,targetKind:'abbreviation'},
]
for (const item of referenceCases) it(item.title, () => {
  const doc = mapValid('06-terms-references.xml')
  expect(findMarkedInline(doc, item.text).marks).toEqual([{type:item.mark, targetId:item.target(doc), ...(item.targetKind ? {targetKind:item.targetKind} : {})}])
})

describe('完整样例的映射关系', () => {
  it('[M-4.1-05] 正文各章保留顺序和标题', () => {
    const ir = mapValid('03-structure.xml')
    expect(ir.body.map(c => c.title)).toEqual([[{text:'范围'}], [{text:'规范性引用文件'}], [{text:'术语和定义'}], [{text:'技术要求'}]])
    expect(ir.body.map(c => c.secType)).toEqual(['scope','norm-refs','terms','general'])
  })
  it('[M-4.3.2-01] 标准元数据写入完整文档的元数据字段', () => {
    const meta = mapValid('02-full-metadata.xml').meta
    expect(meta).toMatchObject({title:'网络设备安全要求 第1部分：总则', stdCode:'GB/T 99999.1—2026', publishDate:'2026-04-30', implementDate:'2026-11-01'})
    expect(meta.languages?.map(l => l.tag)).toEqual(['zh', 'en'])
  })
  it('[M-4.3.4-01] 不含子条的引言保留正文', () => {
    const ir = mapValid('03-structure.xml')
    expect(ir.front.introduction).toMatchObject([{kind:'paragraph', content:[{text:'引言可以只含段落。'}]}])
    expect(ir.front.introductionClauses ?? []).toEqual([])
  })
  it('[M-4.4.2.3-01] [M-4.4.2.3.2-01] 规范性引用章和清单保持归属', () => {
    const ir = mapValid('03-structure.xml')
    const chapter = ir.body[1]!
    expect(chapter.secType).toBe('norm-refs')
    const lists = collectKind<IRNormRefList>(chapter, 'normRefList')
    expect(lists).toHaveLength(1)
    expect(lists[0]!.entries.map(e => e.entryType)).toEqual(['std','mixed'])
  })
  it('[M-4.5.3.1-03] [M-4.5.3.1-04] [M-4.5.3.1-05] 参考文献中标准号与题名分别保留', () => {
    const entry = mapValid('03-structure.xml').bibliography[0]!
    expect(entry.entryType).toBe('standard')
    expect(entry.fields?.map(f => [f.name, f.value])).toEqual([
      ['std-ref', [{text:'GB/T 7714—2015'}]], ['title', [{text:'信息与文献 参考文献著录规则'}]],
    ])
  })
  it('[M-4.5.3.1-06] 参考文献的混合引文原文保留', () => {
    const entry = mapValid('03-structure.xml').bibliography[1]!
    expect(entry.content[0]).toEqual({text:'李四.标准数字化概论[M].北京:示例出版社,2024.'})
    expect(entry.content[1]).toEqual({text:'\n'})
  })
  it('[M-4.5.3-01] [M-4.5.3-03] 参考文献表的两个条目按顺序保留', () => {
    const ir = mapValid('03-structure.xml')
    expect(ir.bibliography).toHaveLength(2)
    expect(ir.bibliography[0]).toMatchObject({entryType:'standard', content:[{text:'GB/T 7714—2015'}, {text:'信息与文献 参考文献著录规则'}]})
    expect(ir.bibliography[1]!.content[0]!.text).toBe('李四.标准数字化概论[M].北京:示例出版社,2024.')
  })
  it('[M-4.5.3.3-02] 文献中的 URI 保留地址和显示文本', () => {
    expect(mapValid('03-structure.xml').bibliography[1]!.externalLink).toEqual({href:'https://example.org/book',displayText:'https://example.org/book'})
  })
  it('[M-4.5.4-02] [M-4.5.4-03] 索引标题、分组及词条按输入顺序保留', () => {
    const index = mapValid('03-structure.xml').index!
    expect(index.title).toEqual([{text:'索引'}])
    expect(index.groups).toHaveLength(1)
    expect(index.groups[0]!.label).toEqual([{text:'B'}])
    expect(index.groups[0]!.entries.map(e => e.term)).toEqual([[{text:'无标题条'}], [{text:'变量'}]])
  })
  it('[M-4.5.4-06] 无目标 ID 的参见文字逐条保留而不猜测目标', () => {
    const entry = mapValid('03-structure.xml').index!.groups[0]!.entries[0]!
    expect(entry.targets).toEqual([])
    expect(entry.sourceReferences).toEqual([{type:'see',content:[{text:'5.1'}]}, {type:'see',content:[{text:'5.2'}]}])
  })
  it('[M-4.4.2.4-01] 术语章与两个术语条目保持层级归属', () => {
    const chapter = mapValid('06-terms-references.xml').body.find(c => c.secType === 'terms')!
    expect(chapter.title).toEqual([{text:'术语和定义'}])
    const terms = collectKind<IRTermEntry>(chapter, 'termEntry')
    expect(terms).toHaveLength(2)
    expect(terms[0]!.languageSets?.[0]?.groups[0]?.terms[0]?.content).toEqual([{text:'标准化文件'}])
    expect(terms[1]!.languageSets?.[0]?.groups[0]?.terms[0]?.content).toEqual([{text:'要求'}])
  })
  it('[M-9.2.3-02] [M-9.2.3-03] [M-9.2.3-04] 术语词形和词性描述符保持关联', () => {
    const term = collectKind<IRTermEntry>(mapValid('06-terms-references.xml'), 'termEntry')[0]!
    const variants = term.languageSets![0]!.groups.flatMap(g => g.terms)
    expect(variants.map(v => v.content)).toEqual([[{text:'标准化文件'}],[{text:'规范文件'}],[{text:'规格书'}]])
    expect(variants[0]!.descriptors).toEqual(expect.arrayContaining([expect.objectContaining({kind:'partOfSpeech',value:[{text:'noun'}]})]))
  })
  it('[M-9.2.8-01] 术语来源原文属于对应条目', () => {
    const terms = collectKind<IRTermEntry>(mapValid('06-terms-references.xml'), 'termEntry')
    expect(terms[0]!.source).toEqual([{text:'GB/T 1.1—2020,3.1.2'}])
    expect(terms[1]!.source).toBeUndefined()
  })
  it('[M-9.2.4-01] [M-9.2.5-01] 术语示例和注不混淆', () => {
    const term = collectKind<IRTermEntry>(mapValid('06-terms-references.xml'), 'termEntry')[0]!
    expect(JSON.stringify(term.examples)).toContain('电子文件和纸质文件。')
    expect(JSON.stringify(term.notes)).toContain('必要时可附图。')
    expect(term.notes).toHaveLength(2)
  })
  it('[M-10.1.4-03] [M-10.1.4-04] [M-10.1.4-05] 缩略语每项的术语和释义保持对应', () => {
    const list = collectKind<IRDefList>(mapValid('06-terms-references.xml'), 'defList')[0]!
    expect(list.items.map(item => [item.term, item.definition])).toEqual([
      [[{text:'CPU'}],[{text:'中央处理器（Central Processing Unit）'}]],
      [[{text:'GPS'}],[{text:'全球定位系统（Global Positioning System）'}]],
    ])
  })
  it('[M-9.2.6-01] 术语定义中的关联术语指向另一条目的身份', () => {
    const terms = collectKind<IRTermEntry>(mapValid('06-terms-references.xml'), 'termEntry')
    const run = findMarkedInline(terms[0]!.definition, '要求')
    expect(run.marks).toEqual([{type:'termRef', targetId:terms[1]!.id}])
  })
  it('[M-9.2.7-01] 术语注内的附录引用指向附录', () => {
    const ir = mapValid('06-terms-references.xml')
    const note = collectKind<IRTermEntry>(ir, 'termEntry')[0]!.notes[0]!
    expect(findMarkedInline(note, '附录').marks).toEqual([{type:'crossRef',targetId:ir.appendices[0]!.id,targetKind:'appendix'}])
  })
  it('[M-9.2.2-01] 术语定义正文及其中格式按原次序保留', () => {
    const term = collectKind<IRTermEntry>(mapValid('06-terms-references.xml'), 'termEntry')[1]!
    expect(JSON.stringify(term.definition)).toContain('需要满足的条件，参见')
    expect(findMarkedInline(term.definition, '文件 (3.1.1)').marks?.[0]?.type).toBe('termRef')
  })
  it('[M-10.1.8-01] [M-10.1.1-03] 正文脚注的正文和引用身份保留', () => {
    const inlines = allInlines(mapValid('06-terms-references.xml'))
    const footnotes = inlines.flatMap(run => run.footnote ? [run.footnote] : [])
    expect(footnotes).toHaveLength(1)
    expect(footnotes[0]!.id).toBeTruthy()
    expect(footnotes[0]!.content).toEqual([{text:'脚注的内容。'}])
  })
  it('[M-6.2.3-10] [M-6.2.3-11] 单元格脚注引用指向同表的对应定义', () => {
    const table = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')[0]!
    const refs = allInlines(table.rows).flatMap(run => (run.marks ?? []).filter(mark => mark.type === 'tableFootnoteRef'))
    expect(refs).toHaveLength(2)
    expect(refs).toEqual([
      expect.objectContaining({type:'tableFootnoteRef',targetId:table.footnotes![0]!.id,id:expect.any(String)}),
      expect.objectContaining({type:'tableFootnoteRef',targetId:table.footnotes![1]!.id,id:expect.any(String)}),
    ])
    expect(refs[0]!.id).not.toBe(refs[1]!.id)
  })
  it('[M-10.2-01] [M-10.2-02] 正文内标准号保留标准引用标记', () => {
    expect(findMarkedInline(mapValid('06-terms-references.xml'), 'GB/T 1.1').marks).toEqual([{type:'stdRef'}])
  })
  it('[M-10.1.7-01] 正文混合引文的文本与标记保留', () => {
    expect(findMarkedInline(mapValid('06-terms-references.xml'), 'Example Corp. Interface specification [EB/OL].').marks).toEqual([{type:'mixedCitation'}])
  })
  it('[M-6.2.1-01] [M-6.1-01] 表容器及 XHTML 表格映射到所在章节', () => {
    const doc = mapValid('04-tables.xml')
    const chapter = doc.body.find(c => c.title[0]?.text === '表')!
    const tables = collectKind<IRTable>(chapter, 'table')
    expect(tables).toHaveLength(2)
    expect(tables[0]!.rows[0]!.cells[0]!.content).toMatchObject([{kind:'paragraph',content:[{text:'项目'}]}])
    expect(tables[1]!.rows[1]!.cells[1]!.content).toMatchObject([{kind:'paragraph',content:[{text:'b'}]}])
  })
  it('[M-6.6-01] 横向属性只改变对应表的方向', () => {
    const tables = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')
    expect(tables.map(t => t.orientation)).toEqual(['portrait','landscape'])
  })
  it('[M-6.2.2-01] 表头与表体分界映射为表头行数', () => {
    const tables = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')
    expect(tables.map(t => t.headerRowCount)).toEqual([2,1])
    expect(tables[0]!.rows[1]!.cells.every(c => c.header)).toBe(true)
    expect(tables[0]!.rows[2]!.cells.every(c => !c.header)).toBe(true)
  })
  it('[M-6.4-02] 正文单元格跨列数保持为二', () => {
    const table = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')[0]!
    expect(table.rows[3]!.cells[1]!.colspan).toBe(2)
    expect(table.rows[3]!.cells[1]!.rowspan).toBe(1)
    expect(JSON.stringify(table.rows[3]!.cells[1]!.content)).toContain('2.0')
  })
  it('[M-6.4-03] 正文单元格跨行数及后续行位置不丢失', () => {
    const minimal = readFileSync(resolve(sampleDir, 'valid', '01-minimal.xml'), 'utf8')
    const xml = minimal.replace('</p>', '</p><table-wrap><label>表1</label><table><tbody><tr><td rowspan="2">甲</td><td>乙</td></tr><tr><td>丙</td></tr></tbody></table></table-wrap>')
    const table = collectKind<IRTable>(mapSource(xml), 'table')[0]!
    expect(table.rows.map(r => r.cells.map(c => c.rowspan))).toEqual([[2,1],[1]])
    expect(JSON.stringify(table.rows[1]!.cells[0]!.content)).toContain('丙')
  })
  it('[M-6.3.3.1-01] 单元格四边的线型与宽度分别保留', () => {
    const cell = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')[0]!.rows[2]!.cells[1]!
    expect(cell.style).toMatchObject({borderLeftStyle:'solid',borderTopStyle:'solid',borderRightStyle:'solid',borderBottomStyle:'solid',borderLeft:{value:2,unit:'px'},borderTop:{value:2,unit:'px'},borderRight:{value:1,unit:'px'},borderBottom:{value:1,unit:'px'}})
  })
  it('[M-6.3.4-01] 单元格背景色保留在原单元格', () => {
    const cells = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')[0]!.rows[2]!.cells
    expect(cells[2]!.style?.backgroundColor).toBe('#EFEFEF')
    expect(cells[1]!.style?.backgroundColor).toBeUndefined()
  })
  it('[M-6.2.3-03] [M-6.2.3-04] 表脚容器中的注和脚注属于同一张表', () => {
    const tables = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')
    expect(JSON.stringify(tables[0]!.notes)).toContain('表中数值为示例。')
    expect(tables[0]!.footnotes?.map(f => f.content)).toEqual([[{text:'第一个表脚注。'}],[{text:'第二个表脚注。'}]])
    expect(tables[1]!.notes).toEqual([])
  })
  it('[M-6.2.4-02] 表头单位独立段落保留其原始顺序', () => {
    const cell = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')[0]!.rows[1]!.cells[0]!
    expect(cell.content).toMatchObject([{kind:'paragraph',content:[{text:'标称尺寸(d)'}]}, {kind:'paragraph',content:[{text:'mm'}]}])
  })
  it('[M-7.1-04] 行内 MathML 保留于文本段落中', () => {
    const inlines = allInlines(mapValid('05-formulas-figures.xml'))
    const formulas = inlines.flatMap(r => r.formula ? [r.formula] : [])
    expect(formulas).toHaveLength(1)
    expect(formulas[0]!.mathml).toContain('<mml:mi>x</mml:mi>')
    expect(formulas[0]!.mathml).toContain('≤')
  })
  it('[M-7.2-01] 公式注保留在对应公式及其正文', () => {
    const formulas = collectKind<IRFormula>(mapValid('05-formulas-figures.xml'), 'formula')
    expect(formulas[0]!.notes?.[0]?.content).toEqual([{text:'公式注紧跟在公式之后。'}])
    expect(formulas[1]!.notes).toBeUndefined()
  })
  it('[M-7.3-01] [M-7.3-03] [M-7.3-04] [M-7.3-05] [M-7.3-06] [M-7.3-07] 公式图例保留每个符号、格式和对应解释', () => {
    const formula = collectKind<IRFormula>(mapValid('05-formulas-figures.xml'), 'formula')[0]!
    expect(formula.whereList?.map(x => [x.term, x.definition])).toEqual([
      [[{text:'E',marks:[{type:'italic'}]}],[{text:'能量，单位为焦耳（J）；'}]],
      [[{text:'m',marks:[{type:'italic'}]}],[{text:'质量，单位为千克（kg）；'}]],
      [[{text:'v',marks:[{type:'italic'}]}],[{text:'速度，单位为米每秒（m/s）。'}]],
    ])
  })
  it('[M-8.2-01] [M-8.2-05] [M-8.2-08] 图题和图形保留在原图所在章', () => {
    const doc = mapValid('05-formulas-figures.xml')
    const chapter = doc.body.find(c => c.title[0]?.text === '图')!
    const figures = collectKind<IRFigure>(chapter, 'figure')
    expect(figures[0]!.caption).toEqual([{text:'系统结构示意'}])
    expect(figures[0]!.src).toBe(png)
    expect(figures[0]!.resourceId).toBe('resource:fig_1')
  })
  it('[M-8.3-02] 行内图保留源资源和尺寸', () => {
    const images = allInlines(mapValid('05-formulas-figures.xml')).flatMap(r => r.image ? [r.image] : [])
    expect(images).toEqual([expect.objectContaining({src:png,resourceId:'resource:icon_1',size:'S'})])
  })
  it('[M-8.5-02] [M-8.5-03] [M-8.5-04] [M-8.5-05] [M-8.5-06] 图例标题、符号与说明保持关联顺序', () => {
    const figure = collectKind<IRFigure>(mapValid('05-formulas-figures.xml'), 'figure')[0]!
    expect(figure.legend?.title).toEqual([{text:'标引序号说明：'}])
    expect(figure.legend?.items.map(x => [x.term,x.definition])).toEqual([
      [[{text:'1'}],[{text:'驱动及控制模块；'}]],
      [[{text:'2'}],[{text:'传感模块。'}]],
    ])
  })
  it('[M-8.4-03] 图内示例属于原图且保留正文', () => {
    const original = readFileSync(resolve(sampleDir, 'valid', '05-formulas-figures.xml'), 'utf8')
    const xml = original.replace('</fig>', '<non-normative-example><label>示例：</label><p>图中示例正文。</p></non-normative-example></fig>')
    const figures = collectKind<IRFigure>(mapSource(xml), 'figure')
    expect(figures[0]!.examples?.[0]).toMatchObject({kind:'example',content:[{kind:'paragraph',content:[{text:'图中示例正文。'}]}]})
    expect(figures[1]!.examples ?? []).toEqual([])
  })
  it('[M-6.2.1-03] [M-7.1-03] [M-8.2-04] 表、公式与图的编号从各自对象重新派生', () => {
    const tableDoc = mapValid('04-tables.xml'), formulaDoc = mapValid('05-formulas-figures.xml')
    const table = collectKind<IRTable>(tableDoc, 'table')[0]!
    const formula = collectKind<IRFormula>(formulaDoc, 'formula')[0]!
    const figure = collectKind<IRFigure>(formulaDoc, 'figure')[0]!
    expect(resolveIr(tableDoc).labels[table.id]?.label).toBe('表1')
    expect(resolveIr(formulaDoc).labels[formula.id]?.label).toBe('(1)')
    expect(resolveIr(formulaDoc).labels[figure.id]?.label).toBe('图1')
  })
  it('[M-5.6-06] 表注、图注、公式注各自属于原容器', () => {
    const table = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')[0]!
    const media = mapValid('05-formulas-figures.xml')
    const figure = collectKind<IRFigure>(media, 'figure')[0]!
    const formula = collectKind<IRFormula>(media, 'formula')[0]!
    expect(JSON.stringify(table.notes)).toContain('表中数值为示例。')
    expect(JSON.stringify(figure.notes)).toContain('图注位于图形之后。')
    expect(formula.notes?.[0]?.content).toEqual([{text:'公式注紧跟在公式之后。'}])
    expect(table.notes).toHaveLength(1)
    expect(figure.notes).toHaveLength(1)
    expect(formula.notes).toHaveLength(1)
  })
  it('[M-6.2.3-05] [M-7.2-02] 表注与公式注标签按各自容器重新派生', () => {
    const tableDoc = mapValid('04-tables.xml'), mediaDoc = mapValid('05-formulas-figures.xml')
    const table = collectKind<IRTable>(tableDoc, 'table')[0]!
    const formula = collectKind<IRFormula>(mediaDoc, 'formula')[0]!
    expect(resolveIr(tableDoc).labels[table.notes[0]!.id]?.label).toBe('注：')
    expect(resolveIr(mediaDoc).labels[formula.notes![0]!.id]?.label).toBe('注：')
  })
  it('[M-7.3-02] 式中标题只接受可重新生成的固定文字', () => {
    const original = readFileSync(resolve(sampleDir, 'valid', '05-formulas-figures.xml'), 'utf8')
    expect(collectKind<IRFormula>(mapSource(original), 'formula')[0]!.whereList).toHaveLength(3)
    const altered = original.replace('<title>式中：</title>', '<title>其他说明：</title>')
    const tree = parseXml46687(altered).tree!
    const result = mapXml46687(tree, prepare(tree.root))
    expect(result.ir).toBeNull()
    expect(result.problems).toContainEqual(expect.objectContaining({code:'xml-unsupported',severity:'error',xml:expect.objectContaining({path:expect.stringContaining('/legend[1]/title[1]')})}))
  })
  it('[M-4.5.4-01] 整文索引映射到文末索引对象', () => {
    const index = mapValid('03-structure.xml').index!
    expect(index.title).toEqual([{text:'索引'}])
    expect(index.groups[0]!.entries.map(entry => entry.term)).toEqual([[{text:'无标题条'}],[{text:'变量'}]])
  })
  it('[M-7.4-02] 公式 MathML 的合法不透明 id 仅作为关联键并不污染公式内容', () => {
    const original = readFileSync(resolve(sampleDir, 'valid', '05-formulas-figures.xml'), 'utf8')
    const xml = original.replace('id="mml_m2"', 'id="数学甲"')
    const formula = collectKind<IRFormula>(mapSource(xml), 'formula')[0]!
    expect(formula.mathml).toContain('<mml:mfrac>')
    expect(formula.mathml).not.toContain('数学甲')
  })
  it('[M-8.2-11] 图注正文属于图且不出现在相邻图', () => {
    const figures = collectKind<IRFigure>(mapValid('05-formulas-figures.xml'), 'figure')
    expect(figures[0]!.notes[0]).toMatchObject({kind:'note',content:[{kind:'paragraph',content:[{text:'图注位于图形之后。'}]}]})
    expect(figures[1]!.notes).toEqual([])
  })
  it('[M-7.1-04] [M-7.4-01] 改变 MathML 前缀仍按 URI 保留行内和行间公式', () => {
    const source = readFileSync(resolve(sampleDir, 'valid', '05-formulas-figures.xml'), 'utf8')
    const xml = source.replace('xmlns:mml=', 'xmlns:q=').replaceAll('mml:', 'q:')
    const ir = mapSource(xml)
    const inline = allInlines(ir).flatMap(run => run.formula ? [run.formula] : [])
    const block = collectKind<IRFormula>(ir, 'formula')
    expect(inline[0]!.mathml).toContain('<mml:mi>x</mml:mi>')
    expect(block[0]!.mathml).toContain('<mml:mfrac>')
    expect(block[1]!.mathml).toContain('<mml:mi>b</mml:mi>')
  })
  it('[M-8.2-08] 一张图的附加资源缺失时整文映射失败且不返回部分结果', () => {
    const source = readFileSync(resolve(sampleDir, 'valid', '05-formulas-figures.xml'), 'utf8')
    const tree = parseXml46687(source).tree!
    const options = prepare(tree.root)
    expect(options.resources.delete('fig_2_b')).toBe(true)
    const result = mapXml46687(tree, options)
    expect(result.ir).toBeNull()
    expect(result.problems).toContainEqual(expect.objectContaining({code:'xml-resource-missing',severity:'error',xml:expect.objectContaining({path:expect.stringContaining('/graphic[2]')})}))
    expect(options.resources.has('fig_2')).toBe(true)
  })
  it('[M-6.1-03] XHTML 列声明的宽度、水平和垂直对齐逐列保留', () => {
    const table = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')[0]!
    expect(table.columns).toEqual([
      {width:{value:30,unit:'%'},textAlign:'left'},
      {width:{value:35,unit:'%'},textAlign:'center',verticalAlign:'middle'},
      {width:{value:35,unit:'%'},textAlign:'right'},
    ])
  })
  it('[M-6.2.3-08] 表脚注上标编号从对应定义和引用重新派生', () => {
    const doc = mapValid('04-tables.xml')
    const table = collectKind<IRTable>(doc, 'table')[0]!
    const labels = resolveIr(doc).labels
    expect(table.footnotes?.map(fn => labels[fn.id]?.label)).toEqual(['a','b'])
    expect(table.footnotes?.map(fn => labels[fn.id]?.xmlId)).toEqual(['table-fn_1.1','table-fn_1.2'])
  })
  it('[M-8.5-01] 图内图例与该图资源共同保留', () => {
    const figure = collectKind<IRFigure>(mapValid('05-formulas-figures.xml'), 'figure')[0]!
    expect(figure.resourceId).toBe('resource:fig_1')
    expect(figure.legend?.items.map(item => item.term)).toEqual([[{text:'1'}],[{text:'2'}]])
    expect(figure.legend?.items.map(item => item.definition)).toEqual([[{text:'驱动及控制模块；'}],[{text:'传感模块。'}]])
  })
  it('[M-8.6-01] 图题中的单位保留在原图上', () => {
    const figures = collectKind<IRFigure>(mapValid('05-formulas-figures.xml'), 'figure')
    expect(figures[0]!.caption).toEqual([{text:'系统结构示意'}])
    expect(figures[0]!.unit).toBe('单位为毫米')
    expect(figures[1]!.unit).toBeUndefined()
  })
  it('[M-6.2.1-04] [M-6.2.1-05] 表题和横纵方向分别属于各表', () => {
    const tables = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')
    expect(tables).toHaveLength(2)
    expect(tables.map(t => t.caption)).toEqual([[{text:'带表头、合并单元格、表注与表脚注的表'}], [{text:'横向表'}]])
    expect(tables.map(t => t.orientation)).toEqual(['portrait', 'landscape'])
  })
  it('[M-6.2.2-02] [M-6.2.4-01] 表头行、跨行跨列及单元格内容按网格保留', () => {
    const table = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')[0]!
    expect(table.headerRowCount).toBe(2)
    expect(table.rows[0]!.cells.map(c => [c.rowspan, c.colspan, c.header])).toEqual([[2, 1, true], [1, 2, true]])
    expect(table.rows[0]!.cells[0]!.content).toMatchObject([{kind:'paragraph', content:[{text:'项目'}]}])
    expect(JSON.stringify(table.rows)).toContain('多段单元格')
  })
  it('[M-6.2.3-07] [M-6.2.3-09] 表脚注正文与两个表格引用的目标保持一致', () => {
    const table = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')[0]!
    expect(table.footnotes?.map(f => f.content)).toEqual([[{text:'第一个表脚注。'}], [{text:'第二个表脚注。'}]])
    const rowText = JSON.stringify(table.rows)
    for (const footnote of table.footnotes!) expect(rowText).toContain(`"targetId":"${footnote.id}"`)
  })
  it('[M-6.2.5-02] [M-6.2.3-06] 表单位和注正文完整保留', () => {
    const table = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')[0]!
    expect(table.unit).toBe('单位为毫米')
    expect(JSON.stringify(table.notes)).toContain('表中数值为示例。')
  })
  it('[M-7.1-01] [M-7.4-01] 行间公式保留 MathML 与编号状态', () => {
    const formulas = collectKind<IRFormula>(mapValid('05-formulas-figures.xml'), 'formula')
    expect(formulas).toHaveLength(2)
    expect(formulas.map(f => f.numbered)).toEqual([true, false])
    expect(formulas[0]!.mathml).toContain('<mml:mfrac>')
    expect(formulas[1]!.mathml).toContain('<mml:mi>a</mml:mi>')
  })
  it('[M-8.2-06] [M-8.2-09] 图题与每个图形资源归属保留', () => {
    const ir = mapValid('05-formulas-figures.xml')
    const figures = collectKind<IRFigure>(ir, 'figure')
    expect(figures.map(f => f.caption)).toEqual([[{text:'系统结构示意'}], [{text:'含说明段落和多个图形的图'}], [{text:'分图一'}], [{text:'分图二'}]])
    expect(figures.map(f => f.resourceId)).toEqual(['resource:fig_1','resource:fig_2','resource:fig_3','resource:fig_4'])
    expect(figures[1]!.additionalGraphics?.[0]).toMatchObject({src: png, resourceId:'resource:fig_2_b', specificUse:'size:M'})
    const set = collectKind<IRFigureSet>(ir, 'figureSet')[0]!
    expect(set.figures.map(f => f.resourceId)).toEqual(['resource:fig_3','resource:fig_4'])
    expect(set.legend?.items[0]?.definition).toEqual([{text:'组合图的共用说明。'}])
  })
  it('[M-8.2-12] 图形后的说明段属于该图', () => {
    const figures = collectKind<IRFigure>(mapValid('05-formulas-figures.xml'), 'figure')
    expect(figures[1]!.descriptions?.[0]?.content).toEqual([{text:'图形与图题之间的说明段落。'}])
  })
  it('[M-5.8-01] 数组保留列组及单元格顺序', () => {
    const array = collectKind<IRArray>(mapValid('09-import-pending.xml'), 'array')[0]!
    expect(array.columnGroups).toEqual([{start:0, count:2}])
    expect(array.rows[0]!.cells.map(c => JSON.stringify(c.content))).toEqual([expect.stringContaining('甲'),expect.stringContaining('按列对齐的文本')])
  })
  it('[M-C.1-05] 公式组保留两个成员及各自编号状态', () => {
    const group = collectKind<IRFormulaGroup>(mapValid('09-import-pending.xml'), 'formulaGroup')[0]!
    expect(group.numbered).toBe(true)
    expect(group.formulas.map(f => f.numbered)).toEqual([false,false])
    expect(group.formulas[0]!.mathml).toContain('<mml:mi>a</mml:mi>')
    expect(group.formulas[1]!.mathml).toContain('<mml:mi>b</mml:mi>')
  })
})

// 明确的格式/语义错误期待；两个仅改变合法 ID 字面的样例另测，待用户裁定。
const expectedInvalid: Record<string, string> = {
  'admn-sts-value.xml': 'xml-content-model',
  'alternatives.xml': 'xml-content-model',
  'app-without-annex-type.xml': 'xml-annex-type-required',
  'bad-app-content-type.xml': 'xml-content-model',
  'bad-date-format.xml': 'xml-date-invalid',
  'bad-list-type.xml': 'xml-content-model',
  'bad-part-of-speech.xml': 'xml-content-model',
  'bad-processing-meta.xml': 'xml-content-model',
  'bad-ref-list-content-type.xml': 'xml-content-model',
  'bibl-ref-list-in-app.xml': 'xml-content-model',
  'block-level-fn.xml': 'xml-content-model',
  'caption-two-titles.xml': 'xml-content-model',
  'chapter-sec-type-intro.xml': 'xml-content-model',
  'custom-xref-no-type.xml': 'xml-xref-custom-type-required',
  'custom-xref-to-section.xml': 'xml-reference-kind',
  'custom-xref-wrong-target.xml': 'xml-reference-kind',
  'dangling-entailed-term.xml': 'xml-reference-dangling',
  'dangling-rid.xml': 'xml-reference-dangling',
  'definition-target.xml': 'xml-unsupported',
  'doctype-internal-subset.xml': 'xml-forbidden-doctype',
  'dup-id.xml': 'xml-id-duplicate',
  'dup-release-date.xml': 'xml-date-invalid',
  'empty-table-wrap-foot.xml': 'xml-content-model',
  'encoding-declared-after-400-bytes.xml': 'xml-encoding',
  'ext-id.xml': 'xml-paragraph-id-forbidden',
  'ext-link-newline-in-url.xml': 'xml-unsupported',
  'ext-link-tab-in-scheme.xml': 'xml-unsupported',
  'ext-link-without-type.xml': 'xml-ext-link-type-invalid',
  'fig-footnote-in-caption.xml': 'xml-unsupported',
  'fig-footnote.xml': 'xml-unsupported',
  'fn-xref-to-table-footnote.xml': 'xml-reference-kind',
  'front-scope-sec.xml': 'xml-content-model',
  'gbt37967-root.xml': 'legacy-format',
  'impl-date-in-release-date.xml': 'xml-date-invalid',
  'invalid-calendar-date.xml': 'xml-date-invalid',
  'issue-agencies.xml': 'xml-content-model',
  'js-ext-link.xml': 'xml-unsupported',
  'mathml-display-inline-in-disp-formula.xml': 'xml-math-display-invalid',
  'mathml-href-control-char.xml': 'xml-unsupported',
  'mathml-id-missing.xml': 'xml-math-id-required',
  'mathml-onclick.xml': 'xml-unsupported',
  'mathml-unprefixed.xml': 'xml-content-model',
  'missing-app-id.xml': 'xml-app-id-required',
  'missing-ref-id.xml': 'xml-bibl-ref-id-required',
  'missing-term-entry-id.xml': 'xml-term-id-required',
  'mixed-cell-content.xml': 'xml-content-model',
  'named-content-without-type.xml': 'xml-content-model',
  'nested-table.xml': 'xml-content-model',
  'nested-term-entry.xml': 'xml-content-model',
  'non-utf8-encoding.xml': 'xml-encoding',
  'not-wellformed.xml': 'xml-syntax',
  'numbered-paragraph-with-title.xml': 'xml-content-model',
  'p-number-id.xml': 'xml-paragraph-id-forbidden',
  'p-with-id.xml': 'xml-paragraph-id-forbidden',
  'sec-block-after-subsec.xml': 'xml-content-model',
  'sec-without-label.xml': 'xml-section-label-required',
  'sep-legacy-namespace.xml': 'legacy-format',
  'std-in-tbx-source.xml': 'xml-unsupported',
  'std-meta-wrong-order.xml': 'xml-meta-order-invalid',
  'table-fn-xref-to-body-fn.xml': 'xml-reference-kind',
  'table-wrap-without-label.xml': 'xml-table-label-required',
  'tbx-definition-alias.xml': 'xml-content-model',
  'tbx-grammatical-number-alias.xml': 'xml-content-model',
  'tbx-langset-no-lang.xml': 'xml-content-model',
  'tbx-normative-authorization-alias.xml': 'xml-content-model',
  'tbx-term-entry-alias.xml': 'xml-content-model',
  'term-entry-without-definition.xml': 'xml-term-definition-count',
  'term-sec-outside-terms.xml': 'xml-content-model',
  'term-two-definitions.xml': 'xml-term-definition-count',
  'tex-math.xml': 'xml-content-model',
  'tfoot.xml': 'xml-content-model',
  'title-wrap-no-lang.xml': 'xml-content-model',
  'unknown-element.xml': 'xml-content-model',
  'unordered-list-label.xml': 'xml-content-model',
  'wrong-root.xml': 'xml-content-model',
  'wrong-xref-type.xml': 'xml-reference-kind',
}

describe('WP8.3 负例的具体诊断与位置', () => {
  const pendingOpaque = ['formula-id.xml', 'uuid-id.xml']
  const files = readdirSync(resolve(sampleDir, 'invalid')).filter(n => n.endsWith('.xml')).sort()
  it('清单包含每个样例与待裁决的不透明 ID 样例', () => {
    expect(files).toEqual([...Object.keys(expectedInvalid), ...pendingOpaque].sort())
  })
  for (const [file, code] of Object.entries(expectedInvalid)) {
    it(`拒绝 ${file} 并给出 ${code} 和 XML 位置`, () => {
      const parsed = parseXml46687(readFileSync(resolve(sampleDir, 'invalid', file), 'utf8'))
      const problems = parsed.tree
        ? [...detectLegacyXml46687(parsed.tree), ...validateXml46687(parsed.tree).problems]
        : parsed.problems
      const expected = problems.find(p => p.code === code && p.severity === 'error')
      expect(expected, `${file}: ${JSON.stringify(problems)}`).toBeDefined()
      expect(expected?.message).toMatch(/[\u4e00-\u9fff]/)
      expect(expected?.xml).toEqual(expect.objectContaining({ line: expect.any(Number), column: expect.any(Number), path: expect.any(String) }))
      expect(expected!.xml!.line).toBeGreaterThan(0)
      expect(expected!.xml!.column).toBeGreaterThan(0)
      if (parsed.tree) expect(mapXml46687(parsed.tree, prepare(parsed.tree.root)).ir).toBeNull()
    })
  }
  for (const file of pendingOpaque) it(`合法不透明 ID 当前可接受，等待裁定：${file}`, () => {
    const parsed = parseXml46687(readFileSync(resolve(sampleDir, 'invalid', file), 'utf8'))
    expect(parsed.problems).toEqual([])
    const tree = parsed.tree!
    expect(detectLegacyXml46687(tree)).toEqual([])
    expect(validateXml46687(tree).problems.filter(p => p.severity === 'error')).toEqual([])
    const result = mapXml46687(tree, prepare(tree.root))
    expect(result.problems.filter(p => p.severity === 'error')).toEqual([])
    expect(result.ir).not.toBeNull()
  })
})
