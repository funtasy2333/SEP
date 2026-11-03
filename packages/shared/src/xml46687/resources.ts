/**
 * GB/T 46687.2 XML 导出的图片资源契约（WP8.2 设计 §3.3、§4.3；同构，无 DOM、无 Node API）。
 *
 * - `ResourceManifest` 是渲染器与 T2.5 准备层之间的纯数据清单：只描述“哪个 `xlink:href` 对应哪份资源、
 *   叫什么文件名、什么媒体类型”，不含字节（可 `JSON.stringify` 往返）；字节由准备层另行持有并写入资源包。
 * - `collectXml46687ImageRefs` 是渲染器（预扫描）与准备层（命名资源文件）**共用**的纯函数，二者因此天然一致。
 *   `inl_<k>` 是这两处共享的序号，不是 Resolver 的编号逻辑（D-M-08）；块图的 `href` 一律取 Resolver 给出的 `fig` xmlId。
 */

import type { IRDoc, NodeId, ResolvedLabel } from '../ir/types'

/** 清单条目的字节来源：`IRDoc.resources` 里的资源、内联 data URL，还是外部 `src`。 */
export type ResourceManifestSource = 'resource' | 'dataUrl' | 'src'

export interface ResourceManifestEntry {
  /** `xlink:href` 的值：块图 = 所属 `fig` 的 xmlId（如 `fig_1`）；行内图 = `inl_<k>`。无目录、无扩展名。 */
  href: string
  /** IR 资源键：图或行内图的 `resourceId`，缺省时为 `src`。 */
  key: string
  /** 资源包内的文件名，无目录：`<href>.<扩展名>`，如 `fig_1.png`。 */
  fileName: string
  /** 如 `image/png`。 */
  mediaType: string
  source: ResourceManifestSource
}

export interface ResourceManifest {
  version: 1
  entries: ResourceManifestEntry[]
}

/** `collectXml46687ImageRefs` 返回的一项：一处图片引用及其应使用的 `xlink:href`。 */
export interface Xml46687ImageRef {
  /** 块图 = 所属 `fig` 的 xmlId；行内图 = `inl_<k>`。 */
  href: string
  /** IR 资源键：`resourceId ?? src`（图与行内图同口径）。 */
  key: string
  kind: 'figure' | 'inline' | 'figure-extra' | 'table-alternative'
  /** 块图为图自身的 NodeId；行内图为最近一层带 `id` 的祖先（通常是所在段落）。 */
  ownerId: NodeId
  /** IR 路径，与 `getOutputSupportProblems` 同写法（以 `doc` 起头）：块图指向图块，行内图指向所在 run。 */
  path: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 收集文档里全部图片引用，按 IR 文档序返回（块图与行内图交错）。
 *
 * 文档序：前言、引言、引言条、各章、各附录；数组按元素顺序，段落内按 run 顺序，同一对象内按其自身字段顺序
 * （`Object.entries` 键序，与输出边界的遍历口径相同）。
 * 每个部分之下是**通用深度遍历**（不按块种类枚举），因此列项、注/示例、表格单元格、图注、术语条目、
 * 嵌套条文脚注等任何深度的位置都不会漏；Resolver 不允许行内图出现的位置（标题、图表题、术语条目……）也照样收集，
 * 是否合法由 Resolver 与输出边界判定，本函数不做判断。参考文献、索引、元数据不在上述部分内，Resolver 不允许
 * 行内图出现在这些位置，故不遍历。
 *
 * - 块图：`href = labels[图.id].xmlId`。`labels` 缺该图或 `xmlId` 为空时**不生成条目**（渲染器会另报 `xml-label-missing`），
 *   函数本身保持纯、不抛错。
 * - 行内图：`href = inl_<k>`，k 从 1 起，只对行内图计数，块图不占序号；同一资源被引用多次也各得各的 `href`。
 * - `key = resourceId ?? src`。
 */
export function collectXml46687ImageRefs(doc: IRDoc, labels: Record<NodeId, ResolvedLabel>): Xml46687ImageRef[] {
  const refs: Xml46687ImageRef[] = []
  let inlineCount = 0

  const visit = (value: unknown, path: string, ownerId: NodeId): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`, ownerId))
      return
    }
    if (!isRecord(value)) return
    const id = typeof value.id === 'string' ? value.id : ownerId

    if (value.kind === 'figure' && typeof value.id === 'string') {
      const label = Object.prototype.hasOwnProperty.call(labels, value.id) ? labels[value.id] : undefined
      if (typeof label?.xmlId === 'string' && label.xmlId !== '') {
        const key = typeof value.resourceId === 'string' ? value.resourceId : typeof value.src === 'string' ? value.src : ''
        refs.push({ href: label.xmlId, key, kind: 'figure', ownerId: value.id, path })
        if (Array.isArray(value.additionalGraphics)) value.additionalGraphics.forEach((graphic, index) => {
          if (!isRecord(graphic) || typeof graphic.id !== 'string' || typeof graphic.src !== 'string') return
          refs.push({ href: `${label.xmlId}_g${index + 1}`, key: typeof graphic.resourceId === 'string' ? graphic.resourceId : graphic.src,
            kind: 'figure-extra', ownerId: graphic.id, path: `${path}.additionalGraphics[${index}]` })
        })
      }
    }

    if (value.kind === 'table' && typeof value.id === 'string' && isRecord(value.alternativeGraphic)) {
      const label = Object.prototype.hasOwnProperty.call(labels, value.id) ? labels[value.id] : undefined
      const graphic = value.alternativeGraphic
      if (typeof label?.xmlId === 'string' && label.xmlId !== '' && typeof graphic.id === 'string' && typeof graphic.src === 'string') {
        refs.push({ href: `${label.xmlId}_alt`, key: typeof graphic.resourceId === 'string' ? graphic.resourceId : graphic.src,
          kind: 'table-alternative', ownerId: graphic.id, path: `${path}.alternativeGraphic` })
      }
    }

    const image = value.image
    if (typeof value.text === 'string' && isRecord(image) && typeof image.src === 'string') {
      inlineCount += 1
      const key = typeof image.resourceId === 'string' ? image.resourceId : image.src
      refs.push({ href: `inl_${inlineCount}`, key, kind: 'inline', ownerId: id, path })
    }

    for (const [name, child] of Object.entries(value)) visit(child, `${path}.${name}`, id)
  }

  visit(doc.front.foreword, 'doc.front.foreword', '')
  visit(doc.front.introduction, 'doc.front.introduction', '')
  visit(doc.front.introductionClauses ?? [], 'doc.front.introductionClauses', '')
  visit(doc.body, 'doc.body', '')
  visit(doc.appendices, 'doc.appendices', '')
  return refs
}
