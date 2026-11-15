// Check whether packages/server/dist/main.js matches the current source/config/lockfile/Node inputs,
// and record the input fingerprint after a successful build.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_DIRS = [
  'packages/server/src',
  'packages/shared/src',
  'packages/io/src',
  'packages/client/src',
];

const EXTRA_FILES = [
  'pnpm-lock.yaml',
  'package.json',
  'tsconfig.base.json',
  'packages/server/package.json',
  'packages/server/tsconfig.json',
  'packages/server/tsconfig.build.json',
  'packages/server/nest-cli.json',
  'packages/server/webpack.config.js',
  'packages/server/resources/authoring-reference.md',
  'docs/wp9-authoring-reference.md',
  'packages/shared/package.json',
  'packages/shared/tsconfig.json',
  'packages/io/package.json',
  'packages/io/tsconfig.json',
  'packages/client/package.json',
  'packages/client/tsconfig.json',
];

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist', '__pycache__']);
const SKIP_FILE_SUFFIXES = ['.test.ts', '.spec.ts', '.snap', '.tsbuildinfo'];

function toPosix(rel) {
  return rel.split(path.sep).join('/');
}

function shouldSkipFile(name) {
  return SKIP_FILE_SUFFIXES.some(suffix => name.endsWith(suffix));
}

function collectDirFiles(root, relDir, out) {
  const absDir = path.join(root, ...relDir.split('/'));
  if (!fs.existsSync(absDir)) return;
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      collectDirFiles(root, `${relDir}/${entry.name}`, out);
    } else if (entry.isFile()) {
      if (shouldSkipFile(entry.name)) continue;
      out.push(`${relDir}/${entry.name}`);
    }
  }
}

function computeFingerprint(root, runtime = process) {
  const resolvedRoot = path.resolve(root);
  const files = [];
  for (const dir of SOURCE_DIRS) collectDirFiles(resolvedRoot, dir, files);
  for (const rel of EXTRA_FILES) {
    const abs = path.join(resolvedRoot, ...rel.split('/'));
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) files.push(rel);
  }
  files.sort();
  const seen = new Set();
  const hash = crypto.createHash('sha256');
  hash.update(`node:${runtime.version}\0${runtime.platform}\0${runtime.arch}\n`);
  for (const rel of files) {
    const normalized = toPosix(rel);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const abs = path.join(resolvedRoot, ...normalized.split('/'));
    const data = fs.readFileSync(abs);
    hash.update(normalized);
    hash.update('\0');
    hash.update(String(data.length));
    hash.update('\0');
    hash.update(data);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function statePaths(root) {
  const distDir = path.join(path.resolve(root), 'packages', 'server', 'dist');
  return {
    distDir,
    mainFile: path.join(distDir, 'main.js'),
    stateFile: path.join(distDir, '.ses-build-state.json'),
  };
}

function checkBuildState(root, runtime = process) {
  const { mainFile, stateFile } = statePaths(root);
  if (!fs.existsSync(mainFile)) {
    return { fresh: false, reason: '未找到后端构建产物，需要构建。' };
  }
  if (!fs.existsSync(stateFile)) {
    return { fresh: false, reason: '未找到构建状态记录，需要构建。' };
  }
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return { fresh: false, reason: '构建状态记录已损坏，需要重新构建。' };
  }
  const fingerprint = computeFingerprint(root, runtime);
  if (!saved || saved.fingerprint !== fingerprint || saved.node !== runtime.version) {
    return { fresh: false, reason: '源码、依赖或运行环境已变化，需要重新构建。' };
  }
  return { fresh: true, reason: '' };
}

function recordBuildState(root, runtime = process) {
  const { mainFile, stateFile } = statePaths(root);
  if (!fs.existsSync(mainFile)) {
    throw new Error(`找不到构建产物：${mainFile}`);
  }
  const state = {
    version: 1,
    fingerprint: computeFingerprint(root, runtime),
    node: runtime.version,
    platform: runtime.platform,
    arch: runtime.arch,
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return state;
}

function parseArgs(argv) {
  const cmd = argv[2];
  let root = path.resolve(__dirname, '..');
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) {
      root = path.resolve(argv[++i]);
    } else {
      throw new Error(`未知参数：${argv[i]}`);
    }
  }
  return { cmd, root };
}

if (require.main === module) {
  try {
    const { cmd, root } = parseArgs(process.argv);
    if (cmd === 'check') {
      const result = checkBuildState(root);
      if (!result.fresh) {
        console.log(result.reason);
        process.exitCode = 1;
      }
    } else if (cmd === 'record') {
      recordBuildState(root);
    } else {
      console.error('用法：node scripts/build-state.cjs <check|record> [--root <dir>]');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error && error.message ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { computeFingerprint, checkBuildState, recordBuildState };
