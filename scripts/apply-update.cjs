#!/usr/bin/env node
// SES 升级执行器的全部文件逻辑（纯 Node 内置模块，Node >= 20，Windows / macOS / Linux 通用）。
// 由 ses-upgrade.sh / ses-upgrade.ps1 在服务停止后调用；也可单独运行，便于测试。
//
// 子命令：
//   list      --staging <dir> --platform macos|windows
//   apply     --root <root> --staging <dir> --plan <plan.json>
//   rollback  --root <root>
//   status    --root <root> --state <s> --step <s> [--message <m>] [--plan <plan.json>]
//   backup-db --root <root>
//   restore-db --root <root>
//   finalize  --root <root> [--plan <plan.json>]
//   plan-get  --plan <plan.json> --key <name>
//
// 跨版本契约：升级时，ses-upgrade.sh / ses-upgrade.ps1 会优先使用“升级包里新版本”的本文件执行
// apply 与（apply 之后的）rollback，其余子命令仍用当前已安装版本的副本，所以新旧两个版本会互相配合。
// 因此上面的子命令名、参数名与含义、plan.json 字段、.ses-update/ 与 .ses-run/upgrade-status.json
// 的文件格式都是契约，后续版本不得破坏兼容（只能新增可选参数/字段）。新版 apply 写出的
// rollback manifest 只会被同一个新版 rollback 读取，格式可以演进。
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// 规则：必须与 scripts/package-release.py 的 runtime_files(platform) 保持一致
// （scripts/test_apply_update.py 会逐项比对）。
// ---------------------------------------------------------------------------
const CONFIG = [
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'tsconfig.base.json',
  'packages/server/nest-cli.json', 'packages/server/webpack.config.js',
  'packages/server/tsconfig.json', 'packages/server/tsconfig.build.json',
  'packages/client/index.html', 'packages/client/vite.config.ts',
  'packages/client/tsconfig.json', 'packages/client/tsconfig.app.json', 'packages/client/tsconfig.node.json',
  'packages/io/tsconfig.json', 'packages/shared/tsconfig.json',
];
const PACKAGES = ['client', 'server', 'shared', 'io'];
const SKIP_SUFFIXES = ['.test.ts', '.spec.ts', '.snap', '.md', '.tsbuildinfo'];
const AUTHORING_SOURCE = 'docs/wp9-authoring-reference.md';
const AUTHORING_TARGET = 'packages/server/resources/authoring-reference.md';
const ENTRIES = {
  windows: ['启动SES.cmd', '退出SES.cmd', 'scripts/ses-windows.ps1', 'scripts/backup-db.cjs', 'scripts/check-sqlite.cjs',
    'scripts/start-service.cjs', 'scripts/apply-update.cjs', 'scripts/ses-upgrade.ps1'],
  macos: ['启动SES.command', '退出SES.command', 'scripts/ses-local.sh', 'scripts/apply-update.cjs', 'scripts/ses-upgrade.sh'],
};
const LAUNCHER_SCRIPT = { windows: 'scripts/ses-windows.ps1', macos: 'scripts/ses-local.sh' };
// 归档里没有这些文件说明压缩包不是 SES，直接拒绝；其余缺失的配置文件仅告警并跳过。
const REQUIRED_ARCHIVE = ['package.json', 'pnpm-lock.yaml', 'packages/server/package.json', 'packages/client/package.json', AUTHORING_SOURCE];

// 整目录替换：旧目录整体移走，避免残留文件被 vue-tsc -b 等编译。
const REPLACE_DIRS = [
  'packages/client/src', 'packages/server/src', 'packages/shared/src', 'packages/io/src',
  'packages/client/public', 'packages/server/resources',
];

// 升级绝不能改动的内容。
const PROTECTED_TOP = new Set(['.ses-update', '.ses-run', '.ses-tools', 'output', '.env', '.git']);
const PROTECTED_PREFIXES = [['packages', 'server', 'data']];
const DB_FILES = ['ses.db', 'ses.db-wal', 'ses.db-shm'];
const DB_DIR = 'packages/server/data';

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------
class UpdateError extends Error {}

function fail(message) {
  throw new UpdateError(message);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item.startsWith('--')) {
      const key = item.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`参数 --${key} 缺少取值`);
      args[key] = value;
      i++;
    } else {
      args._.push(item);
    }
  }
  return args;
}

function need(args, key) {
  if (typeof args[key] !== 'string' || args[key] === '') fail(`缺少参数 --${key}`);
  return args[key];
}

function readJson(file, what) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    fail(`无法读取${what}（${file}）：${error.message}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    // Windows 上目标被占用时回退为直接写入。
    fs.writeFileSync(file, fs.readFileSync(temp));
    fs.rmSync(temp, { force: true });
  }
}

function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(p) {
  try {
    return fs.lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function moveEntry(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const retryable = new Set(['EPERM', 'EBUSY', 'EACCES']);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(source, target);
      return;
    } catch (error) {
      if (error.code === 'EXDEV') {
        fs.cpSync(source, target, { recursive: true, preserveTimestamps: true });
        rmrf(source);
        return;
      }
      if (process.platform === 'win32' && retryable.has(error.code) && attempt < 5) {
        sleep(300);
        continue;
      }
      throw error;
    }
  }
}

function shortCommit(commit) {
  return typeof commit === 'string' && commit ? commit.slice(0, 7) : null;
}

function describeVersion(version, commit) {
  const short = shortCommit(commit);
  if (version && short) return `${version} (${short})`;
  return version || short || 'unknown';
}

// ---------------------------------------------------------------------------
// 路径安全
// ---------------------------------------------------------------------------
function relSegments(rel) {
  if (typeof rel !== 'string' || rel === '') fail('目标路径为空');
  const segments = rel.split(/[\\/]/);
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..' || segment.includes(':') || segment.includes('\0')) {
      fail(`目标路径不合法：${rel}`);
    }
  }
  return segments;
}

function isProtectedSegments(segments) {
  if (segments.includes('node_modules')) return true;
  const first = segments[0];
  if (PROTECTED_TOP.has(first) || first.startsWith('.env.')) return true;
  return PROTECTED_PREFIXES.some(prefix => prefix.every((part, index) => segments[index] === part));
}

function isUnder(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function createGuard(root) {
  const realRoot = fs.realpathSync(root);
  const cache = new Map();
  function checkAncestor(dir) {
    if (cache.has(dir)) return;
    // 找到最近一个已存在的祖先，其真实路径必须仍在根目录内，且不能经符号链接绕进受保护目录。
    let probe = dir;
    while (!exists(probe)) probe = path.dirname(probe);
    const real = fs.realpathSync(probe);
    if (real !== realRoot) {
      if (!isUnder(realRoot, real)) fail(`目标目录经符号链接指向安装目录之外：${dir}`);
      const segments = path.relative(realRoot, real).split(path.sep);
      if (isProtectedSegments(segments)) fail(`目标目录经符号链接指向受保护目录：${dir}`);
    }
    cache.set(dir, true);
  }
  return function check(rel) {
    const segments = relSegments(rel);
    if (isProtectedSegments(segments)) fail(`拒绝改动受保护路径：${rel}`);
    const target = path.resolve(root, ...segments);
    if (!isUnder(root, target)) fail(`目标路径超出安装目录：${rel}`);
    checkAncestor(path.dirname(target));
    try {
      if (fs.lstatSync(target).isSymbolicLink()) fail(`拒绝改写符号链接：${rel}`);
    } catch (error) {
      if (error instanceof UpdateError) throw error;
    }
    return target;
  };
}

// ---------------------------------------------------------------------------
// staging 识别与文件清单
// ---------------------------------------------------------------------------
function locateTop(staging) {
  if (!isDirectory(staging)) fail(`staging 目录不存在：${staging}`);
  const entries = fs.readdirSync(staging).filter(name => name !== '__MACOSX' && name !== '.DS_Store');
  if (entries.length !== 1 || !isDirectory(path.join(staging, entries[0]))) {
    fail(`压缩包内应只有一个顶层目录，实际为：${entries.join(', ') || '（空）'}`);
  }
  return path.join(staging, entries[0]);
}

function walkFiles(dir, visit, relPrefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      visit(rel, full, 'symlink');
    } else if (entry.isDirectory()) {
      walkFiles(full, visit, rel);
    } else if (entry.isFile()) {
      visit(rel, full, 'file');
    }
  }
}

function archiveFiles(top, platform) {
  const files = new Map();
  const add = (rel, from) => files.set(rel, { from });
  const warn = rel => process.stderr.write(`警告：归档中缺少 ${rel}，已跳过。\n`);
  for (const name of REQUIRED_ARCHIVE) {
    if (!fs.existsSync(path.join(top, ...name.split('/')))) fail(`不是有效的 SES 源码归档：缺少 ${name}`);
  }
  const optional = [...CONFIG];
  for (const pkg of PACKAGES) optional.push(`packages/${pkg}/package.json`);
  optional.push(...ENTRIES[platform]);
  for (const rel of optional) {
    const from = path.join(top, ...rel.split('/'));
    if (fs.existsSync(from)) add(rel, from);
    else warn(rel);
  }
  for (const pkg of PACKAGES) {
    const base = path.join(top, 'packages', pkg, 'src');
    if (!isDirectory(base)) continue;
    walkFiles(base, (relInSrc, full, kind) => {
      if (kind !== 'file') return;
      const rel = `packages/${pkg}/src/${relInSrc}`;
      const parts = rel.split('/');
      if (parts.some(part => part.startsWith('__')) || SKIP_SUFFIXES.some(suffix => parts[parts.length - 1].endsWith(suffix))) return;
      add(rel, full);
    });
  }
  const publicDir = path.join(top, 'packages', 'client', 'public');
  if (isDirectory(publicDir)) {
    walkFiles(publicDir, (relInPublic, full, kind) => {
      if (kind === 'file') add(`packages/client/public/${relInPublic}`, full);
    });
  }
  add(AUTHORING_TARGET, path.join(top, ...AUTHORING_SOURCE.split('/')));
  return files;
}

function releaseFiles(top, platform) {
  const files = new Map();
  walkFiles(top, (rel, full, kind) => {
    if (kind === 'symlink') fail(`发布包内含符号链接，已拒绝：${rel}`);
    files.set(rel, { from: full });
  });
  if (!files.has(LAUNCHER_SCRIPT[platform])) {
    fail(`发布包与当前平台（${platform}）不匹配：缺少 ${LAUNCHER_SCRIPT[platform]}`);
  }
  return files;
}

function resolveStaging(staging, platform, plan) {
  if (!ENTRIES[platform]) fail(`未知平台：${platform}`);
  const top = locateTop(staging);
  const buildFile = path.join(top, 'ses-build.json');
  let kind;
  let files;
  let buildInfo;
  if (fs.existsSync(buildFile)) {
    kind = 'release';
    const info = readJson(buildFile, '安装包中的 ses-build.json');
    if (!info || typeof info.version !== 'string' || !info.version) fail('安装包中的 ses-build.json 缺少 version');
    files = releaseFiles(top, platform);
    buildInfo = null; // 原样安装
  } else if (isDirectory(path.join(top, 'packages')) && fs.existsSync(path.join(top, ...AUTHORING_SOURCE.split('/')))) {
    kind = 'archive';
    files = archiveFiles(top, platform);
    const manifest = readJson(path.join(top, 'package.json'), '归档中的 package.json');
    if (typeof manifest.version !== 'string' || !manifest.version) fail('归档根 package.json 缺少 version');
    buildInfo = {
      version: manifest.version,
      channel: 'commit',
      commit: (plan && plan.targetCommit) || null,
      builtAt: new Date().toISOString(),
    };
    files.set('ses-build.json', { data: Buffer.from(`${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8') });
  } else {
    fail('无法识别压缩包类型：既不是 SES 发布包（缺少 ses-build.json），也不是源码归档');
  }
  return { kind, top, files, buildInfo };
}

// ---------------------------------------------------------------------------
// 子命令
// ---------------------------------------------------------------------------
function cmdList(args) {
  const platform = need(args, 'platform');
  const { files } = resolveStaging(need(args, 'staging'), platform, null);
  process.stdout.write(`${JSON.stringify([...files.keys()].sort())}\n`);
}

function readPlan(file) {
  const plan = readJson(file, '升级计划');
  if (!plan || typeof plan !== 'object') fail('升级计划格式错误');
  if (plan.platform !== 'macos' && plan.platform !== 'windows') fail(`升级计划中的 platform 不合法：${plan.platform}`);
  return plan;
}

function updDir(root) {
  return path.join(root, '.ses-update');
}

function cmdApply(args) {
  const root = fs.realpathSync(path.resolve(need(args, 'root')));
  const plan = readPlan(need(args, 'plan'));
  const { files, kind, buildInfo } = resolveStaging(path.resolve(need(args, 'staging')), plan.platform, plan);
  const check = createGuard(root);

  const replaced = REPLACE_DIRS.filter(dir => [...files.keys()].some(rel => rel.startsWith(`${dir}/`)));
  const inReplaced = rel => replaced.some(dir => rel.startsWith(`${dir}/`));

  // 先校验全部目标，任何一条不合法都在写入前整体拒绝。
  const targets = new Map();
  for (const rel of files.keys()) targets.set(rel, check(rel));
  for (const dir of replaced) targets.set(dir, check(dir));

  const rollbackDir = path.join(updDir(root), 'rollback');
  const backupFiles = path.join(rollbackDir, 'files');
  rmrf(rollbackDir);
  fs.mkdirSync(backupFiles, { recursive: true });

  // 规划 rollback manifest：先记录原先是否存在，再动手。
  const entries = [];
  const mkdirs = new Set();
  const noteParents = (rel, includeSelf) => {
    const segments = rel.split('/');
    for (let length = 1; length < segments.length + (includeSelf ? 1 : 0); length++) {
      const dirRel = segments.slice(0, length).join('/');
      if (!exists(path.join(root, ...segments.slice(0, length)))) mkdirs.add(dirRel);
    }
  };
  for (const dir of replaced) noteParents(dir, false);
  const standalone = [...files.keys()].filter(rel => !inReplaced(rel)).sort();
  for (const rel of standalone) noteParents(rel, false);
  for (const dir of [...mkdirs].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))) {
    entries.push({ path: dir, kind: 'mkdir', existed: false });
  }
  for (const dir of replaced) entries.push({ path: dir, kind: 'dir', existed: exists(targets.get(dir)) });
  for (const rel of standalone) {
    const target = targets.get(rel);
    if (isDirectory(target)) fail(`目标路径是目录，无法作为文件替换：${rel}`);
    entries.push({ path: rel, kind: 'file', existed: exists(target) });
  }
  const manifestFile = path.join(rollbackDir, 'manifest.json');
  const manifest = { version: 1, createdAt: new Date().toISOString(), kind, applied: false, entries };
  writeJson(manifestFile, manifest);

  // 1) 整目录替换：旧目录整体移入 rollback。
  for (const dir of replaced) {
    const target = targets.get(dir);
    if (exists(target)) {
      if (!isDirectory(target)) fail(`目标路径不是目录：${dir}`);
      moveEntry(target, path.join(backupFiles, ...dir.split('/')));
    }
  }
  // 2) 写入新文件；被覆盖的旧文件先备份。
  let written = 0;
  for (const [rel, source] of [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const target = targets.get(rel);
    if (!inReplaced(rel) && exists(target)) {
      const backup = path.join(backupFiles, ...rel.split('/'));
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(target, backup);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (source.data) fs.writeFileSync(target, source.data);
    else fs.copyFileSync(source.from, target);
    if (process.platform !== 'win32' && (rel.endsWith('.sh') || rel.endsWith('.command'))) fs.chmodSync(target, 0o755);
    written++;
    // 仅供测试：模拟写到一半失败，用来验证 rollback。
    if (process.env.SES_APPLY_TEST_FAIL_AFTER && written >= Number(process.env.SES_APPLY_TEST_FAIL_AFTER)) fail('测试注入的失败');
  }
  manifest.applied = true;
  writeJson(manifestFile, manifest);
  process.stdout.write(`已替换 ${written} 个文件（整目录替换：${replaced.join(', ') || '无'}），类型：${kind === 'release' ? '发布包' : '源码归档'}${buildInfo ? `，版本 ${buildInfo.version}` : ''}。\n`);
}

function cmdRollback(args) {
  const root = fs.realpathSync(path.resolve(need(args, 'root')));
  const rollbackDir = path.join(updDir(root), 'rollback');
  const manifestFile = path.join(rollbackDir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) {
    process.stdout.write('没有可回滚的记录（升级尚未改动任何文件）。\n');
    return;
  }
  const manifest = readJson(manifestFile, '回滚清单');
  if (!Array.isArray(manifest.entries)) fail('回滚清单格式错误');
  const check = createGuard(root);
  const backupFiles = path.join(rollbackDir, 'files');
  let restored = 0;
  for (const entry of [...manifest.entries].reverse()) {
    const target = check(entry.path);
    const backup = path.join(backupFiles, ...entry.path.split('/'));
    if (entry.kind === 'mkdir') {
      try { fs.rmdirSync(target); } catch { /* 非空或不存在则保留 */ }
    } else if (entry.kind === 'dir') {
      if (exists(backup)) {
        rmrf(target);
        moveEntry(backup, target);
        restored++;
      } else if (!entry.existed) {
        rmrf(target);
      }
    } else if (entry.kind === 'file') {
      if (exists(backup)) {
        rmrf(target);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(backup, target);
        restored++;
      } else if (!entry.existed) {
        rmrf(target);
      }
    } else {
      fail(`回滚清单含未知类型：${entry.kind}`);
    }
  }
  process.stdout.write(`已回滚，恢复 ${restored} 项。\n`);
}

const STATES = ['running', 'succeeded', 'rolled-back', 'failed'];
const STEPS = ['stopping', 'backing-up', 'extracting', 'applying', 'starting', 'rolling-back', 'done'];

function cmdStatus(args) {
  const root = path.resolve(need(args, 'root'));
  const state = need(args, 'state');
  const step = need(args, 'step');
  if (!STATES.includes(state)) fail(`state 不合法：${state}`);
  if (!STEPS.includes(step)) fail(`step 不合法：${step}`);
  const file = path.join(root, '.ses-run', 'upgrade-status.json');
  let from = null;
  let to = null;
  if (args.plan && fs.existsSync(args.plan)) {
    const plan = readJson(args.plan, '升级计划');
    from = describeVersion(plan.fromVersion, plan.fromCommit);
    to = describeVersion(plan.targetVersion, plan.targetCommit);
  } else if (fs.existsSync(file)) {
    try {
      const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
      from = previous.from ?? null;
      to = previous.to ?? null;
    } catch { /* 旧文件损坏则忽略 */ }
  }
  writeJson(file, {
    state, step, from, to,
    message: typeof args.message === 'string' && args.message !== '' ? args.message : null,
    log: '.ses-run/upgrade.log',
    updatedAt: new Date().toISOString(),
  });
}

function dbPaths(root) {
  const dir = path.join(root, ...DB_DIR.split('/'));
  return { dir, files: DB_FILES.map(name => ({ name, file: path.join(dir, name) })) };
}

function cmdBackupDb(args) {
  const root = path.resolve(need(args, 'root'));
  const backup = path.join(updDir(root), 'db-backup');
  rmrf(backup);
  fs.mkdirSync(backup, { recursive: true });
  const record = { version: 1, createdAt: new Date().toISOString(), existed: {} };
  for (const { name, file } of dbPaths(root).files) {
    record.existed[name] = fs.existsSync(file);
    if (record.existed[name]) fs.copyFileSync(file, path.join(backup, name));
  }
  writeJson(path.join(backup, 'manifest.json'), record);
  const kept = Object.keys(record.existed).filter(name => record.existed[name]);
  process.stdout.write(kept.length ? `数据库已备份：${kept.join(', ')}\n` : '没有现有数据库，无需备份。\n');
}

function cmdRestoreDb(args) {
  const root = path.resolve(need(args, 'root'));
  const backup = path.join(updDir(root), 'db-backup');
  const manifestFile = path.join(backup, 'manifest.json');
  if (!fs.existsSync(manifestFile)) fail('没有数据库备份可恢复');
  const record = readJson(manifestFile, '数据库备份清单');
  const { dir, files } = dbPaths(root);
  fs.mkdirSync(dir, { recursive: true });
  for (const { name, file } of files) {
    if (record.existed && record.existed[name]) {
      fs.copyFileSync(path.join(backup, name), file);
    } else {
      // 原本不存在的文件（含新版本启动后产生的 -wal/-shm）必须一并清除，否则会与恢复后的数据库不一致。
      fs.rmSync(file, { force: true });
    }
  }
  process.stdout.write('数据库已恢复到升级前状态。\n');
}

function cmdFinalize(args) {
  const root = path.resolve(need(args, 'root'));
  const upd = updDir(root);
  const backup = path.join(upd, 'db-backup');
  let kept = null;
  if (fs.existsSync(path.join(backup, 'manifest.json'))) {
    const record = readJson(path.join(backup, 'manifest.json'), '数据库备份清单');
    if (record.existed && DB_FILES.some(name => record.existed[name])) {
      const base = path.join(root, 'output', 'upgrade-backups');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      let target = path.join(base, `ses-before-upgrade-${stamp}`);
      for (let n = 1; exists(target); n++) target = path.join(base, `ses-before-upgrade-${stamp}-${n}`);
      moveEntry(backup, target);
      kept = target;
    }
  }
  rmrf(backup);
  rmrf(path.join(upd, 'staging'));
  rmrf(path.join(upd, 'rollback'));
  fs.rmSync(path.join(upd, 'download.zip'), { force: true });
  if (args.plan && fs.existsSync(args.plan)) {
    try {
      const zip = path.resolve(readJson(args.plan, '升级计划').zip || '');
      if (zip && isUnder(upd, zip)) fs.rmSync(zip, { force: true });
    } catch { /* 清理是尽力而为 */ }
  }
  process.stdout.write(kept ? `升级前数据库备份：${kept}\n` : '升级收尾完成。\n');
}

function cmdPlanGet(args) {
  const plan = readJson(need(args, 'plan'), '升级计划');
  const value = plan[need(args, 'key')];
  process.stdout.write(value === undefined || value === null ? '' : `${value}\n`);
}

const COMMANDS = {
  list: cmdList, apply: cmdApply, rollback: cmdRollback, status: cmdStatus,
  'backup-db': cmdBackupDb, 'restore-db': cmdRestoreDb, finalize: cmdFinalize, 'plan-get': cmdPlanGet,
};

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(3));
    const command = COMMANDS[process.argv[2]];
    if (!command) fail(`未知子命令：${process.argv[2] || '（无）'}；可用：${Object.keys(COMMANDS).join(', ')}`);
    command(args);
  } catch (error) {
    process.stderr.write(`apply-update: ${error instanceof UpdateError ? error.message : error.stack || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = { isProtectedSegments, resolveStaging };
