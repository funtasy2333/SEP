// Opening a database loads the native binding; require() alone does not validate its ABI.
const path = require('node:path');
const { createRequire } = require('node:module');
const Database = createRequire(path.resolve(__dirname, '../packages/server/package.json'))('better-sqlite3');
const db = new Database(':memory:');
db.prepare('SELECT 1').get();
db.close();
