import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { pmToIr } from '@ses/shared'
import { createEditorSchema } from '../../client/src/extensions/editorSchema'
import type { ContentValidator } from './documentOps/types'
import { importXml46687 } from './xml46687Import'

const xml = readFileSync(resolve(process.cwd(), '../../schemas/gbt46687.2/samples/valid/01-minimal.xml'), 'utf8')
const schema = createEditorSchema()
const validator: ContentValidator = content => {
  try {
    const node = schema.nodeFromJSON(content)
    node.check()
    return { ok: true, content: node.toJSON() }
  } catch {
    return { ok: false, message: '生产 Schema 不接受文档' }
  }
}
it('最小 XML 经生产 Schema 保存重开并保留正文', async () => {
  let serial = 0
  const options = { validateContent: validator, generateId: () => `id${++serial}` }
  const result = await importXml46687(xml, options)
  expect(result.problems.filter(p => p.severity === 'error')).toEqual([])
  expect(result.pmDoc).not.toBeNull()
  const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(result.pmDoc)))
  reopened.check()
  expect(pmToIr(reopened.toJSON()).doc.body[0]?.children[0]).toMatchObject({ kind: 'paragraph', content: [{ text: '本文件给出一个只含必需结构的最小文档。' }] })
})
it('无效 XML 和缺少校验器阻断导入', async () => {
  const invalid = await importXml46687('<!DOCTYPE standard><standard/>', { validateContent: validator })
  expect(invalid.pmDoc).toBeNull()
  expect(invalid.problems[0]?.code).toBe('xml-forbidden-doctype')
  const missing = await importXml46687(xml, {} as never)
  expect(missing.pmDoc).toBeNull()
  expect(missing.problems[0]?.code).toBe('xml-schema-invalid')
})
