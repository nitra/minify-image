// E2E замір: повний прогін CLI на фіксованому corpus-у (Kodak + demo/test/files).
// Для кожного CLI (sharp / Bun.Image) — 3 прогони, медіана wall-clock.
// Перед кожним прогоном видаляємо cache-файли + перекопіюємо corpus (бо --write мутує).
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('.', import.meta.url).pathname
const PROJECT = new URL('../', import.meta.url).pathname
const CORPUS = join(ROOT, 'corpus/kodak')
const DEMO = join(PROJECT, 'demo/test/files')
const E2E_CORPUS = join(ROOT, 'e2e-corpus')
const RESULTS_DIR = join(ROOT, 'results')
const N_RUNS = 3

const SHARP_CLI = join(PROJECT, 'npm/src/index.js')
const BUN_IMAGE_CLI = join(ROOT, 'e2e-cli-bun-image.mjs')

mkdirSync(RESULTS_DIR, { recursive: true })

const seedCorpus = () => {
  if (existsSync(E2E_CORPUS)) rmSync(E2E_CORPUS, { force: true, recursive: true })
  mkdirSync(E2E_CORPUS, { recursive: true })
  for (const f of readdirSync(CORPUS)) {
    if (f.endsWith('.png')) copyFileSync(join(CORPUS, f), join(E2E_CORPUS, f))
  }
  for (const f of ['big_jpeg_req_6.jpg', 'ready.Jpeg', 'minified.gif']) {
    const src = join(DEMO, f)
    if (existsSync(src)) copyFileSync(src, join(E2E_CORPUS, f))
  }
  // SVG-и для покриття SVG-гілки CLI
  for (const f of ['brands.svg', 'point.svg']) {
    const src = join(PROJECT, 'demo', f)
    if (existsSync(src)) copyFileSync(src, join(E2E_CORPUS, f))
  }
}

const dirSize = dir => {
  let total = 0
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    try {
      const st = statSync(p)
      if (st.isFile()) total += st.size
    } catch {
      /* skip */
    }
  }
  return total
}

const runOnce = async cliPath => {
  const t0 = Bun.nanoseconds()
  const proc = Bun.spawn(['bun', cliPath, `--src=${E2E_CORPUS}`, '--write', '--avif'], {
    cwd: PROJECT,
    stderr: 'pipe',
    stdout: 'pipe'
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  await proc.exited
  const t1 = Bun.nanoseconds()
  if (proc.exitCode !== 0) {
    throw new Error(`Exit ${proc.exitCode}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`)
  }
  return Number(t1 - t0) / 1e6
}

const median = arr => {
  const s = arr.toSorted((a, b) => a - b)
  return s.length % 2 ? s[Math.floor(s.length / 2)] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

const runCLI = async (cliPath, label) => {
  const runs = []
  let lastSize = 0
  for (let i = 0; i < N_RUNS; i++) {
    process.stdout.write(`  ${label} run ${i + 1}/${N_RUNS}… `)
    seedCorpus()
    const wallMs = await runOnce(cliPath)
    runs.push(wallMs)
    lastSize = dirSize(E2E_CORPUS)
    console.log(`${wallMs.toFixed(0)} ms, ${lastSize} bytes`)
  }
  return { medianMs: median(runs), runs, totalOutputBytes: lastSize }
}

console.log(`E2E bench. CLIs: sharp vs Bun.Image. N=${N_RUNS} runs each.`)

console.log('\n## sharp')
const sharpResult = await runCLI(SHARP_CLI, 'sharp')

console.log('\n## bun-image')
const bunResult = await runCLI(BUN_IMAGE_CLI, 'bun-image')

const results = {
  bunImage: bunResult,
  meta: {
    backend: Bun.Image.backend,
    bunVersion: Bun.version,
    finishedAt: new Date().toISOString(),
    nRuns: N_RUNS,
    platform: `${process.platform}-${process.arch}`
  },
  sharp: sharpResult
}

const startIso = new Date().toISOString().replaceAll(':', '-').replace(/\..+/, '')
const outPath = join(RESULTS_DIR, `e2e-${startIso}.json`)
writeFileSync(outPath, JSON.stringify(results, null, 2))
console.log(`\nResults: ${outPath}`)
console.log(`sharp:    ${sharpResult.medianMs.toFixed(0)} ms median, ${sharpResult.totalOutputBytes} bytes output`)
console.log(`Bun.Image:${bunResult.medianMs.toFixed(0)} ms median, ${bunResult.totalOutputBytes} bytes output`)

rmSync(E2E_CORPUS, { force: true, recursive: true })
