import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync('dist', { recursive: true })
copyFileSync('cjs/index.cjs', 'dist/index.cjs')
