// @vitest-environment happy-dom
/** Opt-in acceptance against a disposable API/SQLite instance; never the user's main database. */
import { readFileSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { pmToIr, resolve, type DocumentMeta, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { createWp6Fixture } from './__fixtures__/wp6'
import { createDocumentDuplicate } from '../utils/duplicateDocument'
import { synchronizeCoverMetadata } from '../utils/documentSettings'
import { exportSemanticJson } from '../serializer/jsonExporter'

const baseUrl = process.env.WP6_API_URL
const evidenceFile = process.env.WP6_EVIDENCE_FILE
const schema = getSchema(createEditorExtensions())
interface StoredDocument { id: number; title: string; meta: DocumentMeta; content: PMJsonNode }
interface Evidence { document: StoredDocument; duplicate: StoredDocument; version: { id: number; content: PMJsonNode } }
async function request<T>(path: string, body?: unknown, method = body ? 'POST' : 'GET'): Promise<T> {
  return new Promise((accept, reject) => {
    const req = httpRequest(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' } }, response => {
      let data = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { data += chunk })
      response.on('end', () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${method} ${path}: ${response.statusCode} ${data}`))
          return
        }
        try { accept(JSON.parse(data) as T) } catch (error) { reject(error) }
      })
      response.on('error', reject)
    })
    req.on('error', reject)
    req.end(body ? JSON.stringify(body) : undefined)
  })
}
function assertProductionContent(content: PMJsonNode) {
  const node = schema.nodeFromJSON(content)
  node.check()
  const converted = pmToIr(node.toJSON() as PMJsonNode)
  expect(converted.warnings).toEqual([])
  expect(resolve(converted.doc).problems.filter(problem => problem.severity === 'error')).toEqual([])
  expect(converted.doc.body[0]?.children[0]).toBeDefined()
  // Both JSON paths retain typed fields; cold reopen does not strip them through Schema defaults.
  const semantic = JSON.stringify(exportSemanticJson(node))
  for (const value of ['MathML', 'term-lang-zh', 'preferredTerm', 'formula-note', 'figure-resource', 'index-entry-main', 'key = value']) {
    expect(semantic.toLowerCase()).toContain(value.toLowerCase())
  }
  return converted.doc
}

describe.runIf(Boolean(baseUrl && evidenceFile))('WP6 real API/SQLite acceptance', () => {
  it('saves edits, version JSON and duplicate; or verifies cold reopening after server restart', async () => {
    if (process.env.WP6_ACCEPTANCE_PHASE === 'browser') {
      const evidence = JSON.parse(readFileSync(evidenceFile!, 'utf8')) as StoredDocument
      const reopened = await request<StoredDocument>(`/documents/${evidence.id}`)
      expect(reopened.content).toEqual(evidence.content)
      const visibleExport = JSON.parse(readFileSync(process.env.WP6_BROWSER_EXPORT_FILE!, 'utf8')) as PMJsonNode
      const loaded = schema.nodeFromJSON(reopened.content)
      const exported = schema.nodeFromJSON(visibleExport)
      exported.check()
      expect(exported.toJSON()).toEqual(loaded.toJSON())
      expect(visibleExport.attrs?.extensionVersion).toBe(1)
      expect(JSON.stringify(visibleExport)).toContain('（浏览器验收）')
      expect(assertProductionContent(visibleExport)).toEqual(assertProductionContent(reopened.content))
      expect(visibleExport.content?.find(node => node.type === 'chapter')?.content?.find(node => node.type === 'clause')?.content?.find(node => node.type === 'termDef')).toMatchObject({number: '1.1.1', path: '1.1.1'})
      return
    }
    if (process.env.WP6_ACCEPTANCE_PHASE === 'reopen') {
      const evidence = JSON.parse(readFileSync(evidenceFile!, 'utf8')) as Evidence
      const reopened = await request<StoredDocument>(`/documents/${evidence.document.id}`)
      const duplicate = await request<StoredDocument>(`/documents/${evidence.duplicate.id}`)
      const version = await request<Evidence['version']>(`/versions/${evidence.version.id}`)
      expect(reopened.content).toEqual(evidence.document.content)
      expect(duplicate.content).toEqual(evidence.duplicate.content)
      expect(version.content).toEqual(evidence.version.content)
      assertProductionContent(reopened.content)
      assertProductionContent(duplicate.content)
      assertProductionContent(version.content)
      return
    }
    const api = new URL(baseUrl!)
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(api.hostname)
    expect(api.port).not.toBe('3000')
    expect(await request<StoredDocument[]>('/documents'), 'prepare must use an empty disposable database').toEqual([])
    const content = schema.nodeFromJSON(createWp6Fixture()).toJSON() as PMJsonNode
    const before = assertProductionContent(content)
    const meta: DocumentMeta = { titleCn: 'WP6 隔离验收稿', titleEn: 'WP6 acceptance fixture', standardType: 'national', proposer: '提出单位', technicalCommittee: '归口单位', applicant: '起草单位' }
    const created = await request<StoredDocument>('/documents', { title: meta.titleCn, meta, stage: 'working_draft', content })
    expect(created.content).toEqual(content)
    const edited = JSON.parse(JSON.stringify(content)) as PMJsonNode
    const visit = (node: PMJsonNode): void => {
      if (node.attrs?.nodeId === 'warning-p') node.content = [{ type: 'text', text: '保存后重开的警告内容。' }]
      node.content?.forEach(visit)
    }
    visit(edited)
    const synchronized = synchronizeCoverMetadata(edited as unknown as Record<string, unknown>, meta) as unknown as PMJsonNode
    const document = await request<StoredDocument>(`/documents/${created.id}`, { content: synchronized }, 'PUT')
    const after = assertProductionContent(document.content)
    expect(after.meta).toMatchObject({ proposer: '提出单位', technicalCommittee: '归口单位', applicant: '起草单位' })
    expect(after.resources).toEqual(before.resources)
    expect(after.index).toEqual(before.index)
    const version = await request<Evidence['version']>('/versions', { documentId: document.id, versionNo: 'WP6-acceptance', content: document.content, note: 'JSON snapshot, no legacy XML' })
    const source = JSON.parse(JSON.stringify(document))
    const duplicateDto = createDocumentDuplicate({ title: document.title, meta: document.meta, content: document.content as unknown as Record<string, unknown> })
    expect(document).toEqual(source)
    const duplicate = await request<StoredDocument>('/documents', duplicateDto)
    const duplicated = assertProductionContent(duplicate.content)
    expect(duplicated.body).toEqual(after.body)
    expect(duplicated.index).toEqual(after.index)
    expect(duplicated.resources).toEqual(after.resources)
    expect(duplicated.meta.titleParts).toEqual(after.meta.titleParts)
    const evidence: Evidence = { document, duplicate, version }
    writeFileSync(evidenceFile!, JSON.stringify(evidence, null, 2))
  })
})
