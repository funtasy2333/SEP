/**
 * MathML 片段解析与规范化（WP8.2 设计 §4.5）——T2.4b 实现。T2.4a-1 只提供桩。
 *
 * 契约：输入是一个完整的 MathML 元素字符串（`<mml:math …>` 或默认命名空间的 `<math xmlns=…>`），
 * 输出统一成 `mml:` 前缀的 `XmlElement`；解析器严格（拒绝 DOCTYPE/实体声明/命名实体/`on*` 属性/危险 `href`），内容模型不检查。
 * 由 `formulas.ts` 调用；失败时由调用方报 `mathml-invalid`。
 */

import type { XmlElement } from '../../xml46687/tree'
import { notImplemented } from './context'

export function parseMathMl(_source: string): XmlElement {
  return notImplemented('parseMathMl (设计 §4.5)', 'T2.4b')
}
