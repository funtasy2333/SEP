// Run from the SES root before starting the backend (SQLite online backup API).
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'packages/server/data/ses.db');
if (fs.existsSync(source)) {
  const Database = createRequire(path.join(root, 'packages/server/package.json'))('better-sqlite3');
  const dir = path.join(root, 'output/startup-backups');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `ses-before-start-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  const db = new Database(source, { readonly: true });
  db.backup(target).then(() => {
    db.close(); console.log(`Database backup: ${target}`);
  }).catch(error => { db.close(); console.error(error); process.exitCode = 1; });
}
