// @ts-nocheck — 测试辅助：使用 Node 内建模块（child_process/fs/os/path/url）；io 的 tsconfig 不含 @types/node。
/**
 * 外部校验辅助（WP8.2 设计 §7.4，D-X-18）。与 `shared/src/renderers/__tests__/xml46687PythonValidation.ts` 同口径、各放一份
 * （shared 的测试不可引用 io，反之亦然）：缺 python3 + lxml + xmllint 时跳过并打印提示；`REQUIRE_XML_VALIDATION=1` 时改为失败。
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = fileURLToPath(new URL('../../../scripts/xml46687/', import.meta.url))

function available() {
  const python = spawnSync('python3', ['-I', '-c', 'import lxml'], { encoding: 'utf8' })
  const xmllint = spawnSync('xmllint', ['--version'], { encoding: 'utf8' })
  return python.status === 0 && xmllint.error === undefined && (xmllint.status === 0 || /libxml/i.test(`${xmllint.stdout}${xmllint.stderr}`))
}

/** 在 `describe` 前调用：返回 true 表示应跳过（已打印提示）；`REQUIRE_XML_VALIDATION=1` 且缺环境时抛错让套件失败。 */
export function shouldSkipValidation() {
  if (available()) return false
  if (process.env.REQUIRE_XML_VALIDATION === '1') throw new Error('REQUIRE_XML_VALIDATION=1，但缺少 python3 + lxml + xmllint，无法做外部校验')
  console.warn('[xml46687] 外部校验被跳过：缺少 python3 + lxml + xmllint（设 REQUIRE_XML_VALIDATION=1 可改为失败）')
  return true
}

function withTempFile(xml, run) {
  const dir = mkdtempSync(join(tmpdir(), 'xml46687-io-'))
  try {
    const file = join(dir, 'standard.xml')
    writeFileSync(file, xml, 'utf8')
    return run(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** `validate.py --json --profile <profile>`：返回 `{ valid, errors, warnings }`。 */
export function validateWithPython(xml, profile = 'export') {
  return withTempFile(xml, file => {
    const result = spawnSync('python3', ['-I', join(SCRIPT_DIR, 'validate.py'), '--json', '--profile', profile, file], { encoding: 'utf8' })
    let parsed
    try { parsed = JSON.parse(result.stdout) } catch { throw new Error(`validate.py 没有输出 JSON（退出码 ${result.status}）：${result.stdout}\n${result.stderr}`) }
    const { valid, errors, warnings } = parsed.results[0]
    return { valid, errors, warnings }
  })
}

/** `sts_compat.py`：退出码 0 = 零未解释偏差。 */
export function stsCompatWithPython(xml) {
  return withTempFile(xml, file => {
    const result = spawnSync('python3', ['-I', join(SCRIPT_DIR, 'sts_compat.py'), file], { encoding: 'utf8' })
    return { status: result.status, stdout: result.stdout }
  })
}
