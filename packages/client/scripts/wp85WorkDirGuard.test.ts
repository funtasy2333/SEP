import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  WORK_DIR_OWNERSHIP_MARKER,
  assertSafeWorkDir,
  cleanupIsolatedWorkDir,
  getDefaultWorkDir,
  prepareIsolatedWorkDir,
} from './wp85WorkDirGuard.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ACTUAL_REPO_ROOT = resolve(__dirname, '../../..')

describe('wp85WorkDirGuard', () => {
  let sandboxRoot: string
  let fakeHomeDir: string
  let fakeRepoAncestor: string
  let fakeRepoRoot: string
  let fakeServerDir: string
  let fakeServerDataDir: string
  let fakeDbFile: string

  beforeEach(() => {
    sandboxRoot = mkdtempSync(join(tmpdir(), 'wp85-guard-test-'))
    fakeHomeDir = join(sandboxRoot, 'home-user')
    fakeRepoAncestor = join(fakeHomeDir, 'workspace')
    fakeRepoRoot = join(fakeRepoAncestor, 'SEP')
    fakeServerDir = join(fakeRepoRoot, 'packages/server')
    fakeServerDataDir = join(fakeServerDir, 'data')
    fakeDbFile = join(fakeServerDataDir, 'ses.db')

    mkdirSync(fakeServerDataDir, { recursive: true })
    writeFileSync(fakeDbFile, 'sentinel-business-db', 'utf8')
    writeFileSync(join(fakeRepoRoot, 'README.md'), 'sentinel-repo-root', 'utf8')
    writeFileSync(join(fakeRepoAncestor, 'ancestor-sentinel.txt'), 'sentinel-ancestor', 'utf8')
  })

  afterEach(() => {
    rmSync(sandboxRoot, { recursive: true, force: true })
  })

  it('默认工作目录位于 os.tmpdir()/wp85-acceptance 且可通过真实仓库路径守卫', () => {
    const defaultDir = getDefaultWorkDir()
    expect(defaultDir).toBe(join(tmpdir(), 'wp85-acceptance'))
    expect(() => assertSafeWorkDir(defaultDir, { repoRoot: ACTUAL_REPO_ROOT })).not.toThrow()
  })

  it('拒绝仓库根、packages/server、packages/server/data 与仓库祖先目录且原文件毫发无损', () => {
    const guardOpts = { repoRoot: fakeRepoRoot, homeDir: fakeHomeDir }
    const forbiddenRepoPaths = [
      fakeRepoRoot,
      fakeServerDir,
      fakeServerDataDir,
      join(fakeServerDataDir, 'nested-nonexistent'),
      fakeRepoAncestor,
    ]

    for (const target of forbiddenRepoPaths) {
      expect(() => prepareIsolatedWorkDir(target, guardOpts)).toThrow(/仓库/)
    }

    // 同时验证针对真实 REPO_ROOT 的只读拒绝（绝不触碰真实目录）
    expect(() => prepareIsolatedWorkDir(ACTUAL_REPO_ROOT, { repoRoot: ACTUAL_REPO_ROOT })).toThrow(/仓库/)
    expect(() => prepareIsolatedWorkDir(join(ACTUAL_REPO_ROOT, 'packages/server'), { repoRoot: ACTUAL_REPO_ROOT })).toThrow(/仓库/)
    expect(() => prepareIsolatedWorkDir(join(ACTUAL_REPO_ROOT, 'packages/server/data'), { repoRoot: ACTUAL_REPO_ROOT })).toThrow(/仓库/)
    expect(() => prepareIsolatedWorkDir(dirname(ACTUAL_REPO_ROOT), { repoRoot: ACTUAL_REPO_ROOT })).toThrow(/祖先/)

    // 所有哨兵文件毫发无损
    expect(readFileSync(fakeDbFile, 'utf8')).toBe('sentinel-business-db')
    expect(readFileSync(join(fakeRepoRoot, 'README.md'), 'utf8')).toBe('sentinel-repo-root')
    expect(readFileSync(join(fakeRepoAncestor, 'ancestor-sentinel.txt'), 'utf8')).toBe('sentinel-ancestor')
  })

  it('拒绝文件系统根目录、用户主目录与系统临时目录根', () => {
    const fsRoot = parse(fakeRepoRoot).root
    const guardOpts = { repoRoot: fakeRepoRoot, homeDir: fakeHomeDir }

    expect(() => prepareIsolatedWorkDir(fsRoot, guardOpts)).toThrow(/文件系统根目录/)
    expect(() => prepareIsolatedWorkDir(fakeHomeDir, guardOpts)).toThrow(/用户主目录/)
    expect(() => prepareIsolatedWorkDir(homedir(), { repoRoot: ACTUAL_REPO_ROOT })).toThrow(/用户主目录/)
    expect(() => prepareIsolatedWorkDir(tmpdir(), guardOpts)).toThrow(/系统临时目录根/)

    expect(readFileSync(fakeDbFile, 'utf8')).toBe('sentinel-business-db')
  })

  it('拒绝通过符号链接（含悬空符号链接）绕过指向仓库内部的路径', () => {
    const guardOpts = { repoRoot: fakeRepoRoot, homeDir: fakeHomeDir }

    const symlinkToServer = join(sandboxRoot, 'safe-looking-link')
    symlinkSync(fakeServerDir, symlinkToServer)

    const danglingLinkToRepoSubdir = join(sandboxRoot, 'dangling-link-into-repo')
    symlinkSync(join(fakeServerDataDir, 'future-subdir'), danglingLinkToRepoSubdir)

    expect(() => prepareIsolatedWorkDir(symlinkToServer, guardOpts)).toThrow(/仓库/)
    expect(() => prepareIsolatedWorkDir(join(symlinkToServer, 'data'), guardOpts)).toThrow(/仓库/)
    expect(() => prepareIsolatedWorkDir(danglingLinkToRepoSubdir, guardOpts)).toThrow(/仓库/)
    expect(() => prepareIsolatedWorkDir(join(danglingLinkToRepoSubdir, 'nested'), guardOpts)).toThrow(/仓库/)

    expect(readFileSync(fakeDbFile, 'utf8')).toBe('sentinel-business-db')
  })

  it('在合法临时目录下创建独立 e2e-run-* 子目录并写入归属标记，清理后仅删除子目录且保留 sentinel.txt 与父目录', () => {
    const guardOpts = { repoRoot: fakeRepoRoot, homeDir: fakeHomeDir }
    const baseWorkDir = join(sandboxRoot, 'custom-work-parent')
    mkdirSync(baseWorkDir, { recursive: true })
    const sentinelPath = join(baseWorkDir, 'sentinel.txt')
    writeFileSync(sentinelPath, 'keep-me-intact', 'utf8')

    const prepared = prepareIsolatedWorkDir(baseWorkDir, guardOpts)

    expect(basename(prepared.runWorkDir).startsWith('e2e-run-')).toBe(true)
    expect(dirname(prepared.runWorkDir)).toBe(prepared.baseWorkDir)
    expect(existsSync(prepared.markerPath)).toBe(true)
    expect(basename(prepared.markerPath)).toBe(WORK_DIR_OWNERSHIP_MARKER)

    const markerJson = JSON.parse(readFileSync(prepared.markerPath, 'utf8'))
    expect(markerJson.owner).toBe('wp85-xml46687-e2e')

    // 模拟在隔离目录内生成运行时文件
    const runtimeSubDir = join(prepared.runWorkDir, 'server/data')
    mkdirSync(runtimeSubDir, { recursive: true })
    writeFileSync(join(runtimeSubDir, 'ses.db'), 'ephemeral-test-db', 'utf8')
    expect(readFileSync(sentinelPath, 'utf8')).toBe('keep-me-intact')

    const result = cleanupIsolatedWorkDir(prepared.runWorkDir, {
      ...guardOpts,
      expectedBaseWorkDir: prepared.baseWorkDir,
    })

    expect(result.removed).toBe(true)
    expect(existsSync(prepared.runWorkDir)).toBe(false)
    expect(existsSync(prepared.baseWorkDir)).toBe(true)
    expect(readFileSync(sentinelPath, 'utf8')).toBe('keep-me-intact')
  })

  it('拒绝清理无 .wp85-e2e-owned 归属标记的目录、父目录本身或仓库内伪造标记目录', () => {
    const guardOpts = { repoRoot: fakeRepoRoot, homeDir: fakeHomeDir }

    // 1. 合法临时目录但缺少归属标记
    const unmarkedDir = join(sandboxRoot, 'unmarked-dir')
    mkdirSync(unmarkedDir, { recursive: true })
    const unmarkedFile = join(unmarkedDir, 'important.txt')
    writeFileSync(unmarkedFile, 'do-not-delete', 'utf8')

    expect(() => cleanupIsolatedWorkDir(unmarkedDir, guardOpts)).toThrow(/缺少归属标记文件/)
    expect(existsSync(unmarkedFile)).toBe(true)

    // 2. 即使写入标记文件，也不允许清理 expectedBaseWorkDir 本身
    const parentWithMarker = join(sandboxRoot, 'parent-with-marker')
    mkdirSync(parentWithMarker, { recursive: true })
    writeFileSync(join(parentWithMarker, WORK_DIR_OWNERSHIP_MARKER), '{}', 'utf8')
    expect(() =>
      cleanupIsolatedWorkDir(parentWithMarker, {
        ...guardOpts,
        expectedBaseWorkDir: parentWithMarker,
      }),
    ).toThrow(/不是预期父目录/)
    expect(existsSync(parentWithMarker)).toBe(true)

    // 3. 即使仓库内子目录被人为放置了标记文件，路径守卫依然拒绝清理
    const fakeRepoMarked = join(fakeServerDir, 'marked-inside-repo')
    mkdirSync(fakeRepoMarked, { recursive: true })
    writeFileSync(join(fakeRepoMarked, WORK_DIR_OWNERSHIP_MARKER), '{}', 'utf8')
    expect(() => cleanupIsolatedWorkDir(fakeRepoMarked, guardOpts)).toThrow(/仓库/)
    expect(existsSync(fakeRepoMarked)).toBe(true)
  })
})
