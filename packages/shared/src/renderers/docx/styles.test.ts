/**
 * styles.ts 单元测试（docs/wp7-docx-delivery.md §9 WP7.2「测试」styles 一项）。
 *
 * §3.2 每个样式都在（ID、中文名、basedOn、w:next）；属主样式的 numPr 与 §3.2「编号」列一致；
 * 标「缩进见 Ax」的样式不含 ind；SesNormal 为默认段落样式。
 *
 * 校验直接解析 buildStylesXml() 的输出（不读 styles.ts 内部的 STYLE_SPECS），避免自证。
 */

import { describe, expect, it } from 'vitest'
import { buildStylesXml } from './styles'
import { findChild } from './__tests__/helpers/xmlTree'
import { parseXml, type XmlElement } from './__tests__/helpers/xmlTree'

function styleMap(): Map<string, XmlElement> {
  const root = parseXml(buildStylesXml())
  const map = new Map<string, XmlElement>()
  for (const child of root.children) {
    if (child.kind === 'element' && child.name === 'w:style') {
      map.set(child.attrs['w:styleId'], child)
    }
  }
  return map
}

function nameOf(el: XmlElement): string | undefined {
  return findChild(el, 'w:name')?.attrs['w:val']
}
function basedOnOf(el: XmlElement): string | undefined {
  return findChild(el, 'w:basedOn')?.attrs['w:val']
}
function nextOf(el: XmlElement): string | undefined {
  return findChild(el, 'w:next')?.attrs['w:val']
}
function numPrOf(el: XmlElement): { numId: string; ilvl: string } | undefined {
  const pPr = findChild(el, 'w:pPr')
  const numPr = pPr && findChild(pPr, 'w:numPr')
  if (!numPr) return undefined
  return { numId: findChild(numPr, 'w:numId')!.attrs['w:val'], ilvl: findChild(numPr, 'w:ilvl')!.attrs['w:val'] }
}
function indOf(el: XmlElement): XmlElement | undefined {
  const pPr = findChild(el, 'w:pPr')
  return pPr && findChild(pPr, 'w:ind')
}

// §3.2 全部样式的 (id -> 中文名)，不含留给 WP7.5 的 SesCover*（SesCoverStdNo 除外）
const EXPECTED_NAMES: Record<string, string> = {
  SesNormal: 'SES_正文基础',
  SesPara: 'SES_段',
  SesTocTitle: 'SES_目次标题',
  SesFrontTitle: 'SES_前言引言标题',
  SesBodyTitle: 'SES_正文首页名称',
  SesChapter: 'SES_章标题',
  SesTermNum: 'SES_术语条目编号',
  SesTermHead: 'SES_术语',
  SesAppendix: 'SES_附录标识',
  SesListDash: 'SES_破折号列项',
  SesListDot: 'SES_间隔号列项',
  SesListItem: 'SES_编号列项',
  SesListCont: 'SES_列项续段',
  SesListCont2: 'SES_列项续段2',
  SesNote: 'SES_注',
  SesNoteN: 'SES_注X',
  SesNoteCont: 'SES_注续段',
  SesNoteNCont: 'SES_注X续段',
  SesExLabel: 'SES_示例标识',
  SesExLabelN: 'SES_示例X标识',
  SesExText: 'SES_示例内容',
  SesFigure: 'SES_图',
  SesFigCap: 'SES_图题',
  SesAppFigCap: 'SES_附录图题',
  SesTblCap: 'SES_表题',
  SesAppTblCap: 'SES_附录表题',
  SesTableText: 'SES_表格文字',
  SesTableCenter: 'SES_表格居中',
  SesTableNote: 'SES_表注',
  SesFormula: 'SES_公式',
  SesWhereLabel: 'SES_式中',
  SesWhereItem: 'SES_式中条目',
  SesBibTitle: 'SES_参考文献标题',
  SesBibEntry: 'SES_参考文献条目',
  SesEndMark: 'SES_终结线',
  SesHeader: 'SES_书眉',
  SesFooter: 'SES_页码',
  TOC1: 'toc 1',
  TOC2: 'toc 2',
  TOC3: 'toc 3',
  SesCoverStdNo: 'SES_封面文件编号',
}
for (let level = 1; level <= 5; level++) {
  EXPECTED_NAMES[`SesClause${level}`] = `SES_${level}级条标题`
  EXPECTED_NAMES[`SesNoTitle${level}`] = `SES_${level}级无标题条`
  EXPECTED_NAMES[`SesAppClause${level}`] = `SES_附录${level}级条标题`
  EXPECTED_NAMES[`SesAppNoTitle${level}`] = `SES_附录${level}级无标题条`
}

describe('styles.ts：§3.2 全部样式都在，ID/中文名/basedOn 正确', () => {
  const styles = styleMap()

  it('样式数量与 ID 集合与 §3.2（不含 WP7.5 的 SesCover*）完全一致', () => {
    expect(new Set(styles.keys())).toEqual(new Set(Object.keys(EXPECTED_NAMES)))
  })

  it.each(Object.entries(EXPECTED_NAMES))('%s 的中文名为 %s', (id, name) => {
    expect(nameOf(styles.get(id)!)).toBe(name)
  })

  it('除 SesNormal 外全部 basedOn SesNormal', () => {
    for (const [id, el] of styles) {
      if (id === 'SesNormal') continue
      expect(basedOnOf(el)).toBe('SesNormal')
    }
  })

  it('SesNormal 不写 basedOn，是默认段落样式（w:default="1"）', () => {
    const normal = styles.get('SesNormal')!
    expect(basedOnOf(normal)).toBeUndefined()
    expect(normal.attrs['w:default']).toBe('1')
    expect(normal.attrs['w:customStyle']).toBe('1')
  })

  it('全部样式都是 w:customStyle="1" 的段落样式', () => {
    for (const el of styles.values()) {
      expect(el.attrs['w:type']).toBe('paragraph')
      expect(el.attrs['w:customStyle']).toBe('1')
      expect(findChild(el, 'w:qFormat')).toBeDefined()
    }
  })
})

describe('styles.ts：w:next（§3.1 标题类样式）', () => {
  const styles = styleMap()
  const withNext = new Set([
    'SesChapter', 'SesClause1', 'SesClause2', 'SesClause3', 'SesClause4', 'SesClause5',
    'SesAppendix', 'SesAppClause1', 'SesAppClause2', 'SesAppClause3', 'SesAppClause4', 'SesAppClause5',
    'SesFrontTitle', 'SesBibTitle',
  ])

  it.each([...styles.keys()])('%s 的 w:next 是否为 SesPara 与 §3.1 标题类样式清单一致', (id) => {
    if (withNext.has(id)) {
      expect(nextOf(styles.get(id)!)).toBe('SesPara')
    } else {
      expect(nextOf(styles.get(id)!)).toBeUndefined()
    }
  })
})

describe('styles.ts：属主样式的 numPr 与 §3.2「编号」列一致', () => {
  const styles = styleMap()
  const owners: Record<string, { numId: string; ilvl: string }> = {
    SesChapter: { numId: '1', ilvl: '0' },
    SesClause1: { numId: '1', ilvl: '1' },
    SesClause2: { numId: '1', ilvl: '2' },
    SesClause3: { numId: '1', ilvl: '3' },
    SesClause4: { numId: '1', ilvl: '4' },
    SesClause5: { numId: '1', ilvl: '5' },
    SesAppendix: { numId: '2', ilvl: '0' },
    SesAppClause1: { numId: '2', ilvl: '1' },
    SesAppClause2: { numId: '2', ilvl: '2' },
    SesAppClause3: { numId: '2', ilvl: '3' },
    SesAppClause4: { numId: '2', ilvl: '4' },
    SesAppClause5: { numId: '2', ilvl: '5' },
    SesFigCap: { numId: '3', ilvl: '0' },
    SesTblCap: { numId: '4', ilvl: '0' },
    SesNote: { numId: '7', ilvl: '0' },
    SesExLabel: { numId: '9', ilvl: '0' },
    SesListDash: { numId: '11', ilvl: '0' },
    SesListDot: { numId: '11', ilvl: '1' },
    SesBibEntry: { numId: '16', ilvl: '0' },
  }

  it.each(Object.entries(owners))('%s 的样式级 numPr 为 numId=%s', (id, expected) => {
    expect(numPrOf(styles.get(id)!)).toEqual(expected)
  })

  it('段落级样式（无标题条、术语、列项实例、注 X、示例 X、附录图表题、表注……）不带样式级 numPr', () => {
    const paragraphLevelOwners = [
      'SesNoTitle1', 'SesNoTitle5', 'SesAppNoTitle1', 'SesAppNoTitle5',
      'SesTermNum', 'SesListItem', 'SesNoteN', 'SesExLabelN',
      'SesAppFigCap', 'SesAppTblCap', 'SesTableNote',
    ]
    for (const id of paragraphLevelOwners) {
      expect(numPrOf(styles.get(id)!)).toBeUndefined()
    }
  })

  it('每个 (numId, ilvl) 组合只被一个样式的 numPr 引用（§4.1 约束 1，属主样式各占一个级别）', () => {
    const seen = new Map<string, string>()
    for (const [id, el] of styles) {
      const np = numPrOf(el)
      if (!np) continue
      const key = `${np.numId}:${np.ilvl}`
      expect(seen.has(key), `(numId=${np.numId}, ilvl=${np.ilvl}) 被 "${seen.get(key)}" 与 "${id}" 两个样式同时引用`).toBe(false)
      seen.set(key, id)
    }
  })
})

describe('styles.ts：标「缩进见 Ax」的样式不写 ind（§3.1）', () => {
  const styles = styleMap()
  const noIndStyles = [
    'SesChapter', 'SesClause1', 'SesClause3', 'SesClause5',
    'SesNoTitle1', 'SesNoTitle3', 'SesNoTitle5',
    'SesTermNum',
    'SesAppendix', 'SesAppClause1', 'SesAppClause3', 'SesAppClause5',
    'SesAppNoTitle1', 'SesAppNoTitle3', 'SesAppNoTitle5',
    'SesListDash', 'SesListDot',
    'SesNote', 'SesNoteN',
    'SesExLabel', 'SesExLabelN',
    'SesFigCap', 'SesAppFigCap', 'SesTblCap', 'SesAppTblCap',
    'SesTableNote',
    'SesBibEntry',
  ]

  it.each(noIndStyles)('%s 不含 w:ind（缩进由编号级别给出）', (id) => {
    expect(indOf(styles.get(id)!)).toBeUndefined()
  })
})

describe('styles.ts：显式缩进值（不依赖编号级别的样式）', () => {
  const styles = styleMap()

  it('SesPara：首行缩进 2 字 = 420', () => {
    expect(indOf(styles.get('SesPara')!)?.attrs).toEqual({ 'w:left': '0', 'w:firstLine': '420' })
  })

  it('SesListCont / SesListCont2：左 840/1260，首行 0', () => {
    expect(indOf(styles.get('SesListCont')!)?.attrs).toEqual({ 'w:left': '840', 'w:firstLine': '0' })
    expect(indOf(styles.get('SesListCont2')!)?.attrs).toEqual({ 'w:left': '1260', 'w:firstLine': '0' })
  })

  it('SesTableText：首行 1 字 = 210，左 0', () => {
    expect(indOf(styles.get('SesTableText')!)?.attrs).toEqual({ 'w:left': '0', 'w:firstLine': '210' })
  })

  it('SesEndMark：左右缩进各 3508', () => {
    expect(indOf(styles.get('SesEndMark')!)?.attrs).toEqual({ 'w:left': '3508', 'w:right': '3508' })
  })

  it('TOC2/TOC3：左缩进 210/420', () => {
    expect(indOf(styles.get('TOC2')!)?.attrs).toEqual({ 'w:left': '210', 'w:firstLine': '0' })
    expect(indOf(styles.get('TOC3')!)?.attrs).toEqual({ 'w:left': '420', 'w:firstLine': '0' })
  })

  it('TOC1 不写 ind（§3.2 未给出缩进值）', () => {
    expect(indOf(styles.get('TOC1')!)).toBeUndefined()
  })
})

describe('styles.ts：字体字号（黑体/宋体、五号/小五等）', () => {
  const styles = styleMap()
  function rFontsAscii(id: string): string | undefined {
    const rPr = findChild(styles.get(id)!, 'w:rPr')
    return rPr && findChild(rPr, 'w:rFonts')?.attrs['w:ascii']
  }
  function szVal(id: string): string | undefined {
    const rPr = findChild(styles.get(id)!, 'w:rPr')
    return rPr && findChild(rPr, 'w:sz')?.attrs['w:val']
  }

  it('SesNormal：Times New Roman/宋体，五号 21', () => {
    expect(rFontsAscii('SesNormal')).toBe('Times New Roman')
    expect(szVal('SesNormal')).toBe('21')
  })

  it('黑体类样式（章、条、附录、图表题……）rFonts 全部为黑体', () => {
    for (const id of ['SesChapter', 'SesClause1', 'SesAppendix', 'SesFigCap', 'SesTblCap', 'SesBibTitle', 'SesHeader', 'SesCoverStdNo']) {
      expect(rFontsAscii(id)).toBe('黑体')
    }
  })

  it('小五字号样式（注、示例、表格文字、页码……）sz=18，不改字体', () => {
    for (const id of ['SesNote', 'SesExLabel', 'SesTableText', 'SesFooter']) {
      expect(szVal(id)).toBe('18')
      expect(rFontsAscii(id)).toBeUndefined() // 字体继承 SesNormal 的宋体，不重复声明
    }
  })

  it('SesEndMark：sz=8（4 磅），不改字体', () => {
    expect(szVal('SesEndMark')).toBe('8')
    expect(rFontsAscii('SesEndMark')).toBeUndefined()
  })

  it('三号标题（目次/前言/正文首页名称）：黑体 32，关闭网格', () => {
    for (const id of ['SesTocTitle', 'SesFrontTitle', 'SesBodyTitle']) {
      expect(rFontsAscii(id)).toBe('黑体')
      expect(szVal(id)).toBe('32')
      const pPr = findChild(styles.get(id)!, 'w:pPr')!
      expect(findChild(pPr, 'w:snapToGrid')?.attrs['w:val']).toBe('0')
    }
  })

  it('SesCoverStdNo：黑体四号 28，右对齐', () => {
    expect(rFontsAscii('SesCoverStdNo')).toBe('黑体')
    expect(szVal('SesCoverStdNo')).toBe('28')
    const pPr = findChild(styles.get('SesCoverStdNo')!, 'w:pPr')!
    expect(findChild(pPr, 'w:jc')?.attrs['w:val']).toBe('right')
  })
})

describe('styles.ts：docDefaults', () => {
  it('rPrDefault 为宋体 + lang，pPrDefault 为空 pPr', () => {
    const root = parseXml(buildStylesXml())
    const docDefaults = findChild(root, 'w:docDefaults')!
    const rPrDefault = findChild(docDefaults, 'w:rPrDefault')!
    const rPr = findChild(rPrDefault, 'w:rPr')!
    expect(findChild(rPr, 'w:rFonts')?.attrs['w:ascii']).toBe('Times New Roman')
    expect(findChild(rPr, 'w:lang')?.attrs['w:val']).toBe('en-US')
    const pPrDefault = findChild(docDefaults, 'w:pPrDefault')!
    const emptyPPr = findChild(pPrDefault, 'w:pPr')
    expect(emptyPPr).toBeDefined() // 自闭合 <w:pPr/>：元素存在，但无子元素
    expect(emptyPPr!.children).toEqual([])
  })

  it('不写 latentStyles', () => {
    const root = parseXml(buildStylesXml())
    expect(findChild(root, 'w:latentStyles')).toBeUndefined()
  })
})
