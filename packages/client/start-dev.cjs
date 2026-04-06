// Launcher script for Vite dev server
// Spawns vite shell shim with correct PATH and CWD
const { spawn } = require('child_process')
const path = require('path')

const env = Object.assign({}, process.env, {
  PATH: path.dirname(process.execPath) + ':' + (process.env.PATH || '')
})

const child = spawn(
  path.join(__dirname, 'node_modules', '.bin', 'vite'),
  [],
  { cwd: __dirname, env, stdio: 'inherit', shell: true }
)

child.on('exit', (code) => process.exit(code || 0))
process.on('SIGTERM', () => child.kill('SIGTERM'))
process.on('SIGINT', () => child.kill('SIGINT'))
