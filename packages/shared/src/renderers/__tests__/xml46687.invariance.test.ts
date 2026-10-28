import { describe, expect, it } from 'vitest'
import { createWp6Fixture } from '../../../../client/src/extensions/__fixtures__/wp6'
import type { NodeId, ResolvedLabel } from '../../ir/types'
import { writeXml } from '../../xml46687/writer'
import { buildXml46687Document, exportXml46687, renderXml46687, type RenderXml46687Options } from '../xml46687'
import { XML46687_NAMESPACES, preserveSpace } from '../xml46687Parts/context'
import { deepFreeze } from './xml46687Kit'
import { buildGoldenSamples } from './xml46687GoldenSamples'

/**
 * 幂等与不变（T2.6，设计 §7.3），对四份黄金样例：
 *
 * 1. 确定性：同一输入连续渲染两次，字符串逐字节相同；`exportXml46687` 同；
 * 2. 不修改输入：`doc`、`labels`、`options` 渲染前后 `JSON.stringify` 相等；递归 `Object.freeze` 的副本渲染不抛错且输出相同；
 * 3. 键序无关：打乱 `options.mathml`、`labels`、`resources.entries` 的键/元素序，输出不变（渲染器按 IR 文档序与 `href` 取值，不遍历对象键）；
 * 4. JSON 往返：`XmlDocument`（写出前的树）可 `JSON.stringify` 往返无损，往返后写出的文本与原输出相同。
 */

const samples = buildGoldenSamples(createWp6Fixture())

/** 确定性地重排对象的键序：固定种子的 Fisher-Yates；结果恰与原序相同时（元素很少）退回反转。 */
function reorderKeys<T>(record: Record<string, T>): Record<string, T> {
  const original = Object.keys(record)
  const keys = [...original]
  let seed = 20261027
  for (let index = keys.length - 1; index > 0; index -= 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    const other = seed % (index + 1)
    ;[keys[index], keys[other]] = [keys[other]!, keys[index]!]
  }
  const ordered = keys.every((key, index) => key === original[index]) ? [...original].reverse() : keys
  return Object.fromEntries(ordered.map(key => [key, record[key]!]))
}

function reorderEntryKeys<T extends object>(entry: T): T {
  return Object.fromEntries(Object.entries(entry).reverse()) as T
}

describe.each(samples)('幂等与不变：$name', ({ doc, labels, options }) => {
  const xml = renderXml46687(doc, labels, options)

  it('确定性：连续两次渲染逐字节相同，exportXml46687 与 renderXml46687 一致', () => {
    expect(renderXml46687(doc, labels, options)).toBe(xml)
    expect(exportXml46687(doc, labels, options).xml).toBe(xml)
    expect(JSON.stringify(exportXml46687(doc, labels, options).problems)).toBe(JSON.stringify(exportXml46687(doc, labels, options).problems))
  })

  it('不修改输入：doc、labels、options 渲染前后 JSON 相等', () => {
    const before = [JSON.stringify(doc), JSON.stringify(labels), JSON.stringify(options)]
    exportXml46687(doc, labels, options)
    renderXml46687(doc, labels, options)
    buildXml46687Document(doc, labels, options)
    expect([JSON.stringify(doc), JSON.stringify(labels), JSON.stringify(options)]).toEqual(before)
  })

  it('不修改输入：递归冻结的副本也能渲染，输出与未冻结时相同', () => {
    const frozenDoc = deepFreeze(JSON.parse(JSON.stringify(doc)))
    const frozenLabels = deepFreeze(JSON.parse(JSON.stringify(labels))) as Record<NodeId, ResolvedLabel>
    const frozenOptions = deepFreeze(JSON.parse(JSON.stringify(options))) as RenderXml46687Options
    expect(() => renderXml46687(frozenDoc, frozenLabels, frozenOptions)).not.toThrow()
    expect(renderXml46687(frozenDoc, frozenLabels, frozenOptions)).toBe(xml)
  })

  it('键序无关：打乱 options.mathml 与 labels 的键序、resources.entries 的元素序（及条目的键序），输出不变', () => {
    const mathmlKeys = Object.keys(options.mathml)
    const shuffledOptions: RenderXml46687Options = {
      mathml: reorderKeys(options.mathml),
      resources: {
        version: 1,
        entries: [...options.resources.entries].reverse().map(reorderEntryKeys),
      },
    }
    const shuffledLabels = reorderKeys(labels)
    // 打乱确实改变了键序/元素序（否则这条测试什么也没证明）；只在有两个以上元素时才成立
    if (mathmlKeys.length > 1) expect(Object.keys(shuffledOptions.mathml)).not.toEqual(mathmlKeys)
    expect(Object.keys(shuffledLabels)).not.toEqual(Object.keys(labels))
    if (options.resources.entries.length > 1) expect(shuffledOptions.resources.entries[0]).not.toEqual(options.resources.entries[0])
    expect(renderXml46687(doc, shuffledLabels, shuffledOptions)).toBe(xml)
    expect(exportXml46687(doc, shuffledLabels, shuffledOptions).problems).toEqual(exportXml46687(doc, labels, options).problems)
  })

  it('JSON 往返：XmlDocument 往返无损，往返后写出的文本与原输出逐字节相同；两次构建的树相等', () => {
    const { document } = buildXml46687Document(doc, labels, options)
    const roundTripped = JSON.parse(JSON.stringify(document))
    expect(roundTripped).toEqual(document)
    expect(writeXml(roundTripped, { namespaces: XML46687_NAMESPACES, indent: '  ', preserveSpace })).toBe(xml)
    expect(buildXml46687Document(doc, labels, options).document).toEqual(document)
  })
})

describe('幂等与不变：样例的覆盖面（避免“打乱”测试因输入太小而空转）', () => {
  it('WP8.2 全要素夹具有多个公式桩与多个资源条目；其余样例至少有可打乱的 labels', () => {
    const wp82 = samples.find(sample => sample.name === 'wp82')!
    expect(Object.keys(wp82.options.mathml).length).toBeGreaterThanOrEqual(5)
    expect(wp82.options.resources.entries.length).toBeGreaterThanOrEqual(5)
    for (const sample of samples) expect(Object.keys(sample.labels).length).toBeGreaterThan(5)
  })
})
