import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

const tsc = process.platform === 'win32' ? 'tsc.cmd' : 'tsc'

rmSync('dist', { recursive: true, force: true })
rmSync('.build-cjs', { recursive: true, force: true })

execFileSync(tsc, ['-p', 'tsconfig.json'], { stdio: 'inherit' })
execFileSync(tsc, ['-p', 'tsconfig.cjs.json'], { stdio: 'inherit' })

mkdirSync('dist', { recursive: true })
renameSync('.build-cjs/index.js', 'dist/index-core.cjs')

const cjsEntry = [
  "'use strict'",
  '',
  "const mod = require('./index-core.cjs')",
  'const first = mod.default',
  '',
  'module.exports = Object.assign(first, mod)',
  '',
].join('\n')

writeFileSync('dist/index.cjs', cjsEntry, 'utf8')
rmSync('.build-cjs', { recursive: true, force: true })

readFileSync('dist/index.js')
readFileSync('dist/index.cjs')
readFileSync('dist/index-core.cjs')
