#!/usr/bin/env node
/**
 * WP8.5 任务 8.5.3：真实 Chromium UI 端到端流程 + 隔离 SQLite 服务端真实冷重启 + HTTP REST 实测。
 *
 * 运行方式（仓库根目录）：
 *   PATH=~/.local/bin:"$PATH" node packages/client/scripts/wp85-xml46687-e2e.mjs
 *
 * 可选参数：
 *   --api-port <port>      隔离后端端口（默认 3096，禁止 3000）
 *   --vite-port <port>     隔离 Vite 端口（默认 5196，禁止 5173）
 *   --work-dir <path>      临时隔离工作父目录（默认 <os.tmpdir()>/wp85-acceptance；每次在其下创建独立 e2e-run-* 子目录）
 *   --output-dir <path>    截图与证据输出目录（默认 docs/qa/wp8.5）
 *   --keep-work-dir        运行结束后保留本次 e2e-run-* 临时目录（默认自动清理）
 *
 * 安全守卫：
 *   - 仅绑定回环地址 127.0.0.1，禁止 3000/5173 默认端口；
 *   - 解析 --work-dir 真实路径（含符号链接与悬空链接），拒绝文件系统根、用户主目录、os.tmpdir() 根、仓库根及其内部或祖先目录；
 *   - 绝不删除调用方传入的 --work-dir 本身或其中既有文件，仅在校验通过后于其下创建带 .wp85-e2e-owned 标记的独立子目录；
 *   - 绝不触碰仓库内的 packages/server/data/ses.db；
 *   - 启动后首先断言 GET /api/documents === []（空库）；
 *   - 无论成功或失败，finally 均彻底终止隔离后端、Vite 进程与浏览器，并在确认 .wp85-e2e-owned 归属标记后仅清理本次 e2e-run-* 子目录（除非指定 --keep-work-dir）。
 */

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  assertSafeWorkDir,
  cleanupIsolatedWorkDir,
  getDefaultWorkDir,
  prepareIsolatedWorkDir,
} from './wp85WorkDirGuard.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../..')
const CLIENT_DIR = join(REPO_ROOT, 'packages/client')
const SERVER_MAIN = join(REPO_ROOT, 'packages/server/dist/main.js')
const SCRIPT_DIR = join(REPO_ROOT, 'scripts/xml46687')

function parseArgs(argv) {
  const opts = {
    apiPort: 3096,
    vitePort: 5196,
    workDir: getDefaultWorkDir(),
    outputDir: join(REPO_ROOT, 'docs/qa/wp8.5'),
    keepWorkDir: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--api-port' && next) { opts.apiPort = Number(next); i += 1 }
    else if (arg === '--vite-port' && next) { opts.vitePort = Number(next); i += 1 }
    else if (arg === '--work-dir') {
      if (!next) throw new Error('--work-dir 缺少路径参数')
      opts.workDir = resolve(next)
      i += 1
    } else if (arg.startsWith('--work-dir=')) {
      const val = arg.slice('--work-dir='.length)
      if (!val) throw new Error('--work-dir 缺少路径参数')
      opts.workDir = resolve(val)
    } else if (arg === '--output-dir') {
      if (!next) throw new Error('--output-dir 缺少路径参数')
      opts.outputDir = resolve(next)
      i += 1
    } else if (arg.startsWith('--output-dir=')) {
      const val = arg.slice('--output-dir='.length)
      if (!val) throw new Error('--output-dir 缺少路径参数')
      opts.outputDir = resolve(val)
    } else if (arg === '--keep-work-dir') {
      opts.keepWorkDir = true
    }
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))

// ---- 安全守卫 ----
if (!Number.isInteger(opts.apiPort) || opts.apiPort < 1024 || opts.apiPort > 65535) {
  throw new Error(`非法 API 端口：${opts.apiPort}`)
}
if (!Number.isInteger(opts.vitePort) || opts.vitePort < 1024 || opts.vitePort > 65535) {
  throw new Error(`非法 Vite 端口：${opts.vitePort}`)
}
if ([3000, 5173].includes(opts.apiPort) || [3000, 5173].includes(opts.vitePort)) {
  throw new Error('禁止使用默认端口 3000 / 5173，避免触碰用户业务库或开发实例')
}
if (opts.apiPort === opts.vitePort) {
  throw new Error('API 端口与 Vite 端口不能相同')
}
assertSafeWorkDir(opts.workDir, { repoRoot: REPO_ROOT })
if (!existsSync(SERVER_MAIN)) {
  throw new Error(`找不到已构建的服务端产物：${SERVER_MAIN}（请先运行 pnpm --filter @ses/server build）`)
}

const API_HOST = '127.0.0.1'
const API_ORIGIN = `http://${API_HOST}:${opts.apiPort}`
const VITE_ORIGIN = `http://${API_HOST}:${opts.vitePort}`

const playwrightEntry = process.env.WP85_PLAYWRIGHT
  ? pathToFileURL(process.env.WP85_PLAYWRIGHT).href
  : pathToFileURL(join(REPO_ROOT, 'packages/server/node_modules/playwright-chromium/index.mjs')).href
const { chromium } = await import(playwrightEntry)
const { default: JSZip } = await import(pathToFileURL(join(CLIENT_DIR, 'node_modules/jszip/lib/index.js')).href)

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256Stable(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function fileSha256(filePath) {
  return sha256Bytes(readFileSync(filePath))
}

async function waitForHttp(url, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status < 500) return res
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`等待服务就绪超时：${url}`)
}

async function assertPortClosed(url) {
  try {
    await fetch(url)
  } catch {
    return true
  }
  throw new Error(`预期服务已停止但端口仍可访问：${url}`)
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return
  const exited = new Promise((resolveExit) => {
    child.once('exit', () => resolveExit())
  })
  child.kill('SIGTERM')
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
  }, 5000)
  await exited
  clearTimeout(timer)
}

function runExternalValidators(xml, label, workDir) {
  const tmpFile = join(workDir, `validate-${label}-${Date.now()}.xml`)
  writeFileSync(tmpFile, xml, 'utf8')
  try {
    const valProc = spawnSync('python3', ['-I', join(SCRIPT_DIR, 'validate.py'), '--json', '--profile', 'export', tmpFile], {
      encoding: 'utf8',
    })
    const valJson = JSON.parse(valProc.stdout)
    const valResult = valJson.results[0]
    assert.equal(valProc.status, 0, `${label} validate.py 失败：${JSON.stringify(valResult?.errors)}`)
    assert.equal(valResult.valid, true, `${label} validate.py valid !== true`)
    assert.deepEqual(valResult.errors, [], `${label} validate.py 有错误`)

    const stsProc = spawnSync('python3', ['-I', join(SCRIPT_DIR, 'sts_compat.py'), tmpFile], {
      encoding: 'utf8',
    })
    assert.equal(stsProc.status, 0, `${label} sts_compat.py 失败：${stsProc.stdout}\n${stsProc.stderr}`)
    assert.ok(stsProc.stdout.includes('未解释偏差 0 个'), `${label} sts_compat.py 存在未解释偏差：${stsProc.stdout}`)

    const jingProc = spawnSync('python3', ['-I', join(SCRIPT_DIR, 'jing_check.py'), '--json', tmpFile], {
      encoding: 'utf8',
    })
    const jingJson = JSON.parse(jingProc.stdout)
    assert.equal(jingProc.status, 0, `${label} jing_check.py 失败：${jingProc.stdout}`)
    assert.equal(jingJson.valid, true, `${label} jing_check.py valid !== true`)
    assert.deepEqual(jingJson.results[0].errors, [], `${label} jing_check.py 有错误`)

    return {
      validatePy: { valid: valResult.valid, errors: valResult.errors.length, warnings: valResult.warnings.length },
      stsCompatPy: { exitCode: stsProc.status, unexplainedDeviations: 0 },
      jingCheckPy: {
        exitCode: jingProc.status,
        jingVersion: jingJson.jing_version,
        javaVersion: jingJson.java_version,
        valid: jingJson.valid,
        errors: jingJson.results[0].errors.length,
      },
    }
  } finally {
    rmSync(tmpFile, { force: true })
  }
}

async function inspectXmlZip(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  const xml = await zip.file('standard.xml').async('string')
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'))
  const resourceHashes = {}
  for (const name of Object.keys(zip.files).filter((n) => n.startsWith('resources/')).sort()) {
    const data = await zip.file(name).async('uint8array')
    resourceHashes[name] = { bytes: data.length, sha256: sha256Bytes(data) }
  }
  return { xml, xmlSha256: sha256Bytes(Buffer.from(xml, 'utf8')), manifest, resourceHashes }
}

/** 准备隔离目录与临时测试包（通过 Vite SSR 直接使用生产 @ses/io 构建真实 GB/T 1.1—2020 资源包）。 */
async function prepareFixtures(fixtureDir) {
  mkdirSync(fixtureDir, { recursive: true })
  const { createServer } = await import(pathToFileURL(join(CLIENT_DIR, 'node_modules/vite/dist/node/index.js')).href)
  const viteSsr = await createServer({
    root: CLIENT_DIR,
    logLevel: 'silent',
    server: { middlewareMode: true },
  })
  try {
    const { buildXml46687Package } = await viteSsr.ssrLoadModule('@ses/io')
    const { createGbt11RealStandardFixture } = await viteSsr.ssrLoadModule('/src/serializer/__fixtures__/wp85RealStandardGbt11.ts')
    const { createEditorSchema } = await viteSsr.ssrLoadModule('/src/extensions/editorSchema.ts')

    const schema = createEditorSchema()
    const realPm = createGbt11RealStandardFixture()
    schema.nodeFromJSON(realPm).check()

    const pkg = await buildXml46687Package({ pmDoc: realPm })
    assert.equal(pkg.problems.filter((p) => p.severity === 'error').length, 0, '准备 GB/T 1.1—2020 资源包失败')
    const validZipPath = join(fixtureDir, 'gbt11-2020.zip')
    writeFileSync(validZipPath, pkg.bytes)

    // 损坏 ZIP：移除第一张图片资源
    const corruptedZip = await JSZip.loadAsync(pkg.bytes)
    const firstRes = Object.keys(corruptedZip.files).find((n) => n.startsWith('resources/'))
    assert.ok(firstRes, '资源包中缺少 resources/*')
    corruptedZip.remove(firstRes)
    const corruptedZipPath = join(fixtureDir, 'corrupted-missing-resource.zip')
    writeFileSync(corruptedZipPath, await corruptedZip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))

    // 纯文本无图标准文档（用于直接下载 .xml 与 REST 纯 XML 导出）
    const textOnlyDoc = schema.nodeFromJSON({
      type: 'doc',
      attrs: { extensionVersion: 1 },
      content: [
        {
          type: 'metadataBlock',
          content: [
            { type: 'titlePart', attrs: { nodeId: 'to-tp-zh', lang: 'zh', role: 'full' }, content: [{ type: 'text', text: '纯文本标准验收样稿' }] },
            { type: 'standardIdentifier', attrs: { nodeId: 'to-id-dated', scheme: 'dated', value: 'GB/T 99990—2026' } },
            { type: 'language', attrs: { nodeId: 'to-lang-zh', tag: 'zh' } },
            { type: 'publisher', attrs: { nodeId: 'to-pub-1', role: 'lead', identifier: 'SAMR' }, content: [{ type: 'text', text: '国家市场监督管理总局' }] },
          ],
        },
        {
          type: 'coverPage',
          attrs: {
            nodeId: 'to-cover',
            standardNo: 'GB/T 99990—2026',
            standardType: 'national',
            titleCn: '纯文本标准验收样稿',
            publishDate: '2026-04-01',
            implementDate: '2026-10-01',
            issuer: '国家市场监督管理总局',
            icsCode: '01.120',
            ccsCode: 'A 00',
          },
          content: [{ type: 'paragraph', attrs: { nodeId: 'to-cover-p' }, content: [{ type: 'text', text: '纯文本标准验收样稿' }] }],
        },
        {
          type: 'foreword',
          content: [
            { type: 'stdParagraph', attrs: { nodeId: 'to-fw-p' }, content: [{ type: 'text', text: '本文件用于验证无图片资源时的纯 XML 导出链路。' }] },
          ],
        },
        {
          type: 'chapter',
          attrs: { nodeId: 'to-ch1', secType: 'scope' },
          content: [
            { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
            { type: 'stdParagraph', attrs: { nodeId: 'to-ch1-p' }, content: [{ type: 'text', text: '本文件规定了无图片资源文档直接导出单文件 XML 的要求。' }] },
          ],
        },
      ],
    })
    textOnlyDoc.check()

    return {
      validZipPath,
      corruptedZipPath,
      legacySepXmlPath: join(REPO_ROOT, 'packages/client/src/serializer/__fixtures__/sample-standard.xml'),
      legacy37967XmlPath: join(REPO_ROOT, 'schemas/gbt46687.2/samples/invalid/gbt37967-root.xml'),
      textOnlyContent: textOnlyDoc.toJSON(),
      initialZipSha256: sha256Bytes(pkg.bytes),
      initialXmlSha256: sha256Bytes(Buffer.from(pkg.xml, 'utf8')),
    }
  } finally {
    await viteSsr.close()
  }
}

// ---- 主流程 ----
const evidence = {
  startedAt: new Date().toISOString(),
  apiOrigin: API_ORIGIN,
  viteOrigin: VITE_ORIGIN,
  baseWorkDir: opts.workDir,
  workDir: null,
  outputDir: opts.outputDir,
  steps: {},
  screenshots: [],
  pageErrors: [],
  consoleErrors: [],
  status: 'in-progress',
}

let isolatedWork = null
let serverProc = null
let viteServer = null
let browser = null

function startIsolatedServer(serverWorkDir) {
  const proc = spawn('node', [SERVER_MAIN], {
    cwd: serverWorkDir,
    env: {
      ...process.env,
      PORT: String(opts.apiPort),
      SES_LISTEN_HOST: API_HOST,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  proc.stdout.on('data', (d) => { logs += d.toString() })
  proc.stderr.on('data', (d) => { logs += d.toString() })
  proc.getLogs = () => logs
  return proc
}

async function startIsolatedVite() {
  const { createServer } = await import(pathToFileURL(join(CLIENT_DIR, 'node_modules/vite/dist/node/index.js')).href)
  const { default: vue } = await import(pathToFileURL(join(CLIENT_DIR, 'node_modules/@vitejs/plugin-vue/dist/index.mjs')).href)
  const server = await createServer({
    configFile: false,
    root: CLIENT_DIR,
    logLevel: 'error',
    plugins: [
      vue({
        template: { compilerOptions: { isCustomElement: (tag) => tag === 'math-field' } },
      }),
    ],
    resolve: {
      alias: { '@': join(CLIENT_DIR, 'src') },
    },
    server: {
      host: API_HOST,
      port: opts.vitePort,
      strictPort: true,
      proxy: {
        '/api': {
          target: API_ORIGIN,
          changeOrigin: true,
          configure(proxy) {
            proxy.on('proxyRes', (proxyRes, _req, res) => {
              proxyRes.on('close', () => {
                if (!proxyRes.complete && !res.destroyed) res.destroy()
              })
            })
          },
        },
      },
    },
  })
  await server.listen()
  await waitForHttp(VITE_ORIGIN, 15000)
  return server
}

async function apiJson(path, init = {}) {
  const res = await fetch(`${API_ORIGIN}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`API ${init.method || 'GET'} ${path} -> ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

async function waitForSaved(page, expectedMinRevision, docId) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const doc = await apiJson(`/documents/${docId}`)
    if (doc.revision >= expectedMinRevision) return doc
    await page.waitForTimeout(250)
  }
  throw new Error(`等待文档 ${docId} 保存到 revision >= ${expectedMinRevision} 超时`)
}

async function saveShot(page, name) {
  const fileName = `${name}.png`
  const fullPath = join(opts.outputDir, fileName)
  await page.screenshot({ path: fullPath, caret: 'initial' })
  evidence.screenshots.push(fileName)
  console.log(`[shot] ${fileName}`)
}

async function dismissToastIfAny(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.el-message').forEach((el) => el.remove())
  })
}

async function appendTextToScopeParagraph(page, markerText) {
  await page.locator('.tiptap').evaluate((el, textToAppend) => {
    const editor = el.editor
    let targetPos = null
    editor.state.doc.descendants((node, pos) => {
      if (targetPos !== null) return false
      if (node.type.name === 'stdParagraph' && node.textContent.includes('本文件确立了标准化文件的结构')) {
        targetPos = pos + node.nodeSize - 1
        return false
      }
      return true
    })
    if (targetPos === null) throw new Error('找不到第1章范围首段以执行编辑')
    editor.chain().focus().setTextSelection(targetPos).insertContent(textToAppend).run()
  }, markerText)
}

try {
  // 0. 创建独立隔离运行目录与测试夹具，并启动隔离服务端、Vite、Chromium
  isolatedWork = prepareIsolatedWorkDir(opts.workDir, { repoRoot: REPO_ROOT })
  evidence.baseWorkDir = isolatedWork.baseWorkDir
  evidence.workDir = isolatedWork.runWorkDir
  mkdirSync(opts.outputDir, { recursive: true })

  const serverWorkDir = join(isolatedWork.runWorkDir, 'server')
  const fixtureDir = join(isolatedWork.runWorkDir, 'fixtures')
  const downloadDir = join(isolatedWork.runWorkDir, 'downloads')
  const validateDir = join(isolatedWork.runWorkDir, 'validate')
  mkdirSync(serverWorkDir, { recursive: true })
  mkdirSync(downloadDir, { recursive: true })
  mkdirSync(validateDir, { recursive: true })

  console.log(`[setup] 隔离运行目录：${isolatedWork.runWorkDir}`)
  console.log('[setup] 准备测试资源包与负例...')
  const fixtures = await prepareFixtures(fixtureDir)

  console.log('[setup] 启动隔离后端与 Vite...')
  serverProc = startIsolatedServer(serverWorkDir)
  await waitForHttp(`${API_ORIGIN}/api/documents`, 20000)
  const initialDocs = await apiJson('/documents')
  assert.deepEqual(initialDocs, [], '安全守卫失败：隔离库必须为空')

  viteServer = await startIsolatedVite()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true })
  const page = await context.newPage()
  page.on('pageerror', (err) => evidence.pageErrors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') evidence.consoleErrors.push(msg.text())
  })

  // 创建空白载体文档用于 UI 验收
  const emptyDoc = await apiJson('/documents', {
    method: 'POST',
    body: JSON.stringify({
      title: 'WP8.5 UI 验收载体文档',
      meta: { titleCn: 'WP8.5 UI 验收载体文档', standardType: 'national' },
      stage: 'working_draft',
      content: {
        type: 'doc',
        attrs: { extensionVersion: 1 },
        content: [
          {
            type: 'chapter',
            attrs: { nodeId: 'init-ch-1', secType: 'scope' },
            content: [
              { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
              { type: 'stdParagraph', attrs: { nodeId: 'init-p-1' }, content: [{ type: 'text', text: '待导入。' }] },
            ],
          },
        ],
      },
    }),
  })
  const mainDocId = emptyDoc.id
  console.log(`[setup] 隔离库已创建载体文档 id=${mainDocId}，后端 PID=${serverProc.pid}`)

  // ================= 步骤 1：UI 入口检查 =================
  await page.goto(`${VITE_ORIGIN}/editor/${mainDocId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.tiptap').waitFor()
  await page.waitForTimeout(500)

  // 检查导入按钮与隐藏 file input
  const importBtn = page.getByRole('button', { name: '导入 XML' })
  await importBtn.waitFor({ state: 'visible' })
  const fileInput = page.locator('input[type="file"][accept=".xml,.zip"]')
  assert.equal(await fileInput.count(), 1, '应存在唯一 accept=".xml,.zip" 文件输入')

  // 打开导出卡片检查
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const exportDlg = page.locator('.el-dialog').filter({ hasText: 'XML（GB/T 46687.2—2026）' }).last()
  await exportDlg.waitFor({ state: 'visible' })
  const exportDlgText = await exportDlg.innerText()
  assert.ok(exportDlgText.includes('XML（GB/T 46687.2—2026）'), '导出卡片缺少 GB/T 46687.2—2026 入口')
  assert.ok(!/37967|NISO STS/i.test(exportDlgText), `导出卡片残留旧入口：${exportDlgText}`)
  await page.waitForTimeout(500)
  await saveShot(page, '01-ui-xml46687-entries')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)

  // 打开源码弹窗检查格式选择器
  await page.getByRole('button', { name: /源码/ }).click()
  const codeDlg = page.locator('.ses-code-dlg')
  await codeDlg.waitFor({ state: 'visible' })
  const codeDlgText = await codeDlg.innerText()
  assert.ok(codeDlgText.includes('XML（GB/T 46687.2—2026）'), '源码格式选择器缺少 GB/T 46687.2—2026')
  assert.ok(!/37967|NISO STS/i.test(codeDlgText), `源码弹窗残留旧入口：${codeDlgText}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)

  evidence.steps.step1_uiEntries = {
    passed: true,
    xmlEntryLabel: 'XML（GB/T 46687.2—2026）',
    legacyEntriesFound: false,
  }
  console.log('[step1] UI 入口检查通过')

  // ================= 步骤 2：真实 UI 导入 .zip 资源包 =================
  await dismissToastIfAny(page)
  await fileInput.setInputFiles(fixtures.validZipPath)
  await page.locator('.el-message--success').filter({ hasText: 'XML 文件导入成功' }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(600)

  const docAfterImport = await apiJson(`/documents/${mainDocId}`)
  assert.equal(docAfterImport.meta.standardNo, 'GB/T 1.1—2020')
  assert.equal(docAfterImport.meta.publishDate, '2020-03-31')
  assert.equal(docAfterImport.meta.implementDate, '2020-10-01')
  assert.equal(docAfterImport.meta.icsCode, '01.120')
  assert.equal(docAfterImport.meta.ccsCode, 'A 00')
  assert.equal(docAfterImport.meta.technicalCommittee, 'SAC/TC 286')
  const crumbText = await page.locator('.doc-crumb').innerText()
  assert.ok(crumbText.includes('GB/T 1.1—2020'), `顶部标题栏未同步标准号：${crumbText}`)
  const editorTextAfterImport = await page.locator('.tiptap').innerText()
  assert.ok(editorTextAfterImport.includes('标准化工作导则') || editorTextAfterImport.includes('本文件确立了标准化文件的结构'))
  const imgCount = await page.locator('.tiptap img').count()
  assert.ok(imgCount >= 3, `导入后图片渲染数量不足：${imgCount}`)
  await saveShot(page, '02-ui-import-zip-success')

  evidence.steps.step2_uiImportZip = {
    passed: true,
    documentId: mainDocId,
    revision: docAfterImport.revision,
    standardNo: docAfterImport.meta.standardNo,
    title: docAfterImport.title,
    renderedImageCount: imgCount,
  }
  console.log(`[step2] 真实 UI 导入 .zip 成功（revision=${docAfterImport.revision}, imgs=${imgCount}）`)

  // ================= 步骤 3：负例 UI 导入拒绝且不覆盖原稿 =================
  const beforeNegEditorJson = await page.locator('.tiptap').evaluate((el) => el.editor.getJSON())
  const beforeNegEditorHash = sha256Stable(beforeNegEditorJson)
  const beforeNegApiDoc = await apiJson(`/documents/${mainDocId}`)
  const beforeNegApiHash = sha256Stable({ title: beforeNegApiDoc.title, meta: beforeNegApiDoc.meta, content: beforeNegApiDoc.content })

  const negativeCases = [
    { key: 'legacySep', path: fixtures.legacySepXmlPath, shotName: '03-ui-reject-legacy-sep' },
    { key: 'legacy37967', path: fixtures.legacy37967XmlPath, shotName: null },
    { key: 'corruptedZip', path: fixtures.corruptedZipPath, shotName: null },
  ]
  const negativeEvidence = {}

  for (const neg of negativeCases) {
    await dismissToastIfAny(page)
    await fileInput.setInputFiles(neg.path)
    const errToast = page.locator('.el-message--error').last()
    await errToast.waitFor({ state: 'visible', timeout: 15000 })
    const errMessage = (await errToast.innerText()).trim()
    assert.ok(errMessage.includes('XML 导入失败'), `负例 ${neg.key} 未出现预期错误提示：${errMessage}`)
    if (neg.shotName) {
      await page.waitForTimeout(350)
      await saveShot(page, neg.shotName)
    }
    await page.waitForTimeout(300)

    const afterNegEditorHash = sha256Stable(await page.locator('.tiptap').evaluate((el) => el.editor.getJSON()))
    const afterNegApiDoc = await apiJson(`/documents/${mainDocId}`)
    const afterNegApiHash = sha256Stable({ title: afterNegApiDoc.title, meta: afterNegApiDoc.meta, content: afterNegApiDoc.content })
    assert.equal(afterNegEditorHash, beforeNegEditorHash, `负例 ${neg.key} 改动了编辑器原稿！`)
    assert.equal(afterNegApiHash, beforeNegApiHash, `负例 ${neg.key} 改动了服务端持久化原稿！`)
    negativeEvidence[neg.key] = {
      rejected: true,
      errorMessage: errMessage,
      editorHashUnchanged: true,
      apiHashUnchanged: true,
    }
    console.log(`[step3] 负例 ${neg.key} 已拒绝且未覆盖原稿：${errMessage.slice(0, 80)}`)
  }
  evidence.steps.step3_negativeRejections = {
    passed: true,
    baselineEditorHash: beforeNegEditorHash,
    baselineApiHash: beforeNegApiHash,
    cases: negativeEvidence,
  }

  // ================= 步骤 4：编辑 + 保存 + 版本快照 A + 三引擎校验 =================
  const MARKER_A = '（WP8.5 首次编辑标记A）'
  const MARKER_B = '（WP8.5 二次编辑标记B）'

  await dismissToastIfAny(page)
  const revBeforeEditA = (await apiJson(`/documents/${mainDocId}`)).revision
  await appendTextToScopeParagraph(page, MARKER_A)
  await page.keyboard.press('Control+s')
  const docAfterEditA = await waitForSaved(page, revBeforeEditA + 1, mainDocId)
  assert.ok(JSON.stringify(docAfterEditA.content).includes(MARKER_A), '首次编辑未持久化到服务端')

  // 打开版本面板并创建快照 A（v1.0）
  await page.getByRole('button', { name: '版本历史' }).click()
  await page.locator('[data-testid="version-sidebar"]').waitFor({ state: 'visible' })
  await page.locator('[data-testid="version-sidebar"]').getByRole('button', { name: '保存版本' }).click()
  const createVerDlg = page.locator('.el-dialog').filter({ hasText: '版本号' }).last()
  await createVerDlg.waitFor({ state: 'visible' })
  await createVerDlg.locator('input').first().fill('1.0')
  await createVerDlg.locator('textarea').fill('WP8.5 快照A（首次编辑后）')
  await createVerDlg.getByRole('button', { name: '确定' }).click()
  await page.locator('.el-message--success').filter({ hasText: '版本保存成功' }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(400)
  await saveShot(page, '04-version-snapshot-a')

  const versionsAfterA = await apiJson(`/versions/document/${mainDocId}`)
  const snapshotA = versionsAfterA.find((v) => v.versionNo === '1.0')
  assert.ok(snapshotA, '找不到已保存的版本快照 A（1.0）')
  const snapshotADetail = await apiJson(`/versions/${snapshotA.id}`)
  assert.ok(typeof snapshotADetail.xml === 'string' && snapshotADetail.xml.includes('<standard '), '快照 A 缺少 GB/T 46687.2 XML')
  assert.ok(snapshotADetail.xml.includes(MARKER_A), '快照 A XML 未包含首次编辑标记')
  const snapshotAValidation = runExternalValidators(snapshotADetail.xml, 'snapshotA', validateDir)

  evidence.steps.step4_editAndSnapshotA = {
    passed: true,
    revisionBefore: revBeforeEditA,
    revisionAfterEdit: docAfterEditA.revision,
    versionId: snapshotA.id,
    versionNo: snapshotA.versionNo,
    xmlBytes: Buffer.byteLength(snapshotADetail.xml, 'utf8'),
    xmlSha256: sha256Bytes(Buffer.from(snapshotADetail.xml, 'utf8')),
    validation: snapshotAValidation,
  }
  console.log(`[step4] 编辑保存 + 版本快照 A(id=${snapshotA.id}) 三引擎校验通过`)

  // ================= 步骤 5：二次编辑 + 保存 + 版本快照 B =================
  await dismissToastIfAny(page)
  const revBeforeEditB = (await apiJson(`/documents/${mainDocId}`)).revision
  await appendTextToScopeParagraph(page, MARKER_B)
  await page.keyboard.press('Control+s')
  const docAfterEditB = await waitForSaved(page, revBeforeEditB + 1, mainDocId)
  assert.ok(JSON.stringify(docAfterEditB.content).includes(MARKER_B), '二次编辑未持久化到服务端')

  await page.locator('[data-testid="version-sidebar"]').getByRole('button', { name: '保存版本' }).click()
  const createVerDlgB = page.locator('.el-dialog').filter({ hasText: '版本号' }).last()
  await createVerDlgB.waitFor({ state: 'visible' })
  await createVerDlgB.locator('input').first().fill('1.1')
  await createVerDlgB.locator('textarea').fill('WP8.5 快照B（二次编辑后）')
  await createVerDlgB.getByRole('button', { name: '确定' }).click()
  await page.locator('.el-message--success').filter({ hasText: '版本保存成功' }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(400)

  const versionsAfterB = await apiJson(`/versions/document/${mainDocId}`)
  const snapshotB = versionsAfterB.find((v) => v.versionNo === '1.1')
  assert.ok(snapshotB, '找不到已保存的版本快照 B（1.1）')
  evidence.steps.step5_editAndSnapshotB = {
    passed: true,
    revisionBefore: revBeforeEditB,
    revisionAfterEdit: docAfterEditB.revision,
    versionId: snapshotB.id,
    versionNo: snapshotB.versionNo,
  }
  console.log(`[step5] 二次编辑保存 + 版本快照 B(id=${snapshotB.id}) 完成`)

  // ================= 步骤 6：服务端真实停止与冷重启 =================
  const dbFilePath = join(serverWorkDir, 'data/ses.db')
  assert.ok(existsSync(dbFilePath), `找不到隔离数据库文件：${dbFilePath}`)
  // 先关闭当前编辑器页签（干净关闭 SSE 长连接），模拟真实冷重启前退出，再停机并冷重开
  await page.goto('about:blank')
  const oldPid = serverProc.pid
  const dbShaBeforeStop = fileSha256(dbFilePath)
  await stopChild(serverProc)
  serverProc = null
  await assertPortClosed(`${API_ORIGIN}/api/documents`)
  const dbShaAfterStop = fileSha256(dbFilePath)

  // 同目录重启隔离服务端
  serverProc = startIsolatedServer(serverWorkDir)
  await waitForHttp(`${API_ORIGIN}/api/documents`, 20000)
  const newPid = serverProc.pid
  assert.notEqual(newPid, oldPid, '冷重启后新旧 PID 必须不同')
  const dbShaAfterRestart = fileSha256(dbFilePath)
  assert.equal(dbShaAfterRestart, dbShaAfterStop, '重启瞬间数据库文件 SHA-256 应与停机后一致')

  // 冷重开编辑器页面并核对编辑后内容与两份版本快照完好无损
  await page.goto(`${VITE_ORIGIN}/editor/${mainDocId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.tiptap').waitFor()
  await page.waitForTimeout(600)
  const reloadedText = await page.locator('.tiptap').innerText()
  assert.ok(reloadedText.includes(MARKER_A) && reloadedText.includes(MARKER_B), '冷重启重载后编辑标记丢失')
  await page.getByRole('button', { name: '版本历史' }).click()
  await page.locator('[data-testid="version-sidebar"]').waitFor({ state: 'visible' })
  const versionListText = await page.locator('[data-testid="version-sidebar"]').innerText()
  assert.ok(versionListText.includes('v1.0') && versionListText.includes('v1.1'), `冷重启后版本列表不完整：${versionListText}`)

  evidence.steps.step6_coldRestart = {
    passed: true,
    oldPid,
    newPid,
    dbPath: dbFilePath,
    dbSha256BeforeStop: dbShaBeforeStop,
    dbSha256AfterStop: dbShaAfterStop,
    dbSha256AfterRestart: dbShaAfterRestart,
    portRefusedWhenStopped: true,
    versionsPreserved: ['v1.0', 'v1.1'],
  }
  console.log(`[step6] 真实冷重启验证通过（oldPid=${oldPid} -> newPid=${newPid}, dbSha=${dbShaAfterStop}）`)

  // ================= 步骤 7：版本回滚至快照 A =================
  await dismissToastIfAny(page)
  const revBeforeRollback = (await apiJson(`/documents/${mainDocId}`)).revision
  const itemA = page.locator('.version-item').filter({ hasText: 'v1.0' }).first()
  await itemA.getByRole('button', { name: '回滚' }).click()
  const confirmBox = page.locator('.el-message-box').last()
  await confirmBox.waitFor({ state: 'visible' })
  await confirmBox.getByRole('button', { name: '确定回滚' }).click()
  await page.waitForTimeout(500)
  await page.keyboard.press('Control+s')
  const docAfterRollback = await waitForSaved(page, revBeforeRollback + 1, mainDocId)

  const textAfterRollback = await page.locator('.tiptap').innerText()
  assert.ok(textAfterRollback.includes(MARKER_A), '回滚至快照 A 后缺少标记 A')
  assert.ok(!textAfterRollback.includes(MARKER_B), '回滚至快照 A 后仍残留标记 B')
  assert.ok(JSON.stringify(docAfterRollback.content).includes(MARKER_A), '回滚后服务端正文缺少标记 A')
  assert.ok(!JSON.stringify(docAfterRollback.content).includes(MARKER_B), '回滚后服务端正文仍残留标记 B')
  await page.locator('.tiptap .std-paragraph').filter({ hasText: MARKER_A }).first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await saveShot(page, '05-version-rollback')

  evidence.steps.step7_rollbackToSnapshotA = {
    passed: true,
    revisionBefore: revBeforeRollback,
    revisionAfter: docAfterRollback.revision,
    containsMarkerA: true,
    containsMarkerB: false,
  }
  console.log(`[step7] 版本回滚至快照 A 成功（revision=${docAfterRollback.revision}）`)

  // ================= 步骤 8：文档复制（真实 UI 操作） =================
  await page.locator('.ses-brand').click()
  await page.locator('.doc-card').first().waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(400)
  const docsBeforeDup = await apiJson('/documents')
  const targetCard = page.locator('.doc-card').filter({ hasText: 'GB/T 1.1—2020' }).first()
  await targetCard.getByRole('button', { name: '更多操作' }).click()
  await page.locator('.el-dropdown-menu__item').filter({ hasText: '复制为新文件' }).last().click()

  let duplicatedDoc = null
  for (let i = 0; i < 30; i += 1) {
    const docsNow = await apiJson('/documents')
    if (docsNow.length === docsBeforeDup.length + 1) {
      duplicatedDoc = docsNow.find((d) => !docsBeforeDup.some((prev) => prev.id === d.id))
      break
    }
    await page.waitForTimeout(250)
  }
  assert.ok(duplicatedDoc, 'UI 复制为新文件未创建新文档')
  const duplicatedDetail = await apiJson(`/documents/${duplicatedDoc.id}`)
  assert.equal(duplicatedDetail.meta.standardNo, 'GB/T 1.1—2020')
  assert.equal(duplicatedDetail.meta.publishDate, '2020-03-31')
  assert.equal(duplicatedDetail.meta.implementDate, '2020-10-01')
  assert.equal(duplicatedDetail.meta.icsCode, '01.120')
  assert.equal(duplicatedDetail.meta.ccsCode, 'A 00')
  assert.ok(JSON.stringify(duplicatedDetail.content).includes(MARKER_A), '副本缺少回滚后的正文内容')
  assert.ok(!JSON.stringify(duplicatedDetail.content).includes(MARKER_B), '副本不应含已回滚的标记 B')

  evidence.steps.step8_duplicateDocument = {
    passed: true,
    sourceDocumentId: mainDocId,
    duplicateDocumentId: duplicatedDoc.id,
    duplicateTitle: duplicatedDetail.title,
    standardNo: duplicatedDetail.meta.standardNo,
  }
  console.log(`[step8] 文档复制成功（duplicateId=${duplicatedDoc.id}）`)

  // ================= 步骤 9：源码视图 + 真实 UI 下载导出（ZIP 与纯 XML）+ 三引擎校验 =================
  await page.goto(`${VITE_ORIGIN}/editor/${mainDocId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.tiptap').waitFor()
  await page.waitForTimeout(500)

  // 源码视图核验
  await page.getByRole('button', { name: /源码/ }).click()
  const sourceDlg = page.locator('.ses-code-dlg')
  await sourceDlg.waitFor({ state: 'visible' })
  await page.waitForFunction(() => {
    const pre = document.querySelector('.ses-code-dlg .xml-code')
    return Boolean(pre && pre.textContent && pre.textContent.includes('<standard '))
  }, undefined, { timeout: 15000 })
  const sourceXmlText = await sourceDlg.locator('.xml-code').innerText()
  assert.ok(sourceXmlText.includes('<release-date>2020-03-31</release-date>'))
  assert.ok(sourceXmlText.includes('<implementation-date>2020-10-01</implementation-date>'))
  assert.ok(sourceXmlText.includes(MARKER_A))
  await page.waitForTimeout(500)
  await saveShot(page, '06-source-view-xml46687')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // UI 导出卡片截图 + 真实下载含图文档 .zip
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const exportDialog = page.locator('.el-dialog').filter({ hasText: 'XML（GB/T 46687.2—2026）' }).last()
  await exportDialog.waitFor({ state: 'visible' })
  await page.waitForTimeout(500)
  await saveShot(page, '07-ui-export-card')

  const [zipDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    exportDialog.locator('.export-card').filter({ hasText: 'XML（GB/T 46687.2—2026）' }).click(),
  ])
  const uiZip1Name = zipDownload.suggestedFilename()
  assert.ok(uiZip1Name.endsWith('.zip'), `含图文档应下载 .zip，实际为 ${uiZip1Name}`)
  const uiZip1Path = join(downloadDir, 'ui-export-1.zip')
  await zipDownload.saveAs(uiZip1Path)
  const uiZip1Bytes = readFileSync(uiZip1Path)
  const uiZip1Info = await inspectXmlZip(uiZip1Bytes)
  const uiZip1Validation = runExternalValidators(uiZip1Info.xml, 'uiExportZip1', validateDir)

  // 创建纯文本无图文档并在 UI 触发直接下载 .xml
  const textOnlyCreated = await apiJson('/documents', {
    method: 'POST',
    body: JSON.stringify({
      title: '纯文本标准验收样稿',
      meta: {
        titleCn: '纯文本标准验收样稿',
        standardNo: 'GB/T 99990—2026',
        standardType: 'national',
        publishDate: '2026-04-01',
        implementDate: '2026-10-01',
        issuer: '国家市场监督管理总局',
        icsCode: '01.120',
        ccsCode: 'A 00',
      },
      stage: 'working_draft',
      content: fixtures.textOnlyContent,
    }),
  })
  const textOnlyDocId = textOnlyCreated.id
  await page.goto(`${VITE_ORIGIN}/editor/${textOnlyDocId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.tiptap').waitFor()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const exportDialogTextOnly = page.locator('.el-dialog').filter({ hasText: 'XML（GB/T 46687.2—2026）' }).last()
  await exportDialogTextOnly.waitFor({ state: 'visible' })
  const [xmlDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    exportDialogTextOnly.locator('.export-card').filter({ hasText: 'XML（GB/T 46687.2—2026）' }).click(),
  ])
  const uiTextOnlyName = xmlDownload.suggestedFilename()
  assert.ok(uiTextOnlyName.endsWith('.xml'), `无图纯文本文档应直接下载 .xml，实际为 ${uiTextOnlyName}`)
  const uiTextOnlyPath = join(downloadDir, 'ui-export-text-only.xml')
  await xmlDownload.saveAs(uiTextOnlyPath)
  const uiTextOnlyXml = readFileSync(uiTextOnlyPath, 'utf8')
  const uiTextOnlyValidation = runExternalValidators(uiTextOnlyXml, 'uiExportTextOnly', validateDir)

  evidence.steps.step9_sourceAndUiDownloads = {
    passed: true,
    withResourcesZip: {
      suggestedFilename: uiZip1Name,
      zipBytes: uiZip1Bytes.length,
      xmlBytes: Buffer.byteLength(uiZip1Info.xml, 'utf8'),
      xmlSha256: uiZip1Info.xmlSha256,
      resources: uiZip1Info.resourceHashes,
      validation: uiZip1Validation,
    },
    textOnlyXml: {
      documentId: textOnlyDocId,
      suggestedFilename: uiTextOnlyName,
      xmlBytes: Buffer.byteLength(uiTextOnlyXml, 'utf8'),
      xmlSha256: sha256Bytes(Buffer.from(uiTextOnlyXml, 'utf8')),
      validation: uiTextOnlyValidation,
    },
  }
  console.log(`[step9] 源码视图 + UI 下载 .zip(${uiZip1Name}) 与纯 .xml(${uiTextOnlyName}) 三引擎校验全部通过`)

  // ================= 步骤 10：独立新建文档二次 UI 导入 + 二次导出幂等 =================
  const reimportCarrier = await apiJson('/documents', {
    method: 'POST',
    body: JSON.stringify({
      title: 'WP8.5 二次导入独立载体',
      meta: { titleCn: 'WP8.5 二次导入独立载体', standardType: 'national' },
      stage: 'working_draft',
      content: {
        type: 'doc',
        attrs: { extensionVersion: 1 },
        content: [
          {
            type: 'chapter',
            attrs: { nodeId: 're-ch-1', secType: 'scope' },
            content: [
              { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
              { type: 'stdParagraph', attrs: { nodeId: 're-p-1' }, content: [{ type: 'text', text: '待二次导入。' }] },
            ],
          },
        ],
      },
    }),
  })
  const reimportDocId = reimportCarrier.id
  await page.goto(`${VITE_ORIGIN}/editor/${reimportDocId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.tiptap').waitFor()
  await page.waitForTimeout(400)

  await dismissToastIfAny(page)
  await page.locator('input[type="file"][accept=".xml,.zip"]').setInputFiles(uiZip1Path)
  await page.locator('.el-message--success').filter({ hasText: 'XML 文件导入成功' }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(600)

  const reimportText = await page.locator('.tiptap').innerText()
  assert.ok(reimportText.includes(MARKER_A), '独立二次导入后正文缺少标记 A')
  const reimportImgCount = await page.locator('.tiptap img').count()
  assert.ok(reimportImgCount >= 3, `独立二次导入后图片数量不足：${reimportImgCount}`)
  await page.locator('.tiptap .std-figure').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await saveShot(page, '08-ui-reimport-roundtrip')

  await page.getByRole('button', { name: '导出', exact: true }).click()
  const exportDlg2 = page.locator('.el-dialog').filter({ hasText: 'XML（GB/T 46687.2—2026）' }).last()
  await exportDlg2.waitFor({ state: 'visible' })
  const [zipDownload2] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    exportDlg2.locator('.export-card').filter({ hasText: 'XML（GB/T 46687.2—2026）' }).click(),
  ])
  const uiZip2Path = join(downloadDir, 'ui-export-2.zip')
  await zipDownload2.saveAs(uiZip2Path)
  const uiZip2Bytes = readFileSync(uiZip2Path)
  const uiZip2Info = await inspectXmlZip(uiZip2Bytes)

  assert.equal(uiZip2Info.xml, uiZip1Info.xml, '二次 UI 导出的 standard.xml 与首次 UI 导出不逐字节一致！')
  assert.deepEqual(uiZip2Info.resourceHashes, uiZip1Info.resourceHashes, '二次 UI 导出的资源 SHA-256 与首次不一致！')

  evidence.steps.step10_reimportRoundtripIdempotency = {
    passed: true,
    reimportDocumentId: reimportDocId,
    renderedImageCount: reimportImgCount,
    firstXmlSha256: uiZip1Info.xmlSha256,
    secondXmlSha256: uiZip2Info.xmlSha256,
    xmlByteIdentical: uiZip2Info.xml === uiZip1Info.xml,
    resourceSha256Identical: true,
  }
  console.log(`[step10] 独立二次导入与二次导出逐字节幂等验证通过（sha256=${uiZip2Info.xmlSha256}）`)

  // ================= 步骤 11：HTTP REST 导出实测 =================
  // 注：产品实际 REST 路由为 GET /api/documents/:id/export/xml（参见 packages/server/src/export/export.controller.ts）
  const restZipRes = await fetch(`${API_ORIGIN}/api/documents/${mainDocId}/export/xml`)
  assert.equal(restZipRes.status, 200, `REST 含图 XML 导出失败：${restZipRes.status}`)
  const restZipCt = restZipRes.headers.get('content-type') || ''
  assert.ok(restZipCt.includes('application/zip'), `含图 REST 导出 Content-Type 异常：${restZipCt}`)
  const restZipBytes = new Uint8Array(await restZipRes.arrayBuffer())
  const restZipInfo = await inspectXmlZip(restZipBytes)
  const restZipValidation = runExternalValidators(restZipInfo.xml, 'restExportZip', validateDir)
  assert.equal(restZipInfo.xml, uiZip1Info.xml, 'REST 导出的 standard.xml 与 UI 导出不一致')

  const restXmlRes = await fetch(`${API_ORIGIN}/api/documents/${textOnlyDocId}/export/xml`)
  assert.equal(restXmlRes.status, 200, `REST 纯文本 XML 导出失败：${restXmlRes.status}`)
  const restXmlCt = restXmlRes.headers.get('content-type') || ''
  assert.ok(/xml/i.test(restXmlCt), `纯文本 REST 导出 Content-Type 异常：${restXmlCt}`)
  const restXmlText = await restXmlRes.text()
  const restXmlValidation = runExternalValidators(restXmlText, 'restExportTextOnly', validateDir)
  assert.equal(restXmlText, uiTextOnlyXml, 'REST 导出的纯文本 XML 与 UI 导出不一致')

  evidence.steps.step11_httpRestExport = {
    passed: true,
    routePattern: '/api/documents/:id/export/xml',
    withResourcesZip: {
      documentId: mainDocId,
      status: restZipRes.status,
      contentType: restZipCt,
      contentDisposition: restZipRes.headers.get('content-disposition'),
      bytes: restZipBytes.length,
      xmlSha256: restZipInfo.xmlSha256,
      matchesUiExport: restZipInfo.xml === uiZip1Info.xml,
      validation: restZipValidation,
    },
    textOnlyXml: {
      documentId: textOnlyDocId,
      status: restXmlRes.status,
      contentType: restXmlCt,
      contentDisposition: restXmlRes.headers.get('content-disposition'),
      bytes: Buffer.byteLength(restXmlText, 'utf8'),
      xmlSha256: sha256Bytes(Buffer.from(restXmlText, 'utf8')),
      matchesUiExport: restXmlText === uiTextOnlyXml,
      validation: restXmlValidation,
    },
  }
  console.log('[step11] HTTP REST 导出实测（含图 .zip 与纯文本 .xml）全部通过')

  // 零页面错误 / 零控制台错误断言
  assert.deepEqual(evidence.pageErrors, [], `存在 pageerror：${JSON.stringify(evidence.pageErrors)}`)
  assert.deepEqual(evidence.consoleErrors, [], `存在 console.error：${JSON.stringify(evidence.consoleErrors)}`)

  evidence.status = 'passed'
  evidence.finishedAt = new Date().toISOString()
  writeFileSync(join(opts.outputDir, 'e2e-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.log(`[done] WP8.5 UI E2E 全流程通过！证据已写入 ${join(opts.outputDir, 'e2e-evidence.json')}`)
} catch (error) {
  evidence.status = 'failed'
  evidence.error = error instanceof Error ? { message: error.message, stack: error.stack } : String(error)
  evidence.finishedAt = new Date().toISOString()
  mkdirSync(opts.outputDir, { recursive: true })
  writeFileSync(join(opts.outputDir, 'e2e-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.error('[failed]', error)
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  if (viteServer) await viteServer.close().catch(() => {})
  await stopChild(serverProc).catch(() => {})
  if (isolatedWork && !opts.keepWorkDir) {
    try {
      cleanupIsolatedWorkDir(isolatedWork.runWorkDir, {
        repoRoot: REPO_ROOT,
        expectedBaseWorkDir: isolatedWork.baseWorkDir,
      })
    } catch (cleanupError) {
      console.error('[cleanup] 清理隔离运行目录失败：', cleanupError)
    }
  }
}
