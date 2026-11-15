// Run before starting the backend:
// 1. Create a consistent SQLite online backup if packages/server/data/ses.db changed since the last backup.
// 2. Prune old startup backups (output/startup-backups) and upgrade backups (output/upgrade-backups).
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const DEFAULT_STARTUP_KEEP = 10;
const DEFAULT_UPGRADE_KEEP = 5;
const STARTUP_BACKUP_PATTERN = /^ses-before-start-.*\.db$/;
const UPGRADE_BACKUP_PATTERN = /^ses-before-upgrade-/;

function parseKeepCount(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  if (/^[1-9]\d*$/.test(trimmed)) return Number(trimmed);
  return fallback;
}

function statSignature(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const st = fs.statSync(filePath);
  if (!st.isFile()) return null;
  return { size: st.size, mtimeMs: st.mtimeMs };
}

function sameSignature(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.size === b.size && a.mtimeMs === b.mtimeMs;
}

function readStamp(stampFile) {
  if (!fs.existsSync(stampFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(stampFile, 'utf8'));
  } catch {
    return null;
  }
}

function shouldBackup(source, walPath, backupDir, stampFile) {
  if (!fs.existsSync(source)) return { needed: false, reason: 'missing' };
  const saved = readStamp(stampFile);
  if (!saved || typeof saved.file !== 'string' || !saved.file) {
    return { needed: true, reason: 'no-stamp' };
  }
  const previousFile = path.join(backupDir, path.basename(saved.file));
  if (!fs.existsSync(previousFile)) {
    return { needed: true, reason: 'backup-missing' };
  }
  const dbSig = statSignature(source);
  const walSig = statSignature(walPath);
  if (sameSignature(saved.db, dbSig) && sameSignature(saved.wal, walSig)) {
    return { needed: false, reason: 'unchanged' };
  }
  return { needed: true, reason: 'changed' };
}

function pruneStartupBackups(backupDir, keep) {
  if (!fs.existsSync(backupDir)) return 0;
  const files = fs.readdirSync(backupDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && STARTUP_BACKUP_PATTERN.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  let removed = 0;
  for (const name of files.slice(keep)) {
    try {
      fs.rmSync(path.join(backupDir, name), { force: true });
      removed++;
    } catch (error) {
      console.warn(`清理旧启动备份失败（${name}）：${error && error.message ? error.message : error}`);
    }
  }
  return removed;
}

function pruneUpgradeBackups(upgradeDir, keep) {
  if (!fs.existsSync(upgradeDir)) return 0;
  const dirs = fs.readdirSync(upgradeDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && UPGRADE_BACKUP_PATTERN.test(entry.name))
    .filter(entry => fs.existsSync(path.join(upgradeDir, entry.name, 'manifest.json')))
    .map(entry => entry.name)
    .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  let removed = 0;
  for (const name of dirs.slice(keep)) {
    try {
      fs.rmSync(path.join(upgradeDir, name), { recursive: true, force: true });
      removed++;
    } catch (error) {
      console.warn(`清理旧升级备份失败（${name}）：${error && error.message ? error.message : error}`);
    }
  }
  return removed;
}

async function runBackupAndPrune(options = {}) {
  const root = path.resolve(options.root || path.resolve(__dirname, '..'));
  const env = options.env || process.env;
  const startupKeep = parseKeepCount(env.SES_STARTUP_BACKUP_KEEP, DEFAULT_STARTUP_KEEP);
  const upgradeKeep = parseKeepCount(env.SES_UPGRADE_BACKUP_KEEP, DEFAULT_UPGRADE_KEEP);

  const source = path.join(root, 'packages/server/data/ses.db');
  const walPath = `${source}-wal`;
  const startupDir = path.join(root, 'output/startup-backups');
  const upgradeDir = path.join(root, 'output/upgrade-backups');
  const stampFile = path.join(startupDir, '.last-backup.json');

  let backedUp = null;
  let skipped = false;
  const decision = shouldBackup(source, walPath, startupDir, stampFile);
  if (decision.needed) {
    const Database = createRequire(path.join(root, 'packages/server/package.json'))('better-sqlite3');
    fs.mkdirSync(startupDir, { recursive: true });
    const fileName = `ses-before-start-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    const target = path.join(startupDir, fileName);
    const db = new Database(source, { readonly: true });
    try {
      await db.backup(target);
    } finally {
      db.close();
    }
    const stamp = {
      version: 1,
      file: fileName,
      db: statSignature(source),
      wal: statSignature(walPath),
      backedUpAt: new Date().toISOString(),
    };
    fs.writeFileSync(stampFile, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
    backedUp = target;
    console.log(`数据库已备份：${target}`);
  } else if (decision.reason === 'unchanged') {
    skipped = true;
    console.log('数据库自上次备份后未变化，跳过备份。');
  }

  const removedStartup = pruneStartupBackups(startupDir, startupKeep);
  if (removedStartup > 0) {
    console.log(`已清理 ${removedStartup} 份旧启动备份（保留最近 ${startupKeep} 份）。`);
  }
  const removedUpgrade = pruneUpgradeBackups(upgradeDir, upgradeKeep);
  if (removedUpgrade > 0) {
    console.log(`已清理 ${removedUpgrade} 份旧升级备份（保留最近 ${upgradeKeep} 份）。`);
  }

  return { backedUp, skipped, removedStartup, removedUpgrade };
}

function parseArgs(argv) {
  let root = path.resolve(__dirname, '..');
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) {
      root = path.resolve(argv[++i]);
    } else {
      throw new Error(`未知参数：${argv[i]}`);
    }
  }
  return { root };
}

if (require.main === module) {
  Promise.resolve()
    .then(() => parseArgs(process.argv))
    .then(({ root }) => runBackupAndPrune({ root }))
    .catch(error => {
      console.error(error && error.message ? error.message : String(error));
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_STARTUP_KEEP,
  DEFAULT_UPGRADE_KEEP,
  parseKeepCount,
  shouldBackup,
  pruneStartupBackups,
  pruneUpgradeBackups,
  runBackupAndPrune,
};
