/**
 * DOCX 包级别检查（docs/wp7-docx-delivery.md §10.2 helpers/checks.ts）。
 *
 * 每个渲染测试都要跑这两项，外加「同一输入两次输出深度相等」「JSON 往返深度相等」
 * （那两项不需要辅助函数，测试里直接 toEqual 即可）。
 *
 * 这是测试代码（属于 shared 测试基建），不从任何 index.ts 导出，同样不得使用 Node 或浏览器
 * 专有 API。
 */

import { localNameOf, rankMapFor } from '../../xml'
import type { DocxPackage } from '../../types'
import { findChild, parseXml, type XmlElement } from './xmlTree'

function extensionOf(path: string): string {
  const i = path.lastIndexOf('.')
  return i === -1 ? '' : path.slice(i + 1).toLowerCase()
}

/** `.../_rels/xxx.rels` 所描述部件的「所在目录」：relationship 的 Target 相对它解析 */
function relsOwnerDir(relsPath: string): string {
  const idx = relsPath.indexOf('_rels/')
  if (idx === -1) throw new Error(`assertWellFormed: 不是 .rels 部件路径: "${relsPath}"`)
  return relsPath.slice(0, idx)
}

/** 拼接目录与相对路径，归一化 "./" 前缀（我们自己的生成器不会产出 "../"，不处理） */
function resolveRelativeTarget(ownerDir: string, target: string): string {
  const cleaned = target.startsWith('./') ? target.slice(2) : target
  return ownerDir + cleaned
}

/**
 * 每个部件都能被 xmlTree 解析；`[Content_Types].xml` 为每个部件（Override）或每种二进制
 * 扩展名（Default）给出内容类型；每个 `.rels` 的 Target 都能在包内找到（不含 External）。
 */
export function assertWellFormed(pkg: DocxPackage): void {
  const trees: Record<string, XmlElement> = {}
  for (const [path, xml] of Object.entries(pkg.parts)) {
    try {
      trees[path] = parseXml(xml)
    } catch (e) {
      throw new Error(`assertWellFormed: 部件 "${path}" 解析失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const contentTypesTree = trees['[Content_Types].xml']
  if (!contentTypesTree) throw new Error('assertWellFormed: 缺少 [Content_Types].xml')
  const defaultsByExt = new Map<string, string>()
  const overridesByPart = new Map<string, string>()
  for (const child of contentTypesTree.children) {
    if (child.kind !== 'element') continue
    if (child.name === 'Default') {
      const ext = child.attrs.Extension
      const ct = child.attrs.ContentType
      if (ext === undefined || ct === undefined) throw new Error('assertWellFormed: Default 缺少 Extension/ContentType')
      defaultsByExt.set(ext.toLowerCase(), ct)
    } else if (child.name === 'Override') {
      const partName = child.attrs.PartName
      const ct = child.attrs.ContentType
      if (partName === undefined || ct === undefined) throw new Error('assertWellFormed: Override 缺少 PartName/ContentType')
      overridesByPart.set(partName.startsWith('/') ? partName.slice(1) : partName, ct)
    }
  }

  const hasContentType = (path: string): boolean => overridesByPart.has(path) || defaultsByExt.has(extensionOf(path))

  for (const path of Object.keys(pkg.parts)) {
    if (path === '[Content_Types].xml') continue
    if (path.endsWith('.xml')) {
      // .xml 部件必须有显式 Override：光靠 `Default Extension="xml"` 兜底会让 Word 无法
      // 靠 [Content_Types].xml 识别出哪个是主文档/styles/settings，即便每个部件都「有」内容
      // 类型（来自那条通用 Default）。.rels 等非 .xml 扩展名不受这条限制，Default 足够。
      if (!overridesByPart.has(path)) {
        throw new Error(`assertWellFormed: [Content_Types].xml 没有给 XML 部件 "${path}" 声明 Override 内容类型`)
      }
      continue
    }
    if (!hasContentType(path)) throw new Error(`assertWellFormed: [Content_Types].xml 没有给部件 "${path}" 声明内容类型`)
  }
  for (const path of Object.keys(pkg.binaries)) {
    if (!hasContentType(path)) throw new Error(`assertWellFormed: [Content_Types].xml 没有给二进制部件 "${path}" 声明内容类型`)
  }

  const packageHas = (path: string): boolean => Object.prototype.hasOwnProperty.call(pkg.parts, path) || Object.prototype.hasOwnProperty.call(pkg.binaries, path)

  // relsPath -> 该 .rels 内的 Id 集合（同时检查 Id 在文件内不重复，WP7.2 增补）
  const relationshipIdsByRelsPath = new Map<string, Set<string>>()

  for (const [path, tree] of Object.entries(trees)) {
    if (!path.endsWith('.rels')) continue
    const ownerDir = relsOwnerDir(path)
    const ids = new Set<string>()
    for (const child of tree.children) {
      if (child.kind !== 'element' || child.name !== 'Relationship') continue
      const id = child.attrs.Id
      if (id !== undefined) {
        if (ids.has(id)) throw new Error(`assertWellFormed: "${path}" 内的关系 Id "${id}" 重复`)
        ids.add(id)
      }
      if (child.attrs.TargetMode === 'External') continue // 外部链接不在包内，不检查 Target
      const target = child.attrs.Target
      if (target === undefined) throw new Error(`assertWellFormed: "${path}" 中的 Relationship 缺少 Target`)
      const resolved = resolveRelativeTarget(ownerDir, target)
      if (!packageHas(resolved)) {
        throw new Error(`assertWellFormed: "${path}" 中的关系 Target="${target}"（解析为 "${resolved}"）在包内不存在（悬空关系）`)
      }
    }
    relationshipIdsByRelsPath.set(path, ids)
  }

  // r:id / r:embed / r:link 检查（WP7.2 增补）：值必须在该部件自己的 .rels 里有同 Id 的 Relationship
  const R_ID_ATTRS = ['r:id', 'r:embed', 'r:link'] as const
  for (const [path, tree] of Object.entries(trees)) {
    if (path.endsWith('.rels')) continue
    const refs: { attr: string; value: string }[] = []
    collectRIdRefs(tree, R_ID_ATTRS, refs)
    if (refs.length === 0) continue
    const relsPath = relsPathFor(path)
    const ids = relationshipIdsByRelsPath.get(relsPath)
    if (!ids) {
      throw new Error(`assertWellFormed: 部件 "${path}" 引用了 ${refs[0].attr}="${refs[0].value}"，但没有对应的关系文件 "${relsPath}"`)
    }
    for (const ref of refs) {
      if (!ids.has(ref.value)) {
        throw new Error(`assertWellFormed: 部件 "${path}" 的 ${ref.attr}="${ref.value}" 在 "${relsPath}" 里找不到对应的 Relationship`)
      }
    }
  }
}

/** Footnote package contract: refs, definitions, settings, relationship, and content type agree. */
export function assertFootnoteIntegrity(pkg: DocxPackage): void {
  const documentXml = pkg.parts['word/document.xml']
  if (!documentXml) throw new Error('assertFootnoteIntegrity: 缺少 word/document.xml')
  const documentTree = parseXml(documentXml)
  const references: XmlElement[] = []
  collectNamed(documentTree, 'w:footnoteReference', references)
  const footnotesXml = pkg.parts['word/footnotes.xml']
  if (references.length === 0 && footnotesXml === undefined) return
  if (footnotesXml === undefined) throw new Error('assertFootnoteIntegrity: document.xml 有脚注引用但缺少 word/footnotes.xml')
  if (references.length === 0) throw new Error('assertFootnoteIntegrity: footnotes.xml 存在但 document.xml 没有脚注引用')

  const relsXml = pkg.parts['word/_rels/document.xml.rels']
  if (!relsXml) throw new Error('assertFootnoteIntegrity: 缺少 document.xml.rels')
  const relsTree = parseXml(relsXml)
  const footnoteRels = relsTree.children.filter((child): child is XmlElement =>
    child.kind === 'element' && child.name === 'Relationship' &&
    child.attrs.Type === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes')
  if (footnoteRels.length !== 1 || footnoteRels[0]?.attrs.Target !== 'footnotes.xml') {
    throw new Error('assertFootnoteIntegrity: footnotes.xml relationship 缺失或不唯一')
  }

  const contentTypesTree = parseXml(pkg.parts['[Content_Types].xml'] ?? '')
  const footnoteOverride = contentTypesTree.children.find((child): child is XmlElement =>
    child.kind === 'element' && child.name === 'Override' && child.attrs.PartName === '/word/footnotes.xml')
  if (footnoteOverride?.attrs.ContentType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml') {
    throw new Error('assertFootnoteIntegrity: footnotes.xml content type override 缺失或错误')
  }

  const settingsTree = parseXml(pkg.parts['word/settings.xml'] ?? '')
  const footnotePr = findChild(settingsTree, 'w:footnotePr')
  if (!footnotePr || findChild(footnotePr, 'w:pos')?.attrs['w:val'] !== 'pageBottom' ||
      findChild(footnotePr, 'w:numFmt')?.attrs['w:val'] !== 'decimal' ||
      findChild(footnotePr, 'w:numStart')?.attrs['w:val'] !== '1' ||
      findChild(footnotePr, 'w:numRestart')?.attrs['w:val'] !== 'continuous') {
    throw new Error('assertFootnoteIntegrity: 脚注位置或连续编号设置错误')
  }

  const footnotesTree = parseXml(footnotesXml)
  const definitions = footnotesTree.children.filter((child): child is XmlElement =>
    child.kind === 'element' && child.name === 'w:footnote')
  const ids = new Set<string>()
  const separators = new Map<string, string>()
  for (const definition of definitions) {
    const id = definition.attrs['w:id']
    if (!id || ids.has(id)) throw new Error(`assertFootnoteIntegrity: 脚注定义 ID 缺失或重复: "${id ?? ''}"`)
    ids.add(id)
    const type = definition.attrs['w:type']
    if (type) separators.set(type, id)
    else {
      if (!/^\d+$/.test(id)) throw new Error(`assertFootnoteIntegrity: 正文脚注 ID 非正整数: "${id}"`)
      const styles: XmlElement[] = []
      collectNamed(definition, 'w:pStyle', styles)
      if (!styles.some((style) => style.attrs['w:val'] === 'SesFootnoteText')) {
        throw new Error(`assertFootnoteIntegrity: 脚注 ${id} 缺少小五脚注段落样式`)
      }
      const markerRuns: XmlElement[] = []
      collectNamed(definition, 'w:vertAlign', markerRuns)
      const text = collectText(definition).join('')
      if (!markerRuns.some((run) => run.attrs['w:val'] === 'superscript') || !text.startsWith(`${id})`)) {
        throw new Error(`assertFootnoteIntegrity: 脚注 ${id} 缺少 resolver 自定义上标标识`)
      }
    }
  }
  if (separators.get('separator') !== '-1' || separators.get('continuationSeparator') !== '0') {
    throw new Error('assertFootnoteIntegrity: 缺少 separator / continuationSeparator 特殊条目')
  }
  for (const type of ['separator', 'continuationSeparator']) {
    const definition = definitions.find((item) => item.attrs['w:type'] === type)!
    const borders: XmlElement[] = []
    collectNamed(definition, 'w:top', borders)
    const nativeMarks: XmlElement[] = []
    collectNamed(definition, `w:${type}`, nativeMarks)
    if (borders.length !== 1 || nativeMarks.length !== 0) {
      throw new Error(`assertFootnoteIntegrity: ${type} 必须只含自定义单条细边框`)
    }
  }
  for (const reference of references) {
    const id = reference.attrs['w:id']
    if (!id || !ids.has(id) || reference.attrs['w:customMarkFollows'] !== '1') {
      throw new Error(`assertFootnoteIntegrity: 脚注引用 ID "${id ?? ''}" 无定义或未标记 customMarkFollows`)
    }
  }
}

function collectNamed(node: XmlElement, name: string, out: XmlElement[]): void {
  if (node.name === name) out.push(node)
  for (const child of node.children) if (child.kind === 'element') collectNamed(child, name, out)
}

function collectText(node: XmlElement): string[] {
  const out: string[] = []
  const visit = (item: XmlElement): void => {
    for (const child of item.children) {
      if (child.kind === 'text') out.push(child.text)
      else visit(child)
    }
  }
  visit(node)
  return out
}

/** 部件路径 → 它自己的 .rels 部件路径（如 "word/document.xml" → "word/_rels/document.xml.rels"） */
function relsPathFor(partPath: string): string {
  const idx = partPath.lastIndexOf('/')
  const dir = idx === -1 ? '' : partPath.slice(0, idx + 1)
  const filename = idx === -1 ? partPath : partPath.slice(idx + 1)
  return `${dir}_rels/${filename}.rels`
}

function collectRIdRefs(node: XmlElement, attrNames: readonly string[], out: { attr: string; value: string }[]): void {
  for (const attr of attrNames) {
    const v = node.attrs[attr]
    if (v !== undefined) out.push({ attr, value: v })
  }
  for (const child of node.children) {
    if (child.kind === 'element') collectRIdRefs(child, attrNames, out)
  }
}

/**
 * 遍历所有部件，附录 B 所列容器（用 xml.ts 的清单，不重新抄一份）的子元素必须是清单的
 * 子序列——名次必须非递减；`sectPr` 开头的 headerReference/footerReference 同名次，
 * 彼此之间不算顺序错误。出现清单外的子元素也算失败。
 */
export function assertChildOrder(pkg: DocxPackage): void {
  for (const [path, xml] of Object.entries(pkg.parts)) {
    const tree = parseXml(xml)
    walk(tree, path)
  }
}

function walk(node: XmlElement, partPath: string): void {
  const key = localNameOf(node.name)
  const rank = rankMapFor(key)
  if (rank) checkOrder(node, key, rank, partPath)
  for (const child of node.children) {
    if (child.kind === 'element') walk(child, partPath)
  }
}

function checkOrder(node: XmlElement, containerKey: string, rank: Map<string, number>, partPath: string): void {
  let lastRank = -1
  let lastName = ''
  for (const child of node.children) {
    if (child.kind !== 'element') continue
    const childKey = localNameOf(child.name)
    const r = rank.get(childKey)
    if (r === undefined) {
      throw new Error(
        `assertChildOrder: 部件 "${partPath}" 中 <w:${containerKey}> 的子元素 "${child.name}" 不在附录 B 清单内`,
      )
    }
    if (r < lastRank) {
      throw new Error(
        `assertChildOrder: 部件 "${partPath}" 中 <w:${containerKey}> 的子元素顺序错误：` +
          `"${child.name}" 出现在 "${lastName}" 之后，但附录 B 里排在它前面`,
      )
    }
    lastRank = r
    lastName = child.name
  }
}

/**
 * 编号完整性检查（WP7.2 增补，§10.2）：
 * - word/numbering.xml 里每个 `w:num` 引用的 `abstractNumId` 都存在；
 * - document.xml、styles.xml 里段落/样式引用的 `numId` 都在 numbering.xml 中（`numId="0"` 表示
 *   显式无编号，不检查）；
 * - 每个 (abstractNumId, ilvl) 至多被一个样式的样式级 numPr 引用（§4.1 约束 1：一个编号级别
 *   只能绑定一个属主样式，两个样式同时引用会被 Word 悄悄丢弃第二个）。
 */
export function assertNumberingIntegrity(pkg: DocxPackage): void {
  const numberingXml = pkg.parts['word/numbering.xml']
  if (numberingXml === undefined) throw new Error('assertNumberingIntegrity: 包内没有 word/numbering.xml')
  const numberingTree = parseXml(numberingXml)

  const abstractNumIds = new Set<string>()
  const numToAbstract = new Map<string, string>()
  for (const child of numberingTree.children) {
    if (child.kind !== 'element') continue
    if (child.name === 'w:abstractNum') {
      const id = child.attrs['w:abstractNumId']
      if (id !== undefined) abstractNumIds.add(id)
    } else if (child.name === 'w:num') {
      const numId = child.attrs['w:numId']
      const abstractId = findChild(child, 'w:abstractNumId')?.attrs['w:val']
      if (numId === undefined) continue
      if (abstractId === undefined) throw new Error(`assertNumberingIntegrity: num "${numId}" 缺少 abstractNumId`)
      if (!abstractNumIds.has(abstractId)) {
        throw new Error(`assertNumberingIntegrity: num "${numId}" 引用的 abstractNumId "${abstractId}" 不存在`)
      }
      numToAbstract.set(numId, abstractId)
    }
  }

  const stylesXml = pkg.parts['word/styles.xml']
  if (stylesXml !== undefined) {
    const stylesTree = parseXml(stylesXml)
    const ownerOfLevel = new Map<string, string>() // "abstractId:ilvl" -> styleId
    for (const styleEl of stylesTree.children) {
      if (styleEl.kind !== 'element' || styleEl.name !== 'w:style') continue
      const styleId = styleEl.attrs['w:styleId'] ?? '?'
      const pPr = findChild(styleEl, 'w:pPr')
      const numPr = pPr && findChild(pPr, 'w:numPr')
      if (!numPr) continue
      const numId = findChild(numPr, 'w:numId')?.attrs['w:val']
      const ilvl = findChild(numPr, 'w:ilvl')?.attrs['w:val'] ?? '0'
      if (numId === undefined) continue
      const abstractId = numToAbstract.get(numId)
      if (abstractId === undefined) {
        throw new Error(`assertNumberingIntegrity: 样式 "${styleId}" 引用的 numId "${numId}" 不在 numbering.xml 中`)
      }
      const key = `${abstractId}:${ilvl}`
      const existing = ownerOfLevel.get(key)
      if (existing !== undefined) {
        throw new Error(
          `assertNumberingIntegrity: (abstractNumId=${abstractId}, ilvl=${ilvl}) 同时被样式 "${existing}" 与 "${styleId}" 的 numPr 引用（§4.1 约束 1：一个编号级别只能绑定一个属主样式）`,
        )
      }
      ownerOfLevel.set(key, styleId)
    }
  }

  const documentXml = pkg.parts['word/document.xml']
  if (documentXml !== undefined) {
    walkForParagraphNumIds(parseXml(documentXml), numToAbstract)
  }
}

function walkForParagraphNumIds(node: XmlElement, numToAbstract: ReadonlyMap<string, string>): void {
  if (node.kind === 'element' && node.name === 'w:numPr') {
    const numId = findChild(node, 'w:numId')?.attrs['w:val']
    if (numId !== undefined && numId !== '0' && !numToAbstract.has(numId)) {
      throw new Error(`assertNumberingIntegrity: 段落引用的 numId "${numId}" 不在 numbering.xml 中`)
    }
  }
  for (const child of node.children) {
    if (child.kind === 'element') walkForParagraphNumIds(child, numToAbstract)
  }
}
