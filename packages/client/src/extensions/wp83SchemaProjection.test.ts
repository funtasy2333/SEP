// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import { irToPm, pmToIr, type IRDoc, type IRParagraph, type PMJsonNode } from '@ses/shared'
import { exportXml46687, resolve } from '@ses/shared'
import { createEditorSchema } from './editorSchema'
import { createWp82Doc } from '../../../shared/src/renderers/__tests__/xml46687Wp82Fixture'
import { buildGoldenSamples } from '../../../shared/src/renderers/__tests__/xml46687GoldenSamples'
import { createWp6Fixture } from './__fixtures__/wp6'
import { nestedListDoc, xref } from '../../../shared/src/ir/__tests__/wp8mZdBFixtures'

function reopen(source: IRDoc): IRDoc {
  const schema = createEditorSchema()
  const initial = schema.nodeFromJSON(irToPm(source))
  initial.check()
  const saved = JSON.stringify(initial.toJSON())
  const restored = schema.nodeFromJSON(JSON.parse(saved))
  restored.check()
  const converted = pmToIr(restored.toJSON() as PMJsonNode)
  expect(converted.doc.unsupportedContent ?? []).toEqual([])
  return converted.doc
}

function findById(value: unknown, id: string): unknown {
  if (Array.isArray(value)) return value.map(entry => findById(entry, id)).find(Boolean)
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (record.id === id) return record
  return Object.values(record).map(entry => findById(entry, id)).find(Boolean)
}

function normalizeNumberLevel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeNumberLevel)
  if (!value || typeof value !== 'object') return value
  const copy = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeNumberLevel(entry)]))
  if (copy.kind === 'list' && copy.listType === 'number' && copy.level === 2) delete copy.level
  return copy
}

describe('WP8.3 生产 Schema 保存重开', () => {
  it('原版 WP8.2 夹具保留粗体代码和嵌套列表的全部内容与顺序', () => {
    const source = createWp82Doc()
    const restored = reopen(source)
    const paragraph = findById(restored, 'w82-scope-p2') as IRParagraph
    const original = findById(source, 'w82-scope-p2') as IRParagraph
    expect(paragraph.content.map(run => run.text).join('')).toBe(original.content.map(run => run.text).join(''))
    expect(paragraph.content.find(run => run.text === 'ls')).toEqual({ text: 'ls', marks: [{ type: 'bold' }, { type: 'code' }] })
    expect(paragraph.content.find(run => run.footnote)?.footnote).toEqual(original.content.find(run => run.footnote)?.footnote)
    expect(findById(restored, 'w82-list-outer')).toEqual(findById(source, 'w82-list-outer'))
  })

  it.each(buildGoldenSamples(createWp6Fixture()).filter(sample => sample.name !== 'wp8m'))('$name 黄金夹具通过生产 Schema 保存重开并保持 PM 投影幂等', ({ doc, options }) => {
    const schema = createEditorSchema()
    const first = schema.nodeFromJSON(irToPm(doc))
    first.check()
    const restored = schema.nodeFromJSON(JSON.parse(JSON.stringify(first.toJSON())))
    restored.check()
    const converted = pmToIr(restored.toJSON() as PMJsonNode)
    expect(converted.doc.unsupportedContent ?? []).toEqual([])
    const second = schema.nodeFromJSON(irToPm(converted.doc))
    second.check()
    expect(second.toJSON()).toEqual(first.toJSON())
    expect(exportXml46687(converted.doc, resolve(converted.doc).labels, options).xml).toEqual(exportXml46687(doc, resolve(doc).labels, options).xml)
  })

  it('块级列项的 HTML 和 nodeId 可保存并重开', () => {
    const schema = createEditorSchema()
    const source = nestedListDoc([xref('an2', 'listItem')])
    const node = schema.nodeFromJSON(irToPm(source))
    node.check()
    const host = document.createElement('div')
    host.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(node.content))
    const item = host.querySelector('[data-type="std-list-block-item"][data-node-id="a1"]')
    expect(item).not.toBeNull()
    expect(item?.querySelector('[data-node-id="zd-alpha-num"]')).not.toBeNull()
    const parsed = DOMParser.fromSchema(schema).parse(host)
    parsed.check()
    const reopened = pmToIr(parsed.toJSON() as PMJsonNode).doc
    expect(normalizeNumberLevel(findById(reopened, 'zd-alpha'))).toEqual(normalizeNumberLevel(findById(source, 'zd-alpha')))
  })

  it('[M-5.7-11] 保留 alpha、roman 等嵌套层级与指向列项的引用', () => {
    const source = nestedListDoc([xref('an2', 'listItem'), xref('r2', 'listItem')])
    const restored = reopen(source)
    for (const id of ['zd-ref', 'zd-num', 'zd-alpha', 'zd-dash', 'zd-roman']) {
      expect(normalizeNumberLevel(findById(restored, id)), id).toEqual(normalizeNumberLevel(findById(source, id)))
    }
  })
})
