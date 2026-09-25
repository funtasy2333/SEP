/**
 * DOCX XML 拼接工具（docs/wp7-docx-delivery.md §1.2、附录 B）。
 *
 * ECMA-376 对 WordprocessingML 的容器元素规定了固定的子元素顺序；顺序错了 Word 会报
 * 「无法读取的内容，是否尝试恢复」。本文件是附录 B 顺序清单的唯一落地处：
 * - `CHILD_ORDER` 是清单本身（测试从这里 import，不重新抄一份）；
 * - `joinOrderedChildren` 是通用排序拼接函数：调用方传 [元素名, xml] 列表，按清单顺序稳定
 *   排序后拼接子元素 XML（不含容器自身的包裹标签）；清单外的元素名直接抛错；
 * - `pPr`/`rPr`/`sectPr`/`lvl`/`num`/`style`/`tcPr`/`tbl`/`tr` 是它的薄包装，各自补上容器
 *   自身的包裹标签（`w:` 命名空间前缀）与可选属性。
 *
 * 此后各模块拼这些容器一律经过这里，不手写字符串。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

/** [元素名, 该元素的完整 XML 文本] */
export type XmlChild = readonly [name: string, xml: string]

/** 属性值：写入前统一转成字符串再转义 */
export type XmlAttrs = Record<string, string | number | boolean>

// ---------------- 转义 ----------------

/** 转义 XML 文本内容（用于 <w:t> 等元素的文本节点） */
export function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 转义 XML 属性值（额外转义双引号，因为属性值统一用双引号包裹） */
export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 把属性表格式化成 ` k="v" k2="v2"` 形式（前导空格；无属性时返回空串） */
export function formatXmlAttrs(attrs: XmlAttrs | undefined): string {
  if (!attrs) return ''
  let out = ''
  for (const [k, v] of Object.entries(attrs)) {
    out += ` ${k}="${escapeXmlAttr(String(v))}"`
  }
  return out
}

// ---------------- 附录 B 顺序清单 ----------------

/**
 * 顺序清单的一项：普通字符串表示独占一个名次；字符串数组表示这些元素名同享一个名次
 * （彼此之间「任意顺序」，但作为一组仍须排在名次更靠后的元素之前）。
 * 目前唯一的同名次分组是 sectPr 的 headerReference/footerReference（附录 B 原文标注）。
 */
type ChildOrderSpec = readonly (string | readonly string[])[]

/**
 * 附录 B 顺序清单，键为容器的本地元素名（不含 `w:`/`m:` 前缀）。
 * `personal…`（w:style）按 ECMA-376 CT_Style 展开为 personal/personalCompose/personalReply；
 * GB/T 样式表用不到这三个元素，展开只为让清单本身完整、经得起校验。
 */
const CHILD_ORDER: Record<string, ChildOrderSpec> = {
  pPr: [
    'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr',
    'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap',
    'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd',
    'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc',
    'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr',
    'sectPr', 'pPrChange',
  ],
  rPr: [
    'rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline',
    'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing',
    'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText',
    'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath',
  ],
  sectPr: [
    ['headerReference', 'footerReference'], // 任意顺序，最多 6 个
    'footnotePr', 'endnotePr', 'type', 'pgSz', 'pgMar', 'paperSrc', 'pgBorders', 'lnNumType',
    'pgNumType', 'cols', 'formProt', 'vAlign', 'noEndnote', 'titlePg', 'textDirection', 'bidi',
    'rtlGutter', 'docGrid', 'printerSettings',
  ],
  lvl: ['start', 'numFmt', 'lvlRestart', 'pStyle', 'isLgl', 'suff', 'lvlText', 'lvlPicBulletId', 'legacy', 'lvlJc', 'pPr', 'rPr'],
  num: ['abstractNumId', 'lvlOverride'],
  lvlOverride: ['startOverride', 'lvl'],
  style: [
    'name', 'aliases', 'basedOn', 'next', 'link', 'autoRedefine', 'hidden', 'uiPriority', 'semiHidden',
    'unhideWhenUsed', 'qFormat', 'locked', 'personal', 'personalCompose', 'personalReply', 'rsid',
    'pPr', 'rPr', 'tblPr', 'trPr', 'tcPr', 'tblStylePr',
  ],
  settings: ['mirrorMargins', 'defaultTabStop', 'evenAndOddHeaders', 'characterSpacingControl', 'updateFields', 'compat', 'm:mathPr'],
  tbl: ['tblPr', 'tblGrid', 'tr'],
  tr: ['trPr', 'tc'],
  tcPr: ['cnfStyle', 'tcW', 'gridSpan', 'hMerge', 'vMerge', 'tcBorders', 'shd', 'noWrap', 'tcMar', 'textDirection', 'tcFitText', 'vAlign', 'hideMark'],
}

/** 供测试引用的只读清单（键：容器本地名；值：顺序清单，含同名次分组） */
export function childOrderOf(containerName: string): ChildOrderSpec | undefined {
  return CHILD_ORDER[containerName]
}

/**
 * 把解析出的完整标签名（如 "w:pPr"、"m:mathPr"）映射成 CHILD_ORDER 用的本地名：
 * 去掉 `w:` 前缀（清单里的大多数名字隐含 w: 命名空间）；其余前缀原样保留
 * （如 `m:mathPr`，因为它是非 w: 命名空间，清单里也带着前缀登记）。
 */
export function localNameOf(qualifiedName: string): string {
  return qualifiedName.startsWith('w:') ? qualifiedName.slice(2) : qualifiedName
}

/**
 * containerName 的子元素名次表：key 为子元素名，value 为名次（越小越靠前，同名次表示「任意顺序」）。
 * containerName 不是附录 B 所列容器时返回 undefined——调用方（assertChildOrder）用它判断某个元素
 * 是不是需要做顺序校验的容器。
 */
export function rankMapFor(containerName: string): Map<string, number> | undefined {
  const spec = CHILD_ORDER[containerName]
  return spec ? rankMapOf(spec) : undefined
}

function rankMapOf(spec: ChildOrderSpec): Map<string, number> {
  const rank = new Map<string, number>()
  spec.forEach((entry, i) => {
    if (typeof entry === 'string') {
      rank.set(entry, i)
    } else {
      for (const name of entry) rank.set(name, i)
    }
  })
  return rank
}

/**
 * 按 `containerName` 在附录 B 的顺序清单，对 `children` 做稳定排序并拼接（只拼子元素 XML，
 * 不包含容器自身的包裹标签）。同名次或同名元素之间保持调用方传入的相对顺序（稳定排序），
 * 因此 lvlOverride*、tr+ 等允许重复的元素自然按原顺序排列。
 * 元素名不在清单里时抛错（提示容器名与元素名，便于定位）。
 */
export function joinOrderedChildren(containerName: string, children: readonly XmlChild[]): string {
  const spec = CHILD_ORDER[containerName]
  if (!spec) throw new Error(`xml.ts: 未知容器 "${containerName}"，附录 B 未定义顺序清单`)
  const rank = rankMapOf(spec)
  for (const [name] of children) {
    if (!rank.has(name)) {
      throw new Error(`xml.ts: 元素 "${name}" 不在 ${containerName} 的附录 B 子元素清单内`)
    }
  }
  return children
    .map((child, i) => ({ child, i, r: rank.get(child[0])! }))
    .sort((a, b) => (a.r !== b.r ? a.r - b.r : a.i - b.i))
    .map(({ child }) => child[1])
    .join('')
}

/** 包一层容器标签；无子元素内容时自闭合 */
export function wrapElement(name: string, innerXml: string, attrs?: XmlAttrs): string {
  const attrXml = formatXmlAttrs(attrs)
  return innerXml ? `<${name}${attrXml}>${innerXml}</${name}>` : `<${name}${attrXml}/>`
}

/** 排序 + 包裹的组合：按附录 B 顺序拼子元素，再包一层 `<w:{containerName}>` */
function orderedElement(containerName: string, children: readonly XmlChild[], attrs?: XmlAttrs): string {
  return wrapElement(`w:${containerName}`, joinOrderedChildren(containerName, children), attrs)
}

// ---------------- 9 个容器的薄包装（§9 WP7.1 列出的构造函数） ----------------

export function pPr(children: readonly XmlChild[], attrs?: XmlAttrs): string {
  return orderedElement('pPr', children, attrs)
}
export function rPr(children: readonly XmlChild[], attrs?: XmlAttrs): string {
  return orderedElement('rPr', children, attrs)
}
export function sectPr(children: readonly XmlChild[], attrs?: XmlAttrs): string {
  return orderedElement('sectPr', children, attrs)
}
export function lvl(children: readonly XmlChild[], attrs?: XmlAttrs): string {
  return orderedElement('lvl', children, attrs)
}
export function num(children: readonly XmlChild[], attrs?: XmlAttrs): string {
  return orderedElement('num', children, attrs)
}
export function style(children: readonly XmlChild[], attrs?: XmlAttrs): string {
  return orderedElement('style', children, attrs)
}
export function tcPr(children: readonly XmlChild[], attrs?: XmlAttrs): string {
  return orderedElement('tcPr', children, attrs)
}
export function tbl(children: readonly XmlChild[], attrs?: XmlAttrs): string {
  return orderedElement('tbl', children, attrs)
}
export function tr(children: readonly XmlChild[], attrs?: XmlAttrs): string {
  return orderedElement('tr', children, attrs)
}
