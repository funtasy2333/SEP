// PowerShell 5.1 Start-Process resolves working/log paths as wildcard patterns.
// Node's literal filesystem paths also work in directories named SES [preview] 中文.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const [cwd, stdout, stderr, entry, ...args] = process.argv.slice(2);
const out = fs.openSync(stdout, 'w');
const err = fs.openSync(stderr, 'w');
const child = spawn(process.execPath, [entry, ...args], {
  cwd, detached: true, windowsHide: true, stdio: ['ignore', out, err],
});
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('spawn', () => { console.log(child.pid); child.unref(); });
fs.closeSync(out);
fs.closeSync(err);
