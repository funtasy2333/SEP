import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { jsonAttribute } from './json-attribute'

/** Independent, unnumbered grid; the table child supplies the existing row/cell schema. */
export const AlignedArray = Node.create({
  name: 'alignedArray', group: 'block', content: 'table', defining: true,
  addAttributes() { return { columns: jsonAttribute('data-columns'), columnGroups: jsonAttribute('data-column-groups', value => {
    if (value == null) return
    if (!Array.isArray(value)) throw new RangeError('数组列组必须是数组')
    let end = 0
    for (const group of value) {
      if (!group || typeof group !== 'object' || Array.isArray(group)) throw new RangeError('数组列组无效')
      const { start, count } = group as Record<string, unknown>
      if (Object.keys(group).some(key => key !== 'start' && key !== 'count') || typeof start !== 'number' || typeof count !== 'number'
        || !Number.isInteger(start) || !Number.isInteger(count) || start < end || count < 1) throw new RangeError('数组列组无效')
      end = start + count
    }
  }) } },
  parseHTML() { return [{ tag: 'div[data-type="aligned-array"]' }] },
  renderHTML({ HTMLAttributes }): DOMOutputSpec { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'aligned-array' }), 0] },
})
