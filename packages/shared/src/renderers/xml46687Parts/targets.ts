/**
 * P1 预扫描：每个可被引用对象的真实种类（WP8.2 设计 §2.0.1 P1、§2.11 “xref 目标映射”）。
 *
 * 渲染器按**目标的真实种类**决定 `ref-type`，不信任 `mark.targetKind`；种类不一致或没有 id 方案的目标
 * （段落、代码块、警告、摘录、规范性引用条目、图例项、式中项、无编号公式、术语示例、索引条目、行内公式）
 * 由 inline.ts 报 `xml-xref-target-unsupported`（D-X-06；R-9）。
 */

import type { IRBlock, IRClauseChild, IRDoc, IRTermEntry, NodeId } from '../../ir/types'
import { isRecord, type TargetInfo, type TargetKind } from './context'

/** xref 的 `ref-type`（及 `custom-type`）。 */
export interface XrefType {
  refType: 'sec' | 'app' | 'table' | 'fig' | 'disp-formula' | 'custom' | 'bibr' | 'list' | 'abbreviation'
  customType?: 'note' | 'example' | 'term-entry'
}

/**
 * 目标种类 → xref 类型；没有 id 方案的目标返回 undefined。
 * `index` 的 `rid` 是渲染器常量 `sec_index`（V-8 的 `sec` 目标含 `index`），其余取 `labels[t].xmlId`。
 */
export function xrefTypeOf(info: TargetInfo): XrefType | undefined {
  switch (info.kind) {
    case 'chapter': case 'clause': case 'index': return { refType: 'sec' }
    case 'appendix': return { refType: 'app' }
    case 'table': return { refType: 'table' }
    case 'figure': return { refType: 'fig' }
    case 'formula': return info.numbered ? { refType: 'disp-formula' } : undefined
    case 'note': case 'termNote': return { refType: 'custom', customType: 'note' }
    case 'example': return { refType: 'custom', customType: 'example' }
    case 'termEntry': return { refType: 'custom', customType: 'term-entry' }
    case 'bibEntry': return { refType: 'bibr' }
    case 'listItem': return { refType: 'list' }
    case 'abbreviation': return { refType: 'abbreviation' }
    default: return undefined
  }
}

/**
 * 引用内容取 run 自己的文本而不是 Resolver 的 `refText` 的目标：参考文献条目（D-X-10）、术语条目（`refText` 只是编号，
 * 正文要的是术语名）、索引（`refText` 在没有标题时就是内部 id）。
 */
export function xrefUsesRunText(info: TargetInfo): boolean {
  return info.kind === 'bibEntry' || info.kind === 'termEntry' || info.kind === 'index'
}

/** 目标种类的中文名，用于问题消息。 */
export const TARGET_DESCRIPTION: Readonly<Record<TargetKind, string>> = {
  chapter: '章', clause: '条', appendix: '附录', table: '表', figure: '图', formula: '公式', inlineFormula: '行内公式',
  note: '注', example: '示例', termNote: '术语条目中的注', termExample: '术语条目中的示例',
  listItem: '列项', abbreviation: '缩略语项', termEntry: '术语条目', bibEntry: '参考文献条目', index: '索引',
  paragraph: '段落', code: '代码块', warning: '警告', quote: '摘录', normRef: '规范性引用文件条目',
  legendItem: '图例项', whereItem: '“式中”项', indexEntry: '索引条目',
}

/** `crossRef.targetKind`（Resolver 的 `kinds` 取值）与渲染器种类的对应，用于核对 mark 声明的种类。 */
export function resolverKindOf(info: TargetInfo): string {
  switch (info.kind) {
    case 'inlineFormula': return 'formula'
    case 'termNote': return 'note'
    case 'termExample': return 'example'
    case 'termEntry': return 'term'
    case 'bibEntry': return 'bibliography'
    case 'legendItem': case 'whereItem': case 'indexEntry': return 'entity'
    default: return info.kind
  }
}

/** 一次遍历建立 `targets` 表（同一 id 出现多次时以第一次为准；重复 id 是 Resolver 的 error）。 */
export function buildTargets(doc: IRDoc): Map<NodeId, TargetInfo> {
  const targets = new Map<NodeId, TargetInfo>()
  const put = (id: NodeId, info: TargetInfo): void => { if (!targets.has(id)) targets.set(id, info) }

  const walkBlocks = (blocks: readonly IRBlock[], inTerm: boolean): void => {
    for (const block of blocks) walkBlock(block, inTerm)
  }
  const walkBlock = (block: IRBlock, inTerm: boolean): void => {
    switch (block.kind) {
      case 'paragraph':
        put(block.id, { kind: 'paragraph' })
        break
      case 'list': {
        const ordered = block.listType === 'alpha' || block.listType === 'number' || block.listType === 'roman' || block.listType === 'romanUpper'
        for (const item of block.items) {
          put(item.id, { kind: 'listItem', ordered })
          walkBlocks(item.content, inTerm)
        }
        break
      }
      case 'table':
        put(block.id, { kind: 'table' })
        for (const row of block.rows) for (const cell of row.cells) walkBlocks(cell.content, false)
        for (const note of block.notes) { put(note.id, { kind: 'note' }); walkBlocks(note.content, false) }
        break
      case 'figure':
        put(block.id, { kind: 'figure' })
        for (const note of block.notes) { put(note.id, { kind: 'note' }); walkBlocks(note.content, false) }
        for (const example of block.examples ?? []) { put(example.id, { kind: 'example' }); walkBlocks(example.content, false) }
        for (const item of block.legend?.items ?? []) put(item.id, { kind: 'legendItem' })
        break
      case 'formula':
        put(block.id, { kind: 'formula', numbered: block.numbered })
        for (const note of block.notes ?? []) put(note.id, { kind: 'note' })
        for (const item of block.whereList) put(item.id, { kind: 'whereItem' })
        break
      case 'note':
        put(block.id, { kind: inTerm ? 'termNote' : 'note' })
        walkBlocks(block.content, inTerm)
        break
      case 'example':
        put(block.id, { kind: inTerm ? 'termExample' : 'example' })
        walkBlocks(block.content, inTerm)
        break
      case 'warning':
        put(block.id, { kind: 'warning' })
        walkBlocks(block.content, inTerm)
        break
      case 'quote':
        put(block.id, { kind: 'quote' })
        walkBlocks(block.content, inTerm)
        break
      case 'code':
        put(block.id, { kind: 'code' })
        break
      case 'defList':
        for (const item of block.items) put(item.id, { kind: 'abbreviation' })
        break
      case 'normRefList':
        for (const entry of block.entries) put(entry.id, { kind: 'normRef' })
        break
    }
  }
  const walkTerm = (entry: IRTermEntry): void => {
    put(entry.id, { kind: 'termEntry' })
    walkBlocks(entry.definition, true)
    for (const note of entry.notes) { put(note.id, { kind: 'termNote' }); walkBlocks(note.content, true) }
    for (const example of entry.examples) { put(example.id, { kind: 'termExample' }); walkBlocks(example.content, true) }
    for (const nested of entry.nestedEntries ?? []) walkTerm(nested)
  }
  const walkChildren = (children: readonly IRClauseChild[]): void => {
    for (const child of children) {
      if (child.kind === 'clause') { put(child.id, { kind: 'clause' }); walkChildren(child.children) }
      else if (child.kind === 'termEntry') walkTerm(child)
      else walkBlock(child, false)
    }
  }

  walkBlocks(doc.front.foreword, false)
  walkBlocks(doc.front.introduction, false)
  walkChildren(doc.front.introductionClauses ?? [])
  for (const chapter of doc.body) { put(chapter.id, { kind: 'chapter' }); walkChildren(chapter.children) }
  for (const appendix of doc.appendices) { put(appendix.id, { kind: 'appendix' }); walkChildren(appendix.children) }
  for (const entry of doc.bibliography) put(entry.id, { kind: 'bibEntry' })
  if (doc.index) {
    put(doc.index.id, { kind: 'index' })
    for (const group of doc.index.groups) for (const entry of group.entries) put(entry.id, { kind: 'indexEntry' })
  }

  // 行内公式：任何位置的 run 上的 `formula`（通用深度遍历，不按块种类枚举，保证一个不漏）。
  const scanInlineFormulas = (value: unknown): void => {
    if (Array.isArray(value)) { for (const entry of value) scanInlineFormulas(entry); return }
    if (!isRecord(value)) return
    if (typeof value.text === 'string' && isRecord(value.formula) && typeof value.formula.id === 'string') {
      put(value.formula.id, { kind: 'inlineFormula' })
    }
    for (const child of Object.values(value)) scanInlineFormulas(child)
  }
  scanInlineFormulas(doc.front)
  scanInlineFormulas(doc.body)
  scanInlineFormulas(doc.appendices)
  scanInlineFormulas(doc.bibliography)
  scanInlineFormulas(doc.index)
  scanInlineFormulas(doc.meta)
  return targets
}
