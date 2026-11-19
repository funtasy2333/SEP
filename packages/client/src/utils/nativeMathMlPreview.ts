const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'

const presentationElements = new Set([
  'math', 'semantics', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'ms', 'mspace', 'mfrac', 'msqrt', 'mroot',
  'mstyle', 'merror', 'mpadded', 'mphantom', 'mfenced', 'menclose', 'msub', 'msup', 'msubsup',
  'munder', 'mover', 'munderover', 'mmultiscripts', 'mprescripts', 'none', 'mtable', 'mtr', 'mlabeledtr', 'mtd',
])

const presentationAttributes = new Set([
  'accent', 'accentunder', 'align', 'bevelled', 'close', 'columnalign', 'columnlines', 'columnspacing', 'columnspan',
  'depth', 'displaystyle', 'fence', 'form', 'frame', 'framespacing', 'height', 'largeop', 'linethickness', 'lspace',
  'mathbackground', 'mathcolor', 'mathsize', 'mathvariant', 'maxsize', 'minsize', 'movablelimits', 'notation', 'open',
  'rowalign', 'rowlines', 'rowspacing', 'rowspan', 'rspace', 'scriptlevel', 'separator', 'separators', 'stretchy',
  'symmetric', 'voffset', 'width',
])

/** 克隆用于预览的呈现元素。文档中的 MathML 原文保留在模型中，不直接插入编辑器 DOM。 */
export function renderNativeMathMl(source: string): Element | null {
  const root = new DOMParser().parseFromString(source, 'application/xml').documentElement
  if (root.localName !== 'math' || (root.namespaceURI !== MATHML_NS && root.namespaceURI !== null)) return null
  const namespace = root.namespaceURI

  function clone(element: Element): Element | null {
    if (element.namespaceURI !== namespace || !presentationElements.has(element.localName)) return null
    const result = document.createElementNS(MATHML_NS, element.localName)
    for (const attr of element.attributes) {
      if (!attr.namespaceURI && presentationAttributes.has(attr.localName)) result.setAttribute(attr.localName, attr.value)
    }
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
        result.append(child.textContent ?? '')
      } else if (child instanceof Element) {
        const rendered = clone(child)
        if (rendered) result.append(rendered)
      }
    }
    return result
  }

  const math = clone(root)
  math?.setAttribute('display', 'block')
  return math
}
