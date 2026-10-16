import { describe, expect, it } from 'vitest'
import { createPageFlow } from './pageFlow'
import { createRenderContext, emitParagraph } from './context'
import { ABSTRACT_NUM_ID } from '../numbering'

const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`

describe('正文页余量估算', () => {
  it('只在语义正文节开始后启用，不将封面计入正文页', () => {
    const flow = createPageFlow()
    flow.recordParagraph('SesCoverName', run('封面标题'), false)
    expect(flow.availableMm).toBeUndefined()
    flow.startSection()
    expect(flow.availableMm).toBe(238)
  })

  it('读取字号、缩进、显式换行和相邻段落的间距，而不是按段落个数计算', () => {
    const single = createPageFlow(); single.startSection()
    const broken = createPageFlow(); broken.startSection()
    single.recordParagraph('SesPara', run('甲乙丙丁'), false)
    broken.recordParagraph('SesPara', run('甲') + '<w:r><w:br/></w:r>' + run('乙丙丁'), false)
    expect(single.availableMm! - broken.availableMm!).toBeGreaterThan(5)
    const combined = createPageFlow(); combined.startSection()
    combined.recordParagraph('SesBodyTitle', run('标题'), false)
    combined.recordParagraph('SesChapter', run('章'), true)
    const title = createPageFlow(); title.startSection(); title.recordParagraph('SesBodyTitle', run('标题'), false)
    const chapter = createPageFlow(); chapter.startSection(); chapter.recordParagraph('SesChapter', run('章'), true)
    expect(238 - combined.availableMm!).toBeLessThan((238 - title.availableMm!) + (238 - chapter.availableMm!))
    broken.recordParagraph('SesPara', run('长段落'.repeat(100)), false)
    expect(broken.availableMm!).toBeLessThan(single.availableMm! - 35)
  })

  it('表题、单元格及表注只按整段高度入账，不重复计入内部段落', () => {
    const flow = createPageFlow(); flow.startSection()
    flow.recordParagraph('SesPara', run('正文'), false)
    const available = flow.availableMm!
    flow.suspend(() => {
      for (let i = 0; i < 70; i++) flow.recordParagraph('SesTableText', run('记录'), false)
    })
    expect(flow.availableMm).toBe(available)
    flow.placeTable([100, 80], false)
    expect(flow.availableMm).toBe(158)
    // 相邻顶层表之间没有分隔空段（表题段把两表隔开，其高度已计入下一张表的段高）：
    // 查询下一张表的预算不再额外扣除一个空行。
    expect(flow.beforeTable().firstPageHeightMm).toBe(158)
    expect(flow.availableMm).toBe(158)
  })

  it('连续横排块共享页余量，切回竖排后从新节开始', () => {
    const flow = createPageFlow(); flow.startSection()
    flow.withElement(true, () => flow.placeTable([50], false))
    expect(flow.availableMm).toBe(101)
    flow.withElement(true, () => flow.placeTable([30], false))
    expect(flow.availableMm).toBe(71)
    flow.recordParagraph('SesChapter', run('恢复竖排'), true)
    expect(flow.availableMm!).toBeGreaterThan(200)
  })

  it('条文脚注占用页底空间，换节后不带到下一节', () => {
    const plain = createPageFlow(); plain.startSection(); plain.recordParagraph('SesPara', run('正文'), false)
    const noted = createPageFlow(); noted.setFootnoteHeights(new Map([[1, 12]])); noted.startSection()
    noted.recordParagraph('SesPara', run('正文') + '<w:r><w:footnoteReference w:id="1"/></w:r>', false)
    expect(plain.availableMm! - noted.availableMm!).toBe(18)
    noted.startSection()
    expect(noted.availableMm).toBe(238)
  })

  it('公式高度未知时不猜页位置；只有显式新页或新节能恢复估算', () => {
    const flow = createPageFlow(); flow.startSection()
    flow.recordParagraph('SesFormula', '<m:oMath/>', false)
    flow.recordParagraph('SesPara', run('长段落'.repeat(1000)), false)
    expect(flow.availableMm).toBeUndefined()
    expect(flow.estimateUnavailable).toBe(true)
    flow.placeTable([20], false)
    expect(flow.availableMm).toBeUndefined()
    flow.placeTable([60], true)
    expect(flow.availableMm).toBe(178)
  })

  it.each(['early', 'late'])('普通长正文的%s脚注引用跨页后，页位置未知而非整段移页', position => {
    const flow = createPageFlow(); flow.startSection(); flow.setFootnoteHeights(new Map([[1, 12]]))
    flow.placeTable([200], false)
    const content = Array.from({ length: 12 }, (_, i) =>
      run(`正文第${i + 1}行`) + (i === (position === 'early' ? 0 : 10) ? '<w:r><w:footnoteReference w:id="1"/></w:r>' : '')
    ).join('<w:r><w:br/></w:r>')
    flow.recordParagraph('SesPara', content, false)
    expect(flow.availableMm).toBeUndefined()
    expect(flow.estimateUnavailable).toBe(true)
    expect(flow.beforeTable().positionUnknown).toBe(true)
    flow.recordParagraph('SesPara', run('后续普通文字'), false)
    expect(flow.availableMm).toBeUndefined()
    flow.placeTable([80], true)
    expect(flow.availableMm).toBe(158)
    expect(flow.estimateUnavailable).toBe(false)
  })
  it('正文文字能放下但脚注预留会使其跨页时，不能声称引用仍在当前页', () => {
    const flow = createPageFlow(); flow.startSection(); flow.setFootnoteHeights(new Map([[1, 12]]))
    flow.placeTable([210], false)
    const content = Array.from({ length: 4 }, (_, i) => run(`正文第${i+1}行`)).join('<w:r><w:br/></w:r>')
    flow.recordParagraph('SesPara', content + '<w:r><w:footnoteReference w:id="1"/></w:r>', false)
    expect(flow.availableMm).toBeUndefined()
    expect(flow.beforeTable().positionUnknown).toBe(true)
  })
  it('DrawingML的真实高度参与后续余量，不将图片当一行空文字', () => {
    const flow = createPageFlow(); flow.startSection()
    flow.withElement(false, () => flow.recordParagraph('SesFigure', '<w:drawing><wp:extent cx="3600000" cy="1440000"/></w:drawing>', false))
    expect(flow.availableMm!).toBeLessThanOrEqual(198)
    expect(flow.availableMm!).toBeGreaterThan(190)
  })
})


describe('复审：同页链与有效列项缩进', () => {
  const image = '<w:drawing><wp:extent cx="3600000" cy="1440000"/></w:drawing>'
  it('临近页底的图片与图题整体移到新页，图高不会被遗忘', () => {
    const near = createPageFlow(); near.startSection(); near.placeTable([188], false)
    near.recordParagraph('SesFigure', image, false)
    near.recordParagraph('SesFigCap', run('图题'), true)
    const fresh = createPageFlow(); fresh.startSection()
    fresh.recordParagraph('SesFigure', image, false)
    fresh.recordParagraph('SesFigCap', run('图题'), true)
    expect(near.availableMm).toBeCloseTo(fresh.availableMm!, 6)
  })
  it('连续keepNext标题与后段整体移页，而不是只移动末段', () => {
    const near = createPageFlow(); near.startSection(); near.placeTable([216], false)
    const fresh = createPageFlow(); fresh.startSection()
    for (const flow of [near, fresh]) {
      flow.recordParagraph('SesChapter', run('章标题'), true)
      flow.recordParagraph('SesClause1', run('条标题'), true)
      flow.recordParagraph('SesPara', run('后续正文'), false)
    }
    expect(near.availableMm).toBeCloseTo(fresh.availableMm!, 6)
  })
  it.each(['plain', 'early-footnote', 'late-footnote'])('标题链末的%s长正文可以跨页，不能将整链移页估算', kind => {
    const flow = createPageFlow(); flow.startSection(); flow.setFootnoteHeights(new Map([[1, 12]]))
    flow.placeTable([180], false)
    flow.recordParagraph('SesChapter', run('章标题'), true)
    if (kind === 'early-footnote') flow.recordParagraph('SesClause1', run('条标题'), true)
    const content = Array.from({ length: 12 }, (_, i) => run(`链末正文第${i + 1}行`) +
      (i === (kind === 'early-footnote' ? 0 : kind === 'late-footnote' ? 10 : -1)
        ? '<w:r><w:footnoteReference w:id="1"/></w:r>' : '')).join('<w:r><w:br/></w:r>')
    flow.recordParagraph('SesPara', content, false)
    expect(flow.availableMm).toBeUndefined()
    expect(flow.beforeTable().positionUnknown).toBe(true)
    flow.recordParagraph('SesPara', run('继续正文'), false)
    expect(flow.availableMm).toBeUndefined()
    flow.placeTable([80], true)
    expect(flow.availableMm).toBe(158)
  })
  it('标题后正文文字能放下但脚注预留跨过页底时，链末落页仍未知', () => {
    const flow = createPageFlow(); flow.startSection(); flow.setFootnoteHeights(new Map([[1, 12]]))
    flow.placeTable([185], false)
    flow.recordParagraph('SesChapter', run('章标题'), true)
    const content = Array.from({ length: 4 }, (_, i) => run(`链末正文第${i + 1}行`)).join('<w:r><w:br/></w:r>')
    flow.recordParagraph('SesPara', content + '<w:r><w:footnoteReference w:id="1"/></w:r>', false)
    expect(flow.availableMm).toBeUndefined()
    expect(flow.estimateUnavailable).toBe(true)
  })
  it('标题后多行正文在当前页可完整放下时，保持已知余量', () => {
    const flow = createPageFlow(); flow.startSection(); flow.placeTable([100], false)
    flow.recordParagraph('SesChapter', run('章标题'), true)
    flow.recordParagraph('SesPara', run('第一行') + '<w:r><w:br/></w:r>' + run('第二行'), false)
    expect(flow.availableMm).toBeDefined()
    expect(flow.beforeTable().positionUnknown).toBe(false)
  })
  it.each(['first', 'middle', 'wrapping-footnote'])('溢出链中%s位置的可拆分长标题使最终落页未知', position => {
    const flow = createPageFlow(); flow.startSection(); flow.setFootnoteHeights(new Map([[1, 12]]))
    flow.placeTable([180], false)
    if (position === 'middle') flow.recordParagraph('SesChapter', run('短章标题'), true)
    const long = position === 'wrapping-footnote'
      ? run('自然回行长标题'.repeat(70)) + '<w:r><w:footnoteReference w:id="1"/></w:r>'
      : Array.from({ length: 12 }, (_, i) => run(`长标题第${i + 1}行`)).join('<w:r><w:br/></w:r>')
    flow.recordParagraph(position === 'middle' ? 'SesClause1' : 'SesChapter', long, true)
    flow.recordParagraph('SesPara', run('单行后续正文'), false)
    expect(flow.availableMm).toBeUndefined()
    expect(flow.beforeTable().positionUnknown).toBe(true)
    flow.placeTable([80], true)
    expect(flow.availableMm).toBe(158)
  })
  it('前置多行标题和单行正文完整放得下时仍保持估算', () => {
    const flow = createPageFlow(); flow.startSection()
    flow.recordParagraph('SesChapter', run('第一行') + '<w:r><w:br/></w:r>' + run('第二行'), true)
    flow.recordParagraph('SesPara', run('单行正文'), false)
    expect(flow.availableMm).toBeDefined()
    expect(flow.beforeTable().positionUnknown).toBe(false)
  })
  it('直接接表的待定长标题已超过旧页余量时，首段按整链落新页保守估算，不再要求位置未知或强制分页', () => {
    const flow = createPageFlow(); flow.startSection(); flow.placeTable([180], false)
    flow.recordParagraph('SesChapter', Array.from({ length: 12 }, (_, i) => run(`长标题第${i + 1}行`)).join('<w:r><w:br/></w:r>'), true)
    const budget = flow.beforeTable()
    expect(budget.firstPageHeightMm).toBeUndefined()
    expect(budget.firstPageReservedMm).toBeGreaterThan(0)
    expect(budget.positionUnknown).toBe(false)
  })
  it('placeNaturalTable 之后页位置保持未知，直到新节或横竖切换才恢复', () => {
    const flow = createPageFlow(); flow.startSection()
    flow.recordParagraph('SesChapter', run('章标题'), true)
    flow.placeNaturalTable()
    expect(flow.availableMm).toBeUndefined()
    flow.recordParagraph('SesPara', run('自然分页表后的正文'), false)
    expect(flow.beforeTable().positionUnknown).toBe(true)
    flow.withElement(true, () => expect(flow.beforeTable().positionUnknown).toBe(false))
    flow.startSection()
    expect(flow.beforeTable().positionUnknown).toBe(false)
    expect(flow.availableMm).toBe(238)
  })
  it('位置未知的页流在紧邻下一张表前不会因表间空行跨页而被误当成新页起点', () => {
    const flow = createPageFlow(); flow.startSection()
    flow.placeTable([236], false) // 旧页几乎写满：5.5 mm 的表间空行本会跨页并 nextPage()
    flow.placeNaturalTable()
    expect(flow.beforeTable().positionUnknown).toBe(true)
    expect(flow.estimateUnavailable).toBe(true)
  })
  it('页流未启用（封面、目次）时不视为位置未知', () => {
    const flow = createPageFlow()
    expect(flow.beforeTable().positionUnknown).toBe(false)
  })
  it('中途读取余量不截断同页链，移页后脚注只预留一次', () => {
    const near = createPageFlow(); near.setFootnoteHeights(new Map([[1, 12]])); near.startSection(); near.placeTable([178], false)
    near.recordParagraph('SesFigure', image, false)
    expect(near.availableMm).toBeDefined()
    expect(near.availableMm).toBe(near.availableMm)
    near.recordParagraph('SesFigCap', run('图题') + '<w:r><w:footnoteReference w:id="1"/></w:r>', true)
    const fresh = createPageFlow(); fresh.setFootnoteHeights(new Map([[1, 12]])); fresh.startSection()
    fresh.recordParagraph('SesFigure', image, false)
    fresh.recordParagraph('SesFigCap', run('图题') + '<w:r><w:footnoteReference w:id="1"/></w:r>', true)
    expect(near.availableMm).toBeCloseTo(fresh.availableMm!, 6)
  })
  it('动态编号二级的回行与属主间隔号二级使用相同宽度', () => {
    const a=createRenderContext({}); const b=createRenderContext({})
    for(const ctx of [a,b]) ctx.pageFlow.startSection()
    emitParagraph(a,'SesListItem',{numPr:{numId:a.numbering.allocListInstance(ABSTRACT_NUM_ID.listAlpha),ilvl:1},runsXml:run('甲'.repeat(120)),numbered:{nodeId:'a',kind:'listItem'}})
    emitParagraph(b,'SesListDot',{runsXml:run('甲'.repeat(120)),numbered:{nodeId:'b',kind:'listItem'}})
    expect(a.pageFlow.availableMm).toBe(b.pageFlow.availableMm)
  })
  it.each([
    ['编号定义一级', 'SesListItem', 840, false],
    ['段落覆盖二级', 'SesListItem', 1260, true],
    ['属主破折号一级', 'SesListDash', 840, false],
    ['属主间隔号二级', 'SesListDot', 1260, false],
  ])('%s的回行使用全部有效左缩进', (_, style, left, override) => {
    const ctx = createRenderContext({}); ctx.pageFlow.startSection()
    const numId = ctx.numbering.allocListInstance(ABSTRACT_NUM_ID.listAlpha)
    emitParagraph(ctx, style as string, {
      runsXml: run('甲'.repeat(120)), numbered: {nodeId: 'list-item', kind: 'listItem'},
      ...(style === 'SesListItem' ? {numPr: {numId, ilvl: 0}} : {}),
      ...(override ? {indent: {left: left as number, hanging: 420}} : {}),
    })
    expect(238 - ctx.pageFlow.availableMm!).toBeGreaterThanOrEqual(4 * 15.6 * 25.4 / 72 - 0.001)
  })
})
