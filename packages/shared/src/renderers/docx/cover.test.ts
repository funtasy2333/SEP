import { describe, expect, it } from 'vitest'
import type { IRDoc, IRDocMeta } from '../../ir/types'
import { mmToTwips } from './units'
import type { DocxPackage, DocxRenderOptions } from './types'
import { normalizeCoverStdCode } from './cover'
import { renderDocxTraced } from './render'
import { assertChildOrder, assertNumberingIntegrity, assertWellFormed } from './__tests__/helpers/checks'
import { extractParagraphText } from './__tests__/helpers/paragraphText'
import { docxOutline } from './__tests__/helpers/outline'
import { findChild, parseXml, type XmlElement } from './__tests__/helpers/xmlTree'

const BASE_META: IRDocMeta = {
  title: '标准化文件编辑系统',
  titleEn: 'Standardization document editing system',
  stdCode: 'GB/T 12345—2026',
  icsCode: '35.240',
  ccsCode: 'L 70',
  standardType: 'gb',
  issuer: '某标准发布机构',
  publishDate: '2026-06-01',
  implementDate: '2026-12-01',
}

function makeDoc(meta: IRDocMeta): IRDoc {
  return {
    schemaVersion: 1,
    meta,
    front: { foreword: [], introduction: [] },
    body: [],
    appendices: [],
    bibliography: [],
  }
}

function renderCoverPackage(
  meta: IRDocMeta,
  stage: DocxRenderOptions['stage'] = 'working_draft',
): DocxPackage {
  return renderDocxTraced(makeDoc(meta), {}, {
    images: {},
    formulaOmml: {},
    stage,
    createdAt: '2026-09-30T08:00:00.000Z',
  }).pkg
}

function descendants(el: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = []
  for (const child of el.children) {
    if (child.kind !== 'element') continue
    if (child.name === name) found.push(child)
    found.push(...descendants(child, name))
  }
  return found
}

function paragraphs(pkg: DocxPackage): XmlElement[] {
  const xml = pkg.parts['word/document.xml']
  if (!xml) throw new Error('封面 DOCX 缺少 word/document.xml')
  return descendants(parseXml(xml), 'w:p')
}

function styleOf(p: XmlElement): string | undefined {
  return findChild(findChild(p, 'w:pPr')!, 'w:pStyle')?.attrs['w:val']
}

function paragraphWithStyle(pkg: DocxPackage, styleId: string): XmlElement | undefined {
  return paragraphs(pkg).find((p) => styleOf(p) === styleId)
}

function frameOf(p: XmlElement): XmlElement | undefined {
  const pPr = findChild(p, 'w:pPr')
  return pPr && findChild(pPr, 'w:framePr')
}

const TYPE_CASES = [
  {
    standardType: 'gb',
    stdCode: 'GB/T 12345 - 2026',
    normalizedCode: 'GB/T 12345—2026',
    designationStyle: 'SesCoverDesignationGb',
    designation: '中华人民共和国国家标准',
    designationFrame: [24.7, 37.54, 170],
    logoStyle: 'SesCoverLogo',
    logo: '〔图〕',
    english: true,
  },
  {
    standardType: 'guide',
    stdCode: 'GB/Z 12345-2026',
    normalizedCode: 'GB/Z 12345—2026',
    designationStyle: 'SesCoverDesignationGuide',
    designation: '中华人民共和国国家标准化指导性技术文件',
    designationFrame: [24.7, 37.54, 171],
    logoStyle: 'SesCoverLogo',
    logo: '〔图〕',
    english: true,
  },
  {
    standardType: 'industry',
    stdCode: 'JB/T 1234-2026',
    normalizedCode: 'JB/T 1234—2026',
    designationStyle: 'SesCoverDesignationOther',
    designation: '中华人民共和国机械行业标准',
    designationFrame: [25, 40.12, 170],
    logoStyle: 'SesCoverLogoText',
    logo: 'JB',
    english: true,
  },
  {
    standardType: 'local',
    stdCode: 'DB33/T 123-2026',
    normalizedCode: 'DB33/T 123—2026',
    designationStyle: 'SesCoverDesignationOther',
    designation: '浙江省地方标准',
    designationFrame: [25, 40.12, 170],
    logoStyle: 'SesCoverLogo',
    logo: '〔图〕',
    english: false,
  },
  {
    standardType: 'group',
    stdCode: 'T/ABC 123-2026',
    normalizedCode: 'T/ABC 123—2026',
    designationStyle: 'SesCoverDesignationOther',
    designation: '团体标准',
    designationFrame: [25, 40.12, 170],
    logoStyle: 'SesCoverGroupLogo',
    logo: 'T',
    english: true,
  },
  {
    standardType: 'enterprise',
    stdCode: 'Q/ABC 123-2026',
    normalizedCode: 'Q/ABC 123—2026',
    designationStyle: 'SesCoverDesignationOther',
    designation: '企业标准',
    designationFrame: [25, 40.12, 170],
    logoStyle: 'SesCoverEnterpriseLogo',
    logo: 'Q',
    english: false,
  },
] as const satisfies ReadonlyArray<{
  standardType: IRDocMeta['standardType']
  stdCode: string
  normalizedCode: string
  designationStyle: string
  designation: string
  designationFrame: readonly [number, number, number]
  logoStyle: string
  logo: string
  english: boolean
}>

describe('WP7.5 六类封面与文件编号', () => {
  it.each(TYPE_CASES)('$standardType 映射称谓、标志与规范化文件编号', (testCase) => {
    const meta: IRDocMeta = {
      ...BASE_META,
      standardType: testCase.standardType,
      stdCode: testCase.stdCode,
      industryName: '机械',
      regionName: '浙江省',
      filingNo: '备案 123',
    }
    const pkg = renderCoverPackage(meta)
    const outline = docxOutline(pkg)

    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
    expect(() => assertNumberingIntegrity(pkg)).not.toThrow()
    expect(JSON.parse(JSON.stringify(pkg))).toEqual(pkg)
    expect(renderCoverPackage(meta)).toEqual(pkg)

    const designationParagraph = paragraphWithStyle(pkg, testCase.designationStyle)
    expect(designationParagraph, `${testCase.standardType} 称谓段落应存在`).toBeDefined()
    const designationFrame = frameOf(designationParagraph!)
    expect(designationFrame, `${testCase.standardType} 称谓应使用图文框定位`).toBeDefined()
    expect(designationFrame!.attrs).toMatchObject({
      'w:x': String(mmToTwips(testCase.designationFrame[0])),
      'w:y': String(mmToTwips(testCase.designationFrame[1])),
      'w:w': String(mmToTwips(testCase.designationFrame[2])),
    })

    expect(outline).toContain(`${testCase.designationStyle} │ — │ ${testCase.designation}`)
    expect(outline).toContain(`${testCase.logoStyle} │ — │ ${testCase.logo}`)
    expect(outline).toContain(`SesCoverStdNo │ — │ ${testCase.normalizedCode}`)
    if (testCase.english) expect(outline).toContain('SesCoverEnglish │ — │ Standardization document editing system')
    else expect(outline).not.toContain('SesCoverEnglish │')
    expect(pkg.warnings.filter((warning) => warning.code === 'cover-field-missing')).toEqual([])

    if (testCase.standardType === 'industry') {
      expect(outline).toContain('SesCoverIcs │ — │ ICS 35.240⏎CCS L 70⏎备案号：备案 123')
    }
    if (testCase.standardType === 'local') {
      expect(outline).toContain('SesCoverDbRegion │ — │ 33')
    }
  })

  it.each([
    ['GB12345-2026', 'GB 12345—2026'],
    ['DB33 123', 'DB33 123'],
    ['HG1234', 'HG 1234'],
    ['Q/TEST123', 'Q/TEST123'],
  ])('编号 %s 规范化为 %s', (source, expected) => {
    expect(normalizeCoverStdCode(source)).toBe(expected)
  })

  it('行业连续编号与地方代号仍拆出正确的封面标志代码', () => {
    const industry = docxOutline(renderCoverPackage({ ...BASE_META, standardType: 'industry', stdCode: 'HG1234', industryName: '化工' }))
    const local = docxOutline(renderCoverPackage({ ...BASE_META, standardType: 'local', stdCode: 'DB33 123', regionName: '浙江省' }))
    expect(industry).toContain('SesCoverLogoText │ — │ HG')
    expect(local).toContain('SesCoverDbRegion │ — │ 33')
  })

  it.each([
    { stdCode: 'HG 1234—2026', expected: 'HG' },
    { stdCode: 'HG1234-2026', expected: 'HG' },
    { stdCode: 'HG/T 1234-2026', expected: 'HG' },
    { stdCode: 'HG/T1234-2026', expected: 'HG' },
    { stdCode: 'HH malformed', expected: 'XX' },
    { stdCode: 'HH/T malformed', expected: 'XX' },
    { stdCode: 'DB33 123', expected: 'XX' },
    { stdCode: 'Q/TEST123', expected: 'XX' },
  ])('行业标志从有效规范编号 $stdCode 提取代号 $expected，不猜测畸形或其他类型编号', ({ stdCode, expected }) => {
    const outline = docxOutline(renderCoverPackage({ ...BASE_META, standardType: 'industry', stdCode }))
    expect(outline).toContain(`SesCoverLogoText │ — │ ${expected}`)
  })

  it('地方代码段按 1020 twips 拟合并定位在规定右上区域', () => {
    const pkg = renderCoverPackage({ ...BASE_META, standardType: 'local', stdCode: 'DB33 123', regionName: '浙江省' })
    const paragraph = paragraphWithStyle(pkg, 'SesCoverDbRegion')
    expect(paragraph).toBeDefined()
    expect(frameOf(paragraph!)?.attrs).toMatchObject({
      'w:x': String(mmToTwips(154.2)),
      'w:y': String(mmToTwips(3.5)),
      'w:w': String(mmToTwips(40)),
    })

    const styles = parseXml(pkg.parts['word/styles.xml']!)
    const style = descendants(styles, 'w:style').find((element) => element.attrs['w:styleId'] === 'SesCoverDbRegion')
    const rPr = style && findChild(style, 'w:rPr')
    expect(rPr && findChild(rPr, 'w:fitText')?.attrs['w:val']).toBe('1020')
  })
})

const STAGE_CASES = [
  { stage: 'working_draft', label: '（工作草案）', patent: false },
  { stage: 'comment_draft', label: '（征求意见稿）', patent: true },
  { stage: 'review_discussion_draft', label: '（送审讨论稿）', patent: false },
  { stage: 'review_draft', label: '（送审稿）', patent: true },
  { stage: 'approval_draft', label: '（报批稿）', patent: false },
  { stage: 'public_draft', label: '（公示稿）', patent: false },
  { stage: 'published', label: undefined, patent: false },
] as const satisfies ReadonlyArray<{
  stage: DocxRenderOptions['stage']
  label: string | undefined
  patent: boolean
}>

describe('WP7.5 七阶段封面标识与专利征集说明', () => {
  it.each(STAGE_CASES)('$stage 的阶段标识与专利说明符合映射', ({ stage, label, patent }) => {
    const outline = docxOutline(renderCoverPackage(BASE_META, stage))
    if (label) expect(outline).toContain(`SesCoverStage │ — │ ${label}`)
    else expect(outline).not.toContain('SesCoverStage │')

    const patentLine = 'SesCoverPatent │ — │ 在提交反馈意见时，请将您知道的相关专利连同支持性文件一并附上。'
    if (patent) expect(outline).toContain(patentLine)
    else expect(outline).not.toContain('SesCoverPatent │')
  })
})

describe('WP7.5 封面定位与内容', () => {
  it('封面段落写入 §6.1 页面坐标图文框，文件编号和新增元数据格式正确', () => {
    const meta: IRDocMeta = {
      ...BASE_META,
      replaces: 'GB/T 0001 - 2010',
      consistency: '（ISO 1234:2020，MOD）',
    }
    const pkg = renderCoverPackage(meta, 'comment_draft')
    const outline = docxOutline(pkg)
    const expectedFrames: ReadonlyArray<readonly [string, number, number, number]> = [
      ['SesCoverIcs', 25, 9.17, 90],
      ['SesCoverLogo', 143, 12.03, 40],
      ['SesCoverDesignationGb', 24.7, 37.54, 170],
      ['SesCoverStdNo', 100, 54.59, 90],
      ['SesCoverReplaces', 100, 64.41, 90],
      ['SesCoverRule', 25, 69.16, 170],
      ['SesCoverName', 25, 112.55, 170],
      ['SesCoverEnglish', 25, 112.55, 170],
      ['SesCoverConsistency', 25, 112.55, 170],
      ['SesCoverStage', 25, 112.55, 170],
      ['SesCoverPatent', 25, 112.55, 170],
      ['SesCoverDates', 25, 249.6, 170],
      ['SesCoverIssuer', 25, 262.5, 170],
    ]

    for (const [styleId, xMm, yMm, widthMm] of expectedFrames) {
      const paragraph = paragraphWithStyle(pkg, styleId)
      expect(paragraph, `${styleId} 段落应存在`).toBeDefined()
      const frame = frameOf(paragraph!)
      expect(frame, `${styleId} 应使用图文框定位`).toBeDefined()
      expect(frame!.attrs).toMatchObject({
        'w:hAnchor': 'page',
        'w:vAnchor': 'page',
        'w:wrap': 'around',
        'w:hSpace': '0',
        'w:vSpace': '0',
        'w:x': String(mmToTwips(xMm)),
        'w:y': String(mmToTwips(yMm)),
        'w:w': String(mmToTwips(widthMm)),
      })
    }

    expect(outline).toContain('SesCoverStdNo │ — │ GB/T 12345—2026')
    expect(outline).toContain('SesCoverReplaces │ — │ 代替 GB/T 0001—2010')
    expect(outline).toContain('SesCoverConsistency │ — │ （ISO 1234:2020，MOD）')
    expect(outline).toContain('SesCoverDates │ — │ 2026-06-01 发布⇥2026-12-01 实施')
  })

  it.each([
    { title: '仅文件编号缺失', meta: { stdCode: undefined }, missing: 'meta.stdCode' },
    { title: '文件编号为空', meta: { stdCode: '' }, missing: 'meta.stdCode' },
    { title: '文件编号仅含空白', meta: { stdCode: '   ' }, missing: 'meta.stdCode' },
    { title: '仅文件名称缺失', meta: { title: undefined }, missing: 'meta.title' },
    { title: '文件名称为空', meta: { title: '' }, missing: 'meta.title' },
  ])('$title 时保留一个 SesCoverStdNo 段且只记对应 warning', ({ meta, missing }) => {
    const pkg = renderCoverPackage({ ...BASE_META, ...meta })
    const outline = docxOutline(pkg)
    const coverNumberParagraphs = paragraphs(pkg).filter((p) => styleOf(p) === 'SesCoverStdNo')
    const warnings = pkg.warnings.filter((warning) => warning.code === 'cover-field-missing')

    expect(coverNumberParagraphs).toHaveLength(1)
    expect(frameOf(coverNumberParagraphs[0]!)).toBeDefined()
    if (missing === 'meta.stdCode') {
      expect(extractParagraphText(coverNumberParagraphs[0]!)).toBe('')
      expect(outline.match(/^SesCoverStdNo │ — │$/gm)).toHaveLength(1)
    } else {
      expect(extractParagraphText(coverNumberParagraphs[0]!)).toBe('GB/T 12345—2026')
      expect(outline).toContain('SesCoverStdNo │ — │ GB/T 12345—2026')
    }
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toContain(missing)
  })

  it('文件名称与编号都缺失时各记一条 warning，不重复', () => {
    const pkg = renderCoverPackage({ ...BASE_META, title: undefined, stdCode: undefined })
    const warnings = pkg.warnings.filter((warning) => warning.code === 'cover-field-missing')
    expect(warnings).toHaveLength(2)
    expect(warnings.map((warning) => warning.message).join('\n')).toContain('meta.title')
    expect(warnings.map((warning) => warning.message).join('\n')).toContain('meta.stdCode')
  })

  it.each([
    {
      name: 'industryName',
      meta: { standardType: 'industry' as const, industryName: undefined },
      expectedText: 'SesCoverDesignationOther │ — │ 中华人民共和国行业标准',
    },
    {
      name: 'regionName',
      meta: { standardType: 'local' as const, regionName: undefined },
      expectedText: 'SesCoverDesignationOther │ — │ 地方标准',
    },
    {
      name: 'issuer',
      meta: { standardType: 'group' as const, issuer: undefined, regionName: '浙江省' },
      expectedText: 'SesCoverIssuer │ — │ 发　布',
    },
  ])('缺少 $name 时封面留空并只记录对应 warning', ({ name, meta, expectedText }) => {
    const pkg = renderCoverPackage({ ...BASE_META, ...meta })
    const warnings = pkg.warnings.filter((warning) => warning.code === 'cover-field-missing')
    const outline = docxOutline(pkg)
    expect(outline).toContain(expectedText)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toContain(`meta.${name}`)
  })
})

describe('WP7.5 封面 DOCX 包完整性', () => {
  const build = () => renderCoverPackage(BASE_META, 'comment_draft')
  const pkg = build()

  it('XML、内容类型、内部 relationship 目标及 r:embed 均完整', () => {
    expect(() => assertWellFormed(pkg)).not.toThrow()
    const embeds = descendants(parseXml(pkg.parts['word/document.xml']!), 'a:blip')
      .map((element) => element.attrs['r:embed'])
    expect(embeds.length).toBeGreaterThanOrEqual(2)
    const rels = parseXml(pkg.parts['word/_rels/document.xml.rels']!)
    const relationshipIds = descendants(rels, 'Relationship').map((element) => element.attrs.Id)
    for (const embed of embeds) expect(relationshipIds).toContain(embed)
  })

  it('全部部件的子元素顺序符合 OOXML 清单', () => {
    expect(() => assertChildOrder(pkg)).not.toThrow()
  })

  it('样式、段落与编号定义引用完整', () => {
    expect(() => assertNumberingIntegrity(pkg)).not.toThrow()
  })

  it('包是可 JSON 往返的确定性纯数据', () => {
    expect(JSON.parse(JSON.stringify(pkg))).toEqual(pkg)
    expect(build()).toEqual(pkg)
    expect(Object.values(pkg.parts).every((part) => typeof part === 'string')).toBe(true)
    expect(Object.values(pkg.binaries).every((part) => typeof part === 'string')).toBe(true)
  })
})

describe('WP7.5 封面素材来源提示', () => {
  it.each([
    { standardType: 'industry', warning: '行业代号标志' },
    { standardType: 'local', warning: '原始来源未核实' },
    { standardType: 'group', warning: '团体标准按国标布局近似' },
    { standardType: 'enterprise', warning: '企业标准按国标布局近似' },
  ] as const)('$standardType 缺少合格素材时保留来源提示 warning', ({ standardType, warning }) => {
    const pkg = renderCoverPackage({ ...BASE_META, standardType })
    expect(pkg.warnings.some((item) => item.code === 'cover-asset-approximation' && item.message.includes(warning))).toBe(true)
  })
})
