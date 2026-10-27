// @ts-nocheck — 测试辅助：使用 Node 内建模块（child_process/fs/os/path/url）；shared 的 tsconfig 不含 @types/node，也不编译测试。
/**
 * 外部校验辅助（WP8.2 设计 §7.4，D-X-18）。
 *
 * `pythonValidationAvailable()` = `python3 -I -c "import lxml"` 退出码 0 且 `xmllint --version` 可执行。
 * - 可用：每个黄金样例与域夹具跑 `validate.py --profile export`，要求 `valid:true`、`errors:[]`；
 * - 不可用：`describe.skipIf`，并打印“外部校验被跳过”；
 * - 环境变量 `REQUIRE_XML_VALIDATION=1` 时，缺环境改为失败（验收命令固定带这个变量）。
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根目录下的校验脚本（本文件位于 packages/shared/src/renderers/__tests__/）。 */
export const VALIDATE_SCRIPT = fileURLToPath(new URL('../../../../../scripts/xml46687/validate.py', import.meta.url))
export const STS_COMPAT_SCRIPT = fileURLToPath(new URL('../../../../../scripts/xml46687/sts_compat.py', import.meta.url))

let cached

export function pythonValidationAvailable() {
  if (cached !== undefined) return cached
  const python = spawnSync('python3', ['-I', '-c', 'import lxml'], { encoding: 'utf8' })
  const xmllint = spawnSync('xmllint', ['--version'], { encoding: 'utf8' })
  cached = python.status === 0 && xmllint.error === undefined && (xmllint.status === 0 || /libxml/i.test(`${xmllint.stdout}${xmllint.stderr}`))
  return cached
}

/** `REQUIRE_XML_VALIDATION=1`：缺 python3/lxml/xmllint 即失败，而不是跳过。 */
export function validationRequired() {
  return process.env.REQUIRE_XML_VALIDATION === '1'
}

/**
 * 在 `describe` 前调用：缺环境时若要求校验则抛错（让套件失败），否则返回 true 表示应跳过并已打印提示。
 */
export function shouldSkipValidation() {
  if (pythonValidationAvailable()) return false
  if (validationRequired()) {
    throw new Error('REQUIRE_XML_VALIDATION=1，但缺少 python3 + lxml + xmllint，无法做外部校验')
  }
  console.warn('[xml46687] 外部校验被跳过：缺少 python3 + lxml + xmllint（设 REQUIRE_XML_VALIDATION=1 可改为失败）')
  return true
}

/** 把 XML 写入临时文件，跑 `validate.py --json --profile <profile>`，返回第一个结果。 */
export function validateWithPython(xml, profile = 'export') {
  const dir = mkdtempSync(join(tmpdir(), 'xml46687-'))
  try {
    const file = join(dir, 'standard.xml')
    writeFileSync(file, xml, 'utf8')
    return validateFileWithPython(file, profile)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function validateFileWithPython(file, profile = 'export') {
  const result = spawnSync('python3', ['-I', VALIDATE_SCRIPT, '--json', '--profile', profile, file], { encoding: 'utf8' })
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    throw new Error(`validate.py 没有输出 JSON（退出码 ${result.status}）：${result.stdout}\n${result.stderr}`)
  }
  const first = parsed.results[0]
  return { valid: first.valid, errors: first.errors, warnings: first.warnings }
}

/** `sts_compat.py` 的退出码（0 = 零未解释偏差）与输出。 */
export function stsCompatWithPython(xml) {
  const dir = mkdtempSync(join(tmpdir(), 'xml46687-'))
  try {
    const file = join(dir, 'standard.xml')
    writeFileSync(file, xml, 'utf8')
    const result = spawnSync('python3', ['-I', STS_COMPAT_SCRIPT, file], { encoding: 'utf8' })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
