/**
 * T2.4b 域测试用的确定性桩（设计 §7.2）：shared 的测试不能依赖 io，所以用最小的 MathML 与由 `collectXml46687ImageRefs` 生成的假资源清单；
 * 真实的 KaTeX 转换与资源包由 io 的测试（T2.5）覆盖。
 */

import { resolve } from '../../ir/resolve'
import type { IRDoc, NodeId, ResolvedLabel } from '../../ir/types'
import { collectXml46687ImageRefs, type ResourceManifest } from '../../xml46687/resources'
import type { RenderXml46687Options } from '../xml46687'

/** 最小的 MathML：`<mml:math><mml:mi>x</mml:mi></mml:math>`（`mml:` 前缀，不带命名空间声明）。 */
export function stubMathMl(symbol = 'x'): string {
  return `<mml:math><mml:mi>${symbol}</mml:mi></mml:math>`
}

/** 由文档里的全部图片引用生成的假资源清单（每个 `href` 一项，文件名 `<href>.png`）。 */
export function stubManifest(doc: IRDoc, labels: Record<NodeId, ResolvedLabel> = resolve(doc).labels): ResourceManifest {
  return {
    version: 1,
    entries: collectXml46687ImageRefs(doc, labels).map((ref) => ({
      href: ref.href, key: ref.key, fileName: `${ref.href}.png`, mediaType: 'image/png',
      source: ref.key.startsWith('data:') ? 'dataUrl' as const : 'resource' as const,
    })),
  }
}

/** 渲染选项：假资源清单 + 给定的 MathML（公式 NodeId → MathML 字符串）。 */
export function stubOptions(doc: IRDoc, mathml: Record<NodeId, string> = {}): RenderXml46687Options {
  return { mathml, resources: stubManifest(doc) }
}
