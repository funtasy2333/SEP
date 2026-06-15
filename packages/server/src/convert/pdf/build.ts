/**
 * vivliostyle 构建与 poppler 工具封装（Phase 5.5 / WP5，IO 层）。
 *
 * - resolveVivliostyleCli：定位 @vivliostyle/cli 的 dist/cli.js（编程定位，免 PATH 依赖）；
 * - runVivliostyleBuild：以 node 子进程执行 `vivliostyle build <in> -o <out>`（execFile）；
 * - pdfToTextPages：pdftotext 逐页纯文本（按 \f 切分）；
 * - pdfPageCount：pdfinfo 取页数（两遍页数一致性断言用）；
 * - prepareKatexAssets / injectHeadLink：KaTeX CSS + 字体落盘并注入 <link>。
 *
 * poppler（pdftotext/pdfinfo）为系统依赖：优先 PATH，回退 Homebrew/usr-local 常见路径。
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { copyFile, cp, readFile, writeFile, access } from 'fs/promises'
import { join, dirname } from 'path'

const execFileAsync = promisify(execFile)

const VIVLIOSTYLE_TIMEOUT = 120_000
const POPPLER_TIMEOUT = 60_000

/** poppler 二进制候选路径（系统依赖，非 npm 包） */
const POPPLER_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

async function resolvePoppler(bin: string): Promise<string> {
  for (const dir of POPPLER_DIRS) {
    const p = join(dir, bin)
    try {
      await access(p)
      return p
    } catch {
      /* continue */
    }
  }
  // 回退到 PATH 中的同名命令
  return bin
}

/** 定位 @vivliostyle/cli 的 CLI 入口（从 server 包可解析）。失败抛错。 */
export function resolveVivliostyleCli(): string {
  const pkgPath = require.resolve('@vivliostyle/cli/package.json')

  const pkg = require('@vivliostyle/cli/package.json') as {
    bin: Record<string, string>
  }
  const rel = pkg.bin.vivliostyle ?? pkg.bin.vs
  return join(dirname(pkgPath), rel)
}

/** vivliostyle 是否可用（CLI 可解析即认为已安装；浏览器缺失在构建时报错） */
export function isVivliostyleAvailable(): boolean {
  try {
    resolveVivliostyleCli()
    return true
  } catch {
    return false
  }
}

/** 执行一遍 vivliostyle build。失败时抛出含 stderr 的错误。 */
export async function runVivliostyleBuild(
  cliPath: string,
  inputHtml: string,
  outputPdf: string,
): Promise<void> {
  try {
    await execFileAsync(
      process.execPath,
      [cliPath, 'build', inputHtml, '-o', outputPdf, '--timeout', '120'],
      { timeout: VIVLIOSTYLE_TIMEOUT, maxBuffer: 32 * 1024 * 1024 },
    )
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    throw new Error(`vivliostyle build 失败: ${e.stderr || e.message || err}`)
  }
}

/** pdftotext 逐页纯文本，按换页符 \f 切分（去掉末尾空段）。 */
export async function pdfToTextPages(pdfPath: string): Promise<string[]> {
  const bin = await resolvePoppler('pdftotext')
  const { stdout } = await execFileAsync(bin, [pdfPath, '-'], {
    timeout: POPPLER_TIMEOUT,
    maxBuffer: 64 * 1024 * 1024,
  })
  const parts = stdout.split('\f')
  // pdftotext 每页后均跟一个 \f，末段通常为空——移除以使页数等于物理页数
  if (parts.length > 0 && parts[parts.length - 1].trim() === '') parts.pop()
  return parts
}

/** pdfinfo 取页数。 */
export async function pdfPageCount(pdfPath: string): Promise<number> {
  const bin = await resolvePoppler('pdfinfo')
  const { stdout } = await execFileAsync(bin, [pdfPath], {
    timeout: POPPLER_TIMEOUT,
  })
  const m = /^Pages:\s+(\d+)/m.exec(stdout)
  return m ? Number(m[1]) : NaN
}

/** poppler 是否可用（pdftotext + pdfinfo 均可定位且可执行）。 */
export async function isPopplerAvailable(): Promise<boolean> {
  try {
    const bin = await resolvePoppler('pdftotext')
    await execFileAsync(bin, ['-v'], { timeout: 10_000 }).catch((e) => {
      // pdftotext -v 退出码非 0 但能执行也算可用；仅 ENOENT 视为不可用
      if ((e as { code?: string }).code === 'ENOENT') throw e
    })
    return true
  } catch {
    return false
  }
}

/**
 * 把 KaTeX 的 CSS 与字体复制到 tmpDir，返回需注入 <head> 的 <link> 标签。
 * CSS 以相对路径引用 fonts/，故字体目录须与 katex.min.css 同级落盘。
 */
export async function prepareKatexAssets(tmpDir: string): Promise<string> {
  const cssSrc = require.resolve('katex/dist/katex.min.css')
  const fontsSrc = join(dirname(cssSrc), 'fonts')
  await copyFile(cssSrc, join(tmpDir, 'katex.min.css'))
  await cp(fontsSrc, join(tmpDir, 'fonts'), { recursive: true })
  return '<link rel="stylesheet" href="katex.min.css" />'
}

/** 在 </head> 前插入若干标签（KaTeX <link>）。 */
export function injectHead(html: string, headTags: string): string {
  const idx = html.indexOf('</head>')
  if (idx < 0) return html
  return html.slice(0, idx) + headTags + html.slice(idx)
}

/** 写文件（封装以便复用）。 */
export async function writeHtmlFile(path: string, html: string): Promise<void> {
  await writeFile(path, html, 'utf8')
}

/** 读 PDF 为 Buffer。 */
export async function readPdf(path: string): Promise<Buffer> {
  return readFile(path)
}
