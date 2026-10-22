/**
 * XML 序列化器
 * 将 ProseMirror 文档结构序列化为 GB/T 37967-2019 兼容的 XML
 *
 * GB/T 37967-2019《标准文献的XML标记》基于 NISO STS (Standards Tag Suite)，
 * 核心结构：<standard> → <front> + <body> + <back>
 */

import type { Node as PMNode } from '@tiptap/pm/model'
import { UnsupportedOutputError, assertOutputSupported, pmToIr, resolve, type OutputSupportProblem, type PMJsonNode, type ResolvedLabel } from '@ses/shared'
import { normalizePageOrientation } from '../utils/orientation'

let activeFootnoteLabels: Record<string, ResolvedLabel> = {}
let activeXmlReferenceContext: XmlReferenceContext | undefined

interface XmlTargetDefinition {
  xmlId: string
  stableId?: string
  legacyIds: string[]
  emittedXmlId?: string
  emittedDefinitionCount: number
}

interface XmlReferenceContext {
  hasResolver: boolean
  labels?: Record<string, ResolvedLabel>
  definitionsByNode: WeakMap<PMNode, XmlTargetDefinition>
  byStableId: Map<string, XmlTargetDefinition[]>
  byLegacyId: Map<string, XmlTargetDefinition[]>
  byXmlId: Map<string, XmlTargetDefinition[]>
  emittedIdCounts: Map<string, number>
  emittedRids: Set<string>
  resolvedReferences: { rid: string; target?: XmlTargetDefinition }[]
}

export class XmlFootnoteValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XmlFootnoteValidationError'
  }
}

export class XmlCrossRefValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XmlCrossRefValidationError'
  }
}

/** 缩进辅助 */
function indent(depth: number): string {
  return '  '.repeat(depth)
}

/** XML 特殊字符转义 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 构建 XML 属性字符串 */
function buildAttrs(attrs: Record<string, string | number | boolean | null | undefined>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null && value !== '') {
      const renderedValue = String(value)
      const context = activeXmlReferenceContext
      if (context && key === 'id') {
        context.emittedIdCounts.set(renderedValue, (context.emittedIdCounts.get(renderedValue) ?? 0) + 1)
      } else if (context && key === 'rid') {
        context.emittedRids.add(renderedValue)
      }
      parts.push(`${key}="${escapeXml(renderedValue)}"`)
    }
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : ''
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function mapDefinition(
  context: XmlReferenceContext,
  node: PMNode,
  fallbackXmlId?: unknown,
  legacyAliases: unknown[] = [],
): void {
  const stableId = nonEmptyString(node.attrs.nodeId)
  const resolvedXmlId = stableId ? nonEmptyString(context.labels?.[stableId]?.xmlId) : undefined
  const xmlId = resolvedXmlId ?? nonEmptyString(fallbackXmlId)
  if (!xmlId) return

  const definition: XmlTargetDefinition = {
    xmlId,
    ...(resolvedXmlId && stableId ? { stableId } : {}),
    legacyIds: legacyAliases.map(nonEmptyString).filter((value): value is string => value !== undefined),
    emittedDefinitionCount: 0,
  }
  context.definitionsByNode.set(node, definition)
  const add = (index: Map<string, XmlTargetDefinition[]>, key: string | undefined) => {
    if (!key) return
    const entries = index.get(key) ?? []
    entries.push(definition)
    index.set(key, entries)
  }
  add(context.byStableId, definition.stableId)
  for (const legacyId of definition.legacyIds) add(context.byLegacyId, legacyId)
  add(context.byXmlId, definition.xmlId)
}

/** The tree scan records possible targets; only IDs actually emitted below can satisfy a reference. */
function createXmlReferenceContext(
  doc: PMNode,
  labels?: Record<string, ResolvedLabel>,
): XmlReferenceContext {
  const context: XmlReferenceContext = {
    hasResolver: labels !== undefined,
    ...(labels === undefined ? {} : { labels }),
    definitionsByNode: new WeakMap(),
    byStableId: new Map(),
    byLegacyId: new Map(),
    byXmlId: new Map(),
    emittedIdCounts: new Map(),
    emittedRids: new Set(),
    resolvedReferences: [],
  }

  const walk = (node: PMNode): void => {
    const rawId = nonEmptyString(node.attrs.id)
    const resolverId = nonEmptyString(context.labels?.[nonEmptyString(node.attrs.nodeId) ?? '']?.xmlId)
    if (resolverId || rawId) mapDefinition(context, node, resolverId ?? rawId, [rawId])
    node.forEach(child => walk(child))
  }
  walk(doc)
  return context
}

function xmlDefinitionId(node: PMNode, fallback?: unknown): string | undefined {
  const stableId = nonEmptyString(node.attrs.nodeId)
  const resolvedId = stableId
    ? nonEmptyString(activeXmlReferenceContext?.labels?.[stableId]?.xmlId)
    : undefined
  const xmlId = resolvedId ?? nonEmptyString(fallback)
  if (xmlId) {
    const definition = activeXmlReferenceContext?.definitionsByNode.get(node)
    if (definition) {
      definition.emittedXmlId = xmlId
      definition.emittedDefinitionCount += 1
    }
  }
  return xmlId
}

function recordEmittedDefinitionByStableId(nodeIdValue: unknown, xmlId: string): void {
  const nodeId = nonEmptyString(nodeIdValue)
  const context = activeXmlReferenceContext
  if (!nodeId || !context?.hasResolver) return
  const matches = uniqueDefinitions(context.byStableId.get(nodeId)).filter(definition => definition.xmlId === xmlId)
  if (matches.length !== 1) return
  matches[0]!.emittedXmlId = xmlId
  matches[0]!.emittedDefinitionCount += 1
}

function uniqueDefinitions(entries: XmlTargetDefinition[] | undefined): XmlTargetDefinition[] {
  return [...new Set(entries ?? [])]
}

function assertNonEmptyCrossRefTargets(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNonEmptyCrossRefTargets)
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (record.type === 'text' && Array.isArray(record.marks)) {
    for (const mark of record.marks) {
      if (!mark || typeof mark !== 'object' || (mark as Record<string, unknown>).type !== 'crossRef') continue
      const attrs = (mark as { attrs?: Record<string, unknown> }).attrs
      const hasTargetId = attrs?.targetId !== null && attrs?.targetId !== undefined
      const selected = hasTargetId ? attrs?.targetId : attrs?.refId
      if (typeof selected !== 'string' || selected.length === 0) {
        throw new XmlCrossRefValidationError(hasTargetId
          ? '交叉引用目标为空；空 targetId 不回退到 refId。'
          : '旧交叉引用缺少 refId，不能生成无目标的 xref。')
      }
    }
  }
  Object.values(record).forEach(assertNonEmptyCrossRefTargets)
}

function resolveCrossRefXmlId(attrs: Record<string, unknown> | undefined): string {
  const hasTargetId = attrs?.targetId !== null && attrs?.targetId !== undefined
  const selected = hasTargetId ? attrs?.targetId : attrs?.refId
  if (typeof selected !== 'string' || selected.length === 0) {
    throw new XmlCrossRefValidationError(hasTargetId
      ? '交叉引用目标为空；空 targetId 不回退到 refId。'
      : '旧交叉引用缺少 refId，不能生成无目标的 xref。')
  }

  const context = activeXmlReferenceContext
  if (!context?.hasResolver) {
    if (hasTargetId) {
      throw new XmlCrossRefValidationError(`交叉引用目标「${selected}」需要 Resolver 才能映射为 XML id。`)
    }
    // Minimal legacy PMNode-shaped callers have no stable-ID space. Keep their explicit
    // refId verbatim instead of pretending it was Resolver-mapped.
    return selected
  }

  let candidates: XmlTargetDefinition[]
  if (hasTargetId) {
    candidates = uniqueDefinitions(context.byStableId.get(selected))
  } else {
    candidates = uniqueDefinitions([
      ...(context.byStableId.get(selected) ?? []),
      ...(context.byLegacyId.get(selected) ?? []),
      ...(context.byXmlId.get(selected) ?? []),
    ])
  }

  if (candidates.length === 0) {
    if (!hasTargetId) {
      // Older schema trees may refer directly to a legacy emitted id without nodeId/attrs.id.
      // Keep the spelling and let the actual serialized ID inventory decide whether it exists.
      context.resolvedReferences.push({ rid: selected })
      return selected
    }
    throw new XmlCrossRefValidationError(`交叉引用目标「${selected}」未找到稳定 ID 映射，不能生成 XML 引用。`)
  }
  if (candidates.length > 1) {
    throw new XmlCrossRefValidationError(`交叉引用 refId「${selected}」同时匹配多个定义，目标有歧义。`)
  }

  const target = candidates[0]!
  const sameXmlId = uniqueDefinitions(context.byXmlId.get(target.xmlId))
  if (sameXmlId.length !== 1) {
    throw new XmlCrossRefValidationError(`交叉引用目标的 XML id「${target.xmlId}」重复，无法唯一定位。`)
  }
  context.resolvedReferences.push({ rid: target.xmlId, target })
  return target.xmlId
}

function validateEmittedXmlReferences(context: XmlReferenceContext): void {
  if (!context.hasResolver) return
  for (const rid of context.emittedRids) {
    const count = context.emittedIdCounts.get(rid) ?? 0
    if (count !== 1) {
      throw new XmlCrossRefValidationError(count === 0
        ? `交叉引用目标「${rid}」未在当前 XML 输出中出现；旧 XML 没有可承载该目标的 id 属性，请保留 JSON 并等待 WP8 转换。`
        : `交叉引用目标的 XML id「${rid}」在当前输出中重复，无法唯一定位。`)
    }
  }
  for (const { rid, target } of context.resolvedReferences) {
    const count = context.emittedIdCounts.get(rid) ?? 0
    if (count !== 1) {
      throw new XmlCrossRefValidationError(count === 0
        ? `交叉引用目标「${rid}」未在当前 XML 输出中出现；旧 XML 没有可承载该目标的 id 属性，请保留 JSON 并等待 WP8 转换。`
        : `交叉引用目标的 XML id「${rid}」在当前输出中重复，无法唯一定位。`)
    }
    if (target && (target.emittedDefinitionCount !== 1 || target.emittedXmlId !== rid)) {
      throw new XmlCrossRefValidationError(`交叉引用目标「${rid}」没有作为其定义出现在当前 XML 输出中，请保留 JSON 并等待 WP8 转换。`)
    }
  }
}

/**
 * 将 ProseMirror 文档序列化为 GB/T 37967-2019 XML
 */
export function serializeToXml(doc: PMNode): string {
  const previousLabels = activeFootnoteLabels
  const previousReferenceContext = activeXmlReferenceContext
  try {
    // A few serializer unit tests and callers provide a minimal PMNode-shaped tree without
    // ProseMirror's toJSON(). Keep those legacy callers working; production editor nodes always
    // take the resolver-backed path so footnote numbering and XML IDs remain shared.
    if (typeof doc.toJSON === 'function') {
      const pmJson = doc.toJSON() as PMJsonNode
      assertNonEmptyCrossRefTargets(pmJson)
      const { doc: irDoc } = pmToIr(pmJson)
      // WP6 new authoring semantics must not be dropped by the old XML path pending WP8.
      const resolved = resolve(irDoc)
      const errors = resolved.problems.filter(problem =>
        problem.severity === 'error' && ['dangling-footnote', 'unreferenced-footnote', 'invalid-footnote'].includes(problem.code))
      if (errors.length) {
        throw new XmlFootnoteValidationError(`脚注校验未通过，不能生成 XML：${[...new Set(errors.map(problem => problem.message))].join('；')}`)
      }
      activeFootnoteLabels = resolved.labels
      activeXmlReferenceContext = createXmlReferenceContext(doc, resolved.labels)
      assertOutputSupported(irDoc, 'XML')
      // These shapes pass through IR's broad authoring contract, but this legacy serializer
      // does not consume them. Keep provenance here so legacy formulaDescription remains exportable.
      const unsupported: OutputSupportProblem[] = []
      const addUnsupported = (node: PMNode, path: string, message: string, fallbackId?: unknown): void => {
        const id = node.attrs.nodeId ?? node.attrs.id ?? fallbackId
        unsupported.push({
          code: 'unsupported-output',
          ...(typeof id === 'string' ? { nodeId: id } : {}),
          path,
          message: `${message} 请保留 JSON 文档并等待 WP8 转换。`,
        })
      }
      const legacyChapters = irDoc.body.filter(block => block.kind === 'chapter')
      let chapterIndex = 0
      const checkUnsupportedLegacyXmlShapes = (node: PMNode, path: string): void => {
        if (node.type.name === 'chapter') {
          const chapter = legacyChapters[chapterIndex++]
          const explicitSecType = node.attrs.secType
          if (chapter && typeof explicitSecType === 'string'
            && ['scope', 'norm-refs', 'terms', 'general'].includes(explicitSecType)) {
            const title = chapter.title.map(inline => inline.text).join('').trim()
            const inferredSecType = title === '范围' ? 'scope'
              : title === '规范性引用文件' ? 'norm-refs'
                : title === '术语和定义' ? 'terms' : 'general'
            if (explicitSecType !== inferredSecType) {
              addUnsupported(node, `${path}.attrs.secType`, `XML 不保存显式章角色；按标题重新导入会得到「${inferredSecType}」而不是「${explicitSecType}」。`)
            }
          }
        }
        // WP8.M G7-b：块内容的注/示例（多段、含列项）。旧序列化器按「未知块」递归输出子段落，会丢掉注/示例的外层包装与标签，
        // 因此在 WP8.2 的新导出器接手前整体阻断，而不是静默拍平成普通段落。
        if (node.type.name === 'noteBlock' || node.type.name === 'exampleBlock') {
          addUnsupported(node, path, `XML 暂未支持块内容的${node.type.name === 'noteBlock' ? '注' : '示例'}（多段或含列项）。`)
        }
        if (node.type.name === 'termSource' && node.childCount > 0) {
          addUnsupported(node, path, 'XML 暂未支持独立的术语来源节点。')
        }
        if (node.type.name === 'formula') {
          node.forEach((child, _offset, index) => {
            if (child.type.name === 'whereList' && child.childCount > 0) {
              const formulaId = node.attrs.nodeId ?? node.attrs.id
              addUnsupported(child, `${path}.content[${index}]`, 'XML 暂未支持类型化的公式式中列表。', formulaId)
            }
          })
        }
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          node.forEach((child, _offset, index) => {
            if (!child.isTextblock || !['paragraph', 'stdParagraph'].includes(child.type.name)) {
              const cellId = node.attrs.nodeId ?? node.attrs.id
              addUnsupported(child, `${path}.content[${index}]`, `XML 暂未支持表格单元格中的块「${child.type.name}」。`, cellId)
            }
          })
        }
        node.forEach((child, _offset, index) => checkUnsupportedLegacyXmlShapes(child, `${path}.content[${index}]`))
      }
      checkUnsupportedLegacyXmlShapes(doc, 'pm')
      if (unsupported.length > 0) throw new UnsupportedOutputError(unsupported)
    } else {
      // Minimal legacy trees have no Resolver context. Never invent IDs/labels for footnotes.
      const hasFootnote = (node: PMNode): boolean => {
        if (['footnoteRef', 'tableFootnoteRef', 'tableFootnoteEntry'].includes(node.type.name)) return true
        if (node.isText || typeof node.forEach !== 'function') return false
        let found = false
        node.forEach(child => { if (hasFootnote(child)) found = true })
        return found
      }
      if (hasFootnote(doc)) throw new XmlFootnoteValidationError('脚注 XML 序列化需要可验证的完整文档，不能使用缺少 toJSON 的文档树。')
      activeFootnoteLabels = {}
      activeXmlReferenceContext = createXmlReferenceContext(doc)
    }

    const xml = serializeXmlDocument(doc)
    const referenceContext = activeXmlReferenceContext
    if (referenceContext) validateEmittedXmlReferences(referenceContext)
    return xml
  } finally {
    activeFootnoteLabels = previousLabels
    activeXmlReferenceContext = previousReferenceContext
  }
}

function serializeXmlDocument(doc: PMNode): string {
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<standard xmlns="urn:csbts:std:xml:1.0">')

  // 收集文档各部分
  const frontNodes: PMNode[] = []   // coverPage
  const forewordNode: PMNode | null = findChild(doc, 'foreword')
  const introNode: PMNode | null = findChild(doc, 'introduction')
  const chapters: PMNode[] = []
  const appendices: PMNode[] = []
  let bibliographyNode: PMNode | null = null
  const coverNode: PMNode | null = findChild(doc, 'coverPage')

  doc.forEach((child) => {
    switch (child.type.name) {
      case 'coverPage':
        frontNodes.push(child)
        break
      case 'chapter':
        chapters.push(child)
        break
      case 'appendix':
        appendices.push(child)
        break
      case 'bibliography':
        bibliographyNode = child
        break
    }
  })

  // === <front> ===
  lines.push(`${indent(1)}<front>`)
  serializeFront(lines, doc, coverNode, 2)
  lines.push(`${indent(1)}</front>`)

  // === <body> ===
  lines.push(`${indent(1)}<body>`)

  // 前言
  if (forewordNode) {
    serializeForeword(lines, forewordNode, 2)
  }

  // 引言
  if (introNode) {
    serializeIntroduction(lines, introNode, 2)
  }

  // 章
  let chapterNum = 0
  const clauseCounters = [0, 0, 0, 0, 0]
  for (const chapter of chapters) {
    chapterNum++
    clauseCounters.fill(0)
    serializeChapter(lines, chapter, chapterNum, clauseCounters, 2)
  }

  lines.push(`${indent(1)}</body>`)

  // === <back> ===
  if (appendices.length > 0 || bibliographyNode) {
    lines.push(`${indent(1)}<back>`)

    // 附录
    if (appendices.length > 0) {
      lines.push(`${indent(2)}<app-group>`)
      let appIndex = 0
      for (const appendix of appendices) {
        appIndex++
        const letter = String.fromCharCode(64 + appIndex)
        serializeAppendix(lines, appendix, letter, 3)
      }
      lines.push(`${indent(2)}</app-group>`)
    }

    // 参考文献
    if (bibliographyNode) {
      serializeBibliography(lines, bibliographyNode, 2)
    }

    lines.push(`${indent(1)}</back>`)
  }

  lines.push('</standard>')
  return lines.join('\n')
}

// ========== 各节点序列化函数 ==========

/** 序列化 <front> 元数据 */
function serializeFront(lines: string[], doc: PMNode, coverNode: PMNode | null, depth: number) {
  const attrs = doc.attrs
  lines.push(`${indent(depth)}<std-meta>`)

  // 标准编号
  if (attrs.standardNo || coverNode?.attrs.standardNo) {
    const no = attrs.standardNo || coverNode?.attrs.standardNo
    lines.push(`${indent(depth + 1)}<std-ref>${escapeXml(no)}</std-ref>`)
  }

  // 标准标识
  if (attrs.icsCode || attrs.ccsCode || coverNode?.attrs.icsCode || coverNode?.attrs.ccsCode) {
    lines.push(`${indent(depth + 1)}<std-ident>`)
    const ics = attrs.icsCode || coverNode?.attrs.icsCode
    const ccs = attrs.ccsCode || coverNode?.attrs.ccsCode
    if (ics) lines.push(`${indent(depth + 2)}<ics>${escapeXml(ics)}</ics>`)
    if (ccs) lines.push(`${indent(depth + 2)}<ccs>${escapeXml(ccs)}</ccs>`)
    lines.push(`${indent(depth + 1)}</std-ident>`)
  }

  // 标题
  const titleCn = attrs.titleCn || coverNode?.attrs.titleCn
  const titleEn = attrs.titleEn || coverNode?.attrs.titleEn
  if (titleCn) {
    lines.push(`${indent(depth + 1)}<title-wrap lang="zh">`)
    lines.push(`${indent(depth + 2)}<main>${escapeXml(titleCn)}</main>`)
    lines.push(`${indent(depth + 1)}</title-wrap>`)
  }
  if (titleEn) {
    lines.push(`${indent(depth + 1)}<title-wrap lang="en">`)
    lines.push(`${indent(depth + 2)}<main>${escapeXml(titleEn)}</main>`)
    lines.push(`${indent(depth + 1)}</title-wrap>`)
  }

  // 日期
  const pubDate = attrs.publishDate || coverNode?.attrs.publishDate
  const implDate = attrs.implementDate || coverNode?.attrs.implementDate
  if (pubDate) lines.push(`${indent(depth + 1)}<pub-date>${escapeXml(pubDate)}</pub-date>`)
  if (implDate) lines.push(`${indent(depth + 1)}<release-date>${escapeXml(implDate)}</release-date>`)

  // 标准类型
  const standardType = attrs.standardType || coverNode?.attrs.standardType
  if (standardType) {
    lines.push(`${indent(depth + 1)}<std-type>${escapeXml(standardType)}</std-type>`)
  }

  // 发布机构
  const issuer = coverNode?.attrs.issuer
  if (issuer) {
    lines.push(`${indent(depth + 1)}<std-org>`)
    lines.push(`${indent(depth + 2)}<std-org-name>${escapeXml(issuer)}</std-org-name>`)
    lines.push(`${indent(depth + 1)}</std-org>`)
  }

  // SES-only cover metadata uses the STS custom-meta escape hatch; existing std-meta elements stay unchanged.
  const coverMetaValue = (key: string): string | undefined => {
    const coverValue = coverNode?.attrs[key]
    if (typeof coverValue === 'string' && coverValue !== '') return coverValue
    const rootValue = attrs[key]
    return typeof rootValue === 'string' && rootValue !== '' ? rootValue : undefined
  }
  const coverMetadata = [
    ['replaces', coverMetaValue('replaces')],
    ['consistency', coverMetaValue('consistency')],
    ['filingNo', coverMetaValue('filingNo')],
    ['industryName', coverMetaValue('industryName')],
    ['regionName', coverMetaValue('regionName')],
    ['coverDesignation', coverMetaValue('coverDesignation')],
  ].filter((entry): entry is [string, string] => entry[1] !== undefined)
  if (coverMetadata.length > 0) {
    lines.push(`${indent(depth + 1)}<custom-meta-group content-type="ses-cover">`)
    for (const [name, value] of coverMetadata) {
      lines.push(`${indent(depth + 2)}<custom-meta>`)
      lines.push(`${indent(depth + 3)}<meta-name>${name}</meta-name>`)
      lines.push(`${indent(depth + 3)}<meta-value>${escapeXml(value)}</meta-value>`)
      lines.push(`${indent(depth + 2)}</custom-meta>`)
    }
    lines.push(`${indent(depth + 1)}</custom-meta-group>`)
  }

  lines.push(`${indent(depth)}</std-meta>`)
}

/** 序列化前言 */
function serializeForeword(lines: string[], node: PMNode, depth: number) {
  lines.push(`${indent(depth)}<foreword>`)
  serializeBlockChildren(lines, node, depth + 1)
  lines.push(`${indent(depth)}</foreword>`)
}

/** 序列化引言 */
function serializeIntroduction(lines: string[], node: PMNode, depth: number) {
  lines.push(`${indent(depth)}<intro>`)
  serializeBlockChildren(lines, node, depth + 1)
  lines.push(`${indent(depth)}</intro>`)
}

/** 序列化章 */
function serializeChapter(
  lines: string[],
  node: PMNode,
  chapterNum: number,
  clauseCounters: number[],
  depth: number,
) {
  const id = xmlDefinitionId(node, node.attrs.id || `sec_${chapterNum}`) || `sec_${chapterNum}`
  lines.push(`${indent(depth)}<sec${buildAttrs({ id })}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'chapterTitle':
        lines.push(`${indent(depth + 1)}<title>${serializeInlineContent(child)}</title>`)
        break
      case 'clause':
        serializeClause(lines, child, chapterNum, clauseCounters, depth + 1)
        break
      case 'termDef':
        serializeTermDef(lines, child, chapterNum, clauseCounters, depth + 1)
        break
      default:
        serializeBlockNode(lines, child, depth + 1)
        break
    }
  })

  lines.push(`${indent(depth)}</sec>`)
}

/** 序列化条 */
function serializeClause(
  lines: string[],
  node: PMNode,
  chapterNum: number,
  clauseCounters: number[],
  depth: number,
) {
  const level = node.attrs.level || 1
  clauseCounters[level - 1]++
  for (let i = level; i < 5; i++) clauseCounters[i] = 0

  const numParts = [chapterNum, ...clauseCounters.slice(0, level)]
  const numStr = numParts.join('.')
  const id = xmlDefinitionId(node, node.attrs.id || `sec_${numStr}`) || `sec_${numStr}`
  const hasTitle = node.attrs.hasTitle !== false

  const attrs: Record<string, string | number | boolean | null> = { id }
  if (!hasTitle) attrs['content-type'] = 'untitled'

  lines.push(`${indent(depth)}<sec${buildAttrs(attrs)}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'clauseTitle':
        lines.push(`${indent(depth + 1)}<title>${serializeInlineContent(child)}</title>`)
        break
      case 'clause':
        serializeClause(lines, child, chapterNum, clauseCounters, depth + 1)
        break
      case 'termDef':
        serializeTermDef(lines, child, chapterNum, clauseCounters, depth + 1)
        break
      default:
        serializeBlockNode(lines, child, depth + 1)
        break
    }
  })

  lines.push(`${indent(depth)}</sec>`)
}

/** 序列化术语定义 */
function serializeTermDef(
  lines: string[],
  node: PMNode,
  chapterNum: number,
  clauseCounters: number[],
  depth: number,
) {
  const level = node.attrs.level || 1
  clauseCounters[level - 1]++
  for (let i = level; i < 5; i++) clauseCounters[i] = 0

  const numParts = [chapterNum, ...clauseCounters.slice(0, level)]
  const numStr = numParts.join('.')
  const id = xmlDefinitionId(node, node.attrs.id || `term_${numStr}`) || `term_${numStr}`

  lines.push(`${indent(depth)}<term-sec${buildAttrs({ id })}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'termName': {
        lines.push(`${indent(depth + 1)}<term>`)
        lines.push(`${indent(depth + 2)}<preferred>`)
        lines.push(`${indent(depth + 3)}<term-name>${serializeInlineContent(child)}</term-name>`)
        lines.push(`${indent(depth + 2)}</preferred>`)
        lines.push(`${indent(depth + 1)}</term>`)
        break
      }
      case 'termNameEn': {
        const text = serializeInlineContent(child)
        if (text.trim()) {
          lines.push(`${indent(depth + 1)}<term>`)
          lines.push(`${indent(depth + 2)}<admitted>`)
          lines.push(`${indent(depth + 3)}<term-name lang="en">${text}</term-name>`)
          lines.push(`${indent(depth + 2)}</admitted>`)
          lines.push(`${indent(depth + 1)}</term>`)
        }
        break
      }
      case 'termDefinition':
        lines.push(`${indent(depth + 1)}<def>`)
        lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
        lines.push(`${indent(depth + 1)}</def>`)
        break
      case 'note':
        lines.push(`${indent(depth + 1)}<term-note>`)
        lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
        lines.push(`${indent(depth + 1)}</term-note>`)
        break
      case 'example':
        lines.push(`${indent(depth + 1)}<term-example>`)
        lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
        lines.push(`${indent(depth + 1)}</term-example>`)
        break
      case 'termDef':
        serializeTermDef(lines, child, chapterNum, clauseCounters, depth + 1)
        break
      default:
        serializeBlockNode(lines, child, depth + 1)
        break
    }
  })

  lines.push(`${indent(depth)}</term-sec>`)
}

/** 序列化附录 */
function serializeAppendix(lines: string[], node: PMNode, letter: string, depth: number) {
  const normative = node.attrs.normative ? 'normative' : 'informative'
  const id = xmlDefinitionId(node, node.attrs.id || `app_${letter}`) || `app_${letter}`
  lines.push(`${indent(depth)}<app${buildAttrs({ id, 'content-type': normative })}>`)

  const clauseCounters = [0, 0, 0, 0, 0]

  node.forEach((child) => {
    switch (child.type.name) {
      case 'appendixLabel':
        // 附录标识由系统自动生成，XML 中通过 id 和 content-type 表达
        break
      case 'appendixTitle':
        lines.push(`${indent(depth + 1)}<title>${serializeInlineContent(child)}</title>`)
        break
      case 'clause':
        serializeAppendixClause(lines, child, letter, clauseCounters, depth + 1)
        break
      case 'termDef':
        serializeAppendixTermDef(lines, child, letter, clauseCounters, depth + 1)
        break
      default:
        serializeBlockNode(lines, child, depth + 1)
        break
    }
  })

  lines.push(`${indent(depth)}</app>`)
}

/** 序列化附录中的条 */
function serializeAppendixClause(
  lines: string[],
  node: PMNode,
  letter: string,
  clauseCounters: number[],
  depth: number,
) {
  const level = node.attrs.level || 1
  clauseCounters[level - 1]++
  for (let i = level; i < 5; i++) clauseCounters[i] = 0

  const numParts = [letter, ...clauseCounters.slice(0, level)]
  const numStr = numParts.join('.')
  const id = xmlDefinitionId(node, node.attrs.id || `sec_${numStr}`) || `sec_${numStr}`
  const hasTitle = node.attrs.hasTitle !== false

  const attrs: Record<string, string | number | boolean | null> = { id }
  if (!hasTitle) attrs['content-type'] = 'untitled'

  lines.push(`${indent(depth)}<sec${buildAttrs(attrs)}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'clauseTitle':
        lines.push(`${indent(depth + 1)}<title>${serializeInlineContent(child)}</title>`)
        break
      case 'clause':
        serializeAppendixClause(lines, child, letter, clauseCounters, depth + 1)
        break
      case 'termDef':
        serializeAppendixTermDef(lines, child, letter, clauseCounters, depth + 1)
        break
      default:
        serializeBlockNode(lines, child, depth + 1)
        break
    }
  })

  lines.push(`${indent(depth)}</sec>`)
}

/** 序列化附录中的术语定义 */
function serializeAppendixTermDef(
  lines: string[],
  node: PMNode,
  letter: string,
  clauseCounters: number[],
  depth: number,
) {
  const level = node.attrs.level || 1
  clauseCounters[level - 1]++
  for (let i = level; i < 5; i++) clauseCounters[i] = 0

  const numParts = [letter, ...clauseCounters.slice(0, level)]
  const numStr = numParts.join('.')
  const id = xmlDefinitionId(node, node.attrs.id || `term_${numStr}`) || `term_${numStr}`

  lines.push(`${indent(depth)}<term-sec${buildAttrs({ id })}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'termName':
        lines.push(`${indent(depth + 1)}<term>`)
        lines.push(`${indent(depth + 2)}<preferred>`)
        lines.push(`${indent(depth + 3)}<term-name>${serializeInlineContent(child)}</term-name>`)
        lines.push(`${indent(depth + 2)}</preferred>`)
        lines.push(`${indent(depth + 1)}</term>`)
        break
      case 'termNameEn': {
        const text = serializeInlineContent(child)
        if (text.trim()) {
          lines.push(`${indent(depth + 1)}<term>`)
          lines.push(`${indent(depth + 2)}<admitted>`)
          lines.push(`${indent(depth + 3)}<term-name lang="en">${text}</term-name>`)
          lines.push(`${indent(depth + 2)}</admitted>`)
          lines.push(`${indent(depth + 1)}</term>`)
        }
        break
      }
      case 'termDefinition':
        lines.push(`${indent(depth + 1)}<def>`)
        lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
        lines.push(`${indent(depth + 1)}</def>`)
        break
      case 'note':
        lines.push(`${indent(depth + 1)}<term-note>`)
        lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
        lines.push(`${indent(depth + 1)}</term-note>`)
        break
      case 'example':
        lines.push(`${indent(depth + 1)}<term-example>`)
        lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
        lines.push(`${indent(depth + 1)}</term-example>`)
        break
      case 'termDef':
        serializeAppendixTermDef(lines, child, letter, clauseCounters, depth + 1)
        break
      default:
        serializeBlockNode(lines, child, depth + 1)
        break
    }
  })

  lines.push(`${indent(depth)}</term-sec>`)
}

/** 序列化参考文献 */
function serializeBibliography(lines: string[], node: PMNode, depth: number) {
  lines.push(`${indent(depth)}<ref-list>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'bibliographyTitle':
        lines.push(`${indent(depth + 1)}<title>${serializeInlineContent(child)}</title>`)
        break
      case 'bibEntry': {
        const index = child.attrs.index
        const id = xmlDefinitionId(child, index ? `bib_${index}` : undefined)
        const attrs: Record<string, string | null | undefined> = { id }
        lines.push(`${indent(depth + 1)}<ref${buildAttrs(attrs)}>`)
        lines.push(`${indent(depth + 2)}<mixed-citation>${serializeInlineContent(child)}</mixed-citation>`)
        lines.push(`${indent(depth + 1)}</ref>`)
        break
      }
    }
  })

  lines.push(`${indent(depth)}</ref-list>`)
}

/** 序列化通用块级节点 */
function serializeBlockNode(lines: string[], node: PMNode, depth: number) {
  switch (node.type.name) {
    case 'stdParagraph':
    case 'paragraph':
      lines.push(`${indent(depth)}<p>${serializeInlineContent(node)}</p>`)
      break

    case 'note':
      lines.push(`${indent(depth)}<non-normative-note>`)
      lines.push(`${indent(depth + 1)}<p>${serializeInlineContent(node)}</p>`)
      lines.push(`${indent(depth)}</non-normative-note>`)
      break

    case 'example':
      lines.push(`${indent(depth)}<non-normative-example>`)
      lines.push(`${indent(depth + 1)}<p>${serializeInlineContent(node)}</p>`)
      lines.push(`${indent(depth)}</non-normative-example>`)
      break

    case 'stdTable':
      serializeTable(lines, node, depth)
      break

    case 'figure':
      serializeFigure(lines, node, depth)
      break

    case 'formula':
      serializeFormula(lines, node, depth)
      break

    case 'stdList':
      serializeList(lines, node, depth)
      break

    default:
      // 其他未知节点尝试输出文本
      if (node.isTextblock) {
        lines.push(`${indent(depth)}<p>${serializeInlineContent(node)}</p>`)
      } else {
        // 递归处理子节点
        node.forEach((child) => {
          serializeBlockNode(lines, child, depth)
        })
      }
      break
  }
}

/** 序列化表格 */
function serializeTable(lines: string[], node: PMNode, depth: number) {
  const id = xmlDefinitionId(node, node.attrs.id)
  const orientation = normalizePageOrientation(node.attrs.orientation)
  lines.push(`${indent(depth)}<table-wrap${buildAttrs({
    id: id || undefined,
    orientation: orientation === 'landscape' ? orientation : undefined,
  })}>`)

  const footer: PMNode[] = []
  node.forEach((child) => {
    switch (child.type.name) {
      case 'tableCaption':
        lines.push(`${indent(depth + 1)}<caption>`)
        lines.push(`${indent(depth + 2)}<title>${serializeInlineContent(child)}</title>`)
        lines.push(`${indent(depth + 1)}</caption>`)
        break
      case 'tableCaptionEn':
        lines.push(`${indent(depth + 1)}<caption lang="en">`)
        lines.push(`${indent(depth + 2)}<title>${serializeInlineContent(child)}</title>`)
        lines.push(`${indent(depth + 1)}</caption>`)
        break
      case 'table':
        serializeHtmlTable(lines, child, depth + 1)
        break
      case 'tableFootnote':
      case 'tableNoteRow':
      case 'tableFootnoteRow':
        footer.push(child)
        break
    }
  })

  if (footer.length > 0) {
    lines.push(`${indent(depth + 1)}<table-wrap-foot>`)
    for (const row of footer) {
      if (row.type.name === 'tableFootnote') {
        // Legacy editor node retained as a plain table-wrap-foot paragraph.
        lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(row)}</p>`)
      } else if (row.type.name === 'tableNoteRow') {
        row.forEach((note) => serializeBlockNode(lines, note, depth + 2))
      } else if (row.type.name === 'tableFootnoteRow') {
        row.forEach((entry) => {
          if (entry.type.name !== 'tableFootnoteEntry') return
          const nodeId = String(entry.attrs.nodeId || '')
          const xmlId = tableFootnoteXmlId(nodeId)
          const label = requireFootnoteLabel(nodeId, 'table').label
          const attrs = buildAttrs({ id: xmlId })
          recordEmittedDefinitionByStableId(nodeId, xmlId)
          lines.push(`${indent(depth + 2)}<fn fn-type="table"${attrs}>`)
          lines.push(`${indent(depth + 3)}<label>${escapeXml(label)}</label>`)
          lines.push(`${indent(depth + 3)}<p>${serializeInlineContent(entry)}</p>`)
          lines.push(`${indent(depth + 2)}</fn>`)
        })
      }
    }
    lines.push(`${indent(depth + 1)}</table-wrap-foot>`)
  }

  lines.push(`${indent(depth)}</table-wrap>`)
}

/** 序列化 HTML 表格结构 (Tiptap 内置表格) */
function serializeHtmlTable(lines: string[], node: PMNode, depth: number) {
  lines.push(`${indent(depth)}<table>`)

  // Tiptap 的表格结构：table > tableRow > tableCell/tableHeader
  node.forEach((row) => {
    if (row.type.name === 'tableRow') {
      lines.push(`${indent(depth + 1)}<tr>`)
      row.forEach((cell) => {
        const tag = cell.type.name === 'tableHeader' ? 'th' : 'td'
        const cellAttrs: Record<string, string | number | null | undefined> = {}
        if (cell.attrs.colspan && cell.attrs.colspan > 1) cellAttrs.colspan = cell.attrs.colspan
        if (cell.attrs.rowspan && cell.attrs.rowspan > 1) cellAttrs.rowspan = cell.attrs.rowspan

        const content = serializeCellContent(cell)
        lines.push(`${indent(depth + 2)}<${tag}${buildAttrs(cellAttrs)}>${content}</${tag}>`)
      })
      lines.push(`${indent(depth + 1)}</tr>`)
    }
  })

  lines.push(`${indent(depth)}</table>`)
}

/** 序列化表格单元格内容 */
function serializeCellContent(cell: PMNode): string {
  const parts: string[] = []
  cell.forEach((child) => {
    if (child.isTextblock) {
      parts.push(serializeInlineContent(child))
    }
  })
  return parts.join(' ')
}

/** 序列化图 */
function serializeFigure(lines: string[], node: PMNode, depth: number) {
  const id = xmlDefinitionId(node, node.attrs.id)
  const orientation = normalizePageOrientation(node.attrs.orientation)
  lines.push(`${indent(depth)}<fig${buildAttrs({
    id: id || undefined,
    orientation: orientation === 'landscape' ? orientation : undefined,
  })}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'figureImage': {
        const src = child.attrs.src
        const alt = child.attrs.alt
        if (src) {
          lines.push(`${indent(depth + 1)}<graphic${buildAttrs({ 'xlink:href': src, alt: alt || undefined })} />`)
        }
        break
      }
      case 'figureCaption':
        lines.push(`${indent(depth + 1)}<caption>`)
        lines.push(`${indent(depth + 2)}<title>${serializeInlineContent(child)}</title>`)
        lines.push(`${indent(depth + 1)}</caption>`)
        break
      case 'figureCaptionEn':
        lines.push(`${indent(depth + 1)}<caption lang="en">`)
        lines.push(`${indent(depth + 2)}<title>${serializeInlineContent(child)}</title>`)
        lines.push(`${indent(depth + 1)}</caption>`)
        break
    }
  })

  lines.push(`${indent(depth)}</fig>`)
}

/** 序列化公式 */
function serializeFormula(lines: string[], node: PMNode, depth: number) {
  const id = xmlDefinitionId(node, node.attrs.id)
  lines.push(`${indent(depth)}<disp-formula${buildAttrs({ id: id || undefined })}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'formulaContent':
        lines.push(`${indent(depth + 1)}<tex-math><![CDATA[${child.textContent}]]></tex-math>`)
        break
      case 'formulaDescription':
        lines.push(`${indent(depth + 1)}<def-list>`)
        lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
        lines.push(`${indent(depth + 1)}</def-list>`)
        break
    }
  })

  lines.push(`${indent(depth)}</disp-formula>`)
}

/** 序列化列表 */
export function toXmlListType(listType: string): string {
  const listTypeMap: Record<string, string> = {
    dash: 'dash',
    alpha: 'alpha-lower',
    numeric: 'arabic',
    dot: 'bullet',
    roman: 'arabic',
    romanUpper: 'arabic',
  }
  return listTypeMap[listType] || 'dash'
}

function serializeList(lines: string[], node: PMNode, depth: number) {
  const listType = toXmlListType(node.attrs.listType)

  lines.push(`${indent(depth)}<list${buildAttrs({ 'list-type': listType })}>`)

  node.forEach((child) => {
    if (child.type.name === 'stdListItem') {
      lines.push(`${indent(depth + 1)}<list-item>`)
      if (listType === 'bullet') lines.push(`${indent(depth + 2)}<label>·</label>`)
      lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
      lines.push(`${indent(depth + 1)}</list-item>`)
    }
  })

  lines.push(`${indent(depth)}</list>`)
}

/** 序列化块级子节点（用于 foreword/introduction 等容器） */
function serializeBlockChildren(lines: string[], node: PMNode, depth: number) {
  node.forEach((child) => {
    serializeBlockNode(lines, child, depth)
  })
}

/**
 * 序列化行内内容（文本 + marks）
 * 输出带行内标签的文本
 */
function serializeInlineContent(node: PMNode): string {
  const parts: string[] = []

  node.forEach((child) => {
    if (child.isText) {
      parts.push(serializeMarkedText(child.text || '', child.marks.map((mark) => ({ type: mark.type.name, attrs: mark.attrs }))))
    } else if (child.type.name === 'footnoteRef') {
      parts.push(serializeFootnoteReference(child.attrs.nodeId, child.attrs.content))
    } else if (child.type.name === 'tableFootnoteRef') {
      parts.push(serializeTableFootnoteReference(child.attrs.targetId))
    } else if (child.type.name === 'hardBreak') {
      parts.push('<break />')
    }
  })

  return parts.join('')
}

function serializeMarkedText(text: string, marks: Array<{ type: string; attrs?: Record<string, unknown> }> = []): string {
  let result = escapeXml(text)
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold': result = `<bold>${result}</bold>`; break
      case 'italic': result = `<italic>${result}</italic>`; break
      case 'subscript': result = `<sub>${result}</sub>`; break
      case 'superscript': result = `<sup>${result}</sup>`; break
      case 'underline': result = `<underline>${result}</underline>`; break
      case 'strike': result = `<strike>${result}</strike>`; break
      case 'crossRef': {
        const rid = resolveCrossRefXmlId(mark.attrs)
        result = `<xref${buildAttrs({ 'ref-type': mark.attrs?.refType as string || 'sec', rid })}>${result}</xref>`
        break
      }
    }
  }
  return result
}

function serializeInlineJson(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.map((value) => {
    if (!value || typeof value !== 'object') return ''
    const node = value as PMJsonNode
    if (node.type === 'text') return serializeMarkedText(node.text || '', (node.marks || []).map((mark) => ({ type: mark.type, attrs: mark.attrs })))
    if (node.type === 'hardBreak') return '<break />'
    if (node.type === 'footnoteRef') return serializeFootnoteReference(node.attrs?.nodeId, node.attrs?.content)
    if (node.type === 'tableFootnoteRef') return serializeTableFootnoteReference(node.attrs?.targetId)
    return ''
  }).join('')
}

function requireFootnoteLabel(nodeId: unknown, kind: 'body' | 'table'): ResolvedLabel {
  const id = typeof nodeId === 'string' ? nodeId : ''
  const resolved = activeFootnoteLabels[id]
  const valid = resolved && resolved.refText === resolved.label && (kind === 'body'
    ? /^fn_[1-9][0-9]*$/.test(resolved.xmlId) && /^[1-9][0-9]*\)$/.test(resolved.label)
    : /^tabfn_.+_[a-z]+$/.test(resolved.xmlId) && /^[a-z]+$/.test(resolved.label) && resolved.xmlId.endsWith(`_${resolved.label}`))
  if (!valid) throw new XmlFootnoteValidationError(`脚注「${id}」缺少有效 Resolver 标签，不能生成 XML。`)
  return resolved
}

function bodyFootnoteXmlId(nodeId: unknown): string {
  return requireFootnoteLabel(nodeId, 'body').xmlId
}

function tableFootnoteXmlId(nodeId: unknown): string {
  return requireFootnoteLabel(nodeId, 'table').xmlId
}

function serializeFootnoteReference(nodeIdValue: unknown, content: unknown): string {
  const nodeId = typeof nodeIdValue === 'string' ? nodeIdValue : ''
  const id = bodyFootnoteXmlId(nodeId)
  const label = requireFootnoteLabel(nodeId, 'body').label
  const attrs = buildAttrs({ id })
  recordEmittedDefinitionByStableId(nodeId, id)
  return `<xref${buildAttrs({ 'ref-type': 'fn', rid: id })}>${escapeXml(label)}</xref><fn${attrs}><label>${escapeXml(label)}</label><p>${serializeInlineJson(content)}</p></fn>`
}

function serializeTableFootnoteReference(targetIdValue: unknown): string {
  const targetId = typeof targetIdValue === 'string' ? targetIdValue : ''
  const id = tableFootnoteXmlId(targetId)
  const label = requireFootnoteLabel(targetId, 'table').label
  return `<xref${buildAttrs({ 'ref-type': 'table-fn', rid: id })}>${escapeXml(label)}</xref>`
}

/** 查找文档中某类型的第一个子节点 */
function findChild(doc: PMNode, typeName: string): PMNode | null {
  let found: PMNode | null = null
  doc.forEach((child) => {
    if (!found && child.type.name === typeName) {
      found = child
    }
  })
  return found
}
