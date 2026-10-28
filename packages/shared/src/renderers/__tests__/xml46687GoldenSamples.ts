/**
 * 四份黄金样例的输入（T2.6，设计 §7.1③、§7.2）：WP8.2 全要素、`fullRendererFixture()`、WP8.M 派生、WP6 派生。
 *
 * WP6 夹具在 client 包里，shared 的 tsc 不允许引用（rootDir），所以由各测试文件导入后以 PM JSON 传入 `buildGoldenSamples`。
 * 渲染选项一律是确定性桩：`stubMathMlFor`（每个公式一个最小 MathML）+ `stubManifest`（由 `collectXml46687ImageRefs` 生成的假清单）。
 */

import { pmToIr, type PMJsonNode } from '../../ir/pmToIr'
import { resolve } from '../../ir/resolve'
import { createWp8mIrDoc } from '../../ir/__tests__/wp8mFixtures'
import type { IRDoc, NodeId, ResolvedLabel } from '../../ir/types'
import type { RenderXml46687Options } from '../xml46687'
import { fullRendererFixture } from './fullRendererFixture'
import { patchFullRendererForXml, patchWp6ForXml, patchWp8mForXml } from './xml46687GoldenFixtures'
import { stubManifest } from './xml46687StubKit'
import { createWp82Doc, stubMathMlFor } from './xml46687Wp82Fixture'

export type GoldenSampleName = 'wp82' | 'fullRenderer' | 'wp8m' | 'wp6'

export interface GoldenSample {
  name: GoldenSampleName
  /** `__snapshots__/` 下的 XML 文件快照名（相对于测试文件所在目录）。 */
  snapshot: string
  doc: IRDoc
  labels: Record<NodeId, ResolvedLabel>
  options: RenderXml46687Options
}

function sample(name: GoldenSampleName, doc: IRDoc): GoldenSample {
  const { labels } = resolve(doc)
  return {
    name,
    snapshot: `__snapshots__/xml46687.${name}.xml`,
    doc,
    labels,
    options: { mathml: stubMathMlFor(doc), resources: stubManifest(doc, labels) },
  }
}

/** 四份黄金样例；每次调用都重新构造（互不共享对象）。 */
export function buildGoldenSamples(wp6Fixture: PMJsonNode): GoldenSample[] {
  return [
    sample('wp82', createWp82Doc()),
    sample('fullRenderer', patchFullRendererForXml(pmToIr(fullRendererFixture()).doc)),
    sample('wp8m', patchWp8mForXml(createWp8mIrDoc())),
    sample('wp6', patchWp6ForXml(pmToIr(wp6Fixture).doc)),
  ]
}
