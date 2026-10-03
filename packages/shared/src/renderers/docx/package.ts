/**
 * DOCX 包组装（docs/wp7-docx-delivery.md §9 WP7.1「shared 骨架」）。
 *
 * `buildPackage` 把 `word/document.xml` 全文与可选部件（styles、numbering、页眉页脚、media）
 * 组装成完整的 DocxPackage：`[Content_Types].xml`、`_rels/.rels`、`word/_rels/document.xml.rels`、
 * `word/settings.xml`（§2.4）、`word/fontTable.xml`、`docProps/core.xml`、`docProps/app.xml` 都在这里生成。
 * 本模块只负责「打包」，不负责渲染 document.xml/styles.xml/numbering.xml 的内容——那是
 * body/*.ts、styles.ts、numbering.ts、sections.ts（WP7.2 起）的职责；也不负责把 DocxPackage
 * 压成 zip——那是宿主用 JSZip 做的事（§1.1 数据流，不变式 1）。
 *
 * 同构纯 TypeScript：不读系统时钟（createdAt 由调用方传入，见不变式 3）、不用 JSZip/Blob。
 */

import { CHAR_WIDTH_TWIPS } from './units'
import { escapeXmlAttr, escapeXmlText, joinOrderedChildren, wrapElement, type XmlChild } from './xml'
import type { DocxPackage } from './types'

const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships/'
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/**
 * 关系 ID 分配器：调用方（渲染器）在组装 document.xml 时用它申请 rId1、rId2……写入
 * document.xml 里对应元素的 r:id 属性；申请到的 ID 随后要通过 DocxRelatedPart 带回来，
 * 交给 buildPackage 登记进 word/_rels/document.xml.rels。
 * styles、settings、fontTable、numbering 的关系不经过这个分配器，由 buildPackage 在打包时
 * 用接着的 ID 自动登记（见 buildPackage 内部的 nextIdAfter）。
 */
export function createRelationshipIdAllocator(): () => string {
  let n = 0
  return () => {
    n += 1
    return `rId${n}`
  }
}

/** 页眉页脚、图片等「document.xml 里已经写了 r:id 引用」的关联部件 */
export interface DocxRelatedPart {
  /** 由 createRelationshipIdAllocator() 申请、且已写入 document.xml 对应 r:id 属性的关系 ID */
  id: string
  /** 包内路径（相对包根），如 word/header1.xml、word/media/image1.png */
  target: string
  /** 关系类型 URI（如 `${REL}header`、`${REL}image`） */
  relationshipType: string
  /** 部件内容：XML 部件传 UTF-8 文本；二进制部件（图片等）传 base64 字符串 */
  content: string
  /**
   * true 表示二进制部件：写入 DocxPackage.binaries，[Content_Types].xml 按扩展名登记 Default。
   * false/省略表示 XML 部件：写入 DocxPackage.parts，按 PartName 登记 Override，此时必须提供 contentType。
   */
  binary?: boolean
  /** XML 部件的 [Content_Types].xml Override 内容类型；binary 部件可省略（按扩展名查内置表） */
  contentType?: string
}

export interface DocxPackageInput {
  /** word/document.xml 全文（含 XML 声明），由调用方组装好；body 内的 r:id 已经和 relatedParts 对应 */
  documentXml: string
  /** docProps 标题（写入 docProps/core.xml 的 dc:title） */
  title: string
  /** docProps/core.xml 创建、修改时间（ISO，来自宿主，不读系统时间，见不变式 3） */
  createdAt: string
  /** word/styles.xml 全文；不提供则不生成该部件，也不登记关系 */
  stylesXml?: string
  /** word/numbering.xml 全文；不提供则不生成该部件，也不登记关系 */
  numberingXml?: string
  /** 页眉页脚、图片等关联部件（顺序即分配 ID 时的调用顺序） */
  relatedParts?: readonly DocxRelatedPart[]
}

/** 用 Map 而不是 plain object：plain object 按外部扩展名字符串查找会命中 Object.prototype
 * 上的属性（如扩展名恰好是 "constructor" 时），让未知扩展名绕过下面的报错分支。 */
const BINARY_CONTENT_TYPES = new Map<string, string>([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['tiff', 'image/tiff'],
])

function extensionOf(target: string): string {
  const i = target.lastIndexOf('.')
  return i === -1 ? '' : target.slice(i + 1).toLowerCase()
}

/** word/ 前缀的部件路径 → 相对 word/_rels/document.xml.rels 所在目录的相对路径 */
function relativeToWordDir(target: string): string {
  return target.startsWith('word/') ? target.slice('word/'.length) : target
}

/** 归一化 ISO 时间：去掉毫秒，统一为 YYYY-MM-DDThh:mm:ssZ（与 Word 自己写 docProps/core.xml 的格式一致） */
function normalizeIsoSeconds(iso: string): string {
  return iso.replace(/\.\d+(?=Z$)/, '')
}

/** 在给定的已用 ID（"rId7" 形式）之后继续分配，避免和调用方已经用掉的 ID 冲突 */
function nextIdAfter(usedIds: readonly string[]): () => string {
  let max = 0
  for (const id of usedIds) {
    const m = /^rId(\d+)$/.exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  let n = max
  return () => {
    n += 1
    return `rId${n}`
  }
}

interface Rel {
  id: string
  type: string
  target: string
}

function relationshipsXml(rels: readonly Rel[]): string {
  const body = rels
    .map((r) => `<Relationship Id="${escapeXmlAttr(r.id)}" Type="${escapeXmlAttr(r.type)}" Target="${escapeXmlAttr(r.target)}"/>`)
    .join('')
  return `${XML_DECL}<Relationships xmlns="${RELS_NS}">${body}</Relationships>`
}

interface ContentTypeOverride {
  partName: string
  contentType: string
}

function contentTypesXml(binaryExtensions: ReadonlyMap<string, string>, overrides: readonly ContentTypeOverride[]): string {
  const defaults =
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    Array.from(binaryExtensions.entries())
      .map(([ext, ct]) => `<Default Extension="${escapeXmlAttr(ext)}" ContentType="${escapeXmlAttr(ct)}"/>`)
      .join('')
  const overrideXml = overrides
    .map((o) => `<Override PartName="/${escapeXmlAttr(o.partName)}" ContentType="${escapeXmlAttr(o.contentType)}"/>`)
    .join('')
  return `${XML_DECL}<Types xmlns="${CT_NS}">${defaults}${overrideXml}</Types>`
}

/** word/settings.xml：§2.4 全文固定输出，走 xml.ts 的附录 B 顺序拼接（不手写顺序） */
function settingsXml(includeFootnotes: boolean): string {
  const children: XmlChild[] = [
    ['mirrorMargins', '<w:mirrorMargins/>'],
    ['defaultTabStop', `<w:defaultTabStop w:val="${2 * CHAR_WIDTH_TWIPS}"/>`],
    ['evenAndOddHeaders', '<w:evenAndOddHeaders/>'],
    ['characterSpacingControl', '<w:characterSpacingControl w:val="compressPunctuation"/>'],
    ['updateFields', '<w:updateFields w:val="true"/>'],
    ...(includeFootnotes
      ? [[
          'footnotePr',
          '<w:footnotePr><w:pos w:val="pageBottom"/><w:numFmt w:val="decimal"/>' +
            '<w:numStart w:val="1"/><w:numRestart w:val="continuous"/>' +
            '<w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>',
        ] as const]
      : []),
    [
      'compat',
      '<w:compat><w:compatSetting w:name="compatibilityMode" ' +
        'w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>',
    ],
    [
      'm:mathPr',
      '<m:mathPr><m:mathFont m:val="Cambria Math"/><m:smallFrac m:val="0"/><m:dispDef/>' +
        '<m:intLim m:val="subSup"/><m:naryLim m:val="undOvr"/></m:mathPr>',
    ],
  ]
  const el = wrapElement('w:settings', joinOrderedChildren('settings', children), {
    'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'xmlns:m': 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  })
  return XML_DECL + el
}

/** word/fontTable.xml：登记宋体、黑体、Times New Roman、Cambria Math */
function fontTableXml(): string {
  const font = (name: string, charset: string, family: string) =>
    `<w:font w:name="${escapeXmlAttr(name)}"><w:charset w:val="${charset}"/>` +
    `<w:family w:val="${family}"/><w:pitch w:val="variable"/></w:font>`
  const fonts =
    font('宋体', '86', 'auto') + font('黑体', '86', 'auto') + font('Times New Roman', '00', 'roman') + font('Cambria Math', '00', 'roman')
  const NS =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  return `${XML_DECL}<w:fonts ${NS}>${fonts}</w:fonts>`
}

/** docProps/core.xml：created/modified 都取 createdAt，带 xsi:type="dcterms:W3CDTF" */
function corePropsXml(title: string, createdAtSeconds: string): string {
  const NS =
    'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
  const createdText = escapeXmlText(createdAtSeconds)
  const body =
    `<dc:title>${escapeXmlText(title)}</dc:title>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${createdText}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${createdText}</dcterms:modified>`
  return `${XML_DECL}<cp:coreProperties ${NS}>${body}</cp:coreProperties>`
}

/** docProps/app.xml：Application 固定写 SES */
function appPropsXml(): string {
  const NS = 'xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"'
  return `${XML_DECL}<Properties ${NS}><Application>SES</Application></Properties>`
}

export function buildPackage(input: DocxPackageInput): DocxPackage {
  const parts: Record<string, string> = {}
  const binaries: Record<string, string> = {}
  const warnings: DocxPackage['warnings'] = []

  const relatedParts = input.relatedParts ?? []
  const docRels: Rel[] = []
  const overrides: ContentTypeOverride[] = []
  const binaryExtensions = new Map<string, string>()

  parts['word/document.xml'] = input.documentXml

  // ---- 页眉页脚、图片……（调用方已经分配好 ID 并写进 document.xml）----
  for (const rel of relatedParts) {
    docRels.push({ id: rel.id, type: rel.relationshipType, target: relativeToWordDir(rel.target) })
    if (rel.binary) {
      binaries[rel.target] = rel.content
      const ext = extensionOf(rel.target)
      const ct = rel.contentType ?? BINARY_CONTENT_TYPES.get(ext)
      if (!ct) throw new Error(`buildPackage: 无法确定二进制部件 "${rel.target}" 的内容类型（未知扩展名 "${ext}"）`)
      binaryExtensions.set(ext, ct)
    } else {
      if (!rel.contentType) throw new Error(`buildPackage: XML 部件 "${rel.target}" 缺少 contentType`)
      parts[rel.target] = rel.content
      overrides.push({ partName: rel.target, contentType: rel.contentType })
    }
  }

  // ---- styles、settings、fontTable、numbering：最后自动登记，接着调用方已用的 ID 往下发 ----
  const nextAutoId = nextIdAfter(relatedParts.map((r) => r.id))

  if (input.stylesXml !== undefined) {
    parts['word/styles.xml'] = input.stylesXml
    overrides.push({ partName: 'word/styles.xml', contentType: `${WML}styles+xml` })
    docRels.push({ id: nextAutoId(), type: `${REL}styles`, target: 'styles.xml' })
  }

  parts['word/settings.xml'] = settingsXml(relatedParts.some((rel) => rel.target === 'word/footnotes.xml'))
  overrides.push({ partName: 'word/settings.xml', contentType: `${WML}settings+xml` })
  docRels.push({ id: nextAutoId(), type: `${REL}settings`, target: 'settings.xml' })

  parts['word/fontTable.xml'] = fontTableXml()
  overrides.push({ partName: 'word/fontTable.xml', contentType: `${WML}fontTable+xml` })
  docRels.push({ id: nextAutoId(), type: `${REL}fontTable`, target: 'fontTable.xml' })

  if (input.numberingXml !== undefined) {
    parts['word/numbering.xml'] = input.numberingXml
    overrides.push({ partName: 'word/numbering.xml', contentType: `${WML}numbering+xml` })
    docRels.push({ id: nextAutoId(), type: `${REL}numbering`, target: 'numbering.xml' })
  }

  // ---- docProps ----
  const createdAt = normalizeIsoSeconds(input.createdAt)
  parts['docProps/core.xml'] = corePropsXml(input.title, createdAt)
  parts['docProps/app.xml'] = appPropsXml()

  // ---- 关系与内容类型 ----
  parts['word/_rels/document.xml.rels'] = relationshipsXml(docRels)
  parts['_rels/.rels'] = relationshipsXml([
    { id: 'rId1', type: `${REL}officeDocument`, target: 'word/document.xml' },
    { id: 'rId2', type: `${PKG_REL}metadata/core-properties`, target: 'docProps/core.xml' },
    { id: 'rId3', type: `${REL}extended-properties`, target: 'docProps/app.xml' },
  ])
  parts['[Content_Types].xml'] = contentTypesXml(binaryExtensions, [
    { partName: 'word/document.xml', contentType: `${WML}document.main+xml` },
    ...overrides,
    { partName: 'docProps/core.xml', contentType: 'application/vnd.openxmlformats-package.core-properties+xml' },
    { partName: 'docProps/app.xml', contentType: 'application/vnd.openxmlformats-officedocument.extended-properties+xml' },
  ])

  return { parts, binaries, warnings }
}
