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
import { parseXml, type XmlElement } from './xmlTree'

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

  for (const [path, tree] of Object.entries(trees)) {
    if (!path.endsWith('.rels')) continue
    const ownerDir = relsOwnerDir(path)
    for (const child of tree.children) {
      if (child.kind !== 'element' || child.name !== 'Relationship') continue
      if (child.attrs.TargetMode === 'External') continue // 外部链接不在包内，不检查
      const target = child.attrs.Target
      if (target === undefined) throw new Error(`assertWellFormed: "${path}" 中的 Relationship 缺少 Target`)
      const resolved = resolveRelativeTarget(ownerDir, target)
      if (!packageHas(resolved)) {
        throw new Error(`assertWellFormed: "${path}" 中的关系 Target="${target}"（解析为 "${resolved}"）在包内不存在（悬空关系）`)
      }
    }
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
