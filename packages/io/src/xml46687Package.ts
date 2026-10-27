/**
 * GB/T 46687.2 XML 出件（平台无关）：ProseMirror JSON → IR → Resolver → 并行准备公式与资源 →
 * shared 的 `exportXml46687` → JSZip 资源包（WP8.2 设计 §5.2 (c)）。与 `buildDocx` 完全对称，client 与服务端共用。
 *
 * 包布局（C-T-27）：
 * ```
 * <包>.zip
 * ├── standard.xml            // exportXml46687 的输出，UTF-8，无 BOM
 * ├── manifest.json           // { format, version, xml, entries:[ResourceManifestEntry…] }；键序固定、无时间戳
 * └── resources/<fileName>    // 每个清单条目一个文件，按 fileName 排序
 * ```
 * 条目固定日期、无隐式目录、固定排序，同一输入的字节逐一相同。UI 不在本阶段接入。
 */

import JSZip from 'jszip'
import {
  exportXml46687,
  type DocumentMeta,
  type PMJsonNode,
  type ResourceManifest,
  type ResourceManifestEntry,
  type Xml46687Problem,
} from '@ses/shared'
import { prepareDocxInput, type PMJsonSource, type PreparedDocxInput } from './docx'
import { convertFormulasToMathMl } from './formulaMathMl'
import type { ImageResourceOptions } from './imageResources'
import { collectXml46687Resources } from './xml46687Resources'

/** 资源包 `manifest.json` 的 `format` 值。 */
export const XML46687_PACKAGE_FORMAT = 'GB/T 46687.2—2026 XML'
/** 资源包里 XML 文件的路径，也是 `manifest.json` 的 `xml` 值。 */
export const XML46687_PACKAGE_XML_PATH = 'standard.xml'
const MANIFEST_PATH = 'manifest.json'
const RESOURCE_DIRECTORY = 'resources/'
// 与 docx.ts 同：JSZip 默认把当前时间写入每个条目，固定为 1980-01-01 令字节可复现。
const ZIP_DATE = new Date(Date.UTC(1980, 0, 1))

const textEncoder = new TextEncoder()

/** 与 `PreparedDocxInput` 同形：PM JSON → IR → Resolver 的结果。 */
export type PreparedXml46687Input = PreparedDocxInput

export interface BuildXml46687PackageOptions {
  pmDoc: PMJsonNode | PMJsonSource
  documentMeta?: DocumentMeta
  imageResources?: ImageResourceOptions
}

export interface BuildXml46687PackageResult {
  /** 资源包字节；有任何 error 时为空数组（不打包）。 */
  bytes: Uint8Array
  /** `exportXml46687` 的输出；有任何 error 时为 null。 */
  xml: string | null
  /** 准备层收集到的资源清单（失败的图片不在其中）。 */
  manifest: ResourceManifest
  /** 全部问题：公式转换、资源读取，以及渲染器的问题（含 warning/info）。 */
  problems: Xml46687Problem[]
}

/**
 * PM JSON → IR → Resolver，与 `prepareDocxInput` 同构（`documentMeta` 覆盖 IR 元数据的规则沿用：
 * 所有非 undefined 字段都覆盖 pmToIr 的结果，空字符串也保留）。
 */
export function prepareXml46687Input(
  pmDoc: PMJsonNode | PMJsonSource,
  documentMeta?: DocumentMeta,
): PreparedXml46687Input {
  return prepareDocxInput(pmDoc, documentMeta)
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function assertSafeFileName(fileName: string): void {
  if (fileName === '' || fileName === '.' || fileName === '..' || /[/\\\u0000]/.test(fileName)) {
    throw new Error(`资源文件名无效：「${fileName}」（应为无目录的文件名）`)
  }
}

/**
 * 键序固定的清单条目，使 `manifest.json` 的文本不依赖调用方对象的键序。
 * 注意：`key` 按设计原样写入；图以 data URL 内联时 `key` 就是整段 data URL，`manifest.json` 会因此带上一份 base64 副本。
 */
function orderedEntry(entry: ResourceManifestEntry): ResourceManifestEntry {
  return { href: entry.href, key: entry.key, fileName: entry.fileName, mediaType: entry.mediaType, source: entry.source }
}

/**
 * 把 XML、清单与资源文件写成资源包字节。
 *
 * 条目：`standard.xml` 第一，其余按路径字典序（`manifest.json`、`resources/<fileName>`），固定日期 1980-01-01 UTC、
 * `createFolders:false`、DEFLATE；`manifest.json` 的条目按 `fileName` 排序。同一输入字节逐一相同，与调用方
 * 传入条目/文件的次序无关。没有任何图片时仍按同一结构打包（空的 `resources/` 目录不写入）。
 *
 * `files` 的键是 `ResourceManifestEntry.fileName`。清单条目与文件必须一一对应（文件名无目录、忽略大小写不重名），
 * 否则抛 `Error`——这是调用方（`buildXml46687Package`）的内部不变量，不是内容问题。
 */
export async function packageXml46687(
  xml: string,
  manifest: ResourceManifest,
  files: Record<string, Uint8Array>,
): Promise<Uint8Array> {
  const entries = [...manifest.entries].sort((a, b) => byCodeUnit(a.fileName, b.fileName))
  const lowerCaseNames = new Set<string>()
  for (const entry of entries) {
    assertSafeFileName(entry.fileName)
    const lowerCase = entry.fileName.toLowerCase()
    if (lowerCaseNames.has(lowerCase)) throw new Error(`资源文件名重复（忽略大小写）：「${entry.fileName}」`)
    lowerCaseNames.add(lowerCase)
    if (!Object.prototype.hasOwnProperty.call(files, entry.fileName)) {
      throw new Error(`清单条目「${entry.fileName}」没有对应的资源文件`)
    }
  }
  const listed = new Set(entries.map(entry => entry.fileName))
  for (const fileName of Object.keys(files)) {
    if (!listed.has(fileName)) throw new Error(`资源文件「${fileName}」不在清单中`)
  }

  const manifestJson = `${JSON.stringify({
    format: XML46687_PACKAGE_FORMAT,
    version: 1,
    xml: XML46687_PACKAGE_XML_PATH,
    entries: entries.map(orderedEntry),
  }, null, 2)}\n`

  const parts: [path: string, data: Uint8Array][] = [
    [MANIFEST_PATH, textEncoder.encode(manifestJson)],
    ...entries.map((entry): [string, Uint8Array] => [`${RESOURCE_DIRECTORY}${entry.fileName}`, files[entry.fileName]!]),
  ]
  parts.sort((a, b) => byCodeUnit(a[0], b[0]))

  const zip = new JSZip()
  zip.file(XML46687_PACKAGE_XML_PATH, textEncoder.encode(xml), { date: ZIP_DATE, createFolders: false })
  for (const [path, data] of parts) zip.file(path, data, { date: ZIP_DATE, createFolders: false })
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

/**
 * 生成 XML46687 资源包：并行准备公式（LaTeX → MathML）与资源（图片字节与清单），再调 shared 的 `exportXml46687`。
 *
 * - 准备层的问题与渲染器的问题合并返回，一次列出全部错误与警告；准备失败的公式或图片不会让渲染器停下，
 *   渲染器随后会再报 `mathml-missing` / `resource-missing`，两处各自成立（UI 按 nodeId 合并显示）。
 * - **有任何 error 时不打包**：`bytes` 为空数组，`xml` 为 null，`problems` 为全部问题；无 error 才打包。
 * - 同时返回 `xml`，满足“只导出 .xml”与“导出资源包”两种用法（取舍由 UI 决定）。
 * - 入口断言（脚注、输出边界）失败由 `exportXml46687` 转为问题返回，不抛错。
 */
export async function buildXml46687Package(options: BuildXml46687PackageOptions): Promise<BuildXml46687PackageResult> {
  const { doc, labels } = prepareXml46687Input(options.pmDoc, options.documentMeta)
  const [formulaResult, resourceResult] = await Promise.all([
    Promise.resolve(convertFormulasToMathMl(doc)),
    collectXml46687Resources(doc, labels, options.imageResources),
  ])
  const exported = exportXml46687(doc, labels, {
    mathml: formulaResult.mathml,
    resources: resourceResult.manifest,
  })
  const problems = [...formulaResult.problems, ...resourceResult.problems, ...exported.problems]
  const { xml } = exported
  if (xml === null || problems.some(problem => problem.severity === 'error')) {
    return { bytes: new Uint8Array(0), xml: null, manifest: resourceResult.manifest, problems }
  }
  return {
    bytes: await packageXml46687(xml, resourceResult.manifest, resourceResult.files),
    xml,
    manifest: resourceResult.manifest,
    problems,
  }
}
