// @vitest-environment node
/**
 * WP8.5 任务 8.5.2：真实国家标准原文（GB/T 1.1—2020）全要素核对、独立 Jing 校验、
 * 完整往返验收（export → import → 冷重开 → re-export）与 PR #93～#96 回归测试。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  buildXml46687Package,
  importXml46687,
  importXml46687Package,
  type BuildXml46687PackageResult,
  type ContentValidator,
} from '@ses/io'
import type { PMJsonNode, ResourceManifestEntry } from '@ses/shared'
import { createEditorSchema } from '../extensions/editorSchema'
import {
  buildDocxBlob,
  exportSemanticHtml,
  exportSemanticJson,
  prepareXmlImportDocumentUpdate,
} from './index'
import {
  createGbt11RealStandardFixture,
  createGbt11RenderableSubsetDoc,
  createIntroClausesSpecialDoc,
  createPr94To96RegressionDoc,
} from './__fixtures__/wp85RealStandardGbt11'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const SCRIPT_DIR = join(REPO_ROOT, 'scripts', 'xml46687')
const DEFAULT_JING_JAR = join(homedir(), '.local', 'share', 'jing', 'jing.jar')

const PNG_MAGIC = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function productionSchemaValidator(): ContentValidator {
  const schema = createEditorSchema()
  return (candidate) => {
    try {
      const node = schema.nodeFromJSON(candidate)
      node.check()
      return { ok: true, content: node.toJSON() as PMJsonNode }
    } catch (error) {
      return {
        ok: false,
        code: 'xml-schema-invalid',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

function withTempXml<T>(xml: string, run: (file: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'wp85-xml46687-'))
  try {
    const file = join(dir, 'standard.xml')
    writeFileSync(file, xml, 'utf8')
    return run(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function hasPythonXmlValidation(): boolean {
  const py = spawnSync('python3', ['-I', '-c', 'import lxml'], { encoding: 'utf8' })
  const xmllint = spawnSync('xmllint', ['--version'], { encoding: 'utf8' })
  return py.status === 0 && xmllint.error === undefined && (xmllint.status === 0 || /libxml/i.test(`${xmllint.stdout}${xmllint.stderr}`))
}

function shouldSkipPythonValidation(): boolean {
  if (hasPythonXmlValidation()) return false
  if (process.env.REQUIRE_XML_VALIDATION === '1') {
    throw new Error('REQUIRE_XML_VALIDATION=1，但缺少 python3 + lxml + xmllint，无法执行外部校验')
  }
  console.warn('[wp85] 跳过 validate.py / sts_compat.py：缺少 python3 + lxml + xmllint（设置 REQUIRE_XML_VALIDATION=1 强制执行）')
  return true
}

function resolveLocalJingJar(): string | null {
  const fromEnv = process.env.JING_JAR?.trim()
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  if (existsSync(DEFAULT_JING_JAR)) return DEFAULT_JING_JAR
  return null
}

function hasJingValidation(): boolean {
  if (!resolveLocalJingJar()) return false
  const java = spawnSync('java', ['-version'], { encoding: 'utf8' })
  const py = spawnSync('python3', ['-I', '--version'], { encoding: 'utf8' })
  return java.status === 0 && py.status === 0
}

function shouldSkipJingValidation(): boolean {
  if (hasJingValidation()) return false
  if (process.env.REQUIRE_JING_VALIDATION === '1') {
    throw new Error('REQUIRE_JING_VALIDATION=1，但缺少 java 或本地 jing.jar，无法执行 Jing 校验')
  }
  console.warn('[wp85] 跳过 jing_check.py：本地未配置 java / jing.jar（设置 REQUIRE_JING_VALIDATION=1 强制执行）')
  return true
}

function runValidatePy(xml: string, profile: 'export' | 'import' = 'export'): {
  valid: boolean
  errors: Array<{ rule?: string; message?: string }>
  warnings: Array<{ rule?: string; message?: string }>
} {
  return withTempXml(xml, (file) => {
    const res = spawnSync('python3', ['-I', join(SCRIPT_DIR, 'validate.py'), '--json', '--profile', profile, file], {
      encoding: 'utf8',
    })
    let parsed: { results: Array<{ valid: boolean; errors: Array<{ rule?: string; message?: string }>; warnings: Array<{ rule?: string; message?: string }> }> }
    try {
      parsed = JSON.parse(res.stdout)
    } catch {
      throw new Error(`validate.py 未输出合法 JSON（退出码 ${res.status}）：${res.stdout}\n${res.stderr}`)
    }
    return parsed.results[0]!
  })
}

function runStsCompatPy(xml: string): { status: number | null; stdout: string; stderr: string } {
  return withTempXml(xml, (file) => {
    const res = spawnSync('python3', ['-I', join(SCRIPT_DIR, 'sts_compat.py'), file], { encoding: 'utf8' })
    return { status: res.status, stdout: res.stdout, stderr: res.stderr }
  })
}

function runJingCheckPy(xml: string): {
  status: number | null
  payload: {
    engine: string
    java_version: string | null
    jing_jar: string
    schema: string
    valid: boolean
    results: Array<{ file: string; valid: boolean; errors: Array<{ line: number | null; column: number | null; severity: string; message: string }> }>
  }
} {
  return withTempXml(xml, (file) => {
    const res = spawnSync('python3', ['-I', join(SCRIPT_DIR, 'jing_check.py'), '--json', file], { encoding: 'utf8' })
    let payload
    try {
      payload = JSON.parse(res.stdout)
    } catch {
      throw new Error(`jing_check.py 未输出合法 JSON（退出码 ${res.status}）：${res.stdout}\n${res.stderr}`)
    }
    return { status: res.status, payload }
  })
}

async function zipResourceHashes(zipBytes: Uint8Array): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(zipBytes)
  const hashes: Record<string, string> = {}
  const resourcePaths = Object.keys(zip.files).filter((name) => name.startsWith('resources/')).sort()
  for (const name of resourcePaths) {
    const data = await zip.file(name)!.async('uint8array')
    hashes[name] = sha256Hex(data)
  }
  return hashes
}

function findNodes(root: PMJsonNode, predicate: (node: PMJsonNode) => boolean, out: PMJsonNode[] = []): PMJsonNode[] {
  if (predicate(root)) out.push(root)
  for (const child of root.content ?? []) findNodes(child, predicate, out)
  return out
}

const graphicHrefs = (xml: string): string[] =>
  [...xml.matchAll(/<(?:inline-)?graphic\b[^>]*?\sxlink:href="([^"]*)"/g)].map((m) => m[1]!)

let cachedRealBuild: Promise<BuildXml46687PackageResult> | undefined
const buildRealGbt11 = (): Promise<BuildXml46687PackageResult> => {
  cachedRealBuild ??= buildXml46687Package({ pmDoc: createGbt11RealStandardFixture() })
  return cachedRealBuild
}

describe('WP8.5 任务 8.5.2：真实国家标准（GB/T 1.1—2020）全要素核对与往返验收', () => {
  it('1. 生产 createEditorSchema().nodeFromJSON(...).check() 全部通过', () => {
    const schema = createEditorSchema()
    for (const docJson of [
      createGbt11RealStandardFixture(),
      createIntroClausesSpecialDoc(),
      createPr94To96RegressionDoc(),
      createGbt11RenderableSubsetDoc(),
    ]) {
      const node = schema.nodeFromJSON(docJson)
      expect(() => node.check()).not.toThrow()
    }
  })

  it('2. buildXml46687Package 导出 ZIP（standard.xml + manifest.json + resources/*），0 errors', async () => {
    const result = await buildRealGbt11()
    const errors = result.problems.filter((p) => p.severity === 'error')
    expect(errors, errors.map((p) => `${p.code} ${p.path}: ${p.message}`).join('\n')).toEqual([])
    expect(result.xml).not.toBeNull()
    expect(result.bytes.length).toBeGreaterThan(0)

    const zip = await JSZip.loadAsync(result.bytes)
    const names = Object.keys(zip.files)
    expect(names[0]).toBe('standard.xml')
    expect(names).toContain('manifest.json')
    const resourceNames = names.filter((n) => n.startsWith('resources/'))
    expect(resourceNames.length).toBeGreaterThanOrEqual(3)
    expect(await zip.file('standard.xml')!.async('string')).toBe(result.xml)
  })

  describe.skipIf(shouldSkipPythonValidation())('3a. 外部校验：validate.py (--profile export/import) 与 sts_compat.py', () => {
    it('validate.py --json --profile export 与 import 均 0 errors', async () => {
      const { xml } = await buildRealGbt11()
      const exportRes = runValidatePy(xml!, 'export')
      expect(exportRes.errors, JSON.stringify(exportRes.errors, null, 2)).toEqual([])
      expect(exportRes.valid).toBe(true)

      const importRes = runValidatePy(xml!, 'import')
      expect(importRes.errors, JSON.stringify(importRes.errors, null, 2)).toEqual([])
      expect(importRes.valid).toBe(true)
    })

    it('sts_compat.py 对照官方 NISO STS 1.2 DTD：退出码 0，零未解释偏差', async () => {
      const { xml } = await buildRealGbt11()
      const res = runStsCompatPy(xml!)
      expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0)
      expect(res.stdout).toContain('未解释偏差 0 个')
    })
  })

  describe.skipIf(shouldSkipJingValidation())('3b. 独立 RELAX NG 引擎校验：jing_check.py --json', () => {
    it('Jing 20241231 校验真实 GB/T 1.1—2020 导出 XML：退出码 0，0 errors', async () => {
      const { xml } = await buildRealGbt11()
      const { status, payload } = runJingCheckPy(xml!)
      expect(status, JSON.stringify(payload, null, 2)).toBe(0)
      expect(payload.engine).toBe('jing')
      expect(payload.java_version).toBeTruthy()
      expect(payload.valid).toBe(true)
      expect(payload.results).toHaveLength(1)
      expect(payload.results[0]!.valid).toBe(true)
      expect(payload.results[0]!.errors).toEqual([])
    })
  })

  it('4. 语义与资源核验：发布/实施日期分离、TBX、MathML 3.0、无 ext_/DOCTYPE、ID/rid、资源清单与 PNG 字节一一对应', async () => {
    const result = await buildRealGbt11()
    const xml = result.xml!

    // 元数据与发布/实施日期分离
    expect(xml).toContain('<release-date>2020-03-31</release-date>')
    expect(xml).toContain('<implementation-date>2020-10-01</implementation-date>')
    expect(xml).toContain('<ics>01.120</ics>')
    expect(xml).toContain('<ccs>A 00</ccs>')
    expect(xml).toContain('<comm-ref>SAC/TC 286</comm-ref>')
    expect(xml).toContain('<std-supersedes>GB/T 1.1—2009</std-supersedes>')
    expect(xml).toContain('<std-ref type="dated">GB/T 1.1—2020</std-ref>')
    expect(xml).toContain('<std-ref type="undated">GB/T 1.1</std-ref>')
    expect(xml).toContain('<std-org-name>国家市场监督管理总局</std-org-name>')
    expect(xml).toContain('<std-org-name>国家标准化管理委员会</std-org-name>')
    expect(xml).toContain('<content-language>zh</content-language>')
    expect(xml).toContain('<copyright-statement>版权专有 侵权必究</copyright-statement>')
    expect(xml).toContain('<title-wrap xml:lang="zh">')
    expect(xml).toContain('<title-wrap xml:lang="en">')
    expect(xml).toContain('<sec id="sec_foreword" sec-type="foreword">')
    expect(xml).toContain('<sec id="sec_intro" sec-type="intro">')

    // TBX 多语种且不伪造未出现描述符
    expect(xml).toContain('<tbx:termEntry id="term_3.1.1">')
    expect(xml).toContain('<tbx:langSet xml:lang="zh">')
    expect(xml).toContain('<tbx:langSet xml:lang="en">')
    expect(xml).toContain('<tbx:langSet xml:lang="fr">')
    expect(xml).toContain('<tbx:subjectField>标准化</tbx:subjectField>')
    expect(xml).toContain('<tbx:entailedTerm target="term_3.1.2">')
    expect(xml).toContain('<tbx:source>GB/T 20000.1—2014，5.2</tbx:source>')
    expect(xml).not.toContain('tbx:partOfSpeech')
    expect(xml).not.toContain('tbx:normativeAuthorization')

    // MathML 3.0，无 tex-math / annotation / alternatives
    expect(xml).toContain('mathml-version="3.0"')
    const mathTags = [...xml.matchAll(/<mml:math\b([^>]*)>/g)]
    expect(mathTags).toHaveLength(4) // 2 个行间公式 + 2 个行内公式
    expect(xml).not.toMatch(/tex-math|<annotation\b|<alternatives\b/)
    expect(xml).toContain('<disp-formula id="formula_1">')
    expect(xml).toContain('<disp-formula id="formula_2">')
    expect(xml).toContain('<def-list list-content="formula">')

    // 图例、横页表、加粗边框、附录、参考文献、索引
    expect(xml).toContain('<table-wrap id="tab_2" orientation="landscape">')
    expect(xml).toContain('border-top: solid 2px')
    expect(xml).toContain('border-bottom: solid 2px')
    expect(xml).toContain('<def-list list-content="figure">')
    expect(xml).toContain('<app id="sec_A" content-type="informative">')
    expect(xml).toContain('<app id="sec_B" content-type="normative">')
    expect(xml).toContain('<app id="sec_C" content-type="normative">')
    expect(xml).toContain('<uri>https://www.iso.org/directives-and-policies.html</uri>')
    expect(xml).toContain('<index id="sec_index">')

    // 禁止 ext_ 与 DOCTYPE
    expect(xml).not.toMatch(/<!DOCTYPE/i)
    expect(xml).not.toMatch(/\b(?:id|rid|target)="ext_/)

    // ID 唯一且所有 rid / entailedTerm@target 均可解析
    const ids = [...xml.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]!)
    expect(ids.length).toBeGreaterThan(20)
    expect(new Set(ids).size).toBe(ids.length)
    const idSet = new Set(ids)
    const rids = [...xml.matchAll(/<xref\b[^>]*?\srid="([^"]*)"/g)].map((m) => m[1]!)
    expect(rids.length).toBeGreaterThan(10)
    for (const rid of rids) expect(idSet.has(rid), `未解析的 rid=${rid}`).toBe(true)
    const entailed = [...xml.matchAll(/<tbx:entailedTerm\b[^>]*?\starget="([^"]*)"/g)].map((m) => m[1]!)
    expect(entailed.length).toBeGreaterThan(0)
    for (const target of entailed) expect(idSet.has(target), `未解析的 target=${target}`).toBe(true)

    // xlink:href 与 manifest.json 及 ZIP 资源一一对应，且全部是真实有效 PNG
    const zip = await JSZip.loadAsync(result.bytes)
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as { entries: ResourceManifestEntry[] }
    const hrefs = graphicHrefs(xml)
    expect(hrefs.length).toBe(3) // 2 个行内图 + 图 B.1
    expect(manifest.entries.map((e) => e.href).sort()).toEqual([...hrefs].sort())
    const zipResourceFiles = Object.keys(zip.files).filter((n) => n.startsWith('resources/')).sort()
    expect(zipResourceFiles).toEqual(manifest.entries.map((e) => `resources/${e.fileName}`).sort())
    for (const entry of manifest.entries) {
      const bytes = await zip.file(`resources/${entry.fileName}`)!.async('uint8array')
      expect(bytes.length).toBeGreaterThan(PNG_MAGIC.length)
      expect(Array.from(bytes.subarray(0, 8))).toEqual(Array.from(PNG_MAGIC))
    }
  })

  it('5. 完整往返：importXml46687Package → 0 errors → 生产 Schema check → 冷重开 JSON → 二次导出 XML 逐字节完全一致 & 资源 SHA-256 一致', async () => {
    const first = await buildRealGbt11()
    expect(first.xml).not.toBeNull()

    // 导入资源包
    const imported = await importXml46687Package(first.bytes, {
      validateContent: productionSchemaValidator(),
    })
    const importErrors = imported.problems.filter((p) => p.severity === 'error')
    expect(importErrors, importErrors.map((p) => `${p.code} ${p.path ?? ''}: ${p.message}`).join('\n')).toEqual([])
    expect(imported.pmDoc).not.toBeNull()

    // 生产 Schema 校验 + JSON 序列化/反序列化模拟冷重开
    const schema = createEditorSchema()
    const parsedNode = schema.nodeFromJSON(imported.pmDoc!)
    expect(() => parsedNode.check()).not.toThrow()
    const coldReopened = JSON.parse(JSON.stringify(parsedNode.toJSON())) as PMJsonNode
    expect(() => schema.nodeFromJSON(coldReopened).check()).not.toThrow()

    // 二次导出并断言逐字节一致
    const second = await buildXml46687Package({ pmDoc: coldReopened })
    const secondErrors = second.problems.filter((p) => p.severity === 'error')
    expect(secondErrors, secondErrors.map((p) => `${p.code} ${p.path}: ${p.message}`).join('\n')).toEqual([])
    expect(second.xml).toBe(first.xml)

    // 资源 SHA-256 逐一完全一致
    const firstHashes = await zipResourceHashes(first.bytes)
    const secondHashes = await zipResourceHashes(second.bytes)
    expect(secondHashes).toEqual(firstHashes)
  })

  describe('6. 专项往返回归：引言条、PR #94 公式 MathML、PR #95 横页表+表脚注、PR #96 表格加粗外框', () => {
    it('含引言条（sec_0 / 0.1 / 0.1.1 / 无题条 0.2）导出、外部校验与往返逐字节一致', async () => {
      const first = await buildXml46687Package({ pmDoc: createIntroClausesSpecialDoc() })
      expect(first.problems.filter((p) => p.severity === 'error')).toEqual([])
      expect(first.xml).toContain('<sec id="sec_0" sec-type="intro">')
      expect(first.xml).toContain('<sec id="sec_0.1">')
      expect(first.xml).toContain('<sec id="sec_0.1.1">')
      expect(first.xml).toContain('<sec id="sec_0.2" sec-type="numbered-paragraph">')

      if (!shouldSkipPythonValidation()) {
        expect(runValidatePy(first.xml!, 'export').errors).toEqual([])
        expect(runStsCompatPy(first.xml!).status).toBe(0)
      }
      if (!shouldSkipJingValidation()) {
        const { status, payload } = runJingCheckPy(first.xml!)
        expect(status, JSON.stringify(payload)).toBe(0)
        expect(payload.valid).toBe(true)
      }

      const imported = await importXml46687Package(first.bytes, { validateContent: productionSchemaValidator() })
      expect(imported.problems.filter((p) => p.severity === 'error')).toEqual([])
      expect(imported.pmDoc).not.toBeNull()

      const cold = JSON.parse(JSON.stringify(imported.pmDoc)) as PMJsonNode
      const second = await buildXml46687Package({ pmDoc: cold })
      expect(second.problems.filter((p) => p.severity === 'error')).toEqual([])
      expect(second.xml).toBe(first.xml)
    })

    it('PR #94 行间公式 MathML + PR #95 横页表格与表脚注 + PR #96 表格加粗外框 往返逐字节一致', async () => {
      const first = await buildXml46687Package({ pmDoc: createPr94To96RegressionDoc() })
      expect(first.problems.filter((p) => p.severity === 'error')).toEqual([])
      const xml = first.xml!

      // PR #94：行间原生 MathML 保留、无 tex-math/annotation
      expect(xml).toContain('<disp-formula id="formula_1">')
      expect(xml).toContain('<mml:mfrac>')
      expect(xml).not.toMatch(/tex-math|<annotation\b/)

      // PR #95：横页表与表脚注
      expect(xml).toContain('<table-wrap id="tab_1" orientation="landscape">')
      expect(xml).toContain('<xref ref-type="table-fn" rid="table-fn_1.1">a</xref>')
      expect(xml).toContain('<fn id="table-fn_1.1">')

      // PR #96：表头与外框 2px 边框样式
      expect(xml).toContain('border-top: solid 2px')
      expect(xml).toContain('border-bottom: solid 2px')

      if (!shouldSkipPythonValidation()) {
        expect(runValidatePy(xml, 'export').errors).toEqual([])
        expect(runStsCompatPy(xml).status).toBe(0)
      }
      if (!shouldSkipJingValidation()) {
        expect(runJingCheckPy(xml).status).toBe(0)
      }

      // 导入并核对生产 PM 节点属性还原
      const imported = await importXml46687Package(first.bytes, { validateContent: productionSchemaValidator() })
      expect(imported.problems.filter((p) => p.severity === 'error')).toEqual([])
      const pmDoc = imported.pmDoc!

      const formulas = findNodes(pmDoc, (n) => n.type === 'formula')
      expect(formulas).toHaveLength(1)
      expect(typeof formulas[0]!.attrs?.mathml).toBe('string')
      expect(String(formulas[0]!.attrs?.mathml)).toContain('<mml:mfrac>')

      const tables = findNodes(pmDoc, (n) => n.type === 'stdTable')
      expect(tables).toHaveLength(1)
      expect(tables[0]!.attrs?.orientation).toBe('landscape')
      expect(tables[0]!.attrs?.headerRowCount).toBe(2)
      expect(findNodes(tables[0]!, (n) => n.type === 'tableFootnoteEntry')).toHaveLength(1)
      expect(findNodes(tables[0]!, (n) => n.type === 'tableFootnoteRef')).toHaveLength(1)

      const headers = findNodes(tables[0]!, (n) => n.type === 'tableHeader')
      expect(headers.some((h) => h.attrs?.borderTop === 2 && h.attrs?.borderTopStyle === 'solid')).toBe(true)
      expect(headers.some((h) => h.attrs?.borderBottom === 2 && h.attrs?.borderBottomStyle === 'solid')).toBe(true)

      // 冷重开后二次导出逐字节一致
      const cold = JSON.parse(JSON.stringify(pmDoc)) as PMJsonNode
      const second = await buildXml46687Package({ pmDoc: cold })
      expect(second.problems.filter((p) => p.severity === 'error')).toEqual([])
      expect(second.xml).toBe(first.xml)
    })
  })

  describe('7. 负例与旧格式拒绝：SEP 旧格式、GB/T 37967 旧格式、缺失图片资源的损坏 ZIP', () => {
    it('拒绝 SEP 旧格式 sample-standard.xml，pmDoc 为 null', async () => {
      const legacyXml = readFileSync(
        join(REPO_ROOT, 'packages/client/src/serializer/__fixtures__/sample-standard.xml'),
        'utf8',
      )
      const res = await importXml46687(legacyXml, { validateContent: productionSchemaValidator() })
      expect(res.pmDoc).toBeNull()
      expect(res.problems.some((p) => p.severity === 'error' && p.code === 'legacy-format')).toBe(true)
    })

    it('拒绝 GB/T 37967 旧格式 gbt37967-root.xml，pmDoc 为 null', async () => {
      const gbt37967Xml = readFileSync(
        join(REPO_ROOT, 'schemas/gbt46687.2/samples/invalid/gbt37967-root.xml'),
        'utf8',
      )
      const res = await importXml46687(gbt37967Xml, { validateContent: productionSchemaValidator() })
      expect(res.pmDoc).toBeNull()
      expect(res.problems.some((p) => p.severity === 'error' && p.code === 'legacy-format')).toBe(true)
    })

    it('拒绝缺失图片资源的损坏 ZIP，pmDoc 为 null 且报 xml-resource-missing', async () => {
      const first = await buildRealGbt11()
      const zip = await JSZip.loadAsync(first.bytes)
      const firstResource = Object.keys(zip.files).find((name) => name.startsWith('resources/'))
      expect(firstResource).toBeTruthy()
      zip.remove(firstResource!)
      const corruptedBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })

      const res = await importXml46687Package(corruptedBytes, { validateContent: productionSchemaValidator() })
      expect(res.pmDoc).toBeNull()
      expect(res.problems.some((p) => p.severity === 'error' && p.code === 'xml-resource-missing')).toBe(true)
    })
  })

  describe('8. 非 XML 回归：常规可排版子集的语义 JSON、文件设置、HTML 渲染与 DOCX 导出', () => {
    it('语义 JSON、文件设置元数据、HTML（含 PR #96 表/表头外框 CSS）与 DOCX 导出均正常', async () => {
      const schema = createEditorSchema()
      const pmJson = createGbt11RenderableSubsetDoc()
      const pmNode = schema.nodeFromJSON(pmJson)
      expect(() => pmNode.check()).not.toThrow()

      // 语义 JSON
      const semantic = exportSemanticJson(pmNode)
      expect(semantic.type).toBe('doc')
      expect(Array.isArray(semantic.content)).toBe(true)
      const semanticText = JSON.stringify(semantic)
      expect(semanticText).toContain('标准化文件')
      expect(semanticText).toContain('要素类别汇总表')

      // 文件设置（元数据同步）
      const docUpdate = prepareXmlImportDocumentUpdate(pmJson)
      expect(docUpdate.title).toBe('标准化工作导则 第1部分：标准化文件的结构和起草规则')
      expect(docUpdate.meta.standardNo).toBe('GB/T 1.1—2020')
      expect(docUpdate.meta.publishDate).toBe('2020-03-31')
      expect(docUpdate.meta.implementDate).toBe('2020-10-01')
      expect(docUpdate.meta.icsCode).toBe('01.120')
      expect(docUpdate.meta.ccsCode).toBe('A 00')
      expect(docUpdate.meta.technicalCommittee).toBe('SAC/TC 286')

      // HTML 渲染（含 PR #96 仅加粗表格和表头区域外框的 CSS）
      const html = exportSemanticHtml(pmNode)
      expect(html).toContain('.ses-table-block table, .ses-table-block thead { border: 2px solid #000; }')
      expect(html).toContain('要素类别汇总表')
      expect(html).toContain('范围的章编号固定为1。')
      expect(html).toContain('标记体系示意图')

      // DOCX 导出（含 PR #95 横页节与 PR #96 表头边界粗线）
      const { blob, warnings } = await buildDocxBlob({ pmDoc: pmJson })
      expect(blob.size).toBeGreaterThan(2000)
      expect(Array.isArray(warnings)).toBe(true)
      const docxZip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()))
      const docXml = await docxZip.file('word/document.xml')!.async('string')
      expect(docXml).toContain('要素类别汇总表')
      expect(docXml).toContain('w:orient="landscape"')
      expect(docXml).toContain('w:sz="8"') // PR #96 STRONG_BORDER = 1pt (8 eighths of a point)
    })
  })
})
