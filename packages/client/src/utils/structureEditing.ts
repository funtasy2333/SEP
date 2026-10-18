import type { Editor } from '@tiptap/core'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import {
  applyOutlineEdit, locateOutline, MAX_CLAUSE_LEVEL, MIN_CLAUSE_LEVEL,
  type OutlineFailureReason, type OutlineLeaf, type OutlineLocation,
} from './outlineEditing'
import { convertTextBlock, formatStdList } from './textBlockFormat'

/** 结构格式命令失败的原因：来自大纲核心的原因码，加上选区本身不能转换（invalid-selection）、被引用的块不能转换（referenced-block）。 */
export type StructureFailureReason = OutlineFailureReason | 'invalid-selection' | 'referenced-block'
export type StructureResult = { ok: true } | { ok: false; reason: StructureFailureReason }

const ok: StructureResult = { ok: true }
const fail = (reason: StructureFailureReason): StructureResult => ({ ok: false, reason })
const convertible = new Set(['stdListItem', 'note', 'example'])

interface ClauseTarget {
  /** clause：光标属于一个已有条（标题，或无题条的首个正文段）；block：光标在普通正文段落。 */
  kind: 'clause' | 'block'
  leaf: OutlineLeaf
  location: OutlineLocation
  offsets: [number, number]
}

/** 光标所在文本块对应的大纲目标；不是单个文本块或位置不允许时给出原因。 */
function clauseTarget(tr: Transaction): ClauseTarget | { reason: StructureFailureReason } {
  const { $from, $to } = tr.selection
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return { reason: 'invalid-selection' }
  const depth = $from.depth
  const leaf = $from.parent
  const offsets: [number, number] = [$from.parentOffset, $to.parentOffset]
  if (leaf.type.name === 'clauseTitle') {
    if ($from.node(depth - 1).type.name !== 'clause') return { reason: 'invalid-location' }
    const location = locateOutline($from, depth - 1)
    return location ? { kind: 'clause', leaf: 'title', location, offsets } : { reason: 'invalid-location' }
  }
  if (leaf.type.name !== 'stdParagraph') return { reason: 'invalid-location' }
  const parent = $from.node(depth - 1)
  // 规范的无题条：条文在首个正文段（紧随空的 clauseTitle）；对它改级/切换有题无题，作用于所在的条。
  if (parent.type.name === 'clause' && parent.attrs.hasTitle === false && $from.index(depth - 1) === 1) {
    const location = locateOutline($from, depth - 1)
    return location ? { kind: 'clause', leaf: 'first-paragraph', location, offsets } : { reason: 'invalid-location' }
  }
  const location = locateOutline($from, depth)
  return location ? { kind: 'block', leaf: 'paragraph', location, offsets } : { reason: 'invalid-location' }
}

function commit(editor: Editor, tr: Transaction): StructureResult {
  editor.view.dispatch(tr.scrollIntoView())
  editor.view.focus()
  return ok
}

/**
 * 将当前段落（含部分选中文字）、条标题、列项、注或示例设为 level 级条（hasTitle=false 为无题条）。
 * 按大纲方式只改这一条的级别：正文顺序不变，其后更深的条按级别重新归属；通过校验才改文档。
 * 无题条采用 IR 模型：clauseTitle 为空，条文在首个 stdParagraph。
 * 无题条切换为有题条是有题→无题的逆操作：首个直属块是 stdParagraph 时，其行内内容移入标题、该段删除、引用改指向条；
 * 首块不是段落（列项、注、无正文块）或内容放不进标题时只切换属性。
 * 列项/注/示例先在同一事务内像格式覆盖一样拆出段落，再走同一核心，失败则整体放弃。
 */
export function setClauseFormat(editor: Editor, level: number, hasTitle = true): StructureResult {
  if (!Number.isInteger(level) || level < MIN_CLAUSE_LEVEL || level > MAX_CLAUSE_LEVEL) return fail('out-of-range')
  const { state } = editor
  const { $from, $to } = state.selection
  if (!$from.sameParent($to)) return fail('invalid-selection')
  const tr = state.tr
  if (convertible.has($from.parent.type.name)) {
    const failure = convertTextBlock(state, tr, 'stdParagraph')
    if (failure) return fail(failure === 'referenced-block' ? 'referenced-block' : 'invalid-selection')
  }
  const target = clauseTarget(tr)
  if ('reason' in target) return fail(target.reason)
  const outcome = applyOutlineEdit(
    tr, target.location, { kind: target.kind === 'clause' ? 'set-clause' : 'make-clause', level, hasTitle }, target.leaf, target.offsets,
  )
  return outcome.ok ? commit(editor, tr) : outcome
}

/** 条 → 正文段落：标题项变为段落（保留 nodeId 与 marks），原子条按级别重新归属；列项/注/示例改为段落。 */
export function setParagraphFormat(editor: Editor): StructureResult {
  const { state } = editor
  const { $from, $to } = state.selection
  const tr = state.tr
  if (convertible.has($from.parent.type.name)) {
    const failure = convertTextBlock(state, tr, 'stdParagraph')
    return failure ? fail(failure === 'referenced-block' ? 'referenced-block' : 'invalid-selection') : commit(editor, tr)
  }
  if (!$from.sameParent($to)) return fail('invalid-selection')
  const leaf = $from.parent
  if (leaf.type.name === 'stdParagraph' || leaf.type.name === 'clauseTitle') {
    const parent = $from.node($from.depth - 1)
    // 正文段落（任何位置）本来就是段落；只有无题条的首个正文段需要解除该条编号。
    if (leaf.type.name === 'stdParagraph' && !(parent.type.name === 'clause' && parent.attrs.hasTitle === false && $from.index($from.depth - 1) === 1)) {
      editor.view.focus()
      return ok
    }
    const target = clauseTarget(tr)
    if ('reason' in target) return fail(target.reason)
    const outcome = applyOutlineEdit(tr, target.location, { kind: 'make-paragraph' }, target.leaf, target.offsets)
    return outcome.ok ? commit(editor, tr) : outcome
  }
  if (leaf.type.name === 'paragraph') {
    const parent = $from.node($from.depth - 1)
    const index = $from.index($from.depth - 1)
    // StarterKit list items require their first generic paragraph. Changing it
    // makes the replacement fitter invent an empty bullet before the real text.
    if (parent.type.name === 'listItem') {
      editor.view.focus()
      return ok
    }
    if (!parent.canReplaceWith(index, index + 1, state.schema.nodes.stdParagraph!)) return fail('invalid-location')
    const paragraphPos = $from.before($from.depth)
    tr.replaceWith(paragraphPos, $from.after($from.depth), state.schema.nodes.stdParagraph!.create(
      { nodeId: leaf.attrs.nodeId }, leaf.content, leaf.marks,
    ))
    tr.setSelection(TextSelection.create(tr.doc, paragraphPos + 1 + $from.parentOffset, paragraphPos + 1 + $to.parentOffset))
    return commit(editor, tr)
  }
  return fail('invalid-location')
}

/**
 * 列项格式命令：选中的列项变成目标类型的列项（前后部分保留原类型），正文段落/注/示例转为目标类型列项；
 * 只有空段落（无文字可转换）保持原来的插入新列表行为。文字、marks、nodeId 与引用都保留。
 * 其余不支持的位置或选区（不论空光标还是选区，例如条标题、章标题、术语名、表格单元格里）一律失败，
 * 文档与选区都不动：在那里插入列表会拆开 defining 的条/章/术语条目。
 */
export function setListFormat(editor: Editor, listType: string): StructureResult {
  const { state } = editor
  const tr = state.tr
  const failure = formatStdList(state, tr, listType)
  if (failure === null) return commit(editor, tr)
  if (failure === 'referenced-block') return fail('referenced-block')
  if (failure === 'unsupported') return fail('invalid-selection')
  return editor.chain().focus().insertStdList({ listType }).run() ? ok : fail('invalid-selection')
}

export type StructureAction = 'clause' | 'paragraph' | 'list'

const clauseMessages: Record<StructureFailureReason, string> = {
  'missing-parent': '缺少上级条：须先有上一级条（第一个条必须是一级条），才能设置该级别',
  'level-skip': '会造成层级跳级：条的级别只能比前一条深一级，或与其后条的级别连续',
  'hanging-paragraph': '会留下悬置段落：章（条）内有子条时，不能再有直属正文，请先把正文并入某个条',
  'untitled-with-children': '无题条不能再分条（GB/T 1.1 的无题条不得再设子条）',
  'invalid-location': '当前位置不允许设置条：条只能位于章或附录的正文中，不能用于表格、术语条目、前言等位置',
  'out-of-range': '条的级别须为一至五级，术语条目平移后也不能超过五级',
  'invalid-selection': '请将光标放在单个段落、条标题或列项内；跨段选区不能设置条',
  'referenced-block': '该内容整体被交叉引用，转换后引用会失效；请先修改或删除引用',
}
const paragraphMessages: Partial<Record<StructureFailureReason, string>> = {
  'missing-parent': '该条含有子条，改为段落后子条会缺少上级条；请先调整子条级别',
  'level-skip': '改为段落后其后的子条会跳级；请先调整子条级别',
  'hanging-paragraph': '改为段落会在含子条的章（条）里留下悬置段落；请先把正文并入某个条',
  'referenced-block': '该条（或整个列表）被引用，转为段落会让引用失去目标；请先删除或改指引用',
}

const listMessages: Partial<Record<StructureFailureReason, string>> = {
  'invalid-selection': '当前位置不能设置列项：请将光标放在正文段落、注、示例或列项内（标题、术语、表格单元格等位置不支持，选区也不能跨类型）；空段落中会插入新列表',
  'referenced-block': '该注/示例被交叉引用，转为列项后引用会失效；请先修改或删除引用',
}

/** 把失败原因码转成面向用户的中文提示（不同原因给出不同提示）。 */
export function structureFailureMessage(reason: StructureFailureReason, action: StructureAction = 'clause'): string {
  const specific = action === 'paragraph' ? paragraphMessages[reason] : action === 'list' ? listMessages[reason] : undefined
  return specific ?? clauseMessages[reason]
}
