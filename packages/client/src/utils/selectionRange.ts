import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { Selection } from '@tiptap/pm/state'

/** from 与 to 之间是否只有块的开闭边界（没有文字、也没有被整块跨过的节点，如表格、图片）。 */
function onlyBoundariesBetween(doc: PMNode, from: number, to: number): boolean {
  if (from >= to) return true
  let skipped = false
  doc.nodesBetween(from, to, (node, pos) => {
    if (skipped) return false
    if (pos >= from && pos + node.nodeSize <= to) skipped = true
    return !skipped
  })
  return !skipped
}

/** 从 a 走到 b 要进出的节点（共同祖先以下）里有没有 isolating 节点（表格、单元格、图、公式、章、附录……）。 */
function crossesIsolating(doc: PMNode, a: number, b: number): boolean {
  const $a = doc.resolve(a), $b = doc.resolve(b)
  const shared = $a.sharedDepth(b)
  for (const $p of [$a, $b]) {
    for (let depth = $p.depth; depth > shared; depth -= 1) if ($p.node(depth).type.spec.isolating) return true
  }
  return false
}

/** 只隔着普通块边界（没有被跨过的内容，也不进出表格、图等 isolating 节点）。 */
const adjacent = (doc: PMNode, a: number, b: number) => onlyBoundariesBetween(doc, a, b) && !crossesIsolating(doc, a, b)

/** $pos 所在文本块之前、紧邻的文本块末尾；中间隔着其他内容时返回 null。 */
function previousTextblockEnd(doc: PMNode, $pos: ResolvedPos): number | null {
  const found = Selection.findFrom(doc.resolve($pos.before()), -1, true)
  if (!found) return null
  return adjacent(doc, found.head, $pos.pos) ? found.head : null
}

/** $pos 所在文本块之后、紧邻的文本块开头；中间隔着其他内容时返回 null。 */
function nextTextblockStart(doc: PMNode, $pos: ResolvedPos): number | null {
  const found = Selection.findFrom(doc.resolve($pos.after()), 1, true)
  if (!found) return null
  return adjacent(doc, $pos.pos, found.head) ? found.head : null
}

/**
 * 去掉跨块选区两端“看不见”的部分，返回用户实际看到的选区范围。
 *
 * 浏览器里拖选到行尾、Shift+↓ 选中一整行时，选区终点常常落在下一个文本块的开头（偏移 0）；
 * 从上一行行尾开始拖选时，起点落在上一个文本块的末尾。屏幕上那一块没有任何文字被选中，
 * 但 ProseMirror 认为选区跨进了这一块：复制时会带上一个空的列项/段落（粘贴后多出空白条），
 * 格式命令也会把这一块一起转换（例如把下一个空段落变成空列项）。
 *
 * 只裁剪紧邻的普通块边界：与相邻文本块之间隔着表格、图片等内容，或要进出表格、图、章等 isolating 节点时保持原样；
 * 裁剪后不会越过另一端。
 */
export function visibleBlockRange(doc: PMNode, from: number, to: number): { from: number; to: number } {
  if (from >= to) return { from, to }
  let $from = doc.resolve(from)
  let $to = doc.resolve(to)
  if ($from.sameParent($to)) return { from, to }
  if ($to.parent.isTextblock && $to.parentOffset === 0) {
    const end = previousTextblockEnd(doc, $to)
    if (end !== null && end >= from) $to = doc.resolve(end)
  }
  if (!$from.sameParent($to) && $from.parent.isTextblock && $from.parentOffset === $from.parent.content.size) {
    const start = nextTextblockStart(doc, $from)
    if (start !== null && start <= $to.pos) $from = doc.resolve(start)
  }
  return { from: $from.pos, to: $to.pos }
}
