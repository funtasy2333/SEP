import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'

/** Independent, unnumbered grid; the table child supplies the existing row/cell schema. */
export const AlignedArray = Node.create({
  name: 'alignedArray', group: 'block', content: 'table', defining: true,
  addAttributes() { return { columns: { default: null, rendered: false }, columnGroups: { default: null, rendered: false } } },
  parseHTML() { return [{ tag: 'div[data-type="aligned-array"]' }] },
  renderHTML({ HTMLAttributes }): DOMOutputSpec { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'aligned-array' }), 0] },
})
