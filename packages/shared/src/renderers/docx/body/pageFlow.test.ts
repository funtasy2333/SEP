import { describe, expect, it } from 'vitest'
import { createPageFlow } from './pageFlow'

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
    flow.beforeTable()
    expect(flow.availableMm!).toBeLessThan(153)
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

  it('DrawingML的真实高度参与后续余量，不将图片当一行空文字', () => {
    const flow = createPageFlow(); flow.startSection()
    flow.withElement(false, () => flow.recordParagraph('SesFigure', '<w:drawing><wp:extent cx="3600000" cy="1440000"/></w:drawing>', false))
    expect(flow.availableMm!).toBeLessThanOrEqual(198)
    expect(flow.availableMm!).toBeGreaterThan(190)
  })
})
