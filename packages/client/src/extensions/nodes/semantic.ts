import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'

function safeExternalHref(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const href = value.trim()
  if (!href || /[\u0000-\u0020]/.test(href)) return null
  return /^(https?:\/\/|mailto:|tel:)/i.test(href) ? href : null
}

/** Tiptap's implicit parser coerces numeric/boolean-looking strings; these fields are textual. */
function stringAttribute(name: string, defaultValue: string | null = null) {
  return { default: defaultValue, parseHTML: (element: HTMLElement) => element.getAttribute(name) ?? defaultValue }
}

/** Navigation is filtered separately from the stored authoring value. JSON protects control characters in HTML. */
function externalHrefAttribute() {
  return {
    default: '',
    parseHTML: (element: HTMLElement) => {
      const payload = element.getAttribute('data-external-href')
      if (payload !== null) {
        try {
          const value: unknown = JSON.parse(payload)
          if (typeof value === 'string') return value
        } catch { /* External tagged HTML may omit a valid editor payload. */ }
      }
      return element.getAttribute('href') ?? ''
    },
  }
}

/** Read the editable slot only; external plain tagged HTML can use the element itself. */
function contentSlot(className: string): (element: HTMLElement) => HTMLElement {
  return element => element.querySelector<HTMLElement>(`:scope > .${className}`) ?? element
}

/** Metadata stored in PM JSON on the root/legacy cover nodes as a typed fallback. */
export const MetadataFields = Extension.create({
  name: 'metadataFields',

  addGlobalAttributes() {
    const typedFields = [
      'titleParts', 'identifiers', 'languages', 'publishers', 'adoptions',
      'replacedStandards', 'copyrights',
    ]
    const persistedFallbacks = Object.fromEntries(typedFields.map((name) => [name, {
      default: null,
      // These structured values are persisted by the PM JSON document. The visible
      // metadataBlock nodes are the editable representation; this is the root fallback.
      renderHTML: () => ({}),
    }]))
    return [
      { types: ['doc', 'standardDoc', 'coverPage'], attributes: persistedFallbacks },
      {
        types: ['doc', 'standardDoc'],
        attributes: { extensionVersion: { default: null, renderHTML: () => ({}) } },
      },
    ]
  },
})

/** Visible structured metadata. Small scalar records render as readable inline chips. */
export const MetadataBlock = Node.create({
  name: 'metadataBlock',
  group: 'block',
  content: '(titlePart | standardIdentifier | language | publisher | adoption | replacedStandard | copyright)*',
  defining: true,

  parseHTML() {
    return [{ tag: 'section[data-type="metadata-block"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['section', mergeAttributes(HTMLAttributes, {
      'data-type': 'metadata-block',
      class: 'std-metadata-block',
    }), 0]
  },
})

export const TitlePart = Node.create({
  name: 'titlePart',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      lang: stringAttribute('lang'),
      role: stringAttribute('role'),
    }
  },

  parseHTML() {
    return [{ tag: '[data-type="title-part"]', priority: 51, contentElement: contentSlot('std-title-part-content') }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const labels = [node.attrs.lang, node.attrs.role].filter(Boolean).map(String)
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'title-part',
      class: 'std-title-part',
    }),
    ...(labels.length ? [['span', { class: 'std-metadata-label' }, labels.join(' · ')]] as DOMOutputSpec[] : []),
    ['span', { class: 'std-title-part-content' }, 0]]
  },
})

export const StandardIdentifier = Node.create({
  name: 'standardIdentifier',
  group: 'block',
  content: 'identifierPart*',
  defining: true,

  addAttributes() {
    return {
      scheme: stringAttribute('scheme'),
      value: stringAttribute('value'),
    }
  },

  parseHTML() {
    return [{ tag: '[data-type="standard-identifier"]', priority: 51, contentElement: contentSlot('std-identifier-parts') }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const children: DOMOutputSpec[] = []
    if (node.attrs.scheme) children.push(['span', { class: 'std-metadata-label' }, String(node.attrs.scheme)])
    if (node.attrs.value) children.push(['span', { class: 'std-identifier-value' }, String(node.attrs.value)])
    children.push(['div', { class: 'std-identifier-parts' }, 0])
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'standard-identifier',
      class: 'std-identifier',
    }), ...children]
  },
})

export const IdentifierPart = Node.create({
  name: 'identifierPart',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      kind: stringAttribute('kind', ''),
      position: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: '[data-type="identifier-part"]', priority: 51, contentElement: contentSlot('std-identifier-part-content') }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-type': 'identifier-part',
      class: 'std-identifier-part',
      'data-kind': node.attrs.kind,
      'data-position': node.attrs.position,
    }),
    ['span', { class: 'std-metadata-label' }, `${String(node.attrs.kind || 'part')}${node.attrs.position ? ` ${node.attrs.position}` : ''}: `],
    ['span', { class: 'std-identifier-part-content' }, 0]]
  },
})

export const MetadataLanguage = Node.create({
  name: 'language',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      tag: stringAttribute('tag', ''),
      usage: stringAttribute('usage'),
    }
  },

  parseHTML() {
    return [{ tag: '[data-type="metadata-language"]' }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const label = [node.attrs.tag, node.attrs.usage].filter(Boolean).join(' · ')
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-type': 'metadata-language',
      class: 'std-metadata-language',
    }), label]
  },
})

export const Publisher = Node.create({
  name: 'publisher',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      role: stringAttribute('role'),
      identifier: stringAttribute('identifier'),
    }
  },

  parseHTML() {
    return [{ tag: '[data-type="publisher"]', priority: 51, contentElement: contentSlot('std-publisher-content') }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const labels = [node.attrs.role, node.attrs.identifier].filter(Boolean).map(String)
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'publisher',
      class: 'std-publisher',
    }),
    ...(labels.length ? [['span', { class: 'std-metadata-label' }, labels.join(' · ')]] as DOMOutputSpec[] : []),
    ['span', { class: 'std-publisher-content' }, 0]]
  },
})

export const Adoption = Node.create({
  name: 'adoption',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      reference: stringAttribute('reference', ''),
      degree: stringAttribute('degree'),
      language: stringAttribute('language'),
    }
  },

  parseHTML() {
    return [{ tag: '[data-type="adoption"]' }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const detail = [node.attrs.degree, node.attrs.language].filter(Boolean).join(' · ')
    const value = [node.attrs.reference, detail].filter(Boolean).join(' — ')
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-type': 'adoption',
      class: 'std-adoption',
    }), value]
  },
})

export const ReplacedStandard = Node.create({
  name: 'replacedStandard',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      reference: stringAttribute('reference', ''),
      relation: stringAttribute('relation'),
    }
  },

  parseHTML() {
    return [{ tag: '[data-type="replaced-standard"]' }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const value = [node.attrs.reference, node.attrs.relation].filter(Boolean).join(' — ')
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-type': 'replaced-standard',
      class: 'std-replaced-standard',
    }), value]
  },
})

export const Copyright = Node.create({
  name: 'copyright',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      holder: stringAttribute('holder'),
      year: stringAttribute('year'),
      language: stringAttribute('language'),
    }
  },

  parseHTML() {
    return [{ tag: '[data-type="copyright"]', priority: 51, contentElement: contentSlot('std-copyright-content') }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const labels = [node.attrs.holder, node.attrs.year, node.attrs.language].filter(Boolean).map(String)
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'copyright',
      class: 'std-copyright',
    }),
    ...(labels.length ? [['span', { class: 'std-metadata-label' }, labels.join(' · ')]] as DOMOutputSpec[] : []),
    ['span', { class: 'std-copyright-content' }, 0]]
  },
})

/** Explicit TBX language and term structure; descriptors belong to one visible variant. */
export const TbxLangSet = Node.create({
  name: 'tbxLangSet',
  group: 'block',
  content: 'tbxTig+',
  defining: true,

  addAttributes() {
    return { lang: stringAttribute('lang', '') }
  },

  parseHTML() {
    return [{ tag: '[data-type="tbx-lang-set"]', priority: 51, contentElement: contentSlot('std-tbx-lang-set-content') }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    return ['section', mergeAttributes(HTMLAttributes, {
      'data-type': 'tbx-lang-set',
      class: 'std-tbx-lang-set',
    }), ['header', { class: 'std-tbx-language' }, String(node.attrs.lang ?? '')], ['div', { class: 'std-tbx-lang-set-content' }, 0]]
  },
})

export const TbxTig = Node.create({
  name: 'tbxTig',
  group: 'block',
  content: 'tbxTermVariant+',
  defining: true,

  parseHTML() {
    return [{ tag: '[data-type="tbx-tig"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'tbx-tig',
      class: 'std-tbx-tig',
    }), 0]
  },
})

export const TbxTermVariant = Node.create({
  name: 'tbxTermVariant',
  group: 'block',
  content: 'tbxTerm tbxTermDescriptor*',
  defining: true,

  parseHTML() {
    return [{ tag: '[data-type="tbx-term-variant"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'tbx-term-variant',
      class: 'std-tbx-term-variant',
    }), 0]
  },
})

export const TbxTerm = Node.create({
  name: 'tbxTerm',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: '[data-type="tbx-term"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'tbx-term',
      class: 'std-tbx-term',
    }), 0]
  },
})

export const TbxTermDescriptor = Node.create({
  name: 'tbxTermDescriptor',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-descriptor-type') ?? element.getAttribute('type') ?? '',
      },
    }
  },

  parseHTML() {
    return [{ tag: '[data-type="tbx-term-descriptor"]', priority: 51, contentElement: contentSlot('std-tbx-descriptor-value') }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'tbx-term-descriptor',
      'data-descriptor-type': node.attrs.type,
      class: 'std-tbx-term-descriptor',
    }), ['span', { class: 'std-tbx-descriptor-label' }, `${String(node.attrs.type || 'descriptor')}: `], ['span', { class: 'std-tbx-descriptor-value' }, 0]]
  },
})

export const FormulaNote = Node.create({
  name: 'formulaNote',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: '[data-type="formula-note"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'formula-note',
      class: 'std-formula-note',
    }), 0]
  },
})

export const WhereList = Node.create({
  name: 'whereList',
  group: 'block',
  content: 'whereItem+',
  defining: true,

  parseHTML() {
    return [{ tag: '[data-type="where-list"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['dl', mergeAttributes(HTMLAttributes, {
      'data-type': 'where-list',
      class: 'std-where-list',
    }), 0]
  },
})

export const WhereItem = Node.create({
  name: 'whereItem',
  group: 'block',
  content: 'whereTerm whereDefinition',
  defining: true,

  parseHTML() {
    return [{ tag: '[data-type="where-item"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'where-item',
      class: 'std-where-item',
    }), 0]
  },
})

export const WhereTerm = Node.create({
  name: 'whereTerm',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: '[data-type="where-term"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['dt', mergeAttributes(HTMLAttributes, { 'data-type': 'where-term' }), 0]
  },
})

export const WhereDefinition = Node.create({
  name: 'whereDefinition',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: '[data-type="where-definition"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['dd', mergeAttributes(HTMLAttributes, { 'data-type': 'where-definition' }), 0]
  },
})

export const FormulaInline = Node.create({
  name: 'formulaInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      mathml: stringAttribute('mathml'),
      latex: stringAttribute('latex'),
      source: stringAttribute('source'),
    }
  },

  parseHTML() {
    return [{ tag: '[data-type="formula-inline"]' }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const label = node.attrs.latex ?? (node.attrs.mathml ? '［MathML公式源］' : '［行内公式］')
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-type': 'formula-inline',
      class: 'std-formula-inline',
      contenteditable: 'false',
    }), String(label)]
  },
})

/** Flat table attributes; every measure has an explicit unit attribute. */
const rowMeasureAttrs = {
  height: { default: null },
  heightUnit: stringAttribute('heightUnit'),
  borderColor: stringAttribute('borderColor'),
  borderWidth: { default: null },
  borderWidthUnit: stringAttribute('borderWidthUnit'),
  backgroundColor: stringAttribute('backgroundColor'),
  borderTop: { default: null }, borderTopUnit: stringAttribute('borderTopUnit'),
  borderRight: { default: null }, borderRightUnit: stringAttribute('borderRightUnit'),
  borderBottom: { default: null }, borderBottomUnit: stringAttribute('borderBottomUnit'),
  borderLeft: { default: null }, borderLeftUnit: stringAttribute('borderLeftUnit'),
}

const cellMeasureAttrs = {
  borderTop: { default: null }, borderTopUnit: stringAttribute('borderTopUnit'),
  borderRight: { default: null }, borderRightUnit: stringAttribute('borderRightUnit'),
  borderBottom: { default: null }, borderBottomUnit: stringAttribute('borderBottomUnit'),
  borderLeft: { default: null }, borderLeftUnit: stringAttribute('borderLeftUnit'),
  paddingTop: { default: null }, paddingTopUnit: stringAttribute('paddingTopUnit'),
  paddingRight: { default: null }, paddingRightUnit: stringAttribute('paddingRightUnit'),
  paddingBottom: { default: null }, paddingBottomUnit: stringAttribute('paddingBottomUnit'),
  paddingLeft: { default: null }, paddingLeftUnit: stringAttribute('paddingLeftUnit'),
}

const cellUnitAttribute = {
  default: null,
  parseHTML: (element: HTMLElement) => element.getAttribute('data-unit') ?? element.getAttribute('unit'),
}

/** The visible unit badge is presentation; only the content hole belongs to a pasted cell. */
function cellContentElement(element: HTMLElement): HTMLElement {
  return element.querySelector<HTMLElement>(':scope > .std-table-cell-wrapper > .std-table-cell-content') ?? element
}

function renderCell(node: { attrs: Record<string, unknown> }, tag: 'td' | 'th', HTMLAttributes: Record<string, unknown>): DOMOutputSpec {
  const attributes = { ...HTMLAttributes }
  delete attributes.unit
  if (typeof node.attrs.unit === 'string' && node.attrs.unit.length > 0) attributes['data-unit'] = node.attrs.unit
  const cellChildren: DOMOutputSpec[] = []
  if (typeof node.attrs.unit === 'string' && node.attrs.unit.length > 0) {
    cellChildren.push(['span', {
      class: 'std-table-cell-unit',
      contenteditable: 'false',
      'aria-label': `单位 ${node.attrs.unit}`,
    }, node.attrs.unit])
  }
  cellChildren.push(['div', { class: 'std-table-cell-content' }, 0])
  return [tag, mergeAttributes(attributes), ['div', { class: 'std-table-cell-wrapper' }, ...cellChildren]]
}

export const StandardTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: stringAttribute('textAlign'),
      verticalAlign: stringAttribute('verticalAlign'),
      ...rowMeasureAttrs,
    }
  },
})

export const StandardTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      cellType: stringAttribute('cellType'),
      unit: cellUnitAttribute,
      width: { default: null },
      widthUnit: stringAttribute('widthUnit'),
      textAlign: stringAttribute('textAlign'),
      verticalAlign: stringAttribute('verticalAlign'),
      backgroundColor: stringAttribute('backgroundColor'),
      ...cellMeasureAttrs,
    }
  },

  parseHTML() {
    return (this.parent?.() ?? []).map(rule => ({ ...rule, contentElement: cellContentElement }))
  },

  renderHTML({ node, HTMLAttributes }) {
    return renderCell(node, 'td', HTMLAttributes)
  },
})

export const StandardTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      cellType: stringAttribute('cellType'),
      unit: cellUnitAttribute,
      width: { default: null },
      widthUnit: stringAttribute('widthUnit'),
      textAlign: stringAttribute('textAlign'),
      verticalAlign: stringAttribute('verticalAlign'),
      backgroundColor: stringAttribute('backgroundColor'),
      ...cellMeasureAttrs,
    }
  },

  parseHTML() {
    return (this.parent?.() ?? []).map(rule => ({ ...rule, contentElement: cellContentElement }))
  },

  renderHTML({ node, HTMLAttributes }) {
    return renderCell(node, 'th', HTMLAttributes)
  },
})

export const FigureGroup = Node.create({
  name: 'figureGroup',
  group: 'block',
  content: 'figureDescription* figureResourceRef*',
  defining: true,

  parseHTML() {
    return [{ tag: '[data-type="figure-group"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'figure-group',
      class: 'std-figure-group',
    }), 0]
  },
})

export const FigureDescription = Node.create({
  name: 'figureDescription',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: '[data-type="figure-description"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'figure-description',
      class: 'std-figure-description',
    }), 0]
  },
})

export const FigureResource = Node.create({
  name: 'figureResource',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      mediaType: stringAttribute('mediaType'),
      name: stringAttribute('name'),
      encoding: stringAttribute('encoding', 'dataUrl'),
      data: {
        default: '',
        parseHTML: element => {
          const raw = element.getAttribute('data-resource-payload')
          if (raw === null) return ''
          try {
            const data: unknown = JSON.parse(raw)
            return typeof data === 'string' ? data : raw
          } catch {
            return raw
          }
        },
        // JSON escaping keeps CR, NUL and other text payload characters intact in clipboard HTML.
        renderHTML: attributes => ({ 'data-resource-payload': JSON.stringify(attributes.data) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: '[data-type="figure-resource"]' }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const label = node.attrs.name || node.attrs.mediaType || '图资源'
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'figure-resource',
      class: 'std-figure-resource',
    }), String(label)]
  },
})

export const FigureResourceRef = Node.create({
  name: 'figureResourceRef',
  group: 'block',
  atom: true,

  addAttributes() {
    return { targetId: stringAttribute('targetId', '') }
  },

  parseHTML() {
    return [{ tag: '[data-type="figure-resource-ref"]' }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-type': 'figure-resource-ref',
      class: 'std-figure-resource-ref',
    }), `资源 ${node.attrs.targetId ?? ''}`]
  },
})

export const BibStructured = Node.create({
  name: 'bibStructured',
  group: 'inline',
  inline: true,
  content: 'bibField* bibIdentifier* bibExternalLink?',
  defining: true,

  parseHTML() {
    return [{ tag: '[data-type="bib-structured"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-type': 'bib-structured',
      class: 'std-bib-structured',
    }), 0]
  },
})

export const BibField = Node.create({
  name: 'bibField',
  group: 'inline',
  inline: true,
  content: 'inline*',
  defining: true,

  addAttributes() {
    return { name: stringAttribute('name', '') }
  },

  parseHTML() {
    return [{ tag: '[data-type="bib-field"]', priority: 51, contentElement: contentSlot('std-bib-field-value') }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-type': 'bib-field',
      'data-field-name': node.attrs.name,
      class: 'std-bib-field',
    }), ['span', { class: 'std-bib-field-label' }, `${String(node.attrs.name || 'field')}: `], ['span', { class: 'std-bib-field-value' }, 0]]
  },
})

export const BibIdentifier = Node.create({
  name: 'bibIdentifier',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      scheme: stringAttribute('scheme', ''),
      value: stringAttribute('value', ''),
    }
  },

  parseHTML() {
    return [{ tag: '[data-type="bib-identifier"]' }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-type': 'bib-identifier',
      'data-scheme': node.attrs.scheme,
      class: 'std-bib-identifier',
    }), `${node.attrs.scheme ? `${node.attrs.scheme}: ` : ''}${node.attrs.value ?? ''}`]
  },
})

export const BibExternalLink = Node.create({
  name: 'bibExternalLink',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      href: externalHrefAttribute(),
      title: stringAttribute('title'),
      displayText: stringAttribute('displayText'),
      target: stringAttribute('target'),
      rel: stringAttribute('rel'),
    }
  },

  parseHTML() {
    return [{ tag: '[data-type="bib-external-link"]', priority: 51 }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    return ['a', mergeAttributes(HTMLAttributes, {
      'data-type': 'bib-external-link',
      'data-external-href': JSON.stringify(node.attrs.href),
      href: safeExternalHref(node.attrs.href),
      title: node.attrs.title,
      target: node.attrs.target,
      rel: node.attrs.rel,
      class: 'std-bib-external-link',
    }), String(node.attrs.displayText || node.attrs.title || node.attrs.href || '')]
  },
})

export const IndexBlock = Node.create({
  name: 'indexBlock',
  group: 'block',
  content: 'indexGroup*',
  defining: true,

  addAttributes() {
    return { title: stringAttribute('title') }
  },

  parseHTML() {
    return [{ tag: 'section[data-type="index"]', priority: 51, contentElement: contentSlot('std-index-content') }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const title = node.attrs.title ? String(node.attrs.title) : '索引'
    return ['section', mergeAttributes(HTMLAttributes, {
      'data-type': 'index',
      class: 'std-index',
    }), ['h2', { class: 'std-index-title' }, title], ['div', { class: 'std-index-content' }, 0]]
  },
})

export const IndexGroup = Node.create({
  name: 'indexGroup',
  group: 'block',
  content: 'indexEntry+',
  defining: true,

  addAttributes() {
    return { label: stringAttribute('label') }
  },

  parseHTML() {
    return [{ tag: '[data-type="index-group"]', priority: 51, contentElement: contentSlot('std-index-group-content') }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const label = node.attrs.label ? String(node.attrs.label) : ''
    const children: DOMOutputSpec[] = []
    if (label) children.push(['h3', { class: 'std-index-group-label' }, label])
    children.push(['div', { class: 'std-index-group-content' }, 0])
    return ['section', mergeAttributes(HTMLAttributes, {
      'data-type': 'index-group',
      class: 'std-index-group',
    }), ...children]
  },
})

export const IndexEntry = Node.create({
  name: 'indexEntry',
  group: 'block',
  content: 'indexTerm indexTarget* indexSeeAlso*',
  defining: true,

  parseHTML() {
    return [{ tag: '[data-type="index-entry"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'index-entry',
      class: 'std-index-entry',
    }), 0]
  },
})

export const IndexTerm = Node.create({
  name: 'indexTerm',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: '[data-type="index-term"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'index-term',
      class: 'std-index-term',
    }), 0]
  },
})

export const IndexTarget = Node.create({
  name: 'indexTarget',
  group: 'block',
  atom: true,

  addAttributes() {
    return { targetId: stringAttribute('targetId', '') }
  },

  parseHTML() {
    return [{ tag: '[data-type="index-target"]' }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-type': 'index-target',
      class: 'std-index-target',
    }), `目标 ${node.attrs.targetId ?? ''}`]
  },
})

export const IndexSeeAlso = Node.create({
  name: 'indexSeeAlso',
  group: 'block',
  atom: true,

  addAttributes() {
    return { targetId: stringAttribute('targetId', '') }
  },

  parseHTML() {
    return [{ tag: '[data-type="index-see-also"]' }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-type': 'index-see-also',
      class: 'std-index-see-also',
    }), `参见 ${node.attrs.targetId ?? ''}`]
  },
})

export const WarningBlock = Node.create({
  name: 'warning',
  group: 'block',
  content: 'block+',
  defining: true,

  parseHTML() {
    return [{ tag: 'aside[data-type="warning"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['aside', mergeAttributes(HTMLAttributes, {
      'data-type': 'warning',
      class: 'std-warning',
    }), 0]
  },
})

export const QuoteBlock = Node.create({
  name: 'quoteBlock',
  group: 'block',
  content: 'block+',
  defining: true,

  parseHTML() {
    return [{ tag: 'blockquote[data-type="quote-block"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['blockquote', mergeAttributes(HTMLAttributes, {
      'data-type': 'quote-block',
      class: 'std-quote-block',
    }), 0]
  },
})

export const SemanticCodeBlock = Node.create({
  name: 'codeBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,

  addAttributes() {
    return { language: stringAttribute('language') }
  },

  parseHTML() {
    return [{ tag: 'pre[data-type="code-block"]' }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    return ['pre', mergeAttributes(HTMLAttributes, {
      'data-type': 'code-block',
      'data-language': node.attrs.language,
      class: 'std-code-block',
    }), ['code', {}, 0]]
  },
})

const textStyleCss = {
  fontFamily: 'font-family', fontSize: 'font-size', color: 'color',
  backgroundColor: 'background-color', letterSpacing: 'letter-spacing',
  baseline: 'vertical-align', textTransform: 'text-transform',
} as const

export const TextStyle = Mark.create({
  name: 'textStyle',
  inclusive: true,

  addAttributes() {
    return Object.fromEntries(Object.entries(textStyleCss).map(([name, cssName]) => [name, {
      default: null,
      parseHTML: (element: HTMLElement) => element.style.getPropertyValue(cssName) || element.getAttribute(name) || null,
    }]))
  },

  parseHTML() {
    return [{ tag: 'span[data-type="text-style"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const visibleAttrs = { ...HTMLAttributes }
    delete visibleAttrs.fontFamily
    delete visibleAttrs.fontSize
    delete visibleAttrs.color
    delete visibleAttrs.backgroundColor
    delete visibleAttrs.letterSpacing
    delete visibleAttrs.baseline
    delete visibleAttrs.textTransform
    const css: string[] = []
    for (const [key, cssName] of Object.entries(textStyleCss)) {
      const value = HTMLAttributes[key]
      if (typeof value === 'string' && value.length > 0) css.push(`${cssName}: ${value}`)
    }
    return ['span', mergeAttributes(visibleAttrs, {
      'data-type': 'text-style',
      class: 'std-text-style',
      style: css.join('; '),
    }), 0]
  },
})

export const Variable = Mark.create({
  name: 'variable',
  inclusive: false,

  addAttributes() {
    return {
      kind: stringAttribute('kind'),
      name: stringAttribute('name'),
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="variable"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-type': 'variable',
      'data-kind': HTMLAttributes.kind,
      'data-variable-name': HTMLAttributes.name,
      'aria-label': [HTMLAttributes.kind, HTMLAttributes.name].filter(Boolean).join(' '),
      class: 'std-variable',
    }), 0]
  },
})

export const ExternalLink = Mark.create({
  name: 'externalLink',
  inclusive: false,

  addAttributes() {
    return {
      href: externalHrefAttribute(),
      title: stringAttribute('title'),
      target: stringAttribute('target'),
      rel: stringAttribute('rel'),
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-type="external-link"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, {
      'data-type': 'external-link',
      'data-external-href': JSON.stringify(HTMLAttributes.href),
      href: safeExternalHref(HTMLAttributes.href),
      title: HTMLAttributes.title,
      target: HTMLAttributes.target,
      rel: HTMLAttributes.rel,
      class: 'std-external-link',
    }), 0]
  },
})

function referenceMark(name: 'bibRef' | 'termRef', dataType: string, className: string) {
  return Mark.create({
    name,
    inclusive: false,

    addAttributes() {
      return { targetId: stringAttribute('targetId') }
    },

    parseHTML() {
      return [{ tag: `a[data-type="${dataType}"]`, priority: 51 }]
    },

    renderHTML({ HTMLAttributes }) {
      return ['a', mergeAttributes(HTMLAttributes, {
        'data-type': dataType,
        href: HTMLAttributes.targetId ? `#${HTMLAttributes.targetId}` : null,
        class: className,
      }), 0]
    },
  })
}

export const BibRef = referenceMark('bibRef', 'bib-ref', 'std-bib-ref')
export const TermRef = referenceMark('termRef', 'term-ref', 'std-term-ref')
