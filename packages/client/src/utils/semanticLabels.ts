import { pmToIr, resolve, type PMJsonNode, type ResolvedLabel } from '@ses/shared'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'

const editorLabels = new WeakMap<PMNode, Readonly<Record<string, ResolvedLabel>>>()
const standaloneTableEditorLabels = new WeakMap<PMNode, Readonly<Record<string, ResolvedLabel>>>()

const proseSections = new Set(['chapter', 'appendix', 'foreword', 'introduction'])
const isPlainText = (node: PMNode) => node.isText && node.marks.length === 0

/** A plain-text edit inside unreferenced prose cannot change any Resolver label. */
export function reuseEditorLabelsForTextEdit(transactions: readonly Transaction[], before: PMNode, after: PMNode) {
  const labels = editorLabels.get(before)
  const tr = transactions[0]
  if (!labels || transactions.length !== 1 || tr?.before !== before || tr.doc !== after || tr.steps.length !== 1) return
  const step = tr.steps[0]
  if (!(step instanceof ReplaceStep) || step.slice.openStart || step.slice.openEnd) return
  const from = before.resolve(step.from)
  if (!from.sameParent(before.resolve(step.to)) || from.depth < 2 || from.parent.type.name !== 'stdParagraph') return

  const id = from.parent.attrs.nodeId
  // A paragraph target's displayed reference text is derived from its content.
  if (typeof id !== 'string' || !id || labels[id]) return
  if (!proseSections.has(from.node(1).type.name)) return
  for (let depth = 2; depth < from.depth; depth += 1) {
    if (from.node(depth).type.name !== 'clause') return
  }
  if (!from.parent.content.content.every(isPlainText) || !step.slice.content.content.every(isPlainText)) return
  editorLabels.set(after, labels)
}

/**
 * 弹窗单表子编辑器根节点只含单个无表题的 `stdTable`；
 * `pmToIr()` 仅转换位于章/附录等节内的表格，因此投影解析标签时临时套一层 `chapter` 与空 `tableCaption`，
 * 让表注与表脚注编号（a/b/c、注1/注2）在弹窗内同样正确显示。
 */
export function wrapStandaloneStdTableForLabels(docJson: PMJsonNode): PMJsonNode {
  if (docJson.type !== 'doc') return docJson
  const meaningful = (docJson.content ?? []).filter(
    child => !((child.type === 'paragraph' || child.type === 'stdParagraph') && (child.content?.length ?? 0) === 0),
  )
  if (meaningful.length !== 1 || meaningful[0]?.type !== 'stdTable') {
    return docJson
  }
  const table = meaningful[0]
  const tableContent = table.content ?? []
  const hasCaption = tableContent.some(child => child.type === 'tableCaption')
  return {
    type: 'doc',
    content: [{
      type: 'chapter',
      attrs: { nodeId: '_modal_label_chapter' },
      content: [
        { type: 'chapterTitle' },
        hasCaption
          ? table
          : {
              ...table,
              content: [{ type: 'tableCaption' }, ...tableContent],
            },
      ],
    }],
  }
}

/** Reuse Resolver labels while transactions share the same immutable ProseMirror document. */
export function resolveEditorLabels(
  doc: PMNode,
  options?: { wrapStandaloneTable?: boolean },
): Readonly<Record<string, ResolvedLabel>> {
  const wrapStandaloneTable = options?.wrapStandaloneTable === true
  const cache = wrapStandaloneTable ? standaloneTableEditorLabels : editorLabels
  const cached = cache.get(doc)
  if (cached) return cached
  const source = doc.toJSON() as PMJsonNode
  const projected = wrapStandaloneTable ? wrapStandaloneStdTableForLabels(source) : source
  const { labels } = resolve(pmToIr(projected).doc)
  cache.set(doc, labels)
  return labels
}

/** Resolve presentation labels without storing counters or generated IDs in the document. */
export function semanticLabels(source: PMJsonNode) {
  const ids = new Set<string>()
  const collect = (node: PMJsonNode): void => {
    if (typeof node.attrs?.nodeId === 'string') ids.add(node.attrs.nodeId)
    node.content?.forEach(collect)
  }
  collect(source)
  const sourceIds = new WeakMap<PMJsonNode, string>()
  const numbered = new Set(['chapter', 'clause', 'termDef', 'appendix', 'stdTable', 'table', 'figure', 'formula', 'example', 'exampleBlock', 'bibEntry'])
  let serial = 0
  const project = (node: PMJsonNode): PMJsonNode => {
    const copy: PMJsonNode = { ...node, attrs: node.attrs ? { ...node.attrs } : undefined }
    let id = node.attrs?.nodeId
    if (numbered.has(node.type) && (typeof id !== 'string' || !id)) {
      do { id = `_view_${++serial}` } while (ids.has(id as string))
      ids.add(id as string)
      copy.attrs = { ...copy.attrs, nodeId: id }
    }
    if (typeof id === 'string') sourceIds.set(node, id)
    if (node.content) copy.content = node.content.map(project)
    return copy
  }
  const labels = resolve(pmToIr(project(source)).doc).labels
  return {
    labels,
    labelFor: (node: PMJsonNode) => labels[sourceIds.get(node) ?? '']?.label ?? '?',
  }
}
