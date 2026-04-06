// Launcher script for NestJS dev server
// Ensures node is on PATH and CWD is correct before spawning nest CLI
const path = require('path')
process.env.PATH = path.dirname(process.execPath) + ':' + (process.env.PATH || '')
process.chdir(__dirname)
require('@nestjs/cli/bin/nest.js')
