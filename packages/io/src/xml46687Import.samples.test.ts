import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getXmlAttr, parseXml46687, pmToIr, XLINK_NS } from '@ses/shared'
import type { XmlElement } from '@ses/shared'
import { createEditorSchema } from '../../client/src/extensions/editorSchema'
import type { ContentValidator } from './documentOps/types'
import { importXml46687 } from './xml46687Import'

const schema = createEditorSchema()
const validator: ContentValidator = content => {
  try { const node = schema.nodeFromJSON(content); node.check(); return { ok: true, content: node.toJSON() } }
  catch { return { ok: false, message: '生产 Schema 不接受文档' } }
}
const root = resolve(process.cwd(), '../..')
const validPath = resolve(root, 'schemas/gbt46687.2/samples/valid')
const goldPath = resolve(root, 'packages/shared/src/renderers/__tests__/__snapshots__')
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL6UAAAAASUVORK5CYII='
const cases = [
  ...readdirSync(validPath).filter(name => name.endsWith('.xml')).map(name => [name, resolve(validPath, name)] as const),
  ...['wp82', 'fullRenderer', 'wp8m', 'wp6'].map(name => [name, resolve(goldPath, `xml46687.${name}.xml`)] as const),
]
describe.each(cases)('%s 完整样例', (_, path) => {
  it('以真实资源导入生产 Schema 并保存重开', async () => {
    const xml = readFileSync(path, 'utf8')
    const parsed = parseXml46687(xml)
    expect(parsed.problems).toEqual([])
    const resources = new Map<string, {src: string; mediaType: string}>()
    const visit = (el: XmlElement) => {
      if (el.name.ns === null && (el.name.local === 'graphic' || el.name.local === 'inline-graphic')) {
        const href = getXmlAttr(el, XLINK_NS, 'href')
        if (href) resources.set(href, { src: png, mediaType: 'image/png' })
      }
      el.children.forEach(child => { if (child.type === 'element') visit(child) })
    }
    visit(parsed.tree!.root)
    let sequence = 0
    const result = await importXml46687(xml, { validateContent: validator, resources, generateId: () => `n${++sequence}` })
    expect(result.problems.filter(p => p.severity === 'error')).toEqual([])
    if (path.endsWith('05-formulas-figures.xml')) expect(result.problems).toContainEqual(expect.objectContaining({ code: 'xml-normalized', message: expect.stringContaining('空 LaTeX') }))
    if (path.endsWith('07-import-variants.xml')) {
      expect(result.problems).toContainEqual(expect.objectContaining({ code: 'xml-normalized', message: expect.stringContaining('术语层级') }))
      expect(result.problems).toContainEqual(expect.objectContaining({ code: 'xml-normalized', message: expect.stringContaining('尾项顺序') }))
    }
    if (path.endsWith('06-terms-references.xml')) expect(result.problems).toContainEqual(expect.objectContaining({ code: 'xml-normalized', message: expect.stringContaining('文本片段') }))
    expect(result.pmDoc).not.toBeNull()
    const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(result.pmDoc)))
    reopened.check()
    expect(pmToIr(reopened.toJSON()).doc.unsupportedContent).toBeUndefined()
  })
})
