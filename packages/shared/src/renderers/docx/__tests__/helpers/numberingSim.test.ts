/**
 * §4.7 模拟器自测（docs/wp7-docx-delivery.md §4.7「模拟器自测」表）。
 *
 * 手写 styles/numbering/document 片段复现 spike v10 的 Word 实测结果（原始 XML 见
 * spike/wp7-docx-word/probe_v10.py，结论见 spike/wp7-docx-word/README.md「v10」各行）。
 * 这张自测表全部通过，模拟器才能作为后面 numbering/full fixture 比对的尺子。
 *
 * T3 与 T4「紧接 T3」共用同一个 abstractNum 与文档（T4 的期望输出依赖 T3 结束时的计数器状态，
 * 规格原文「紧接 T3」即此意）；T5、T8、resume、v4、跳级、格式 各用例互相独立，各自新开
 * abstractNum/文档，避免无关状态串扰。
 */

import { describe, expect, it } from 'vitest'
import { abstractNum as buildAbstractNum, lvl, num, numbering as buildNumbering, numPr, pPr, style, styles as buildStyles, wrapElement } from '../../xml'
import type { DocxPackage } from '../../types'
import { formatCounterValue, simulateNumbering } from './numberingSim'

const SP = '　' // 全角空格

// ---------------- 手写 XML 的小工具（局部于本测试文件） ----------------

function run(text: string): string {
  return `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`
}

/** 段落：styleId 可省略；numIdIlvl 传 [numId, ilvl] 则写段落级 numPr */
function p(text: string, opts: { styleId?: string; numId?: string | number; ilvl?: number } = {}): string {
  const children: Parameters<typeof pPr>[0] = []
  if (opts.styleId) children.push(['pStyle', `<w:pStyle w:val="${opts.styleId}"/>`])
  if (opts.numId !== undefined) {
    children.push([
      'numPr',
      numPr([
        ['ilvl', `<w:ilvl w:val="${opts.ilvl ?? 0}"/>`],
        ['numId', `<w:numId w:val="${opts.numId}"/>`],
      ]),
    ])
  }
  const pprXml = children.length > 0 ? pPr(children) : ''
  return `<w:p>${pprXml}${text ? run(text) : ''}</w:p>`
}

function lvlDef(ilvl: number, fmt: string, lvlText: string, start = 1): string {
  return lvl(
    [
      ['start', `<w:start w:val="${start}"/>`],
      ['numFmt', `<w:numFmt w:val="${fmt}"/>`],
      ['lvlText', `<w:lvlText w:val="${lvlText}"/>`],
    ],
    { 'w:ilvl': ilvl },
  )
}

function abstractNumDef(id: number, levels: string[]): string {
  return buildAbstractNum(
    [
      ['multiLevelType', `<w:multiLevelType w:val="${levels.length > 1 ? 'multilevel' : 'singleLevel'}"/>`],
      ...levels.map((l): [string, string] => ['lvl', l]),
    ],
    { 'w:abstractNumId': id },
  )
}

function lvlOverride(ilvl: number, opts: { start?: number; lvlXml?: string } = {}): string {
  // lvlOverride 不在 xml.ts 的 9+6 个导出容器之列，但仍在附录 B 清单里（顺序固定为 startOverride, lvl）：
  // 这里只有两个可选子元素、顺序本就固定，直接手写等价于经 joinOrderedChildren 排序。
  const parts: string[] = []
  if (opts.start !== undefined) parts.push(`<w:startOverride w:val="${opts.start}"/>`)
  if (opts.lvlXml !== undefined) parts.push(opts.lvlXml)
  return wrapElement('w:lvlOverride', parts.join(''), { 'w:ilvl': ilvl })
}

function numDef(numId: number, abstractNumId: number, overrides: { ilvl: number; start?: number; lvlXml?: string }[] = []): string {
  const children: [string, string][] = [['abstractNumId', `<w:abstractNumId w:val="${abstractNumId}"/>`]]
  for (const ov of overrides) children.push(['lvlOverride', lvlOverride(ov.ilvl, ov)])
  return num(children, { 'w:numId': numId })
}

function styleDef(id: string, opts: { basedOn?: string; numId?: string | number; ilvl?: number } = {}): string {
  const children: [string, string][] = [['name', `<w:name w:val="SES_${id}"/>`]]
  if (opts.basedOn) children.push(['basedOn', `<w:basedOn w:val="${opts.basedOn}"/>`])
  if (opts.numId !== undefined) {
    children.push([
      'pPr',
      pPr([
        [
          'numPr',
          numPr([
            ['ilvl', `<w:ilvl w:val="${opts.ilvl ?? 0}"/>`],
            ['numId', `<w:numId w:val="${opts.numId}"/>`],
          ]),
        ],
      ]),
    ])
  }
  return style(children, { 'w:type': 'paragraph', 'w:customStyle': '1', 'w:styleId': id })
}

function pkg(documentBody: string, styleDefs: string[], abstractNums: string[], numDefs: string[]): DocxPackage {
  const NS_ATTRS = {
    'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  }
  const documentXml = wrapElement('w:document', `<w:body>${documentBody}</w:body>`, NS_ATTRS)
  // buildStyles / buildNumbering 已经各自包好 <w:styles>/<w:numbering> 外层标签，不再重复包裹
  const stylesXml = buildStyles(
    styleDefs.map((s): [string, string] => ['style', s]),
    NS_ATTRS,
  )
  const numberingXml = buildNumbering(
    [...abstractNums.map((a): [string, string] => ['abstractNum', a]), ...numDefs.map((n): [string, string] => ['num', n])],
    NS_ATTRS,
  )
  return {
    parts: {
      'word/document.xml': documentXml,
      'word/styles.xml': stylesXml,
      'word/numbering.xml': numberingXml,
    },
    binaries: {},
    warnings: [],
  }
}

/** 只取模拟结果的 label 序列（去空），用于跟期望数组比对 */
function labels(pkgResult: DocxPackage): (string | undefined)[] {
  return simulateNumbering(pkgResult).map((p) => p.label)
}

// ---------------- T1 ----------------

describe('T1：同一 abstractNum 的两个实例 X、Y（都写 startOverride=1）交错使用', () => {
  it('X Y Y X Y -> 注1 注1 注2 注3 注4', () => {
    const abs = abstractNumDef(8, [lvlDef(0, 'decimal', `注%1：`)])
    const nX = numDef(101, 8, [{ ilvl: 0, start: 1 }])
    const nY = numDef(102, 8, [{ ilvl: 0, start: 1 }])
    const body = [
      p('X1', { numId: 101 }),
      p('Y1', { numId: 102 }),
      p('Y2', { numId: 102 }),
      p('X2', { numId: 101 }),
      p('Y3', { numId: 102 }),
    ].join('')
    const result = pkg(body, [], [abs], [nX, nY])
    expect(labels(result)).toEqual(['注1：', '注1：', '注2：', '注3：', '注4：'])
  })
})

// ---------------- T2 ----------------

describe('T2：同一 abstractNum 的两个实例，都不写 override', () => {
  it('a b a -> 甲1 甲2 甲3', () => {
    const abs = abstractNumDef(18, [lvlDef(0, 'decimal', '甲%1：')])
    const nA = numDef(103, 18)
    const nB = numDef(104, 18)
    const body = [p('a1', { numId: 103 }), p('b1', { numId: 104 }), p('a2', { numId: 103 })].join('')
    const result = pkg(body, [], [abs], [nA, nB])
    expect(labels(result)).toEqual(['甲1：', '甲2：', '甲3：'])
  })
})

// ---------------- T3 + T4（紧接 T3，共用 abstractNum 12） ----------------

describe('T3 + T4：紧接 T3，共用同一 abstractNum', () => {
  const abs12 = abstractNumDef(12, [lvlDef(0, 'lowerLetter', '%1)'), lvlDef(1, 'decimal', '%2)')])

  it('T3：一个实例 L0 L1 L1 L0 L1 -> a) 1) 2) b) 1)', () => {
    const n110 = numDef(110, 12, [{ ilvl: 0, start: 1 }])
    const body = [
      p('a', { numId: 110, ilvl: 0 }),
      p('a-1', { numId: 110, ilvl: 1 }),
      p('a-2', { numId: 110, ilvl: 1 }),
      p('b', { numId: 110, ilvl: 0 }),
      p('b-1', { numId: 110, ilvl: 1 }),
    ].join('')
    const result = pkg(body, [], [abs12], [n110])
    expect(labels(result)).toEqual(['a)', '1)', '2)', 'b)', '1)'])
  })

  it('T4：紧接 T3，两个新实例（override 只写 ilvl0），各在 L1 用两次 -> 2) 3) 4) 5)', () => {
    // 复用 T3 的段落 + 实例（同一个 abstractNum 12 的计数器状态），T4 的两个新实例接着写在后面
    const n110 = numDef(110, 12, [{ ilvl: 0, start: 1 }])
    const n111 = numDef(111, 12, [{ ilvl: 0, start: 1 }])
    const n112 = numDef(112, 12, [{ ilvl: 0, start: 1 }])
    const t3Body = [
      p('a', { numId: 110, ilvl: 0 }),
      p('a-1', { numId: 110, ilvl: 1 }),
      p('a-2', { numId: 110, ilvl: 1 }),
      p('b', { numId: 110, ilvl: 0 }),
      p('b-1', { numId: 110, ilvl: 1 }),
    ].join('')
    const t4Body = [
      p('111-一', { numId: 111, ilvl: 1 }),
      p('111-二', { numId: 111, ilvl: 1 }),
      p('112-一', { numId: 112, ilvl: 1 }),
      p('112-二', { numId: 112, ilvl: 1 }),
    ].join('')
    const result = pkg(t3Body + t4Body, [], [abs12], [n110, n111, n112])
    expect(labels(result).slice(5)).toEqual(['2)', '3)', '4)', '5)'])
  })
})

// ---------------- T4b ----------------

describe('T4b：另一个 abstractNum 的两个新实例，override 写 ilvl0 与 ilvl1', () => {
  it('各在 L1 用两次 -> 1) 2) 1) 2)', () => {
    const abs = abstractNumDef(13, [lvlDef(0, 'lowerLetter', '%1)'), lvlDef(1, 'decimal', '%2)')])
    const n113 = numDef(113, 13, [{ ilvl: 0, start: 1 }, { ilvl: 1, start: 1 }])
    const n114 = numDef(114, 13, [{ ilvl: 0, start: 1 }, { ilvl: 1, start: 1 }])
    const body = [
      p('113-一', { numId: 113, ilvl: 1 }),
      p('113-二', { numId: 113, ilvl: 1 }),
      p('114-一', { numId: 114, ilvl: 1 }),
      p('114-二', { numId: 114, ilvl: 1 }),
    ].join('')
    const result = pkg(body, [], [abs], [n113, n114])
    expect(labels(result)).toEqual(['1)', '2)', '1)', '2)'])
  })
})

// ---------------- T5 ----------------

describe('T5：同一 abstractNum 的两个实例 P、Q（都写 override）交错', () => {
  it('P P Q P Q -> a) b) a) b) c)', () => {
    const abs = abstractNumDef(20, [lvlDef(0, 'lowerLetter', '%1)'), lvlDef(1, 'decimal', '%2)')])
    const nP = numDef(120, 20, [{ ilvl: 0, start: 1 }])
    const nQ = numDef(121, 20, [{ ilvl: 0, start: 1 }])
    const body = [
      p('P1', { numId: 120, ilvl: 0 }),
      p('P2', { numId: 120, ilvl: 0 }),
      p('Q1', { numId: 121, ilvl: 0 }),
      p('P3', { numId: 120, ilvl: 0 }),
      p('Q2', { numId: 121, ilvl: 0 }),
    ].join('')
    const result = pkg(body, [], [abs], [nP, nQ])
    expect(labels(result)).toEqual(['a)', 'b)', 'a)', 'b)', 'c)'])
  })
})

// ---------------- resume ----------------

describe('resume：回到前一组时新建实例，startOverride 写该组的下一个序号', () => {
  it('X（起始1）Y（起始1）Y Z（起始2）W（起始3） -> 注1 注1 注2 注2 注3', () => {
    const abs = abstractNumDef(8, [lvlDef(0, 'decimal', '注%1：')])
    const nX = numDef(201, 8, [{ ilvl: 0, start: 1 }])
    const nY = numDef(202, 8, [{ ilvl: 0, start: 1 }])
    const nZ = numDef(203, 8, [{ ilvl: 0, start: 2 }])
    const nW = numDef(204, 8, [{ ilvl: 0, start: 3 }])
    const body = [
      p('X1', { numId: 201 }),
      p('Y1', { numId: 202 }),
      p('Y2', { numId: 202 }),
      p('X2', { numId: 203 }),
      p('Y3', { numId: 204 }),
    ].join('')
    const result = pkg(body, [], [abs], [nX, nY, nZ, nW])
    expect(labels(result)).toEqual(['注1：', '注1：', '注2：', '注2：', '注3：'])
  })
})

// ---------------- T6 ----------------

describe('T6：段落级 numPr 指向由另一个样式「属主」的固定实例', () => {
  it('SesTableNote 用段落级 numPr 指向 SesNote 属主的 A7 固定实例 -> 注：', () => {
    const abs = abstractNumDef(7, [lvlDef(0, 'none', '注：')])
    const nFixed = numDef(7, 7)
    const sesNote = styleDef('SesNote', { numId: 7, ilvl: 0 })
    const body = p('T6 表注', { styleId: 'SesTableNote', numId: 7, ilvl: 0 })
    const result = pkg(body, [sesNote], [abs], [nFixed])
    expect(labels(result)).toEqual(['注：'])
  })
})

// ---------------- T8 ----------------

describe('T8：间隔号（另一 abstractNum 的 L1）嵌在字母列表中', () => {
  it('字母列表 L0、SesListDot（A11 L1）、字母列表 L0 -> a) · b)', () => {
    const abs12 = abstractNumDef(12, [lvlDef(0, 'lowerLetter', '%1)'), lvlDef(1, 'decimal', '%2)')])
    const abs11 = abstractNumDef(11, [lvlDef(0, 'bullet', '——'), lvlDef(1, 'bullet', '·')])
    const n122 = numDef(122, 12, [{ ilvl: 0, start: 1 }])
    const n11Fixed = numDef(11, 11)
    const sesListDot = styleDef('SesListDot', { numId: 11, ilvl: 1 })
    const body = [
      p('alpha 一', { numId: 122, ilvl: 0 }),
      p('dot 一', { styleId: 'SesListDot' }),
      p('alpha 二', { numId: 122, ilvl: 0 }),
    ].join('')
    const result = pkg(body, [sesListDot], [abs12, abs11], [n122, n11Fixed])
    expect(labels(result)).toEqual(['a)', '·', 'b)'])
  })
})

// ---------------- v4 ----------------

describe('v4：A1 固定实例，样式级与段落级 numPr 混用', () => {
  it('章、条、无标题条、条、二级条、二级无标题条、章、无标题条（前三章略）-> 4 4.1 4.2 4.3 4.3.1 4.3.2 5 5.1', () => {
    const abs1 = abstractNumDef(1, [
      lvlDef(0, 'decimal', `%1${SP}`),
      lvlDef(1, 'decimal', `%1.%2${SP}`),
      lvlDef(2, 'decimal', `%1.%2.%3${SP}`),
    ])
    const n1 = numDef(1, 1)
    const sesChapter = styleDef('SesChapter', { numId: 1, ilvl: 0 })
    const sesClause1 = styleDef('SesClause1', { numId: 1, ilvl: 1 })
    const sesClause2 = styleDef('SesClause2', { numId: 1, ilvl: 2 })
    const body = [
      // 前三章略：用三个只占 L0 的章节把计数顶到 3
      p('章一', { styleId: 'SesChapter' }),
      p('章二', { styleId: 'SesChapter' }),
      p('章三', { styleId: 'SesChapter' }),
      p('章四', { styleId: 'SesChapter' }),
      p('条4.1', { styleId: 'SesClause1' }),
      p('无标题条4.2', { numId: 1, ilvl: 1 }),
      p('条4.3', { styleId: 'SesClause1' }),
      p('二级条4.3.1', { styleId: 'SesClause2' }),
      p('二级无标题条4.3.2', { numId: 1, ilvl: 2 }),
      p('章五', { styleId: 'SesChapter' }),
      p('条5.1', { styleId: 'SesClause1' }),
    ].join('')
    const result = pkg(body, [sesChapter, sesClause1, sesClause2], [abs1], [n1])
    expect(labels(result).slice(3)).toEqual([
      `4${SP}`,
      `4.1${SP}`,
      `4.2${SP}`,
      `4.3${SP}`,
      `4.3.1${SP}`,
      `4.3.2${SP}`,
      `5${SP}`,
      `5.1${SP}`,
    ])
  })
})

// ---------------- 跳级 ----------------

describe('跳级：A1 的 L0 后直接 L2', () => {
  it('L0 后直接 L2 -> 1 1.1.1（跳过的 L1 隐式计为 1）', () => {
    const abs1 = abstractNumDef(1, [
      lvlDef(0, 'decimal', `%1${SP}`),
      lvlDef(1, 'decimal', `%1.%2${SP}`),
      lvlDef(2, 'decimal', `%1.%2.%3${SP}`),
    ])
    const n1 = numDef(1, 1)
    const body = [p('chap', { numId: 1, ilvl: 0 }), p('skip', { numId: 1, ilvl: 2 })].join('')
    const result = pkg(body, [], [abs1], [n1])
    expect(labels(result)).toEqual([`1${SP}`, `1.1.1${SP}`])
  })
})

// ---------------- 格式 ----------------

describe('格式：字母、罗马编号的格式（过 26 之后）', () => {
  it('upperLetter 第 1、26、27、28 个 -> A Z AA BB', () => {
    const abs = abstractNumDef(30, [lvlDef(0, 'upperLetter', '%1.')])
    const cases: [number, string][] = [
      [1, 'A.'],
      [26, 'Z.'],
      [27, 'AA.'],
      [28, 'BB.'],
    ]
    for (const [start, expected] of cases) {
      const n = numDef(200 + start, 30, [{ ilvl: 0, start }])
      const result = pkg(p('x', { numId: 200 + start }), [], [abs], [n])
      expect(labels(result)).toEqual([expected])
    }
  })

  it('lowerRoman 第 4、9 个 -> iv ix', () => {
    const abs = abstractNumDef(31, [lvlDef(0, 'lowerRoman', '%1)')])
    for (const [start, expected] of [
      [4, 'iv)'],
      [9, 'ix)'],
    ] as [number, string][]) {
      const n = numDef(300 + start, 31, [{ ilvl: 0, start }])
      const result = pkg(p('x', { numId: 300 + start }), [], [abs], [n])
      expect(labels(result)).toEqual([expected])
    }
  })

  it('upperRoman 第 14 个 -> XIV', () => {
    const abs = abstractNumDef(32, [lvlDef(0, 'upperRoman', '%1)')])
    const n = numDef(414, 32, [{ ilvl: 0, start: 14 }])
    const result = pkg(p('x', { numId: 414 }), [], [abs], [n])
    expect(labels(result)).toEqual(['XIV)'])
  })

  it('formatCounterValue 直接单测覆盖 decimal/bullet 兜底', () => {
    expect(formatCounterValue(3, 'decimal')).toBe('3')
    expect(formatCounterValue(5, 'bullet')).toBe('5') // bullet/none 的 lvlText 本规格中从不含 %n，兜底按数字输出
  })
})

// ---------------- 边界：没有 styles/numbering 部件、numId=0 ----------------

describe('边界情况', () => {
  it('没有 styles 或 numbering 部件时视为全文无编号', () => {
    const documentXml =
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${p('无编号', { styleId: 'SesPara' })}</w:body></w:document>`
    const result = simulateNumbering({ parts: { 'word/document.xml': documentXml }, binaries: {}, warnings: [] })
    expect(result).toEqual([{ index: 0, styleId: 'SesPara', numId: undefined, ilvl: undefined, label: undefined, text: '无编号' }])
  })

  it('段落级 numPr 的 numId="0" 表示显式「无编号」，不沿样式链继续找', () => {
    const abs = abstractNumDef(1, [lvlDef(0, 'decimal', '%1.')])
    const n1 = numDef(1, 1)
    const sesChapter = styleDef('SesChapter', { numId: 1, ilvl: 0 })
    const body = p('x', { styleId: 'SesChapter', numId: 0 })
    const result = pkg(body, [sesChapter], [abs], [n1])
    expect(labels(result)).toEqual([undefined])
  })

  it('index 与 text 按文档顺序输出，含表格单元格内的段落', () => {
    const documentXml =
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' +
      p('段一') +
      '<w:tbl><w:tr><w:tc>' +
      p('格内段落') +
      '</w:tc></w:tr></w:tbl>' +
      p('段二') +
      '</w:body></w:document>'
    const result = simulateNumbering({ parts: { 'word/document.xml': documentXml }, binaries: {}, warnings: [] })
    expect(result.map((r) => r.text)).toEqual(['段一', '格内段落', '段二'])
    expect(result.map((r) => r.index)).toEqual([0, 1, 2])
  })
})
