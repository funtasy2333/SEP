/**
 * DOCX 分节与页眉页脚（docs/wp7-docx-delivery.md §2）。
 *
 * `sectPr` 描述的是它所结束的那一节（§2.2）：非末节的 `sectPr` 写在该节末尾单独的分节空段里，
 * 最后一节的 `sectPr` 是 `w:body` 的最后一个子元素。`createSectionManager()` 维护「当前节属性」，
 * `startSection(kind)` 在开新节前先吐出上一节的分节空段 XML（调用方负责拼进 document.xml 的累积
 * 字符串）。`buildHeaderFooterParts()` 生成 §2.3 的四个页眉页脚部件。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API；不用 class 的参数属性，改用工厂函数 + 闭包。
 */

import { mmToTwips } from './units'
import { escapeXmlText, pPr, sectPr, wrapElement, type XmlChild } from './xml'

// ---------------- §2.1 页面参数 ----------------

const PAGE_W = 11906
const PAGE_H = 16838

function pgMarXml(): string {
  return (
    `<w:pgMar w:top="${mmToTwips(34)}" w:right="${mmToTwips(20)}" w:bottom="${mmToTwips(25)}" ` +
    `w:left="${mmToTwips(25)}" w:header="${mmToTwips(25)}" w:footer="${mmToTwips(20)}" w:gutter="0"/>`
  )
}

// ---------------- §2.2 节序 ----------------

export type SectionKind = 'cover' | 'toc' | 'foreword' | 'introduction' | 'body' | 'appendix' | 'bibliography'

interface PgNumType {
  fmt: 'upperRoman' | 'decimal'
  /** true 时显式写 w:start="1"（重新起编） */
  start?: boolean
}

interface SectionProps {
  type: 'nextPage' | 'oddPage'
  /** 封面节不写 pgNumType（§2.2：「不写」） */
  pgNumType?: PgNumType
  /** 封面节没有页眉页脚引用（首节无引用即无页眉页脚，§2.2） */
  withHeaderFooter: boolean
  landscape?: boolean
}

/** §2.2 节序表：语义节的 type/pgNumType/页眉页脚引用；横排由 startSection 的选项派生。 */
export function sectionPropsFor(kind: SectionKind): SectionProps {
  switch (kind) {
    case 'cover':
      return { type: 'nextPage', withHeaderFooter: false }
    case 'toc':
      return { type: 'oddPage', pgNumType: { fmt: 'upperRoman', start: true }, withHeaderFooter: true }
    case 'foreword':
    case 'introduction':
      // 续编，必须显式写 fmt（§2.2）；no start——沿用目次节起的罗马页码
      return { type: 'nextPage', pgNumType: { fmt: 'upperRoman' }, withHeaderFooter: true }
    case 'body':
      return { type: 'oddPage', pgNumType: { fmt: 'decimal', start: true }, withHeaderFooter: true }
    case 'appendix':
    case 'bibliography':
      return { type: 'nextPage', pgNumType: { fmt: 'decimal' }, withHeaderFooter: true }
  }
}

/** 页眉页脚四个部件的关系 ID（由调用方按 header1、header2、footer1、footer2 的顺序申请，§2.3） */
export interface HeaderFooterRelIds {
  header1: string
  header2: string
  footer1: string
  footer2: string
}

function sectPrXml(props: SectionProps, relIds: HeaderFooterRelIds): string {
  const children: XmlChild[] = []
  if (props.withHeaderFooter) {
    children.push(['headerReference', `<w:headerReference w:type="default" r:id="${relIds.header1}"/>`])
    children.push(['headerReference', `<w:headerReference w:type="even" r:id="${relIds.header2}"/>`])
    children.push(['footerReference', `<w:footerReference w:type="default" r:id="${relIds.footer1}"/>`])
    children.push(['footerReference', `<w:footerReference w:type="even" r:id="${relIds.footer2}"/>`])
  }
  children.push(['type', `<w:type w:val="${props.type}"/>`])
  children.push(['pgSz', props.landscape
    ? `<w:pgSz w:w="${PAGE_H}" w:h="${PAGE_W}" w:orient="landscape"/>`
    : `<w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/>`])
  children.push(['pgMar', pgMarXml()])
  if (props.pgNumType) {
    children.push(['pgNumType', `<w:pgNumType w:fmt="${props.pgNumType.fmt}"${props.pgNumType.start ? ' w:start="1"' : ''}/>`])
  }
  children.push(['docGrid', '<w:docGrid w:type="lines" w:linePitch="312"/>'])
  return sectPr(children)
}

function sectionEmptyParagraphXml(props: SectionProps, relIds: HeaderFooterRelIds): string {
  return `<w:p>${pPr([['sectPr', sectPrXml(props, relIds)]])}</w:p>`
}

export interface SectionManager {
  /**
   * 结束当前节（如果有）、开始 kind 指定的新节：返回「上一节」的分节空段 XML（调用方需要把它拼在
   * 新节内容之前）；第一次调用（没有「上一节」）返回空串。
   */
  startSection(kind: SectionKind, options?: { continuation?: boolean; landscape?: boolean }): string
  /** 渲染结束后取最后一节的 sectPr（w:body 的最后一个子元素，不包在分节空段里） */
  finalSectPr(): string
}

export function createSectionManager(relIds: HeaderFooterRelIds): SectionManager {
  let current: SectionProps | undefined

  return {
    startSection(kind, options) {
      const closing = current ? sectionEmptyParagraphXml(current, relIds) : ''
      const props = sectionPropsFor(kind)
      current = options?.continuation
        ? { ...props, type: 'nextPage', pgNumType: props.pgNumType && { fmt: props.pgNumType.fmt }, landscape: options.landscape }
        : props
      return closing
    },
    finalSectPr() {
      if (!current) throw new Error('sections: finalSectPr() 必须在至少一次 startSection() 之后调用')
      return sectPrXml(current, relIds)
    },
  }
}

// ---------------- §2.3 页眉页脚部件 ----------------

const HDR_FTR_NS = {
  'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/** STYLEREF/PAGE 域：begin → instrText → separate → 缓存结果（w:t）→ end（§2.3、spike gen_spike.py 的 fld()） */
function fieldXml(instr: string, cachedText: string): string {
  return (
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText xml:space="preserve"> ${escapeXmlText(instr)} </w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    `<w:r><w:t xml:space="preserve">${escapeXmlText(cachedText)}</w:t></w:r>` +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
  )
}

type Align = 'left' | 'right'

/** word/header1.xml（单数页/default，align=right）、word/header2.xml（双数页/even，align=left） */
function buildHeaderXml(align: Align, cachedStdCode: string): string {
  const pprXml = pPr([
    ['pStyle', '<w:pStyle w:val="SesHeader"/>'],
    ['jc', `<w:jc w:val="${align}"/>`],
  ])
  const paragraph = `<w:p>${pprXml}${fieldXml('STYLEREF "SES_封面文件编号" \\* MERGEFORMAT', cachedStdCode)}</w:p>`
  return XML_DECL + wrapElement('w:hdr', paragraph, HDR_FTR_NS)
}

/** word/footer1.xml（单数页，ind right=227）、word/footer2.xml（双数页，ind left=227） */
function buildFooterXml(align: Align): string {
  const indAttr = align === 'right' ? '<w:ind w:right="227"/>' : '<w:ind w:left="227"/>'
  const pprXml = pPr([
    ['pStyle', '<w:pStyle w:val="SesFooter"/>'],
    ['ind', indAttr],
    ['jc', `<w:jc w:val="${align}"/>`],
  ])
  const paragraph = `<w:p>${pprXml}${fieldXml('PAGE', '1')}</w:p>`
  return XML_DECL + wrapElement('w:ftr', paragraph, HDR_FTR_NS)
}

export interface HeaderFooterParts {
  header1: string
  header2: string
  footer1: string
  footer2: string
}

/**
 * 生成四个页眉页脚部件（§2.3）。`stdCodeCached` 是 STYLEREF 域的缓存结果文字（`meta.stdCode`，
 * 缺失写空串）；Word 渲染时会重算该域，缓存值只影响不重算域的阅读器，不影响 Word 显示。
 */
export function buildHeaderFooterParts(stdCodeCached: string): HeaderFooterParts {
  return {
    header1: buildHeaderXml('right', stdCodeCached),
    header2: buildHeaderXml('left', stdCodeCached),
    footer1: buildFooterXml('right'),
    footer2: buildFooterXml('left'),
  }
}
