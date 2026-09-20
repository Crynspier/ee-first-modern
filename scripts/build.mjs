import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))

rmSync('dist', { recursive: true, force: true })
rmSync('.build-cjs', { recursive: true, force: true })

const runTsc = (project) => {
  execFileSync(process.execPath, [tsc, '-p', project], { stdio: 'inherit' })
}

runTsc('tsconfig.json')
runTsc('tsconfig.cjs.json')

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
