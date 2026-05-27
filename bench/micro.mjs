// Per-codec micro-bench. Для кожного (adapter × format × файл):
//   N=10 прогонів encode(buf, fmt), відкидаємо перший (JIT warmup), median+p95.
//   Для lossy (jpeg/avif/webp): SSIM + DSSIM проти оригінального RGBA.
// Output: bench/results/micro-<label>-<iso>.json
//
// CLI:
//   bun micro.mjs                       — Kodak suite (default)
//   bun micro.mjs --corpus=<dir>        — будь-яка директорія з PNG
//   bun micro.mjs --corpus=<dir> --label=<name>  — кастомний label у JSON
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { adapters, FORMATS } from './codecs/index.mjs'
import { computeDSSIM, computeSSIM } from './quality.mjs'

const { values } = parseArgs({
  options: {
    corpus: { type: 'string' },
    label: { type: 'string' }
  }
})

const DEFAULT_CORPUS = new URL('corpus/kodak/', import.meta.url).pathname
const CORPUS = values.corpus ? resolve(values.corpus) : DEFAULT_CORPUS
const CORPUS_LABEL = values.label ?? (values.corpus ? basename(CORPUS) : 'kodak')
const RESULTS_DIR = new URL('results/', import.meta.url).pathname
const N_RUNS = 10

mkdirSync(RESULTS_DIR, { recursive: true })

if (!existsSync(CORPUS)) {
  throw new Error(`Corpus missing: ${CORPUS}. Run \`bun download-corpus.mjs\` first or pass --corpus=<dir>.`)
}

const corpusFiles = readdirSync(CORPUS)
  .filter(f => f.toLowerCase().endsWith('.png'))
  .toSorted()
  .map(f => ({ buf: readFileSync(join(CORPUS, f)), name: f }))

if (corpusFiles.length === 0) {
  throw new Error(`No PNG files in ${CORPUS}`)
}

console.log(`Corpus: ${corpusFiles.length} files. Backend: ${Bun.Image.backend}.`)

const median = arr => {
  const s = arr.toSorted((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const p95 = arr => {
  const s = arr.toSorted((a, b) => a - b)
  return s[Math.floor(s.length * 0.95) - 1] ?? Math.max(...arr)
}

const results = {
  backend: Bun.Image.backend,
  bunVersion: Bun.version,
  corpus: `${CORPUS_LABEL} (${corpusFiles.length} PNG)`,
  corpusPath: CORPUS,
  meta: {
    nRuns: N_RUNS,
    platform: `${process.platform}-${process.arch}`,
    startedAt: new Date().toISOString()
  },
  perFile: [],
  summary: []
}

const lossy = new Set(['jpeg', 'avif', 'webp'])

for (const adapter of adapters) {
  for (const fmt of FORMATS) {
    const sizes = []
    const times = []
    const ssims = []
    const dssims = []
    for (const { buf, name } of corpusFiles) {
      const fileTimes = []
      let lastOut
      for (let i = 0; i < N_RUNS; i++) {
        const t0 = Bun.nanoseconds()
        lastOut = await adapter.encode(buf, fmt)
        const t1 = Bun.nanoseconds()
        fileTimes.push(Number(t1 - t0) / 1e6) // ms
      }
      const warmed = fileTimes.slice(1)
      const fileMedian = median(warmed)
      sizes.push(lastOut.length)
      times.push(fileMedian)

      let ssim = null
      let dssim = null
      if (lossy.has(fmt)) {
        ssim = await computeSSIM(buf, lastOut)
        dssim = await computeDSSIM(buf, lastOut)
        ssims.push(ssim)
        if (dssim !== null) dssims.push(dssim)
      }

      results.perFile.push({
        adapter: adapter.name,
        dssim,
        file: name,
        format: fmt,
        medianMs: fileMedian,
        size: lastOut.length,
        ssim
      })
      console.log(
        `${adapter.name.padEnd(20)} ${fmt.padEnd(5)} ${name}: ` +
          `${lastOut.length} B, ${fileMedian.toFixed(1)} ms` +
          (ssim === null ? '' : `, SSIM=${ssim.toFixed(4)}`) +
          (dssim === null ? '' : `, DSSIM=${dssim.toFixed(4)}`)
      )
    }
    results.summary.push({
      adapter: adapter.name,
      avgDSSIM: dssims.length > 0 ? dssims.reduce((s, v) => s + v, 0) / dssims.length : null,
      avgSSIM: ssims.length > 0 ? ssims.reduce((s, v) => s + v, 0) / ssims.length : null,
      format: fmt,
      medianMs: median(times),
      medianSize: median(sizes),
      p95Ms: p95(times),
      totalSize: sizes.reduce((s, v) => s + v, 0)
    })
  }
}

results.meta.finishedAt = new Date().toISOString()
const isoSafe = results.meta.startedAt.replaceAll(':', '-').replace(/\..+/, '')
const outPath = join(RESULTS_DIR, `micro-${CORPUS_LABEL}-${isoSafe}.json`)
writeFileSync(outPath, JSON.stringify(results, null, 2))
console.log(`\nResults: ${outPath}`)
