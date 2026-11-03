import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { exportXml46687, pmToIr, resolve, type IRDoc, type IRList } from '@ses/shared'
import { createEditorSchema } from '../../client/src/extensions/editorSchema'
import { collectXml46687Resources } from './xml46687Resources'
import { importXml46687 } from './xml46687Import'

/** issue #70 × WP8.3：继续编号的列表经 GB/T 46687.2 XML 导出、再导入（生产 Schema 往返）后保持接续。 */

const schema = createEditorSchema()
let counter = 0
const options = {
  generateId: () => `n${++counter}`,
  validateContent: (content: unknown) => {
    try { const node = schema.nodeFromJSON(content as never); node.check(); return { ok: true as const, content: node.toJSON() } }
    catch (error) { return { ok: false as const, message: String(error) } }
  },
}

async function importDoc(xml: string): Promise<IRDoc> {
  const result = await importXml46687(xml, options)
  expect(result.problems.filter(p => p.severity === 'error')).toEqual([])
  const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(result.pmDoc)))
  reopened.check()
  return pmToIr(reopened.toJSON()).doc
}

async function exportDoc(doc: IRDoc): Promise<string> {
  const labels = resolve(doc).labels
  const resources = await collectXml46687Resources(doc, labels)
  const output = exportXml46687(doc, labels, { mathml: {}, resources: resources.manifest })
  expect(output.problems.filter(p => p.severity === 'error')).toEqual([])
  return output.xml!
}

const para = (id: string, text: string) => ({ kind: 'paragraph' as const, id, content: [{ text }] })
const alpha = (id: string, texts: string[], continueNumbering?: boolean): IRList => ({
  kind: 'list', id, listType: 'alpha', ...(continueNumbering ? { continueNumbering } : {}),
  items: texts.map((text, index) => ({ id: `${id}-${index}`, content: [para(`${id}-${index}.p0`, text)] })),
})

const listLabels = (xml: string) => [...xml.matchAll(/<list-item[^>]*>\s*<label>([^<]*)<\/label>/g)].map(match => match[1])

describe('继续编号列表的 XML46687 往返', () => {
  it('导出写 a) b) c)，再导入仍为继续编号，再次导出标号不变', async () => {
    const base = await importDoc(readFileSync('../../schemas/gbt46687.2/samples/valid/01-minimal.xml', 'utf8'))
    base.body[0]!.children.push(alpha('la', ['内部因素', '外部因素']), para('mid', '说明段落。'), alpha('lb', ['其他因素'], true))
    const xml = await exportDoc(base)
    expect(listLabels(xml)).toEqual(['a)', 'b)', 'c)'])

    const reimported = await importDoc(xml)
    const lists = reimported.body[0]!.children.filter((child): child is IRList => child.kind === 'list')
    expect(lists.map(list => list.continueNumbering === true)).toEqual([false, true])
    expect(listLabels(await exportDoc(reimported))).toEqual(['a)', 'b)', 'c)'])
  })

  it('块级列项（含多段与嵌套二级列项）设为继续编号：导出 b)，再导入不报 xml-roundtrip-loss，仍为继续编号', async () => {
    const base = await importDoc(readFileSync('../../schemas/gbt46687.2/samples/valid/01-minimal.xml', 'utf8'))
    const number = (id: string, texts: string[]): IRList => ({
      kind: 'list', id, listType: 'number', level: 2,
      items: texts.map((text, index) => ({ id: `${id}-${index}`, content: [para(`${id}-${index}.p0`, text)] })),
    })
    const block = (id: string, text: string, sub: IRList, continueNumbering?: boolean): IRList => ({
      kind: 'list', id, listType: 'alpha', ...(continueNumbering ? { continueNumbering } : {}),
      items: [{ id: `${id}-0`, content: [para(`${id}-0.p0`, text), sub] }],
    })
    base.body[0]!.children.push(
      block('ba', '内部因素，包括但不限于：', number('na', ['组织架构；', '管理制度。'])),
      para('mid', '说明段落。'),
      block('bb', '外部因素，包括但不限于：', number('nb', ['市场环境；', '监管要求。']), true),
    )
    const xml = await exportDoc(base)
    expect(listLabels(xml)).toEqual(['a)', '1)', '2)', 'b)', '1)', '2)'])

    const reimported = await importDoc(xml)
    const lists = reimported.body[0]!.children.filter((child): child is IRList => child.kind === 'list')
    expect(lists.map(list => list.continueNumbering === true)).toEqual([false, true])
    expect(listLabels(await exportDoc(reimported))).toEqual(['a)', '1)', '2)', 'b)', '1)', '2)'])
  })
})
