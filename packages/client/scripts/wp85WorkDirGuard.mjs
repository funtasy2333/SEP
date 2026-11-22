import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

export const WORK_DIR_OWNERSHIP_MARKER = '.wp85-e2e-owned'
export const DEFAULT_WORK_DIR_NAME = 'wp85-acceptance'
const MAX_SYMLINK_DEPTH = 40

export function getDefaultWorkDir() {
  return join(tmpdir(), DEFAULT_WORK_DIR_NAME)
}

function isSameOrSubPath(candidate, base) {
  const rel = relative(base, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function isFilesystemRoot(canonicalPath) {
  return parse(canonicalPath).root === canonicalPath || dirname(canonicalPath) === canonicalPath
}

/**
 * 解析目标路径的规范真实路径：
 * - 若路径或其末端段尚未存在，则向上回溯至最近存在节点并对其做 realpathSync；
 * - 若遇到悬空符号链接（dangling symlink），同样展开链接目标并继续解析，防止通过符号链接绕过路径守卫。
 */
export function resolveCanonicalPath(targetPath, depth = 0) {
  if (typeof targetPath !== 'string' || targetPath.trim() === '') {
    throw new Error('工作目录路径不能为空')
  }
  if (depth > MAX_SYMLINK_DEPTH) {
    throw new Error(`工作目录路径存在符号链接循环，已拒绝：${targetPath}`)
  }

  const absolute = resolve(targetPath)
  const missingSegments = []
  let current = absolute

  while (true) {
    let lstat
    try {
      lstat = lstatSync(current)
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        const parent = dirname(current)
        if (parent === current) {
          return absolute
        }
        missingSegments.unshift(basename(current))
        current = parent
        continue
      }
      throw err
    }

    if (lstat.isSymbolicLink()) {
      try {
        const realBase = realpathSync(current)
        return missingSegments.length > 0 ? join(realBase, ...missingSegments) : realBase
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
          const linkTarget = readlinkSync(current)
          const resolvedLinkTarget = resolve(dirname(current), linkTarget)
          const nextPath = missingSegments.length > 0
            ? join(resolvedLinkTarget, ...missingSegments)
            : resolvedLinkTarget
          return resolveCanonicalPath(nextPath, depth + 1)
        }
        throw err
      }
    }

    const realBase = realpathSync(current)
    return missingSegments.length > 0 ? join(realBase, ...missingSegments) : realBase
  }
}

/**
 * 校验工作目录路径安全性（只读校验，绝不创建或删除任何文件）。
 */
export function assertSafeWorkDir(workDir, options = {}) {
  const {
    repoRoot,
    homeDir = homedir(),
    tmpDir = tmpdir(),
  } = options

  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') {
    throw new Error('缺少 repoRoot 参数，无法校验工作目录安全性')
  }

  const canonicalWorkDir = resolveCanonicalPath(workDir)
  const canonicalRepoRoot = resolveCanonicalPath(repoRoot)
  const canonicalHomeDir = resolveCanonicalPath(homeDir)
  const canonicalTmpDir = resolveCanonicalPath(tmpDir)

  if (isFilesystemRoot(canonicalWorkDir)) {
    throw new Error(`拒绝使用文件系统根目录作为工作目录：${workDir}（解析为 ${canonicalWorkDir}）`)
  }
  if (canonicalWorkDir === canonicalHomeDir) {
    throw new Error(`拒绝使用用户主目录作为工作目录：${workDir}（解析为 ${canonicalWorkDir}）`)
  }
  if (canonicalWorkDir === canonicalTmpDir) {
    throw new Error(`拒绝直接使用系统临时目录根作为工作目录：${workDir}（解析为 ${canonicalWorkDir}），请使用其子目录`)
  }
  if (isSameOrSubPath(canonicalWorkDir, canonicalRepoRoot)) {
    throw new Error(`拒绝使用仓库根目录或仓库内部路径作为工作目录：${workDir}（解析为 ${canonicalWorkDir}）`)
  }
  if (isSameOrSubPath(canonicalRepoRoot, canonicalWorkDir)) {
    throw new Error(`拒绝使用仓库祖先目录作为工作目录：${workDir}（解析为 ${canonicalWorkDir}）`)
  }

  return {
    canonicalWorkDir,
    canonicalRepoRoot,
  }
}

/**
 * 在校验通过的父工作目录下创建本次运行专属的隔离临时子目录，并写入归属标记文件。
 * 绝不删除调用方传入的 baseWorkDir 本身或其中任何既有文件。
 */
export function prepareIsolatedWorkDir(baseWorkDir, options = {}) {
  const { prefix = 'e2e-run-' } = options
  const { canonicalWorkDir } = assertSafeWorkDir(baseWorkDir, options)

  try {
    const existingStat = statSync(canonicalWorkDir)
    if (!existingStat.isDirectory()) {
      throw new Error(`工作目录路径指向非目录文件，已拒绝：${canonicalWorkDir}`)
    }
  } catch (err) {
    if (!(err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT')) {
      throw err
    }
  }

  mkdirSync(canonicalWorkDir, { recursive: true })
  const verified = assertSafeWorkDir(canonicalWorkDir, options)

  const runWorkDir = realpathSync(mkdtempSync(join(verified.canonicalWorkDir, prefix)))
  if (runWorkDir === verified.canonicalWorkDir || !isSameOrSubPath(runWorkDir, verified.canonicalWorkDir)) {
    throw new Error(`隔离运行目录未落在预期父目录下，已中止：${runWorkDir}`)
  }

  const markerPath = join(runWorkDir, WORK_DIR_OWNERSHIP_MARKER)
  const markerPayload = {
    owner: 'wp85-xml46687-e2e',
    pid: process.pid,
    createdAt: new Date().toISOString(),
    baseWorkDir: verified.canonicalWorkDir,
  }
  writeFileSync(markerPath, `${JSON.stringify(markerPayload, null, 2)}\n`, 'utf8')

  return {
    baseWorkDir: verified.canonicalWorkDir,
    runWorkDir,
    markerPath,
  }
}

/**
 * 仅在通过路径守卫且存在归属标记文件 .wp85-e2e-owned 时清理本次隔离运行子目录。
 * 绝不删除父工作目录或无归属标记的目录。
 */
export function cleanupIsolatedWorkDir(runWorkDir, options = {}) {
  if (typeof runWorkDir !== 'string' || runWorkDir.trim() === '') {
    throw new Error('待清理的工作目录路径不能为空')
  }

  let dirLstat
  try {
    dirLstat = lstatSync(runWorkDir)
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { removed: false, reason: 'not-found' }
    }
    throw err
  }

  if (dirLstat.isSymbolicLink()) {
    throw new Error(`拒绝清理符号链接目录：${runWorkDir}`)
  }
  if (!dirLstat.isDirectory()) {
    throw new Error(`拒绝清理非目录路径：${runWorkDir}`)
  }

  const { canonicalWorkDir } = assertSafeWorkDir(runWorkDir, options)

  if (options.expectedBaseWorkDir !== undefined) {
    const canonicalExpectedBase = resolveCanonicalPath(options.expectedBaseWorkDir)
    if (canonicalWorkDir === canonicalExpectedBase || !isSameOrSubPath(canonicalWorkDir, canonicalExpectedBase)) {
      throw new Error(`拒绝清理目录：目标（${canonicalWorkDir}）不是预期父目录（${canonicalExpectedBase}）的子目录`)
    }
  }

  const markerPath = join(canonicalWorkDir, WORK_DIR_OWNERSHIP_MARKER)
  let markerLstat
  try {
    markerLstat = lstatSync(markerPath)
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      throw new Error(`拒绝清理目录：缺少归属标记文件 ${WORK_DIR_OWNERSHIP_MARKER}（${canonicalWorkDir}）`)
    }
    throw err
  }

  if (markerLstat.isSymbolicLink() || !markerLstat.isFile()) {
    throw new Error(`拒绝清理目录：归属标记 ${WORK_DIR_OWNERSHIP_MARKER} 不是常规文件（${canonicalWorkDir}）`)
  }

  rmSync(canonicalWorkDir, { recursive: true, force: true })
  return {
    removed: true,
    runWorkDir: canonicalWorkDir,
  }
}
