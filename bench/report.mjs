// Генерує markdown-звіт з JSON-результатів micro + e2e.
// Output: docs/bench/<date>-bun-image-vs-sharp.md.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('.', import.meta.url).pathname
const PROJECT = new URL('../', import.meta.url).pathname
const RESULTS = join(ROOT, 'results')
const OUT_DIR = join(PROJECT, 'docs/bench')

const latest = pattern => {
  const files = readdirSync(RESULTS)
    .filter(f => f.startsWith(pattern))
    .toSorted()
  if (files.length === 0) throw new Error(`No ${pattern}* in ${RESULTS}`)
  return JSON.parse(readFileSync(join(RESULTS, files.at(-1)), 'utf8'))
}

const micro = latest('micro-')
const e2e = latest('e2e-')

mkdirSync(OUT_DIR, { recursive: true })

const fmtMB = b => `${(b / 1024 / 1024).toFixed(2)} MB`
const fmtKB = b => `${(b / 1024).toFixed(1)} KB`
const fmtBytes = b => {
  if (b >= 1024 * 1024) return fmtMB(b)
  if (b >= 1024) return fmtKB(b)
  return `${b} B`
}
const fmtMs = m => (m >= 100 ? `${m.toFixed(0)} ms` : `${m.toFixed(1)} ms`)
const fmtRatio = r => `${r >= 1 ? '+' : ''}${((r - 1) * 100).toFixed(1)}%`
const fmtSSIM = v => (v === null ? '—' : v.toFixed(4))

const byFormat = {}
for (const s of micro.summary) {
  byFormat[s.format] ??= {}
  byFormat[s.format][s.adapter] = s
}

const date = micro.meta.startedAt.slice(0, 10)

const ADAPTER_ORDER = ['sharp', 'sharp-default', 'bun-image', 'bun-image-default']
const FORMAT_ORDER = ['png', 'jpeg', 'avif', 'webp']

const formatSection = fmt => {
  const f = byFormat[fmt]
  if (!f) return ''
  const rows = ADAPTER_ORDER.filter(a => f[a])
    .map(a => {
      const s = f[a]
      return `| ${a} | ${fmtBytes(s.totalSize)} | ${fmtMs(s.medianMs)} | ${fmtMs(s.p95Ms)} | ${fmtSSIM(s.avgSSIM)} | ${fmtSSIM(s.avgDSSIM)} |`
    })
    .join('\n')

  const sharpT = f.sharp
  const bunT = f['bun-image']
  let summary = ''
  if (sharpT && bunT) {
    const sizeRatio = bunT.totalSize / sharpT.totalSize
    const timeRatio = bunT.medianMs / sharpT.medianMs
    const speedNote = timeRatio < 1 ? `${(1 / timeRatio).toFixed(2)}× faster` : `${timeRatio.toFixed(2)}× slower`
    const ssimNote =
      sharpT.avgSSIM !== null && bunT.avgSSIM !== null ? `, ΔSSIM ${(bunT.avgSSIM - sharpT.avgSSIM).toFixed(4)}` : ''
    summary = `\n**Bun.Image vs sharp (tuned):** size ${fmtRatio(sizeRatio)}, time ${fmtRatio(timeRatio)} (${speedNote})${ssimNote}\n`
  }

  return `### ${fmt.toUpperCase()}

| Adapter | Total size (24 файли) | Median ms | p95 ms | SSIM avg | DSSIM avg |
| --- | --- | --- | --- | --- | --- |
${rows}
${summary}`
}

const e2eTimeRatio = e2e.bunImage.medianMs / e2e.sharp.medianMs
const e2eSizeRatio = e2e.bunImage.totalOutputBytes / e2e.sharp.totalOutputBytes
const e2eSpeedNote =
  e2eTimeRatio < 1 ? `${(1 / e2eTimeRatio).toFixed(2)}× faster` : `${e2eTimeRatio.toFixed(2)}× slower`

const report = `# Bun.Image vs sharp — Benchmark Report

**Дата:** ${date}
**Платформа:** ${micro.meta.platform}, Bun ${micro.bunVersion}, Bun.Image backend: \`${micro.backend}\`
**Корпус (micro):** ${micro.corpus}, N=${micro.meta.nRuns} runs per file
**Корпус (e2e):** Kodak 24 PNG + demo/test/files (jpeg/gif/svg), N=${e2e.meta.nRuns} runs
**Спец:** \`docs/superpowers/specs/2026-05-26-bun-image-vs-sharp-benchmark-design.md\`

## Per-codec micro-bench

Колонки: total size (24 файли), median ms per file, p95 ms, average SSIM (lossy), average DSSIM (lossy).
Tuned-варіанти (\`sharp\`, \`bun-image\`) — параметри з \`npm/src/index.js\`. \`*-default\` — без extras (no palette/progressive/mozjpeg/effort) для квантифікації втрат.

${FORMAT_ORDER.map(fmt => formatSection(fmt)).join('')}
## E2E CLI (full project run)

Повний прогін \`npm/src/index.js\` (sharp) та \`bench/e2e-cli-bun-image.mjs\` на корпусі.
Cache + corpus seed-иться заново перед кожним прогоном (\`--write\` мутує файли).
Прапори: \`--src=<e2e-corpus> --write --avif\` (тобто з AVIF-генерацією поряд із кожним PNG/JPEG).

| CLI | Median wall-clock | Output size (sum) | Runs (ms) |
| --- | --- | --- | --- |
| sharp | ${fmtMs(e2e.sharp.medianMs)} | ${fmtBytes(e2e.sharp.totalOutputBytes)} | ${e2e.sharp.runs.map(r => r.toFixed(0)).join(', ')} |
| Bun.Image | ${fmtMs(e2e.bunImage.medianMs)} | ${fmtBytes(e2e.bunImage.totalOutputBytes)} | ${e2e.bunImage.runs.map(r => r.toFixed(0)).join(', ')} |

**Bun.Image vs sharp:** time ${fmtRatio(e2eTimeRatio)} (${e2eSpeedNote}), output size ${fmtRatio(e2eSizeRatio)}

## Обмеження

- \`Bun.Image\` ігнорує опції \`mozjpeg\` (JPEG) та \`effort\` (PNG) silently.
- GIF encoding у Bun.Image відсутній — у форку лишається sharp для GIF.
- SVG-стиснення йде через svgo, кодек ні до чого.
- Backend Bun.Image платформо-залежний (\`${micro.backend}\` на цій платформі). Linux/Windows можуть відрізнятись — на macOS це Apple ImageIO з можливою hardware acceleration (Neural Engine / Media Engine для AVIF).
- DSSIM колонка є тільки якщо встановлено \`dssim\` CLI (\`brew install dssim\`).
- Корпус — Kodak suite (24 фото 768×512). Великі UI-PNG (1-20 MB) можуть поводитись інакше — попередній ADR (\`docs/adr/_inbox/20260526-054228-bun-image-benchmark.md\`) на саме такому корпусі показав протилежну картину для sharp PNG.

## Висновок

_Заповнити вручну після перегляду таблиць._
`

const outName = `${date}-bun-image-vs-sharp.md`
writeFileSync(join(OUT_DIR, outName), report)
console.log(`Report: ${join(OUT_DIR, outName)}`)
