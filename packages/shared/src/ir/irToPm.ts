/**
 * Authoring IR → ProseMirror JSON adapter.
 *
 * This is a semantic projection, not a snapshot copier: each IR field is written
 * to its typed production node/attribute. Data which cannot be represented by
 * the production schema is rejected with a path-bearing diagnostic.
 */
import type {
  IRAppendix, IRBibEntry, IRBlock, IRChapter, IRClause, IRClauseChild, IRDefItem, IRDefList, IRDoc,
  IRDocMeta, IRExample, IRInline, IRList, IRMeasure, IRNormRefList, IRNote, IRTable, IRTermEntry,
} from './types'
import type { PMJsonNode } from './pmToIr'
import { hasSemanticExtensions, isInlineNoteContent } from './extensions'
import { unsupportedFootnoteContent } from './footnotePayload'
import { diagnoseInlineProjection, findCrossRefRunProjectionIssues } from './inlineProjectionDiagnostics'
import {
  describeAuthoringContext, fragmentContextRules, validateAuthoringContext,
  type AuthoringContext, type FragmentContextRules, type IRFragmentNode,
} from './fragmentContext'
import { orderedTermTail } from './termTailOrder'
import {
  CELL_BORDER_STYLES, CELL_BORDER_STYLE_KEYS, columnAlignProblem, columnWidthProblem, isCellBorderStyle, tableGridWidth,
} from './tableColumns'

export interface IRToPmDiagnostic {
  path: string
  reason: string
  nodeId?: string
}

export class IRToPmError extends Error {
  readonly diagnostics: IRToPmDiagnostic[]

  constructor(diagnostics: IRToPmDiagnostic[]) {
    super(`IR contains ${diagnostics.length} item(s) that cannot be represented in ProseMirror JSON`)
    this.name = 'IRToPmError'
    this.diagnostics = diagnostics
  }
}

export interface IRToPmOptions {
  /** StandardDoc is useful to XML integrations; production editor defaults to StarterKit doc. */
  rootType?: 'doc' | 'standardDoc'
}

type PmAttrs = Record<string, unknown>
type IRInlineMark = NonNullable<IRInline['marks']>[number]
type IRTextMark = Exclude<IRInlineMark, { type: 'tableFootnoteRef' }>
const node = (type: string, attrs?: PmAttrs, content?: PMJsonNode[]): PMJsonNode => ({
  type,
  ...(attrs && Object.keys(attrs).length ? { attrs } : {}),
  ...(content ? { content } : {}),
})
const text = (value: string): PMJsonNode => ({ type: 'text', text: value })
const withId = (id: string, attrs: PmAttrs = {}): PmAttrs => ({ ...attrs, nodeId: id })
const nonEmpty = <T>(value: T[] | undefined): T[] => value ?? []

const targetKinds: Record<string, string> = {
  chapter: 'chapter', clause: 'clause', appendix: 'appendix', figure: 'figure',
  table: 'table', formula: 'formula', note: 'note', example: 'example',
  bibliography: 'bibEntry', term: 'term', index: 'index', paragraph: 'paragraph', listItem: 'listItem', abbreviation: 'abbreviation',
}

function markToPm(mark: IRTextMark): { type: string; attrs?: PmAttrs } {
  switch (mark.type) {
    case 'bold': return { type: 'bold' }
    case 'italic': return { type: 'italic' }
    case 'underline': return { type: 'underline' }
    case 'sub': return { type: 'subscript' }
    case 'sup': return { type: 'superscript' }
    case 'strike': return { type: 'strike' }
    case 'code': return { type: 'code' }
    case 'variable': return { type: 'variable', attrs: { kind: mark.kind ?? null, name: mark.name ?? null } }
    case 'externalLink': return { type: 'externalLink', attrs: { href: mark.href, title: mark.title ?? null, target: mark.target ?? null, rel: mark.rel ?? null } }
    case 'crossRef': return {
      type: 'crossRef',
      // Preserve an untyped IR reference explicitly: the production PM mark defaults
      // missing refType to `chapter` for legacy PM documents.
      attrs: { targetId: mark.targetId, refType: mark.targetKind ? targetKinds[mark.targetKind] ?? mark.targetKind : '' },
    }
    case 'bibRef': return { type: 'bibRef', attrs: { targetId: mark.targetId } }
    case 'termRef': return { type: 'termRef', attrs: { targetId: mark.targetId } }
    case 'stdRef': return { type: 'stdRef' }
    case 'mixedCitation': return { type: 'mixedCitation' }
  }
}

function inlineToPm(run: IRInline): PMJsonNode[] {
  // tableFootnoteRef is an inline atom, not a ProseMirror mark. Keep it out of
  // text/formula mark sets and emit its node after the inline payload instead.
  const tableFootnoteRefs = (run.marks ?? []).filter((mark): mark is Extract<IRInlineMark, { type: 'tableFootnoteRef' }> => mark.type === 'tableFootnoteRef')
  const textMarks = (run.marks ?? []).filter((mark): mark is IRTextMark => mark.type !== 'tableFootnoteRef')
  const marks = [...textMarks.map(markToPm)]
  if (run.style && Object.keys(run.style).length) marks.push({ type: 'textStyle', attrs: { ...run.style } })
  const result: PMJsonNode[] = []
  if (run.text) {
    // ProseMirror text nodes cannot contain hard breaks semantically.
    const parts = run.text.split('\n')
    parts.forEach((part, i) => {
      if (part) result.push({ ...text(part), ...(marks.length ? { marks: [...marks] } : {}) })
      if (i < parts.length - 1) result.push({ type: 'hardBreak', ...(marks.length ? { marks: [...marks] } : {}) })
    })
  }
  if (run.formula) {
    result.push({ ...node('formulaInline', withId(run.formula.id, {
      mathml: run.formula.mathml ?? null,
      latex: run.formula.latex ?? null,
      source: run.formula.source ?? null,
    })), ...(marks.length ? { marks: [...marks] } : {}) })
  }
  if (run.footnote) {
    result.push(node('footnoteRef', withId(run.footnote.id, {
      content: inlinesToPm(run.footnote.content),
    })))
  }
  for (const mark of tableFootnoteRefs) result.push(node('tableFootnoteRef', withId(mark.id ?? '', { targetId: mark.targetId })))
  return result
}

function inlinesToPm(inlines: IRInline[]): PMJsonNode[] {
  return inlines.flatMap(inlineToPm)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function diagnoseFootnotePayload(content: IRInline[], path: string, id: string | undefined, errors: IRToPmDiagnostic[]): void {
  const reason = unsupportedFootnoteContent(inlinesToPm(content))
  if (reason) errors.push({
    path,
    ...(id === undefined ? {} : { nodeId: id }),
    reason: `脚注内容无法完整保存并重开：${reason}`,
  })
}

/** Walk the source IR so diagnostics keep the exact owner path before PM projection. */
function diagnoseFootnotePayloads(doc: unknown, errors: IRToPmDiagnostic[], rootPath = 'doc'): void {
  const active = new Set<object>()
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`))
      return
    }
    if (!isRecord(value) || active.has(value)) return
    active.add(value)

    if (typeof value.text === 'string' && isRecord(value.footnote) && Array.isArray(value.footnote.content)) {
      diagnoseFootnotePayload(
        value.footnote.content as IRInline[],
        `${path}.footnote.content`,
        typeof value.footnote.id === 'string' ? value.footnote.id : undefined,
        errors,
      )
    }
    if (value.kind === 'table' && Array.isArray(value.footnotes)) {
      value.footnotes.forEach((footnote, index) => {
        if (!isRecord(footnote) || !Array.isArray(footnote.content)) return
        diagnoseFootnotePayload(
          footnote.content as IRInline[],
          `${path}.footnotes[${index}].content`,
          typeof footnote.id === 'string' ? footnote.id : undefined,
          errors,
        )
      })
    }
    for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`)
    active.delete(value)
  }
  visit(doc, rootPath)
}

function measureAttrs(attrs: PmAttrs, key: string, value?: IRMeasure): void {
  if (!value) return
  attrs[key] = value.value
  attrs[`${key}Unit`] = value.unit
}

function cellStyleAttrs(style: NonNullable<IRTable['rows'][number]['cells'][number]['style']>): PmAttrs {
  const attrs: PmAttrs = { ...style }
  for (const key of ['borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const) {
    delete attrs[key]
    measureAttrs(attrs, key, style[key])
  }
  return attrs
}

function rowStyleAttrs(style: NonNullable<IRTable['rows'][number]['style']>): PmAttrs {
  const attrs: PmAttrs = { ...style }
  for (const key of ['borderWidth', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'height'] as const) {
    delete attrs[key]
    measureAttrs(attrs, key, style[key])
  }
  return attrs
}

function tableStyleAttrs(style: NonNullable<IRTable['style']>): PmAttrs {
  const attrs: PmAttrs = { ...style }
  delete attrs.borderWidth
  delete attrs.cellPadding
  measureAttrs(attrs, 'borderWidth', style.borderWidth)
  measureAttrs(attrs, 'cellPadding', style.cellPadding)
  return attrs
}

function paragraph(id: string, content: IRInline[], type = 'stdParagraph'): PMJsonNode {
  return node(type, withId(id), inlinesToPm(content))
}

function blocksToPm(blocks: IRBlock[], path: string, errors: IRToPmDiagnostic[]): PMJsonNode[] {
  return blocks.map((block, index) => blockToPm(block, `${path}[${index}]`, errors)).filter((item): item is PMJsonNode => !!item)
}

function noteContent(ownerId: string, content: IRBlock[], path: string, errors: IRToPmDiagnostic[]): PMJsonNode[] {
  if (content.length === 1 && content[0].kind === 'paragraph') {
    const paragraph = content[0]
    const expectedId = `${ownerId}.p0`
    if (paragraph.id !== expectedId) {
      errors.push({
        path: `${path}.content[0]`,
        nodeId: paragraph.id,
        reason: `生产 note/example 行内内容会将段落 ID 派生为「${expectedId}」，无法保留「${paragraph.id}」`,
      })
    }
    return inlinesToPm(paragraph.content)
  }
  errors.push({ path, nodeId: content[0]?.id, reason: '该位置的注/示例只支持单段落，IR 中存在多块或非段落内容' })
  return []
}

/**
 * 块位置的注/示例（WP8.M G7-b，D-M-05）。canonical 规则保证往返稳定：
 * - content 恰为一个 id 等于 `${owner.id}.p0` 的段落 → 旧 `note`/`example`（行内内容，输出与此前逐字节相同）；
 * - 其余且全为段落/列项 → `noteBlock`/`exampleBlock`，子块各自保留 nodeId（段落 id 取自 `stdParagraph.nodeId`）；
 * - 含表/图/公式等其他块 → IRToPmError（原文 C-S-31 的注/示例内容只有 p、list）。
 * 术语条目、表注行内的注/示例仍用旧节点（`noteContent`），多块在那些位置继续报错。
 */
function noteBlockToPm(block: IRNote | IRExample, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  const blockType = block.kind === 'note' ? 'noteBlock' : 'exampleBlock'
  if (block.content.length === 0) {
    errors.push({ path: `${path}.content`, nodeId: block.id, reason: `生产 ${blockType} 至少需要一个段落或列项` })
  }
  const children: PMJsonNode[] = []
  block.content.forEach((child, index) => {
    const at = `${path}.content[${index}]`
    if (child.kind === 'paragraph') {
      children.push(paragraph(child.id, child.content))
    } else if (child.kind === 'list') {
      const list = listToPm(child, at, errors)
      if (list.type === 'stdList') children.push(list)
      else errors.push({ path: at, nodeId: child.id, reason: `生产 ${blockType} 中的列项只支持简单列项（每个列项一个段落）` })
    } else {
      errors.push({ path: at, nodeId: child.id, reason: `生产 ${blockType} 只接受段落与列项，不支持「${child.kind}」块` })
    }
  })
  return node(blockType, withId(block.id), children)
}

function termToPm(entry: IRTermEntry, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  const content: PMJsonNode[] = [
    node('termName', undefined, inlinesToPm(entry.term)),
    ...(entry.termEn ? [node('termNameEn', undefined, inlinesToPm(entry.termEn))] : []),
    // M-9.2.9-01：领域固定在术语名之后、定义之前，不进入 tailOrder；空数组与缺省等价，不输出空节点。
    ...(entry.subjectField && entry.subjectField.length > 0 ? [node('termSubjectField', undefined, inlinesToPm(entry.subjectField))] : []),
  ]
  const [mainDefinition] = entry.definition
  if (!mainDefinition) {
    errors.push({ path: `${path}.definition`, nodeId: entry.id, reason: 'termDef schema 要求至少一个主定义段落' })
    content.push(node('termDefinition', withId(`${entry.id}.def0`), []))
  } else if (mainDefinition.kind !== 'paragraph') {
    errors.push({ path: `${path}.definition[0]`, nodeId: mainDefinition.id, reason: 'termDef 主定义必须为段落' })
    content.push(node('termDefinition', withId(mainDefinition.id), []))
  } else {
    content.push(node('termDefinition', withId(mainDefinition.id), inlinesToPm(mainDefinition.content)))
  }
  const tail = orderedTermTail(entry, 'pm')
  if (tail.issue) errors.push({
    path: `${path}.tailOrder`,
    nodeId: entry.id,
    reason: `无法按 tailOrder 无损投影：${tail.issue}`,
  })
  for (const item of tail.items) {
    switch (item.kind) {
      case 'definition': {
        const block = item.value
        if (block.kind === 'paragraph') content.push(paragraph(block.id, block.content))
        else errors.push({ path: `${path}.definition[${item.index + 1}]`, nodeId: block.id, reason: 'termDef 后续定义只允许段落' })
        break
      }
      case 'source':
        content.push(node('termSource', undefined, inlinesToPm(item.value)))
        break
      case 'note': {
        const note = item.value
        const inlineContent = noteContent(note.id, note.content, `${path}.notes.${note.id}`, errors)
        content.push(node('note', withId(note.id), inlineContent))
        break
      }
      case 'example': {
        const example = item.value
        const inlineContent = noteContent(example.id, example.content, `${path}.examples.${example.id}`, errors)
        content.push(node('example', withId(example.id), inlineContent))
        break
      }
      case 'nestedEntry': {
        const child = item.value
        content.push(termToPm(child, `${path}.nestedEntries.${child.id}`, errors))
        break
      }
      case 'languageSet': {
        const set = item.value
        const setIndex = item.index
        if (set.groups.length === 0) {
          errors.push({ path: `${path}.languageSets[${setIndex}].groups`, nodeId: set.id, reason: '生产tbxLangSet节点至少需要一个术语组' })
        }
        const tigs = set.groups.map((group, groupIndex) => {
          if (group.terms.length === 0) {
            errors.push({ path: `${path}.languageSets[${setIndex}].groups[${groupIndex}].terms`, nodeId: group.id, reason: '生产tbxTig节点至少需要一个术语变体' })
          }
          return node('tbxTig', withId(group.id), group.terms.map(variant => node('tbxTermVariant', withId(variant.id), [
            node('tbxTerm', undefined, inlinesToPm(variant.content)),
            ...variant.descriptors.map(descriptor => node('tbxTermDescriptor', withId(descriptor.id, { type: descriptor.kind }), inlinesToPm(descriptor.value))),
          ])))
        })
        content.push(node('tbxLangSet', withId(set.id, { lang: set.language }), tigs))
        break
      }
    }
  }
  return node('termDef', withId(entry.id, { level: entry.level ?? 1 }), content)
}

function listToPm(list: IRList, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  if (list.items.length === 0) {
    errors.push({ path: `${path}.items`, nodeId: list.id, reason: '生产列表至少需要一个列项' })
  }
  // WP8.M G7：小写罗马 roman 由生产 stdList 支持（listType='roman'）；romanUpper 在 GB/T 46687.2 没有取值，仍拒绝。
  if (list.listType === 'romanUpper') {
    errors.push({
      path: `${path}.listType`,
      nodeId: list.id,
      reason: `生产列表schema不支持「${list.listType}」编号，不能无损转换`,
    })
    return node('stdList', withId(list.id, { listType: 'dash', level: 1 }), [])
  }

  const fixedLevel = list.listType === 'number' || list.listType === 'dot' ? 2 : 1
  if (list.level !== undefined && list.level !== fixedLevel) {
    errors.push({
      path: `${path}.level`,
      nodeId: list.id,
      reason: `生产列表「${list.listType}」固定为 ${fixedLevel} 级，IR 显式给出 ${list.level} 级`,
    })
  }

  const simple = list.items.every(item => item.content.length === 1 && item.content[0]?.kind === 'paragraph')
  if (simple) {
    const typeByList = { dash: 'dash', number: 'numeric', alpha: 'alpha', roman: 'roman', boxed: 'boxedNumeric', dot: 'dot' } as const
    const rawType = typeByList[list.listType]
    return node('stdList', withId(list.id, { listType: rawType, level: fixedLevel }), list.items.map((item, index) => {
      const content = item.content[0]
      if (content?.kind === 'paragraph' && content.id !== `${item.id}.p0`) {
        errors.push({
          path: `${path}.items[${index}].content[0]`,
          nodeId: content.id,
          reason: `生产标准列表会将列项段落 ID 派生为「${item.id}.p0」，无法保留「${content.id}」`,
        })
      }
      return node('stdListItem', withId(item.id), content?.kind === 'paragraph' ? inlinesToPm(content.content) : [])
    }))
  }
  if (list.listType === 'dash' || list.listType === 'number') {
    for (const [index, item] of list.items.entries()) {
      const first = item.content[0]
      if (first?.kind !== 'paragraph') {
        errors.push({
          path: `${path}.items[${index}].content[0]`,
          nodeId: first?.id ?? item.id,
          reason: 'StarterKit列项必须以段落开头',
        })
      }
    }
    const type = list.listType === 'number' ? 'orderedList' : 'bulletList'
    return node(type, withId(list.id), list.items.map(item => node('listItem', withId(item.id), [
      ...item.content.flatMap((block, index) => block.kind === 'paragraph'
        ? [paragraph(block.id, block.content, 'paragraph')]
        : [listToPm(block, `${path}.${item.id}[${index}]`, errors)]),
    ])))
  }
  errors.push({ path, nodeId: list.id, reason: '生产stdList不支持嵌套列表；当前IR列项结构不能无损映射' })
  return node('stdList', withId(list.id, { listType: 'dash', level: list.level ?? 1 }), [])
}

/** `IRTable.columns` → `stdTable.attrs.columns`（WP8.M G8）：每列四个键齐全（缺省为 null），与生产 Schema 的属性形状一致。 */
function tableColumnsAttr(table: IRTable, path: string, errors: IRToPmDiagnostic[]): PmAttrs[] {
  const columns = table.columns ?? []
  const gridWidth = tableGridWidth(table.rows)
  if (columns.length !== gridWidth) {
    errors.push({
      path: `${path}.columns`, nodeId: table.id,
      reason: `列模型columns有 ${columns.length} 项，与表格网格列数 ${gridWidth} 不符，不能无损转换`,
    })
  }
  return columns.map((column, index) => {
    const where = `${path}.columns[${index}]`
    if (column.width) {
      const problem = columnWidthProblem(column.width.value, column.width.unit)
      if (problem) errors.push({ path: `${where}.width`, nodeId: table.id, reason: `第${index + 1}列${problem}` })
    }
    const textAlign = columnAlignProblem(column.textAlign, undefined)
    if (textAlign) errors.push({ path: `${where}.textAlign`, nodeId: table.id, reason: `第${index + 1}列${textAlign}` })
    const verticalAlign = columnAlignProblem(undefined, column.verticalAlign)
    if (verticalAlign) errors.push({ path: `${where}.verticalAlign`, nodeId: table.id, reason: `第${index + 1}列${verticalAlign}` })
    return {
      width: column.width?.value ?? null,
      widthUnit: column.width?.unit ?? null,
      textAlign: column.textAlign ?? null,
      verticalAlign: column.verticalAlign ?? null,
    }
  })
}

function tableToPm(table: IRTable, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  if (table.rows.length === 0) {
    errors.push({ path: `${path}.rows`, nodeId: table.id, reason: '生产表格至少需要一个表格行' })
  }
  const attrs: PmAttrs = withId(table.id, { orientation: table.orientation, unit: table.unit ?? null, headerRowCount: table.headerRowCount })
  measureAttrs(attrs, 'width', table.width)
  if (table.style) Object.assign(attrs, tableStyleAttrs(table.style))
  if (table.columns !== undefined) attrs.columns = tableColumnsAttr(table, path, errors)
  const rows = table.rows.map((row, ri) => {
    if (row.cells.length === 0) {
      errors.push({ path: `${path}.rows[${ri}].cells`, nodeId: row.id, reason: '生产表格行至少需要一个单元格' })
    }
    const cells = row.cells.map((cell, ci) => {
      if (cell.content.length === 0) {
        errors.push({ path: `${path}.rows[${ri}].cells[${ci}].content`, nodeId: cell.id, reason: '生产表格单元格至少需要一个块级内容' })
      }
      const cellAttrs: PmAttrs = withId(cell.id, {
        colspan: cell.colspan,
        rowspan: cell.rowspan,
        colwidth: cell.columnWidths ? [...cell.columnWidths] : null,
        cellType: cell.cellType ?? null,
        unit: cell.unit ?? null,
      })
      measureAttrs(cellAttrs, 'width', cell.width)
      if (cell.style) {
        const style = { ...cell.style }
        // WP8.M G8：非法的分边边框样式不写入 PM（调用方因 errors 非空而收到 IRToPmError），避免带着不合法取值落库。
        for (const key of CELL_BORDER_STYLE_KEYS) {
          const value = style[key]
          if (value === undefined || isCellBorderStyle(value)) continue
          errors.push({
            path: `${path}.rows[${ri}].cells[${ci}].style.${key}`, nodeId: cell.id,
            reason: `边框样式「${key}」的取值「${String(value)}」不在 ${CELL_BORDER_STYLES.join(' | ')} 之内`,
          })
          delete style[key]
        }
        Object.assign(cellAttrs, cellStyleAttrs(style))
      }
      return node(cell.header ? 'tableHeader' : 'tableCell', cellAttrs, blocksToPm(cell.content, `${path}.rows[${ri}].cells[${ci}].content`, errors))
    })
    return node('tableRow', withId(row.id, row.style ? rowStyleAttrs(row.style) : {}), cells)
  })
  const content: PMJsonNode[] = [
    node('tableCaption', undefined, inlinesToPm(table.caption)),
    ...(table.captionEn ? [node('tableCaptionEn', undefined, inlinesToPm(table.captionEn))] : []),
    node('table', undefined, rows),
  ]
  if (table.notes.length) content.push(node('tableNoteRow', undefined, table.notes.map(note => {
    const inlineContent = noteContent(note.id, note.content, `${path}.notes.${note.id}`, errors)
    return node('note', withId(note.id), inlineContent)
  })))
  if (table.footnotes?.length) content.push(node('tableFootnoteRow', undefined, table.footnotes.map(footnote => node('tableFootnoteEntry', withId(footnote.id), inlinesToPm(footnote.content)))))
  return node('stdTable', attrs, content)
}

function figureToPm(figure: Extract<IRBlock, { kind: 'figure' }>, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  if (figure.notes.length) errors.push({ path: `${path}.notes`, nodeId: figure.id, reason: '生产Figure节点没有可保存图中注的子节点' })
  const width = figure.imageWidth
  const height = figure.imageHeight
  const content: PMJsonNode[] = [
    node('figureImage', {
      src: figure.src, resourceId: figure.resourceId ?? null, alt: figure.alt ?? '', title: figure.title ?? null,
      width: width?.value ?? null, height: height?.value ?? null,
      widthUnit: width?.unit ?? null, heightUnit: height?.unit ?? null,
    }),
    node('figureCaption', undefined, inlinesToPm(figure.caption)),
    ...(figure.captionEn ? [node('figureCaptionEn', undefined, inlinesToPm(figure.captionEn))] : []),
    ...(figure.descriptions ?? []).map(description => node('figureDescription', withId(description.id), inlinesToPm(description.content))),
    ...(figure.groups ?? []).map(group => node('figureGroup', withId(group.id), [
      ...group.descriptions.map(description => node('figureDescription', withId(description.id), inlinesToPm(description.content))),
      ...group.resourceRefs.map(targetId => node('figureResourceRef', { targetId })),
    ])),
  ]
  return node('figure', withId(figure.id, { orientation: figure.orientation, unit: figure.unit ?? null }), content)
}

/** 定义列表的项 → whereItem（whereTerm + whereDefinition）；公式 whereList 与缩略语 defList 共用（WP8.M / G2，P8）。 */
function defItemsToPm(items: IRDefItem[]): PMJsonNode[] {
  return items.map(item => node('whereItem', withId(item.id), [
    node('whereTerm', undefined, inlinesToPm(item.term)),
    node('whereDefinition', undefined, inlinesToPm(item.definition)),
  ]))
}

function defListToPm(list: IRDefList, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  // PM 的 defList 要求 whereItem+；空列表无法投影，明确报错而不是静默丢弃。
  if (list.items.length === 0) errors.push({ path: `${path}.items`, nodeId: list.id, reason: '缩略语列表没有任何项，生产 Schema 要求至少一项' })
  return node('defList', withId(list.id), defItemsToPm(list.items))
}

function formulaToPm(formula: Extract<IRBlock, { kind: 'formula' }>, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  if (formula.sourceInlines && inlinePlainText(formula.sourceInlines).trim() !== formula.latex.trim()) {
    errors.push({ path: `${path}.sourceInlines`, nodeId: formula.id, reason: 'IR公式latex与sourceInlines文本不一致，不能无损投影为单一编辑源' })
  }
  const source = formula.sourceInlines ?? [{ text: formula.latex }]
  const content: PMJsonNode[] = [node('formulaContent', undefined, inlinesToPm(source))]
  if (formula.notes?.length) content.push(...formula.notes.map(note => node('formulaNote', withId(note.id), inlinesToPm(note.content))))
  if (formula.whereList.length) content.push(node('whereList', undefined, defItemsToPm(formula.whereList)))
  return node('formula', withId(formula.id, { latex: formula.latex, mathml: formula.mathml ?? null, numbered: formula.numbered }), content)
}

function blockToPm(block: IRBlock, path: string, errors: IRToPmDiagnostic[]): PMJsonNode | null {
  switch (block.kind) {
    case 'paragraph': return paragraph(block.id, block.content)
    case 'list': return listToPm(block, path, errors)
    case 'table': return tableToPm(block, path, errors)
    case 'figure': return figureToPm(block, path, errors)
    case 'formula': return formulaToPm(block, path, errors)
    case 'defList': return defListToPm(block, path, errors)
    case 'note': case 'example': {
      if (!isInlineNoteContent(block.id, block.content)) return noteBlockToPm(block, path, errors)
      const content = noteContent(block.id, block.content, path, errors)
      return node(block.kind, withId(block.id), content)
    }
    case 'warning': {
      if (block.content.length === 0) errors.push({ path, nodeId: block.id, reason: '生产 warning 节点要求至少一个块级子节点' })
      return node('warning', withId(block.id), blocksToPm(block.content, path, errors))
    }
    case 'quote': {
      if (block.content.length === 0) errors.push({ path, nodeId: block.id, reason: '生产 quoteBlock 节点要求至少一个块级子节点' })
      return node('quoteBlock', withId(block.id), blocksToPm(block.content, path, errors))
    }
    case 'code': return node('codeBlock', withId(block.id, { language: block.language ?? null }), block.text ? [text(block.text)] : [])
    case 'normRefList': return normRefListToPm(block, path, errors)
  }
}

/** 规范性引用文件清单（M-4.4.2.3-02/-03/-04）：std 条目写两个子节点，mixed 条目写单段行内内容。 */
function normRefListToPm(list: IRNormRefList, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  if (list.entries.length === 0) errors.push({ path, nodeId: list.id, reason: '生产 normRefList 节点要求至少一个条目' })
  return node('normRefList', withId(list.id), list.entries.map(entry => entry.entryType === 'std'
    ? node('normRefStd', withId(entry.id), [
      node('normRefStdRef', undefined, inlinesToPm(entry.ref)),
      node('normRefStdTitle', undefined, inlinesToPm(entry.title)),
    ])
    : node('normRefMixed', withId(entry.id), inlinesToPm(entry.content))))
}

function childrenToPm(children: IRClauseChild[], path: string, errors: IRToPmDiagnostic[]): PMJsonNode[] {
  return children.map((child, index) => {
    const at = `${path}[${index}]`
    if (child.kind === 'clause') return clauseToPm(child, at, errors)
    if (child.kind === 'termEntry') return termToPm(child, at, errors)
    return blockToPm(child, at, errors)
  }).filter((item): item is PMJsonNode => !!item)
}

function clauseToPm(clause: IRClause, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  if (!clause.titled && clause.title.length > 0) {
    errors.push({ path: `${path}.title`, nodeId: clause.id, reason: '无题条不能携带非空title；生产schema无法区分隐藏标题与有效标题' })
  }
  return node('clause', withId(clause.id, { level: clause.level, hasTitle: clause.titled }), [
    node('clauseTitle', undefined, inlinesToPm(clause.title)),
    ...childrenToPm(clause.children, path, errors),
  ])
}

function chapterToPm(chapter: IRChapter, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  return node('chapter', withId(chapter.id, { secType: chapter.secType }), [
    node('chapterTitle', undefined, inlinesToPm(chapter.title)),
    ...childrenToPm(chapter.children, path, errors),
  ])
}

function appendixToPm(appendix: IRAppendix, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  return node('appendix', withId(appendix.id, { normative: appendix.normative }), [
    node('appendixLabel', undefined, [text(appendix.normative ? '（规范性）' : '（资料性）')]),
    node('appendixTitle', undefined, inlinesToPm(appendix.title)),
    ...childrenToPm(appendix.children, path, errors),
  ])
}

function bibEntryToPm(entry: IRBibEntry): PMJsonNode {
  const content = inlinesToPm(entry.content)
  const fields = nonEmpty(entry.fields).map(field => node('bibField', withId(field.id, { name: field.name }), inlinesToPm(field.value)))
  const identifiers = nonEmpty(entry.identifiers).map(identifier => node('bibIdentifier', withId(identifier.id, { scheme: identifier.scheme, value: identifier.value })))
  const externalLink = entry.externalLink ? [node('bibExternalLink', {
    href: entry.externalLink.href,
    title: entry.externalLink.title ?? null,
    target: entry.externalLink.target ?? null,
    rel: entry.externalLink.rel ?? null,
    displayText: entry.externalLink.displayText ?? entry.externalLink.title ?? entry.externalLink.href,
  })] : []
  if (fields.length || identifiers.length || externalLink.length) {
    content.push(node('bibStructured', undefined, [...fields, ...identifiers, ...externalLink]))
  }
  return node('bibEntry', withId(entry.id, { entryType: entry.entryType ?? null }), content)
}

function textOnlyField(inlines: IRInline[], path: string, id: string, errors: IRToPmDiagnostic[]): string {
  if (inlines.some(run => (run.marks?.length ?? 0) > 0 || !!run.style || !!run.formula || !!run.footnote)) {
    errors.push({ path, nodeId: id, reason: '生产schema将该字段存入纯字符串属性，无法保留IR中的行内格式或公式' })
  }
  return inlinePlainText(inlines)
}

function metadataToPm(meta: IRDocMeta, errors: IRToPmDiagnostic[]): PMJsonNode | undefined {
  const content: PMJsonNode[] = []
  for (const value of meta.titleParts ?? []) content.push(node('titlePart', withId(value.id, { lang: value.lang ?? null, role: value.role ?? null }), inlinesToPm(value.content)))
  for (const value of meta.identifiers ?? []) content.push(node('standardIdentifier', withId(value.id, { scheme: value.scheme ?? null, value: value.value ?? null }), value.parts.map(part => node('identifierPart', withId(part.id, { kind: part.kind, position: part.position ?? null }), inlinesToPm(part.content)))))
  for (const value of meta.languages ?? []) content.push(node('language', withId(value.id, { tag: value.tag, usage: value.usage ?? null })))
  for (const value of meta.publishers ?? []) content.push(node('publisher', withId(value.id, { role: value.role ?? null, identifier: value.identifier ?? null }), inlinesToPm(value.name)))
  for (const value of meta.adoptions ?? []) content.push(node('adoption', withId(value.id, { reference: value.reference, degree: value.degree ?? null, language: value.language ?? null })))
  for (const value of meta.replacedStandards ?? []) content.push(node('replacedStandard', withId(value.id, { reference: value.reference, relation: value.relation ?? null })))
  for (const value of meta.copyrights ?? []) content.push(node('copyright', withId(value.id, { holder: value.holder ? textOnlyField(value.holder, `meta.copyrights.${value.id}.holder`, value.id, errors) : null, year: value.year ?? null, language: value.language ?? null }), inlinesToPm(value.statement)))
  return content.length ? node('metadataBlock', undefined, content) : undefined
}

function inlinePlainText(inlines: IRInline[]): string { return inlines.map(item => item.text).join('') }

const REFERENCE_MARK_TYPES = new Set(['crossRef', 'bibRef', 'termRef'])

/** A semantic reference mark needs actual text or a formula atom to attach to in ProseMirror. */
function diagnoseReferenceRunsWithoutCarrier(value: unknown, path: string, ownerId: string | undefined, errors: IRToPmDiagnostic[]): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => diagnoseReferenceRunsWithoutCarrier(child, `${path}[${index}]`, ownerId, errors))
    return
  }
  if (!value || typeof value !== 'object') return

  const record = value as Record<string, unknown>
  const currentOwnerId = typeof record.id === 'string' ? record.id : ownerId
  if (typeof record.text === 'string' && record.text.length === 0 && !record.formula && Array.isArray(record.marks)) {
    record.marks.forEach((mark, index) => {
      if (!mark || typeof mark !== 'object' || Array.isArray(mark)) return
      const type = (mark as { type?: unknown }).type
      if (typeof type !== 'string' || !REFERENCE_MARK_TYPES.has(type)) return
      errors.push({
        path: `${path}.marks[${index}]`,
        nodeId: currentOwnerId,
        reason: `空文本上的${type}没有生产ProseMirror节点载体，投影会丢失目标引用`,
      })
    })
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === 'id') continue
    diagnoseReferenceRunsWithoutCarrier(child, `${path}.${key}`, currentOwnerId, errors)
  }
}

function metaToCover(meta: IRDocMeta): PmAttrs {
  const types: Record<IRDocMeta['standardType'], string> = {
    gb: 'national', industry: 'industry', local: 'local', group: 'group', enterprise: 'enterprise', guide: 'guidance',
  }
  return {
    standardNo: meta.stdCode ?? '', standardType: types[meta.standardType],
    titleCn: meta.title ?? '', titleEn: meta.titleEn ?? '',
    publishDate: meta.publishDate ?? '', implementDate: meta.implementDate ?? '',
    issuer: meta.issuer ?? '', icsCode: meta.icsCode ?? '', ccsCode: meta.ccsCode ?? '',
    replaces: meta.replaces ?? '', consistency: meta.consistency ?? '', filingNo: meta.filingNo ?? '',
    industryName: meta.industryName ?? '', regionName: meta.regionName ?? '', coverDesignation: meta.coverDesignation ?? '',
    applicant: meta.applicant ?? null, proposer: meta.proposer ?? null, technicalCommittee: meta.technicalCommittee ?? null,
  }
}

function indexToPm(index: NonNullable<IRDoc['index']>, errors: IRToPmDiagnostic[]): PMJsonNode {
  const groups = index.groups.map((group, groupIndex) => {
    if (group.entries.length === 0) {
      errors.push({ path: `index.groups[${groupIndex}].entries`, nodeId: group.id, reason: '生产indexGroup节点至少需要一个索引词条' })
    }
    return node('indexGroup', withId(group.id, { label: group.label ? textOnlyField(group.label, `index.groups.${group.id}.label`, group.id, errors) : null }), group.entries.map(entry => node('indexEntry', withId(entry.id), [
      node('indexTerm', undefined, inlinesToPm(entry.term)),
      ...entry.targets.map(targetId => node('indexTarget', { targetId })),
      ...entry.seeAlso.map(targetId => node('indexSeeAlso', { targetId })),
    ])))
  })
  return node('indexBlock', withId(index.id, { title: index.title ? textOnlyField(index.title, 'index.title', index.id, errors) : null }), groups)
}

/** Convert a newly constructed or imported IR document into production PM JSON. */
export function irToPm(doc: IRDoc, options: IRToPmOptions = {}): PMJsonNode {
  const rootType = options.rootType ?? 'doc'
  const errors: IRToPmDiagnostic[] = []
  diagnoseReferenceRunsWithoutCarrier(doc, 'doc', undefined, errors)
  diagnoseInlineProjection(doc, 'doc', undefined, errors)
  for (const issue of findCrossRefRunProjectionIssues(doc)) {
    if (issue.kind !== 'crossref-newline') continue
    errors.push({
      path: issue.path,
      ...(issue.nodeId === undefined ? {} : { nodeId: issue.nodeId }),
      reason: issue.reason,
    })
  }
  diagnoseFootnotePayloads(doc, errors)
  if (doc.unsupportedContent?.length) {
    errors.push(...doc.unsupportedContent.map(item => ({ path: item.path, nodeId: item.nodeId ?? undefined, reason: `${item.nodeType}: ${item.reason}` })))
  }
  if (doc.unmappedFootnotes?.length) {
    errors.push(...doc.unmappedFootnotes.map(item => ({ path: `unmappedFootnotes.${item.container}`, nodeId: item.nodeId, reason: item.reason ?? '脚注位置不能无损写回生产文档' })))
  }

  const content: PMJsonNode[] = []
  const hasScalarMeta = doc.meta.standardType !== 'gb' || Object.entries(metaToCover(doc.meta)).some(([key, value]) => key !== 'standardType' && value !== '' && value !== null && value !== undefined)
  const metadata = metadataToPm(doc.meta, errors)
  if (hasScalarMeta || rootType === 'standardDoc') content.push(node('coverPage', metaToCover(doc.meta), [node('paragraph')]))
  if (metadata) content.push(metadata)
  if (doc.front.foreword.length) content.push(node('foreword', undefined, blocksToPm(doc.front.foreword, 'front.foreword', errors)))
  // 引言：块在前、条在后（IR 约定，条之后不能再有引言正文块）；只有条时也要输出引言容器。
  const introduction = [
    ...blocksToPm(doc.front.introduction, 'front.introduction', errors),
    ...(doc.front.introductionClauses ?? []).map((clause, index) => clauseToPm(clause, `front.introductionClauses[${index}]`, errors)),
  ]
  if (introduction.length) content.push(node('introduction', undefined, introduction))
  doc.body.forEach((chapter, index) => content.push(chapterToPm(chapter, `body[${index}]`, errors)))
  doc.appendices.forEach((appendix, index) => content.push(appendixToPm(appendix, `appendices[${index}]`, errors)))
  // 参考文献标题（M-4.5.3-02）：自定义标题替换默认的“参考文献”；没有条目时容器不存在，标题无处安放，明确报错而非丢弃。
  if (doc.bibliographyTitle?.length && doc.bibliography.length === 0) {
    errors.push({ path: 'bibliographyTitle', reason: '生产 bibliography 容器要求至少一个文献条目，自定义标题无处保存' })
  }
  if (doc.bibliography.length) content.push(node('bibliography', undefined, [
    node('bibliographyTitle', undefined, doc.bibliographyTitle?.length ? inlinesToPm(doc.bibliographyTitle) : [text('参考文献')]),
    ...doc.bibliography.map(bibEntryToPm),
  ]))
  if (doc.index) content.push(indexToPm(doc.index, errors))
  for (const resource of doc.resources ?? []) {
    content.push(node('figureResource', withId(resource.id, {
      mediaType: resource.mediaType ?? null, name: resource.name ?? null,
      encoding: resource.encoding, data: resource.data,
    })))
  }

  if (rootType === 'standardDoc' && doc.body.length === 0) {
    errors.push({ path: 'body', reason: '生产standardDoc根至少需要一个chapter' })
  }
  if (rootType === 'doc' && content.length === 0) {
    errors.push({ path: 'doc.content', reason: '生产doc根至少需要一个内容节点' })
  }

  // Older IR snapshots did not carry a stable identity for table-footnote reference atoms.
  // Give those atoms deterministic document-local IDs without changing existing IDs.
  const usedIds = new Set<string>()
  const collectIds = (items: PMJsonNode[]): void => {
    for (const item of items) {
      const id = item.attrs?.nodeId
      if (typeof id === 'string' && id) usedIds.add(id)
      collectIds(item.content ?? [])
    }
  }
  collectIds(content)
  let generatedRefSeq = 0
  const completeReferenceIds = (items: PMJsonNode[]): void => {
    for (const item of items) {
      if (item.type === 'tableFootnoteRef' && !(typeof item.attrs?.nodeId === 'string' && item.attrs.nodeId)) {
        let id = ''
        do { generatedRefSeq += 1; id = `irTableFootnoteRef${generatedRefSeq}` } while (usedIds.has(id))
        usedIds.add(id)
        item.attrs = { ...item.attrs, nodeId: id }
      }
      completeReferenceIds(item.content ?? [])
    }
  }
  completeReferenceIds(content)

  if (errors.length) throw new IRToPmError(errors)
  const attrs = hasSemanticExtensions(doc) ? { extensionVersion: 1 } : undefined
  if (rootType === 'standardDoc') {
    const standardDocAttrs = attrs
      ? { ...attrs, standardType: metaToCover(doc.meta).standardType }
      : { standardType: metaToCover(doc.meta).standardType }
    return node('standardDoc', standardDocAttrs, content)
  }
  return node('doc', attrs, content)
}

// ---------- 写作片段（WP9.2b） ----------

export interface IRFragmentToPmOptions {
  /** 诊断路径的根名称，默认 `fragment`（节点为 `fragment[0]`、`fragment[1]` …）。 */
  rootPath?: string
}

const FRAGMENT_BLOCK_KINDS = new Set<string>([
  'paragraph', 'list', 'table', 'figure', 'formula', 'note', 'example', 'warning', 'quote', 'code',
])

function fragmentKindAllowed(kind: string, rules: FragmentContextRules): boolean {
  if (FRAGMENT_BLOCK_KINDS.has(kind)) return rules.blocks
  switch (kind) {
    case 'chapter': return rules.chapter
    case 'appendix': return rules.appendix
    case 'clause': return rules.clause
    case 'termEntry': return rules.termEntry
    case 'bibEntry': return rules.bibEntry
    default: return false
  }
}

/**
 * 片段里的表脚注引用必须自带 ID：整篇文档投影会为缺 ID 的引用补确定性 ID，
 * 但补 ID 需要文档级的已用 ID 集合，片段层面没有，宁可报错也不写出空 nodeId。
 */
function diagnoseTableFootnoteRefIds(value: unknown, path: string, errors: IRToPmDiagnostic[]): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => diagnoseTableFootnoteRefIds(child, `${path}[${index}]`, errors))
    return
  }
  if (!isRecord(value)) return
  if (Array.isArray(value.marks)) {
    value.marks.forEach((mark, index) => {
      if (!isRecord(mark) || mark.type !== 'tableFootnoteRef') return
      if (typeof mark.id === 'string' && mark.id.length > 0) return
      errors.push({ path: `${path}.marks[${index}]`, reason: '片段中的表脚注引用必须带有非空 id' })
    })
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'marks') continue
    diagnoseTableFootnoteRefIds(child, `${path}.${key}`, errors)
  }
}

/**
 * 把「插入到某个位置」的 IR 片段投影为该位置可放入的生产 PM JSON 节点列表。
 *
 * 与 {@link irToPm} 共用同一套节点转换函数，因此片段内每个节点的 PM 形态与整篇文档中完全一致；
 * 区别只在入口：片段没有文档级内容（封面、元数据、索引、资源），也不要求片段本身自成合法文档。
 * 返回的是 `context.parent` 的子节点列表，不含父节点本身（父节点由调用方在 PM 文档中已有）。
 *
 * 诊断沿用 {@link IRToPmError}：不可表示的内容、片段内容与上下文不符（如在前言里放章）、
 * 行内标记组合无法保留等，路径以 `rootPath`（默认 `fragment`）开头。
 *
 * 不计算任何编号；不检查 ID 唯一性（写作片段由 authoring.ts 的归一化保证，Resolver 兜底）。
 */
export function irFragmentToPm(
  nodes: readonly IRFragmentNode[],
  context: AuthoringContext,
  options: IRFragmentToPmOptions = {},
): PMJsonNode[] {
  const root = options.rootPath ?? 'fragment'
  const contextProblem = validateAuthoringContext(context)
  if (contextProblem) throw new IRToPmError([{ path: 'context', reason: contextProblem }])
  if (!Array.isArray(nodes)) throw new IRToPmError([{ path: root, reason: '片段必须是节点数组' }])

  const rules = fragmentContextRules(context)
  const errors: IRToPmDiagnostic[] = []
  diagnoseReferenceRunsWithoutCarrier(nodes, root, undefined, errors)
  diagnoseInlineProjection(nodes, root, undefined, errors)
  for (const issue of findCrossRefRunProjectionIssues(nodes, root)) {
    if (issue.kind !== 'crossref-newline') continue
    errors.push({
      path: issue.path,
      ...(issue.nodeId === undefined ? {} : { nodeId: issue.nodeId }),
      reason: issue.reason,
    })
  }
  diagnoseFootnotePayloads(nodes, errors, root)
  diagnoseTableFootnoteRefIds(nodes, root, errors)

  const out: PMJsonNode[] = []
  nodes.forEach((node, index) => {
    const path = `${root}[${index}]`
    const kind = isRecord(node) && typeof node.kind === 'string' ? node.kind : undefined
    if (kind === undefined || !fragmentKindAllowed(kind, rules)) {
      errors.push({
        path,
        ...(isRecord(node) && typeof node.id === 'string' ? { nodeId: node.id } : {}),
        reason: kind === undefined
          ? '片段节点缺少 kind'
          : `「${kind}」不能放在「${describeAuthoringContext(context)}」中`,
      })
      return
    }
    switch (node.kind) {
      case 'chapter': out.push(chapterToPm(node, path, errors)); break
      case 'appendix': out.push(appendixToPm(node, path, errors)); break
      case 'clause': out.push(clauseToPm(node, path, errors)); break
      case 'termEntry': out.push(termToPm(node, path, errors)); break
      case 'bibEntry': out.push(bibEntryToPm(node)); break
      default: {
        const pm = blockToPm(node, path, errors)
        if (pm) out.push(pm)
      }
    }
  })

  if (errors.length) throw new IRToPmError(errors)
  return out
}
