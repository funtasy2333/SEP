import { Mark, mergeAttributes } from '@tiptap/core'

/** Persisted IR subscript formatting mapped to the native HTML sub element. */
export const Subscript = Mark.create({
  name: 'subscript',

  parseHTML() {
    return [{ tag: 'sub' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['sub', mergeAttributes(HTMLAttributes), 0]
  },
})

/** Persisted IR superscript formatting mapped to the native HTML sup element. */
export const Superscript = Mark.create({
  name: 'superscript',

  parseHTML() {
    return [{
      tag: 'sup',
      // These typed sup elements are atomic footnote references, not text marks.
      getAttrs: element => ['footnote-ref', 'table-footnote-ref'].includes(element.getAttribute('data-type') ?? '')
        ? false
        : null,
    }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes), 0]
  },
})
