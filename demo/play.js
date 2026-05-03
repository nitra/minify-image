import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { exit, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const workDir = join(here, 'play-output')
const cli = join(here, '..', 'npm', 'src', 'index.js')
const cacheFile = join(workDir, '.n-minify-image.tsv')
const target = join(workDir, 'fat.svg')

// Чисте робоче середовище — щоб кожен запуск починав з нуля
rmSync(workDir, { force: true, recursive: true })
mkdirSync(workDir, { recursive: true })

// Будуємо "товсту" SVG: великий XML-коментар + verbose markup.
// SVGO зі стандартним preset-default викидає коментарі, <title>, <desc>, спрощує
// атрибути — файл стиснеться значно більше за поріг 15%.
const longComment = `<!-- ${'X'.repeat(5000)} -->`
const fatSvg = `<?xml version="1.0" encoding="UTF-8"?>
${longComment}
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <title>Demo</title>
  <desc>A demo SVG that will shrink dramatically after svgo runs</desc>
  <rect x="10" y="10" width="80" height="80" fill="blue"/>
</svg>
`
writeFileSync(target, fatSvg)

const before = statSync(target).size
console.log(`Step 1: створено ${target}`)
console.log(`        розмір на диску = ${before} байт`)
console.log()

console.log(`Step 2: запуск CLI`)
console.log(`        bun ${cli} --src=${workDir} --write`)
console.log('---')
const result = spawnSync('bun', [cli, `--src=${workDir}`, '--write'], { stdio: 'inherit' }) // eslint-disable-line sonarjs/no-os-command-from-path -- bun береться з PATH у dev-середовищі, аналогічно решті скриптів проєкту
console.log('---')
console.log()

if (result.status !== 0) exit(result.status ?? 1)

const after = statSync(target).size
const saved = before - after
const percent = ((saved / before) * 100).toFixed(1)
console.log(`Step 3: інспекція файлу`)
console.log(`        ${target}`)
console.log(`        розмір на диску = ${after} байт (було ${before})`)
console.log(`        економія = ${saved} байт (${percent}%)`)
console.log()

console.log(`Step 4: TSV-cache (${cacheFile})`)
console.log('---')
stdout.write(readFileSync(cacheFile, 'utf8'))
console.log('---')
console.log()
console.log(`Файл і cache лишились у ${workDir} — можеш переглянути в редакторі.`)
