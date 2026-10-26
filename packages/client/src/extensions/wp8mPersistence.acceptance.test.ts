// @vitest-environment happy-dom
/**
 * WP8.M M-Z-b：真实 API/SQLite 保存—冷重开验收（docs/wp8.m/design.md §3.6.6、§4.9 第 5 项）。
 *
 * Opt-in：只有显式提供 `WP8M_API_URL` 与 `WP8M_EVIDENCE_FILE` 才会运行，默认测试套件整体跳过（与 wp6Persistence.acceptance.test.ts 一致）。
 * 只许对一次性的、空的、非默认端口的回环 API/SQLite 实例执行；绝不能对用户的业务数据库（packages/server/data/ses.db）运行。
 *
 * 分两段，中间必须真实停止并重启服务端进程：
 *   prepare（默认）  空库 → 保存全要素文档 → 版本快照 A → 编辑后保存 → 版本快照 B → 副本；证据写入 `WP8M_EVIDENCE_FILE`
 *   reopen           `WP8M_ACCEPTANCE_PHASE=reopen`：服务端重启后读回原稿、副本、两个版本，逐字段与 prepare 的证据核对
 *
 * 使用 M-Z-a 的全要素 fixture `__fixtures__/wp8m.ts`（G1～G8 的 32 个矩阵行）。
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { getSchema } from '@tiptap/core'
import { Editor } from '@tiptap/vue-3'
import { describe, expect, it } from 'vitest'
import {
  getOutputSupportProblems, pmToIr, resolve,
  type IRDoc, type OutputBoundaryFormat, type PMJsonNode, type DocumentMeta,
} from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { createWp8mFixture, WP8M_NEW_MARK_TYPES, WP8M_NEW_NODE_TYPES } from './__fixtures__/wp8m'
import { createWp8mIrDoc } from '../../../shared/src/ir/__tests__/wp8mFixtures'
import { createDocumentDuplicate } from '../utils/duplicateDocument'
import { replaceEditorDocument } from '../utils/editorDocument'
import { exportSemanticJson } from '../serializer/jsonExporter'

const baseUrl = process.env.WP8M_API_URL
const evidenceFile = process.env.WP8M_EVIDENCE_FILE
const schema = getSchema(createEditorExtensions())
const FORMATS: OutputBoundaryFormat[] = ['HTML', 'DOCX', 'XML', 'XML46687']
const EDIT_MARK = '（保存后编辑）'

interface StoredDocument { id: number; title: string; meta: DocumentMeta; stage: string; content: PMJsonNode; revision: number; updatedAt?: string }
interface StoredVersion { id: number; documentId: number; versionNo: string; content: PMJsonNode; note?: string }
interface Evidence {
  fixtureSha256: string
  document: StoredDocument
  duplicate: StoredDocument
  version: StoredVersion
  initialVersion: StoredVersion
  sha256: { document: string; duplicate: string; version: string; initialVersion: string }
  boundary: Record<OutputBoundaryFormat, string[]>
  preparedAt: string
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** 键排序后的稳定序列化，SHA-256 不受对象键顺序影响。 */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
const sha256 = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex')

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

// ---------------------------------------------------------------------------------------------------------------------
// PM / IR 辅助
// ---------------------------------------------------------------------------------------------------------------------

function visit(node: PMJsonNode, fn: (node: PMJsonNode) => void): void {
  fn(node)
  node.content?.forEach(child => visit(child, fn))
}

function findPm(root: PMJsonNode, nodeId: string): PMJsonNode | undefined {
  let found: PMJsonNode | undefined
  visit(root, node => { if (!found && node.attrs?.nodeId === nodeId) found = node })
  return found
}

/** IR 里按 id 找对象（IR 是普通 JSON，深度遍历即可）。 */
function findIr(root: unknown, id: string): Record<string, unknown> | undefined {
  if (Array.isArray(root)) {
    for (const child of root) { const found = findIr(child, id); if (found) return found }
    return undefined
  }
  if (!root || typeof root !== 'object') return undefined
  const row = root as Record<string, unknown>
  if (row.id === id) return row
  for (const child of Object.values(row)) { const found = findIr(child, id); if (found) return found }
  return undefined
}

const text = (value: string): PMJsonNode => ({ type: 'text', text: value })

/** 经生产 Schema 规范化（补齐默认属性）后的 JSON，与编辑器持有、API 保存的形态一致。 */
function canonical(json: PMJsonNode): PMJsonNode {
  const node = schema.nodeFromJSON(json)
  node.check()
  return node.toJSON() as PMJsonNode
}

/**
 * 保存后的编辑：覆盖 G1～G8 各自最有代表性的一处，既有改文字，也有增节点和改属性。
 * 返回新 JSON（不改入参）。每一处在 {@link assertEdits} 里逐项核对。
 */
function applyEdits(source: PMJsonNode): PMJsonNode {
  const edited = clone(source)
  const byId = (id: string): PMJsonNode => {
    const node = findPm(edited, id)
    if (!node) throw new Error(`fixture 里没有节点 ${id}`)
    return node
  }
  const child = (node: PMJsonNode, type: string): PMJsonNode => {
    const found = node.content?.find(entry => entry.type === type)
    if (!found) throw new Error(`${node.type} 里没有 ${type}`)
    return found
  }
  const firstText = (node: PMJsonNode): PMJsonNode => {
    const found = node.content?.find(entry => entry.type === 'text')
    if (!found) throw new Error(`${node.type} 里没有文本`)
    return found
  }
  // G1：标准化条目的标题加后缀；在 g1-nr-3 之后新增一条标准化条目；非标准化条目加后缀；参考文献标题加后缀
  firstText(child(byId('g1-nr-1'), 'normRefStdTitle')).text += EDIT_MARK
  const list = byId('g1-nrl')
  const at = list.content!.findIndex(entry => entry.attrs?.nodeId === 'g1-nr-3')
  list.content!.splice(at + 1, 0, {
    type: 'normRefStd',
    attrs: { nodeId: 'wp8m-acc-nr-5' },
    content: [
      { type: 'normRefStdRef', content: [text('GB/T 1.1—2020')] },
      { type: 'normRefStdTitle', content: [text('标准化工作导则　第1部分：标准化文件的结构和起草规则')] },
    ],
  })
  firstText(byId('g1-nr-4')).text += EDIT_MARK
  const bibliography = findBibliographyTitle(edited)
  firstText(bibliography).text += EDIT_MARK
  // G2：缩略语释义
  firstText(child(byId('abb-ct'), 'whereDefinition')).text = `计算机断层扫描${EDIT_MARK}，参见`
  // G5：术语领域
  firstText(child(byId('g5-t1'), 'termSubjectField')).text = `顾客满意${EDIT_MARK}`
  // G6：引言 0.2 的条文
  firstText(byId('g6-c2-p')).text = `编制目的${EDIT_MARK}，见`
  // G7：罗马列项改字并新增第 5 项；多块注的第一段加后缀
  firstText(byId('g7-r3')).text = `检查${EDIT_MARK}`
  byId('g7-l-roman').content!.push({ type: 'stdListItem', attrs: { nodeId: 'wp8m-acc-r5', marker: null }, content: [text('归档')] })
  firstText(byId('g7-n2-p1')).text += EDIT_MARK
  // G8：名义列宽 40:60 改为 30:70
  const columns = clone(byId('g8-tbl-2col').attrs!.columns as Array<Record<string, unknown>>)
  columns[0].width = 30
  columns[1].width = 70
  byId('g8-tbl-2col').attrs!.columns = columns
  return canonical(edited)
}

function findBibliographyTitle(root: PMJsonNode): PMJsonNode {
  let found: PMJsonNode | undefined
  visit(root, node => { if (node.type === 'bibliographyTitle') found = node })
  if (!found) throw new Error('fixture 里没有 bibliographyTitle')
  return found
}

function plainText(value: unknown): string {
  return JSON.stringify(value)
}

/** 编辑后的 IR：每一处编辑都落在正确的 IR 位置，且 Resolver 的编号随之重排。 */
function assertEdits(doc: IRDoc, label: string): void {
  const labels = resolve(doc).labels
  expect(plainText(findIr(doc, 'g1-nr-1')), `${label} 规范性引用标题`).toContain(`优先数和优先数系${EDIT_MARK}`)
  expect(plainText(findIr(doc, 'wp8m-acc-nr-5')), `${label} 新增规范性引用`).toContain('GB/T 1.1—2020')
  expect(plainText(findIr(doc, 'g1-nr-4')), `${label} 非标准化引用`).toContain(EDIT_MARK)
  expect(plainText(doc.bibliographyTitle), `${label} 自定义参考文献标题`).toContain(`参考书目${EDIT_MARK}`)
  expect(plainText(findIr(doc, 'abb-ct')), `${label} 缩略语释义`).toContain(`计算机断层扫描${EDIT_MARK}`)
  expect(plainText(findIr(doc, 'g5-t1')?.subjectField), `${label} 术语领域`).toContain(`顾客满意${EDIT_MARK}`)
  expect(plainText(findIr(doc, 'g6-c2-p')), `${label} 引言 0.2`).toContain(`编制目的${EDIT_MARK}`)
  expect(plainText(findIr(doc, 'g7-r3')), `${label} 罗马列项`).toContain(`检查${EDIT_MARK}`)
  const roman = findIr(doc, 'g7-l-roman')
  expect((roman?.items as unknown[] | undefined)?.length, `${label} 罗马列项新增一项后共 5 项`).toBe(5)
  expect(plainText(findIr(doc, 'g7-n2-p1')), `${label} 多块注第一段`).toContain(EDIT_MARK)
  const table = findIr(doc, 'g8-tbl-2col')
  expect(columnWidths(table), `${label} 列宽 30:70`).toEqual([30, 70])
  // 新增条目插在 g1-nr-3 之后，Resolver 的 ref_<清单内序号> 随之重排：新条目 ref_4，原第 4 条变 ref_5
  expect(labels['wp8m-acc-nr-5']?.xmlId, label).toBe('ref_4')
  expect(labels['g1-nr-4']?.xmlId, label).toBe('ref_5')
}

function assertNotEdited(doc: IRDoc, label: string): void {
  expect(JSON.stringify(doc), `${label} 不应含编辑标记`).not.toContain(EDIT_MARK)
  expect(findIr(doc, 'wp8m-acc-nr-5'), label).toBeUndefined()
  const table = findIr(doc, 'g8-tbl-2col')
  expect(columnWidths(table), `${label} 列宽 40:60`).toEqual([40, 60])
}

/** IRTable.columns[].width 是 IRMeasure（{ value, unit }）；取其数值。 */
function columnWidths(table: Record<string, unknown> | undefined): Array<number | undefined> | undefined {
  return (table?.columns as Array<{ width?: { value: number; unit: string } }> | undefined)?.map(column => column.width?.value)
}

/** 与 wp8mIntegration.test.ts 一致：编辑器加载时给没有 IR 实体 ID 的容器随机补 nodeId，并在文档末尾保留一个光标段落。 */
function maskGenerated<T>(json: T, knownIds: ReadonlySet<string>): T {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      if (key === 'nodeId' && typeof entry === 'string') return [key, knownIds.has(entry) ? entry : null]
      return [key, walk(entry)]
    }))
  }
  return walk(json) as T
}

function knownIdsOf(root: PMJsonNode): Set<string> {
  const ids = new Set<string>()
  visit(root, node => { if (typeof node.attrs?.nodeId === 'string') ids.add(node.attrs.nodeId) })
  return ids
}

/** 生产编辑器实际加载入口：Editor + replaceEditorDocument，返回编辑器持有的 JSON 与语义 JSON（已遮蔽自动生成的 nodeId，去掉光标空段落）。 */
function loadInEditor(content: PMJsonNode, known: ReadonlySet<string>) {
  const editor = new Editor({ extensions: createEditorExtensions(), content: '<p></p>' })
  editor.mount(document.createElement('div'))
  try {
    expect(replaceEditorDocument(editor, content as unknown as Record<string, unknown>)).toBe(true)
    const held = clone(editor.getJSON()) as PMJsonNode
    const nodes = [...(held.content ?? [])]
    const last = nodes.at(-1)
    if (last && ['stdParagraph', 'paragraph'].includes(last.type) && !last.content?.length && !known.has(String(last.attrs?.nodeId))) nodes.pop()
    return {
      held: maskGenerated({ ...held, content: nodes }, known),
      exported: maskGenerated(exportSemanticJson(editor.state.doc), known),
    }
  } finally {
    editor.destroy()
  }
}

/** 四种格式的输出边界签名：每种格式的问题清单（节点 id + 去掉 doc. 前缀的路径）。 */
function boundarySignature(doc: IRDoc): Record<OutputBoundaryFormat, string[]> {
  return Object.fromEntries(FORMATS.map(format => [
    format,
    getOutputSupportProblems(doc, format).map(problem => `${problem.nodeId ?? '-'} ${problem.path.replace(/^doc\./, '')}`).sort(),
  ])) as Record<OutputBoundaryFormat, string[]>
}

/** 对存储的一份内容做全部结构性断言，返回其 IR。`pristine` 为 true 表示编辑前的状态（应与 IR 原生版本深度相等）。 */
function assertProductionContent(content: PMJsonNode, label: string, options: { pristine: boolean }): IRDoc {
  const node = schema.nodeFromJSON(content)
  node.check()
  const converted = pmToIr(node.toJSON() as PMJsonNode)
  expect(converted.warnings, `${label} pmToIr warnings`).toEqual([])
  expect(converted.doc.unsupportedContent, `${label} unsupportedContent`).toBeUndefined()
  expect(converted.doc.extensionVersion, `${label} extensionVersion`).toBe(1)
  const problems = resolve(converted.doc).problems
  expect(problems.filter(problem => problem.severity === 'error'), `${label} Resolver error`).toEqual([])
  expect(problems.map(problem => `${problem.code}:${problem.nodeId}`), `${label} Resolver warning（fixture 既有写法带来的两条悬置段提示）`)
    .toEqual(['hanging-paragraph:g5-terms', 'hanging-paragraph:g2-abbr-ch'])
  // 语义 JSON 保留全部新节点与新 mark，Resolver 编号已写入
  const semantic = JSON.stringify(exportSemanticJson(node))
  for (const type of [...WP8M_NEW_NODE_TYPES, ...WP8M_NEW_MARK_TYPES]) expect(semantic, `${label} 语义 JSON 缺 ${type}`).toContain(`"${type}"`)
  expect(semantic, `${label} 不应出现 ext_ 占位 ID`).not.toContain('ext_')
  expect(semantic).toContain('"listType":"roman"')
  expect(semantic).toContain('"refType":"abbreviation"')
  expect(semantic).toContain('"refType":"listItem"')
  for (const number of ['0.1', '0.1.1', '0.1.2', '0.2', '0.3', '3.3.1', '3.3.2', 'C.1']) expect(semantic, `${label} 编号 ${number}`).toContain(`"number":"${number}"`)
  expect(semantic).toContain('参考书目')
  if (options.pristine) {
    expect(clone(converted.doc), `${label} 编辑前的 IR 与 IR 原生版本（shared/wp8mFixtures.ts）深度相等`).toEqual(clone(createWp8mIrDoc()))
    assertNotEdited(converted.doc, label)
  } else {
    assertEdits(converted.doc, label)
  }
  return converted.doc
}

describe.runIf(Boolean(baseUrl && evidenceFile))('WP8.M M-Z-b real API/SQLite acceptance', () => {
  it('[M-Z-b] saves, edits, snapshots and duplicates the all-structures document; or verifies cold reopening after server restart', async () => {
    if (process.env.WP8M_ACCEPTANCE_PHASE === 'reopen') {
      const evidence = JSON.parse(readFileSync(evidenceFile!, 'utf8')) as Evidence
      const reopened = await request<StoredDocument>(`/documents/${evidence.document.id}`)
      const duplicate = await request<StoredDocument>(`/documents/${evidence.duplicate.id}`)
      const version = await request<StoredVersion>(`/versions/${evidence.version.id}`)
      const initialVersion = await request<StoredVersion>(`/versions/${evidence.initialVersion.id}`)
      // 逐字段：content / meta / title / stage / revision
      expect(reopened.content).toEqual(evidence.document.content)
      expect(reopened.meta).toEqual(evidence.document.meta)
      expect(reopened.title).toBe(evidence.document.title)
      expect(reopened.stage).toBe(evidence.document.stage)
      expect(reopened.revision).toBe(evidence.document.revision)
      expect(duplicate.content).toEqual(evidence.duplicate.content)
      expect(duplicate.meta).toEqual(evidence.duplicate.meta)
      expect(duplicate.title).toBe(evidence.duplicate.title)
      expect(version.content).toEqual(evidence.version.content)
      expect(version.versionNo).toBe(evidence.version.versionNo)
      expect(initialVersion.content).toEqual(evidence.initialVersion.content)
      expect(initialVersion.versionNo).toBe(evidence.initialVersion.versionNo)
      // SHA-256 与 prepare 时一致
      const hashes = {
        document: sha256(reopened.content), duplicate: sha256(duplicate.content),
        version: sha256(version.content), initialVersion: sha256(initialVersion.content),
      }
      expect(hashes).toEqual(evidence.sha256)
      // 重开后的内容仍是合法的全要素文档：原稿、副本、版本 B 含编辑，版本 A 是编辑前的原始 fixture
      const documentIr = assertProductionContent(reopened.content, 'reopened document', { pristine: false })
      const duplicateIr = assertProductionContent(duplicate.content, 'reopened duplicate', { pristine: false })
      const versionIr = assertProductionContent(version.content, 'reopened version', { pristine: false })
      const initialIr = assertProductionContent(initialVersion.content, 'reopened initial version', { pristine: true })
      // 副本正文、版本 B 与原稿一致；编辑前版本与原稿不同
      expect(duplicateIr.body).toEqual(documentIr.body)
      expect(duplicateIr.appendices).toEqual(documentIr.appendices)
      // 副本比原稿多一个封面（createDocumentDuplicate 把库内元数据同步成封面），所以不比较 front 整体
      expect(duplicateIr.bibliography).toEqual(documentIr.bibliography)
      expect(duplicateIr.bibliographyTitle).toEqual(documentIr.bibliographyTitle)
      expect(duplicateIr.resources).toEqual(documentIr.resources)
      expect(versionIr).toEqual(documentIr)
      expect(initialIr).not.toEqual(documentIr)
      // 输出边界（HTML / DOCX / XML / XML46687）与 prepare 时一致，且与设计 §3.4 + §7.1 的基线一致
      const boundary = boundarySignature(documentIr)
      expect(boundary).toEqual(evidence.boundary)
      expect(boundary.HTML).toHaveLength(15)
      expect(boundary.DOCX).toHaveLength(15)
      expect(boundary.XML.length - boundary.XML46687.length).toBe(2)
      expect(boundarySignature(versionIr)).toEqual(boundary)
      // 编辑前版本的边界基线相同（编辑没有引入或消除任何阻断）
      expect(boundarySignature(initialIr)).toEqual(boundary)
      // 生产编辑器实际加载入口：重开后的内容载入 Editor，保存形态与语义 JSON 与 prepare 时（evidence）载入的结果一致
      const known = knownIdsOf(reopened.content)
      const fromReopen = loadInEditor(reopened.content, known)
      const fromEvidence = loadInEditor(evidence.document.content, known)
      expect(fromReopen.held).toEqual(fromEvidence.held)
      expect(fromReopen.exported).toEqual(fromEvidence.exported)
      expect(loadInEditor(version.content, known).exported).toEqual(fromReopen.exported)
      writeFileSync(`${evidenceFile!}.reopen.json`, JSON.stringify({
        reopenedAt: new Date().toISOString(),
        ids: { document: reopened.id, duplicate: duplicate.id, version: version.id, initialVersion: initialVersion.id },
        revision: reopened.revision,
        sha256: hashes,
        sha256MatchesPrepare: true,
        boundaryCounts: Object.fromEntries(FORMATS.map(format => [format, boundary[format].length])),
        checks: [
          'document/duplicate/version/initialVersion content toEqual evidence (field by field)',
          'meta/title/stage/revision equal', 'sha256 equal to prepare', 'Schema check + pmToIr warnings=[] + Resolver no error for all four',
          'initial version IR deep-equals native IR (shared wp8mFixtures)', 'edits present in document/duplicate/version, absent in initial',
          'duplicate body/appendices/bibliography/resources == document', 'output boundary identical to prepare (HTML 15, DOCX 15, XML-XML46687=2)',
          'Editor + replaceEditorDocument + exportSemanticJson identical to prepare-time load',
        ],
      }, null, 2))
      return
    }

    // ---- prepare ----
    const api = new URL(baseUrl!)
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(api.hostname)
    expect(api.port).not.toBe('3000')
    expect(await request<StoredDocument[]>('/documents'), 'prepare must use an empty disposable database').toEqual([])

    const content = canonical(createWp8mFixture())
    assertProductionContent(content, 'fixture', { pristine: true })
    const meta: DocumentMeta = { titleCn: 'WP8.M 隔离验收稿', titleEn: 'WP8.M acceptance fixture', standardType: 'national' }

    // 1. 保存
    const created = await request<StoredDocument>('/documents', { title: meta.titleCn, meta, stage: 'working_draft', content })
    expect(created.content).toEqual(content)
    expect(created.revision).toBe(0)
    // 2. 版本快照 A：编辑前
    const initialVersion = await request<StoredVersion>('/versions', { documentId: created.id, versionNo: 'WP8M-initial', content: created.content, note: 'WP8.M acceptance: before edits' })
    expect(initialVersion.content).toEqual(content)
    // 3. 编辑后保存（PUT 必须带 baseRevision，否则服务端返回 428）
    const edited = applyEdits(content)
    assertProductionContent(edited, 'edited (local)', { pristine: false })
    const document = await request<StoredDocument>(`/documents/${created.id}`, { baseRevision: created.revision, content: edited }, 'PUT')
    expect(document.revision).toBe(created.revision + 1)
    expect(document.content).toEqual(edited)
    assertProductionContent(document.content, 'saved document', { pristine: false })
    // 4. 版本快照 B：编辑后
    const version = await request<StoredVersion>('/versions', { documentId: document.id, versionNo: 'WP8M-acceptance', content: document.content, note: 'WP8.M acceptance: after edits' })
    // 5. 副本
    const source = clone(document)
    const duplicateDto = createDocumentDuplicate({ title: document.title, meta: document.meta, content: document.content as unknown as Record<string, unknown> })
    expect(document).toEqual(source)
    const duplicate = await request<StoredDocument>('/documents', duplicateDto)
    const duplicateIr = assertProductionContent(duplicate.content, 'duplicate', { pristine: false })
    const documentIr = assertProductionContent(document.content, 'document', { pristine: false })
    expect(duplicateIr.body).toEqual(documentIr.body)
    expect(duplicateIr.appendices).toEqual(documentIr.appendices)
    expect(duplicateIr.bibliography).toEqual(documentIr.bibliography)
    expect(duplicateIr.bibliographyTitle).toEqual(documentIr.bibliographyTitle)
    expect(duplicateIr.resources).toEqual(documentIr.resources)
    // 6. 输出边界基线
    const boundary = boundarySignature(documentIr)
    expect(boundary.HTML).toHaveLength(15)
    expect(boundary.DOCX).toHaveLength(15)
    expect(boundary.XML.length - boundary.XML46687.length).toBe(2)
    expect(boundarySignature(duplicateIr).HTML).toEqual(boundary.HTML)
    expect(boundarySignature(duplicateIr).DOCX).toEqual(boundary.DOCX)

    const evidence: Evidence = {
      fixtureSha256: sha256(content),
      document, duplicate, version, initialVersion,
      sha256: { document: sha256(document.content), duplicate: sha256(duplicate.content), version: sha256(version.content), initialVersion: sha256(initialVersion.content) },
      boundary,
      preparedAt: new Date().toISOString(),
    }
    writeFileSync(evidenceFile!, JSON.stringify(evidence, null, 2))
  })
})
