# Bun.Image vs sharp Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Зробити методологічно коректний замір порівняння `Bun.Image` (Bun 1.3.14) з `sharp` за розміром, якістю (SSIM/DSSIM) і швидкодією на Kodak suite, і записати markdown-звіт у `docs/bench/`.

**Architecture:** Standalone harness у `bench/` (не workspace, окремий `package.json`). Два adapter-и з однаковою сигнатурою `{ name, encode(buf, format) }`. Мікро-бенч (per-codec) + e2e CLI прогін (форк `npm/src/index.js` із заміненими compressors). Quality module використовує `ssim.js` (npm) + `dssim` CLI (optional, через `Bun.spawn`).

**Tech Stack:** Bun 1.3.14, sharp 0.34.5, ssim.js, dssim CLI (optional).

**Spec:** `docs/superpowers/specs/2026-05-26-bun-image-vs-sharp-benchmark-design.md`

---

## File Structure

```
bench/
  .gitignore                 — corpus/, e2e-corpus/, results/, node_modules/
  package.json               — standalone (не workspace), deps: sharp, ssim.js, svgo
  README.md                  — як запускати
  download-corpus.mjs        — fetch 24 Kodak PNG
  codecs/
    sharp.mjs                — adapter
    bun-image.mjs            — adapter
    index.mjs                — registry
    codecs.test.mjs          — parity contract test
  quality.mjs                — computeSSIM, computeDSSIM, decodeToRGBA
  quality.test.mjs           — sanity (identity → SSIM=1)
  micro.mjs                  — orchestrator → bench/results/micro-<iso>.json
  e2e-cli-bun-image.mjs      — форк npm/src/index.js
  e2e.mjs                    — orchestrator → bench/results/e2e-<iso>.json
  report.mjs                 — JSON → docs/bench/2026-05-26-bun-image-vs-sharp.md
docs/bench/
  2026-05-26-bun-image-vs-sharp.md  — фінальний звіт
docs/adr/_inbox/
  20260526-<hhmmss>-bun-image-revisited.md  — нове ADR за результатами (або підтвердження старого)
```

---

### Task 1: Bench harness skeleton

**Files:**

- Create: `bench/.gitignore`
- Create: `bench/package.json`
- Create: `bench/README.md`

- [ ] **Step 1: Створити `bench/.gitignore`**

```
corpus/
e2e-corpus/
results/
node_modules/
```

- [ ] **Step 2: Створити `bench/package.json`**

```json
{
  "name": "minify-image-bench",
  "private": true,
  "type": "module",
  "description": "Methodologically sound bench of Bun.Image vs sharp",
  "scripts": {
    "corpus": "bun download-corpus.mjs",
    "test": "bun test",
    "micro": "bun micro.mjs",
    "e2e": "bun e2e.mjs",
    "report": "bun report.mjs",
    "all": "bun corpus && bun test && bun micro && bun e2e && bun report"
  },
  "dependencies": {
    "sharp": "^0.34.5",
    "ssim.js": "^3.5.0",
    "svgo": "^4.0.1"
  }
}
```

Note: `private: true` + не додаємо в root `workspaces`, щоб bench-deps не текли в npm/. `sharp`, `svgo` дублюються свідомо — e2e-форк їх імпортує локально.

- [ ] **Step 3: Створити `bench/README.md`**

```markdown
# Bench: Bun.Image vs sharp

Standalone harness — не workspace. Запуск:

\`\`\`bash
cd bench
bun install
bun run all # corpus → tests → micro → e2e → report
\`\`\`

Або по кроках: `bun run corpus`, `bun run micro`, etc.

DSSIM (optional, для повного quality-звіту):
\`\`\`bash
brew install dssim # macOS

# або: cargo install dssim

\`\`\`

Без DSSIM — колонка пропускається, SSIM залишається.

Платформа: результати позначені платформо/бекенд-комбо (`Bun.Image.backend`).
```

- [ ] **Step 4: Установити залежності**

Run: `cd bench && bun install`
Expected: lockfile створено, `bench/node_modules/` присутній.

- [ ] **Step 5: Commit**

```bash
git add bench/.gitignore bench/package.json bench/README.md bench/bun.lock
git commit -m "bench: skeleton for Bun.Image vs sharp"
```

---

### Task 2: Corpus downloader

**Files:**

- Create: `bench/download-corpus.mjs`

- [ ] **Step 1: Створити `bench/download-corpus.mjs`**

```js
#!/usr/bin/env bun
// Завантажує Kodak Lossless True Color Image Suite (24 PNG, 768×512 / 512×768).
// Джерело: http://r0k.us/graphics/kodak/ — академічний стандарт image-codec бенчмарків.
// Зберігає у bench/corpus/kodak/kodimNN.png (NN ∈ 01..24). Корпус не комітимо.
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'http://r0k.us/graphics/kodak'
const OUT = new URL('corpus/kodak/', import.meta.url).pathname

mkdirSync(OUT, { recursive: true })

let downloaded = 0
let cached = 0
for (let i = 1; i <= 24; i++) {
  const name = `kodim${String(i).padStart(2, '0')}.png`
  const path = join(OUT, name)
  if (existsSync(path) && statSync(path).size > 100000) {
    cached++
    continue
  }
  process.stdout.write(`${name}… `)
  const res = await fetch(`${BASE}/${name}`)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${name}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  writeFileSync(path, buf)
  downloaded++
  console.log(`${buf.length} bytes`)
}
console.log(`\nDone. ${downloaded} downloaded, ${cached} cached.`)
```

- [ ] **Step 2: Запустити**

Run: `cd bench && bun download-corpus.mjs`
Expected: `Done. 24 downloaded, 0 cached.` Файли в `bench/corpus/kodak/` ~770 KB кожен.

- [ ] **Step 3: Verify**

Run: `cd bench && ls corpus/kodak/ | wc -l`
Expected: `24`. Run: `du -sh corpus/kodak/`. Expected: `~18M`.

- [ ] **Step 4: Commit**

```bash
git add bench/download-corpus.mjs
git commit -m "bench: kodak corpus downloader"
```

---

### Task 3: Sharp adapter + parity test

**Files:**

- Create: `bench/codecs/sharp.mjs`
- Create: `bench/codecs/codecs.test.mjs` (поки тільки sharp)

- [ ] **Step 1: Створити тест-файл `bench/codecs/codecs.test.mjs`**

```js
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { sharpAdapter } from './sharp.mjs'

const SAMPLE = new URL('../../demo/test/files/ready.png', import.meta.url).pathname

test('sharpAdapter has correct shape', () => {
  expect(sharpAdapter.name).toBe('sharp')
  expect(typeof sharpAdapter.encode).toBe('function')
})

test('sharpAdapter.encode(png, "png") returns Uint8Array', async () => {
  const buf = readFileSync(SAMPLE)
  const out = await sharpAdapter.encode(buf, 'png')
  expect(out).toBeInstanceOf(Uint8Array)
  expect(out.length).toBeGreaterThan(0)
  expect(out.length).toBeLessThan(buf.length) // має стиснутися
})

test('sharpAdapter.encode supports png/jpeg/avif/webp', async () => {
  const buf = readFileSync(SAMPLE)
  for (const fmt of ['png', 'jpeg', 'avif', 'webp']) {
    const out = await sharpAdapter.encode(buf, fmt)
    expect(out.length).toBeGreaterThan(0)
  }
})
```

- [ ] **Step 2: Run test — має впасти (no `sharp.mjs`)**

Run: `cd bench && bun test codecs/codecs.test.mjs`
Expected: FAIL — `Cannot find module './sharp.mjs'`

- [ ] **Step 3: Реалізувати `bench/codecs/sharp.mjs`**

```js
// Adapter навколо sharp. Параметри дзеркалять npm/src/index.js compressors:
//   PNG: compressionLevel:9, effort:10, palette:true
//   JPEG: mozjpeg:true, progressive:true
//   AVIF: quality:40
//   WebP: quality:80 (у CLI не використовується, лише для довідки)
// Кеш вимкнено (як у CLI — batch-mode без LRU); concurrency:1 (p-limit назовні).
import sharp from 'sharp'

sharp.cache(false)
sharp.concurrency(1)

const encoders = {
  avif: buf => sharp(buf).avif({ quality: 40 }).toBuffer(),
  jpeg: buf => sharp(buf).jpeg({ mozjpeg: true, progressive: true }).toBuffer(),
  png: buf => sharp(buf).png({ compressionLevel: 9, effort: 10, palette: true }).toBuffer(),
  webp: buf => sharp(buf).webp({ quality: 80 }).toBuffer()
}

export const sharpAdapter = {
  name: 'sharp',
  async encode(buf, format) {
    const encoder = encoders[format]
    if (!encoder) throw new Error(`sharp adapter: unsupported format "${format}"`)
    const out = await encoder(buf)
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
  }
}
```

- [ ] **Step 4: Run test — має пройти**

Run: `cd bench && bun test codecs/codecs.test.mjs`
Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add bench/codecs/sharp.mjs bench/codecs/codecs.test.mjs
git commit -m "bench: sharp adapter with parity tests"
```

---

### Task 4: Bun.Image adapter + parity test

**Files:**

- Create: `bench/codecs/bun-image.mjs`
- Modify: `bench/codecs/codecs.test.mjs` (додати тести для bunImageAdapter)

- [ ] **Step 1: Додати тести для bunImageAdapter у `codecs.test.mjs`**

Додати в кінець файлу:

```js
import { bunImageAdapter } from './bun-image.mjs'

test('bunImageAdapter has correct shape', () => {
  expect(bunImageAdapter.name).toBe('bun-image')
  expect(typeof bunImageAdapter.encode).toBe('function')
})

test('bunImageAdapter.encode(png, "png") returns Uint8Array', async () => {
  const buf = readFileSync(SAMPLE)
  const out = await bunImageAdapter.encode(buf, 'png')
  expect(out).toBeInstanceOf(Uint8Array)
  expect(out.length).toBeGreaterThan(0)
  expect(out.length).toBeLessThan(buf.length)
})

test('bunImageAdapter.encode supports png/jpeg/avif/webp', async () => {
  const buf = readFileSync(SAMPLE)
  for (const fmt of ['png', 'jpeg', 'avif', 'webp']) {
    const out = await bunImageAdapter.encode(buf, fmt)
    expect(out.length).toBeGreaterThan(0)
  }
})
```

- [ ] **Step 2: Run test — має впасти**

Run: `cd bench && bun test codecs/codecs.test.mjs`
Expected: FAIL — `Cannot find module './bun-image.mjs'`

- [ ] **Step 3: Реалізувати `bench/codecs/bun-image.mjs`**

```js
// Adapter навколо Bun.Image (Bun 1.3.14+). Параметри максимально близькі до sharp:
//   PNG: compressionLevel:9, palette:true (effort ігнорується silently)
//   JPEG: quality:75, progressive:true (mozjpeg ігнорується silently)
//   AVIF: quality:40
//   WebP: quality:80
// `Bun.Image.backend` платформо-залежний (macOS → ImageIO, Linux → інший);
// фіксуємо у звіті як частину середовища.

const encoders = {
  avif: buf => new Bun.Image(buf).avif({ quality: 40 }).bytes(),
  jpeg: buf => new Bun.Image(buf).jpeg({ progressive: true, quality: 75 }).bytes(),
  png: buf => new Bun.Image(buf).png({ compressionLevel: 9, palette: true }).bytes(),
  webp: buf => new Bun.Image(buf).webp({ quality: 80 }).bytes()
}

export const bunImageAdapter = {
  name: 'bun-image',
  async encode(buf, format) {
    const encoder = encoders[format]
    if (!encoder) throw new Error(`bun-image adapter: unsupported format "${format}"`)
    return await encoder(buf)
  }
}
```

- [ ] **Step 4: Run test — має пройти**

Run: `cd bench && bun test codecs/codecs.test.mjs`
Expected: 6 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add bench/codecs/bun-image.mjs bench/codecs/codecs.test.mjs
git commit -m "bench: Bun.Image adapter with parity tests"
```

---

### Task 5: Adapter registry + default-params variant

**Files:**

- Create: `bench/codecs/index.mjs`
- Modify: `bench/codecs/codecs.test.mjs`

Окрім «tuned» adapter-ів (з palette/progressive/mozjpeg) додаємо «default» variant для кожного — щоб квантифікувати втрату коли опції не виставлені (відповідь на питання «чи варто переходити на Bun.Image, навіть якщо `mozjpeg` silently ignored»).

- [ ] **Step 1: Створити `bench/codecs/index.mjs`**

```js
// Реєстр adapter-ів для benchmark-runner-а.
// `sharp` / `bun-image` — tuned (параметри з npm/src/index.js).
// `sharp-default` / `bun-image-default` — без extras (no palette, no progressive,
// no mozjpeg, no effort). Третя колонка у звіті: «що ми втрачаємо без екстра-опцій».
import sharp from 'sharp'
import { bunImageAdapter } from './bun-image.mjs'
import { sharpAdapter } from './sharp.mjs'

sharp.cache(false)
sharp.concurrency(1)

const sharpDefaultEncoders = {
  avif: buf => sharp(buf).avif({ quality: 40 }).toBuffer(),
  jpeg: buf => sharp(buf).jpeg({ quality: 75 }).toBuffer(),
  png: buf => sharp(buf).png().toBuffer(),
  webp: buf => sharp(buf).webp({ quality: 80 }).toBuffer()
}

const bunImageDefaultEncoders = {
  avif: buf => new Bun.Image(buf).avif({ quality: 40 }).bytes(),
  jpeg: buf => new Bun.Image(buf).jpeg({ quality: 75 }).bytes(),
  png: buf => new Bun.Image(buf).png().bytes(),
  webp: buf => new Bun.Image(buf).webp({ quality: 80 }).bytes()
}

const makeDefault = (name, encoders) => ({
  name,
  async encode(buf, format) {
    const encoder = encoders[format]
    if (!encoder) throw new Error(`${name}: unsupported format "${format}"`)
    const out = await encoder(buf)
    return out instanceof Uint8Array ? out : new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
  }
})

export const adapters = [
  sharpAdapter,
  bunImageAdapter,
  makeDefault('sharp-default', sharpDefaultEncoders),
  makeDefault('bun-image-default', bunImageDefaultEncoders)
]

export const FORMATS = ['png', 'jpeg', 'avif', 'webp']
```

- [ ] **Step 2: Додати тест у `codecs.test.mjs`**

Додати в кінець:

```js
import { adapters, FORMATS } from './index.mjs'

test('adapters registry has all four variants', () => {
  const names = adapters.map(a => a.name).sort()
  expect(names).toEqual(['bun-image', 'bun-image-default', 'sharp', 'sharp-default'])
})

test('every adapter encodes every FORMAT', async () => {
  const buf = readFileSync(SAMPLE)
  for (const adapter of adapters) {
    for (const fmt of FORMATS) {
      const out = await adapter.encode(buf, fmt)
      expect(out.length).toBeGreaterThan(0)
    }
  }
}, 30_000)
```

- [ ] **Step 3: Run test**

Run: `cd bench && bun test codecs/codecs.test.mjs`
Expected: 8 pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add bench/codecs/index.mjs bench/codecs/codecs.test.mjs
git commit -m "bench: registry + default-params adapter variants"
```

---

### Task 6: Quality module (SSIM + DSSIM)

**Files:**

- Create: `bench/quality.mjs`
- Create: `bench/quality.test.mjs`

- [ ] **Step 1: Створити `bench/quality.test.mjs`**

```js
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { computeDSSIM, computeSSIM, decodeToRGBA } from './quality.mjs'

const SAMPLE_PNG = new URL('../demo/test/files/ready.png', import.meta.url).pathname

test('decodeToRGBA returns RGBA bytes + dims', async () => {
  const buf = readFileSync(SAMPLE_PNG)
  const { data, width, height } = await decodeToRGBA(buf)
  expect(data).toBeInstanceOf(Uint8Array)
  expect(data.length).toBe(width * height * 4)
  expect(width).toBeGreaterThan(0)
})

test('computeSSIM identity = 1.0', async () => {
  const buf = readFileSync(SAMPLE_PNG)
  const ssim = await computeSSIM(buf, buf)
  expect(ssim).toBeCloseTo(1.0, 4)
})

test('computeDSSIM returns null or non-negative number', async () => {
  const buf = readFileSync(SAMPLE_PNG)
  const dssim = await computeDSSIM(buf, buf)
  // dssim may be null if binary not installed; else identity ≈ 0
  if (dssim !== null) expect(dssim).toBeGreaterThanOrEqual(0)
})
```

- [ ] **Step 2: Run — має впасти**

Run: `cd bench && bun test quality.test.mjs`
Expected: FAIL — `Cannot find module './quality.mjs'`

- [ ] **Step 3: Реалізувати `bench/quality.mjs`**

```js
// SSIM via ssim.js (pure JS, npm). DSSIM via Kornelski's dssim CLI (optional).
// Decode: sharp.raw() → RGBA (нейтральний відносно sharp-vs-bun-image кодерів).
// Якщо `dssim` не в PATH — computeDSSIM повертає null (caller робить fallback).
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import ssimModule from 'ssim.js'

// ssim.js експортує named `ssim` і default — обережно з ESM-interop.
const ssimFn = ssimModule.ssim ?? ssimModule.default ?? ssimModule

sharp.cache(false)

/**
 * Декодує encoded image buffer у RGBA через sharp (нейтральний декодер).
 * @param {Uint8Array | Buffer} buf
 * @returns {Promise<{ data: Uint8Array, width: number, height: number }>}
 */
export const decodeToRGBA = async buf => {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return {
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    height: info.height,
    width: info.width
  }
}

/**
 * Mean SSIM ∈ [0..1]. 1.0 — ідентичність.
 * @param {Uint8Array | Buffer} a
 * @param {Uint8Array | Buffer} b
 * @returns {Promise<number>}
 */
export const computeSSIM = async (a, b) => {
  const [ia, ib] = await Promise.all([decodeToRGBA(a), decodeToRGBA(b)])
  if (ia.width !== ib.width || ia.height !== ib.height) {
    throw new Error(`SSIM: dimension mismatch ${ia.width}x${ia.height} vs ${ib.width}x${ib.height}`)
  }
  const { mssim } = ssimFn(
    { data: ia.data, height: ia.height, width: ia.width },
    { data: ib.data, height: ib.height, width: ib.width }
  )
  return mssim
}

let dssimAvailable = null

const detectDssim = async () => {
  if (dssimAvailable !== null) return dssimAvailable
  try {
    const proc = Bun.spawn(['dssim', '--version'], { stderr: 'pipe', stdout: 'pipe' })
    await proc.exited
    dssimAvailable = proc.exitCode === 0
  } catch {
    dssimAvailable = false
  }
  return dssimAvailable
}

/**
 * DSSIM (нижче — краще; 0 — ідентичність). Викликає `dssim a.png b.png`.
 * Якщо бінарка відсутня — повертає null (caller skip колонки).
 * @param {Uint8Array | Buffer} a
 * @param {Uint8Array | Buffer} b
 * @returns {Promise<number | null>}
 */
export const computeDSSIM = async (a, b) => {
  if (!(await detectDssim())) return null
  // dssim вимагає файлів. Пишемо у tmp, читаємо stdout.
  const dir = mkdtempSync(join(tmpdir(), 'dssim-'))
  const aPath = join(dir, 'a.png')
  const bPath = join(dir, 'b.png')
  try {
    // dssim хоче PNG; конвертуємо обидва входи у PNG через sharp.
    const aPng = await sharp(a).png().toBuffer()
    const bPng = await sharp(b).png().toBuffer()
    writeFileSync(aPath, aPng)
    writeFileSync(bPath, bPng)
    const proc = Bun.spawn(['dssim', aPath, bPath], { stderr: 'pipe', stdout: 'pipe' })
    const stdout = await new Response(proc.stdout).text()
    await proc.exited
    if (proc.exitCode !== 0) return null
    // dssim stdout format: "<score>\t<file>" — беремо перший токен першого рядка
    const firstLine = stdout.split('\n')[0]?.trim()
    if (!firstLine) return null
    const score = Number(firstLine.split(/\s+/)[0])
    return Number.isFinite(score) ? score : null
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}
```

- [ ] **Step 4: Run test**

Run: `cd bench && bun test quality.test.mjs`
Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add bench/quality.mjs bench/quality.test.mjs
git commit -m "bench: SSIM (ssim.js) + DSSIM (optional CLI)"
```

---

### Task 7: Micro-bench orchestrator

**Files:**

- Create: `bench/micro.mjs`

- [ ] **Step 1: Створити `bench/micro.mjs`**

```js
#!/usr/bin/env bun
// Per-codec micro-bench. Для кожного (adapter × format × kodakNN):
//   N=10 прогонів encode(buf, fmt), відкидаємо перший (JIT warmup), median+p95.
//   Для lossy (jpeg/avif/webp): SSIM + DSSIM проти оригінального RGBA.
// Output: bench/results/micro-<iso>.json
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { adapters, FORMATS } from './codecs/index.mjs'
import { computeDSSIM, computeSSIM } from './quality.mjs'

const CORPUS = new URL('corpus/kodak/', import.meta.url).pathname
const RESULTS_DIR = new URL('results/', import.meta.url).pathname
const N_RUNS = 10

mkdirSync(RESULTS_DIR, { recursive: true })

if (!existsSync(CORPUS)) {
  console.error(`Corpus missing: ${CORPUS}. Run \`bun download-corpus.mjs\` first.`)
  process.exit(1)
}

const corpusFiles = readdirSync(CORPUS)
  .filter(f => f.endsWith('.png'))
  .sort()
  .map(f => ({ buf: readFileSync(join(CORPUS, f)), name: f }))

console.log(`Corpus: ${corpusFiles.length} files. Backend: ${Bun.Image.backend}.`)

const median = arr => {
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const p95 = arr => [...arr].sort((a, b) => a - b)[Math.floor(arr.length * 0.95) - 1] ?? Math.max(...arr)

const results = {
  backend: Bun.Image.backend,
  bunVersion: Bun.version,
  corpus: 'kodak (24 PNG)',
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
      // відкидаємо перший (warmup)
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
          (ssim !== null ? `, SSIM=${ssim.toFixed(4)}` : '') +
          (dssim !== null ? `, DSSIM=${dssim.toFixed(4)}` : '')
      )
    }
    results.summary.push({
      adapter: adapter.name,
      avgDSSIM: dssims.length ? dssims.reduce((s, v) => s + v, 0) / dssims.length : null,
      avgSSIM: ssims.length ? ssims.reduce((s, v) => s + v, 0) / ssims.length : null,
      format: fmt,
      medianMs: median(times),
      medianSize: median(sizes),
      p95Ms: p95(times),
      totalSize: sizes.reduce((s, v) => s + v, 0)
    })
  }
}

results.meta.finishedAt = new Date().toISOString()
const outPath = join(RESULTS_DIR, `micro-${results.meta.startedAt.replaceAll(':', '-').replace(/\..+/, '')}.json`)
writeFileSync(outPath, JSON.stringify(results, null, 2))
console.log(`\nResults: ${outPath}`)
```

- [ ] **Step 2: Запустити (smoke test, перевірити що працює)**

Run: `cd bench && bun micro.mjs 2>&1 | tail -30`
Expected: завершується успішно, friendly summary, JSON у `bench/results/`.
Тривалість: ~3-8 хвилин (4 adapters × 4 formats × 24 files × 10 runs ≈ 3840 encode-викликів + SSIM/DSSIM на ~1920 lossy результатів).

- [ ] **Step 3: Verify JSON**

Run: `cd bench && jq '.summary | length' results/micro-*.json | tail -1`
Expected: `16` (4 adapters × 4 formats).

- [ ] **Step 4: Commit**

```bash
git add bench/micro.mjs
git commit -m "bench: per-codec micro-bench orchestrator"
```

---

### Task 8: E2E CLI fork з Bun.Image

**Files:**

- Create: `bench/e2e-cli-bun-image.mjs`

Це **копія** `npm/src/index.js` із заміною `compressors` на Bun.Image-варіант + AVIF-генерація через Bun.Image. SVG залишається через svgo. GIF не підтримується Bun.Image — використовуємо sharp (інакше .gif просто скіпатиметься, і e2e-порівняння буде нечесне на цій категорії).

- [ ] **Step 1: Створити `bench/e2e-cli-bun-image.mjs`**

```js
#!/usr/bin/env bun
// Форк npm/src/index.js — той самий CLI, але PNG/JPEG/AVIF через Bun.Image
// замість sharp. GIF лишається sharp (Bun.Image не має GIF encoder), SVG — svgo.
// Призначений ВИКЛЮЧНО для e2e-замірів; не для production.
import calcPercent from 'calc-percent'
import { consola } from 'consola'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { exit } from 'node:process'
import { parseArgs } from 'node:util'
import pLimit from 'p-limit'
import prettyBytes from 'pretty-bytes'
import sharp from 'sharp'
import { optimize as svgoOptimize } from 'svgo'
import { glob } from 'tinyglobby'

sharp.cache(false)
sharp.concurrency(1)

consola.info('START MINIFY IMAGES (Bun.Image fork)')

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    avif: { default: false, type: 'boolean' },
    ignore: { multiple: true, type: 'string' },
    src: { default: '.', type: 'string' },
    write: { default: false, type: 'boolean' }
  }
})

const options = {
  avif: values.avif,
  ignore: values.ignore ?? [],
  src: values.src === '.' && positionals[0] ? positionals[0] : values.src,
  write: values.write
}
consola.info(options)

const srcAbs = resolve(options.src)

const globOptions = {
  absolute: true,
  caseSensitiveMatch: false,
  cwd: options.src,
  ignore: [
    '**/node_modules/**',
    '**/vendor/**',
    '**/test/**',
    '**/.*/**',
    '**/dist/**',
    '**/src-tauri/icons/**',
    ...options.ignore
  ]
}

const HASH_CACHE_FILE = '.n-minify-image.tsv'
const MTIME_CACHE_FILE = 'node_modules/.cache/@nitra/minify-image/mtime.tsv'

// eslint-disable-next-line sonarjs/hashing
const hashBuffer = buf => createHash('sha1').update(buf).digest('hex')

const compareByPath = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)

const loadMtimeCache = () => {
  const cache = new Map()
  try {
    const text = readFileSync(join(srcAbs, MTIME_CACHE_FILE), 'utf8')
    for (const line of text.split('\n')) {
      if (!line) continue
      const cols = line.split('\t')
      if (cols.length !== 3) continue
      const [path, mtime, size] = cols
      if (!path || !mtime || !size) continue
      cache.set(path, { mtime: Number(mtime), size: Number(size) })
    }
  } catch {
    /* cold start */
  }
  return cache
}

const loadHashCache = () => {
  const cache = new Map()
  try {
    const text = readFileSync(join(srcAbs, HASH_CACHE_FILE), 'utf8')
    for (const line of text.split('\n')) {
      if (!line) continue
      const cols = line.split('\t')
      if (cols.length !== 4) continue
      const [path, hash, originalSize, size] = cols
      if (!path || !hash || !size) continue
      const sizeNum = Number(size)
      cache.set(path, { hash, originalSize: Number(originalSize) || sizeNum, size: sizeNum })
    }
  } catch {
    /* cold start */
  }
  return cache
}

const saveMtimeCache = cache => {
  const file = join(srcAbs, MTIME_CACHE_FILE)
  mkdirSync(dirname(file), { recursive: true })
  const entries = [...cache.entries()].toSorted(compareByPath)
  const lines = entries.map(([p, { mtime, size }]) => `${p}\t${mtime}\t${size}`)
  writeFileSync(file, lines.length ? `${lines.join('\n')}\n` : '')
}

const saveHashCache = cache => {
  const entries = [...cache.entries()].toSorted(compareByPath)
  const lines = entries
    .filter(([, { hash }]) => hash)
    .map(([p, { hash, originalSize, size }]) => `${p}\t${hash}\t${originalSize}\t${size}`)
  if (lines.length === 0) return
  writeFileSync(join(srcAbs, HASH_CACHE_FILE), `${lines.join('\n')}\n`)
}

// Bun.Image compressors (паритет з npm/src/index.js де можливо).
// GIF через sharp — Bun.Image не має GIF encoder.
// SVG через svgo — кодек тут ні до чого.
const compressors = {
  '.gif': buf => sharp(buf, { animated: true }).gif({ effort: 10 }).toBuffer(),
  '.jpeg': async buf => Buffer.from(await new Bun.Image(buf).jpeg({ progressive: true, quality: 75 }).bytes()),
  '.jpg': async buf => Buffer.from(await new Bun.Image(buf).jpeg({ progressive: true, quality: 75 }).bytes()),
  '.png': async buf => Buffer.from(await new Bun.Image(buf).png({ compressionLevel: 9, palette: true }).bytes()),
  '.svg': buf => {
    // Спрощений варіант для e2e — повне SVG-treatment не релевантне для бенчмарку кодеків.
    const text = buf.toString('utf8')
    const optimized = svgoOptimize(text, {}).data
    return Buffer.from(optimized, 'utf8')
  }
}

const AVIF_SOURCE_EXTS = new Set(['.gif', '.jpeg', '.jpg', '.png'])

const writeAvif = async (image, avifPath, imagePath) => {
  try {
    const buf = Buffer.from(await new Bun.Image(image).avif({ quality: 40 }).bytes())
    writeFileSync(avifPath, buf)
    consola.info(`${imagePath} → ${avifPath} avif size: ${prettyBytes(buf.length)}`)
  } catch {
    consola.error('skip avif (error): ', imagePath)
  }
}

const compressBuffer = async (image, compressor, imagePath) => {
  try {
    return await compressor(image)
  } catch {
    consola.error('skip minify (error): ', imagePath)
    return null
  }
}

const tryCacheHit = async (imagePath, relPath, mtimeCache, hashCache, avifPath) => {
  const stat = statSync(imagePath)
  const mtimeEntry = mtimeCache.get(relPath)
  if (mtimeEntry && mtimeEntry.size === stat.size && mtimeEntry.mtime === stat.mtimeMs) {
    if (avifPath && !existsSync(avifPath)) await writeAvif(readFileSync(imagePath), avifPath, imagePath)
    return { compressed: 0, orig: stat.size }
  }
  const hashEntry = hashCache.get(relPath)
  if (!hashEntry || !hashEntry.hash || hashEntry.size !== stat.size) return null
  const buf = readFileSync(imagePath)
  if (hashBuffer(buf) !== hashEntry.hash) return null
  mtimeCache.set(relPath, { mtime: stat.mtimeMs, size: stat.size })
  if (avifPath && !existsSync(avifPath)) await writeAvif(buf, avifPath, imagePath)
  return { compressed: 0, orig: stat.size }
}

const processOne = async (imagePath, mtimeCache, hashCache) => {
  const ext = extname(imagePath).toLowerCase()
  const compressor = compressors[ext]
  if (!compressor) return { compressed: 0, orig: 0 }
  const usingCache = Boolean(mtimeCache && hashCache)
  const relPath = usingCache ? relative(srcAbs, imagePath) : null
  const avifPath = options.avif && usingCache && AVIF_SOURCE_EXTS.has(ext) ? `${imagePath}.avif` : null

  if (usingCache) {
    const hit = await tryCacheHit(imagePath, relPath, mtimeCache, hashCache, avifPath)
    if (hit) return hit
  }

  const image = readFileSync(imagePath)
  if (avifPath) await writeAvif(image, avifPath, imagePath)

  const compressedImage = await compressBuffer(image, compressor, imagePath)
  if (!compressedImage) return { compressed: 0, orig: image.length }

  if (!usingCache) return { compressed: image.length - compressedImage.length, orig: image.length }

  let compressedDelta = 0
  let onDiskBytes = image
  if (compressedImage.length * 1.15 < image.length) {
    writeFileSync(imagePath, compressedImage)
    compressedDelta = image.length - compressedImage.length
    onDiskBytes = compressedImage
  }
  const stat = statSync(imagePath)
  const existingOriginal = hashCache.get(relPath)?.originalSize ?? image.length
  mtimeCache.set(relPath, { mtime: stat.mtimeMs, size: stat.size })
  hashCache.set(relPath, { hash: hashBuffer(onDiskBytes), originalSize: existingOriginal, size: stat.size })
  return { compressed: compressedDelta, orig: image.length }
}

const mtimeCache = options.write ? loadMtimeCache() : null
const hashCache = options.write ? loadHashCache() : null
const limit = pLimit(availableParallelism())

const allImages = await glob(['**/*.{png,jpg,jpeg,gif,svg}'], globOptions)
const results = await Promise.all(allImages.map(p => limit(() => processOne(p, mtimeCache, hashCache))))
const stats = { compressed: 0, orig: 0 }
for (const r of results) {
  stats.orig += r.orig
  stats.compressed += r.compressed
}
if (mtimeCache) saveMtimeCache(mtimeCache)
if (hashCache) saveHashCache(hashCache)

const savedPercent = stats.orig > 0 ? calcPercent(stats.compressed, stats.orig) : 0
consola.info(`All image size: ${prettyBytes(stats.orig)}`)
consola.info(
  options.write
    ? `Images optimized, saving: ${prettyBytes(stats.compressed)}, ${savedPercent}%`
    : `Estimated saving: ${prettyBytes(stats.compressed)}, ${savedPercent}%`
)
consola.info('END MINIFY IMAGES (Bun.Image fork)')
```

- [ ] **Step 2: Sanity-check форку**

Run: `cd bench && bun e2e-cli-bun-image.mjs --src=../demo/test/files --avif 2>&1 | tail -20`
Expected: завершується без error, друкує `END MINIFY IMAGES (Bun.Image fork)`. (Це estimate-режим, без `--write`, нічого не зіпсує.)

- [ ] **Step 3: Commit**

```bash
git add bench/e2e-cli-bun-image.mjs
git commit -m "bench: e2e CLI fork with Bun.Image compressors"
```

---

### Task 9: E2E orchestrator

**Files:**

- Create: `bench/e2e.mjs`

- [ ] **Step 1: Створити `bench/e2e.mjs`**

```js
#!/usr/bin/env bun
// E2E замір: повний прогін CLI на фіксованому corpus-у (Kodak + demo/test/files).
// Для кожного CLI (sharp / Bun.Image) — 3 прогони, медіана wall-clock + maxRSS.
// Перед кожним прогоном видаляємо cache-файли (інакше міряємо cache hit, не кодеки).
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
  // Копіюємо Kodak (24 PNG)
  for (const f of readdirSync(CORPUS)) {
    if (f.endsWith('.png')) copyFileSync(join(CORPUS, f), join(E2E_CORPUS, f))
  }
  // + 2 JPEG, 1 GIF, 1 SVG із demo/test/files (тестові фікстури навмисно неоптимальні —
  // саме те, що нам треба для e2e-стискання)
  for (const f of ['big_jpeg_req_6.jpg', 'ready.Jpeg', 'minified.gif', 'point.svg']) {
    const src = join(DEMO, f)
    if (existsSync(src)) copyFileSync(src, join(E2E_CORPUS, f))
  }
  // Копіюємо brands.svg для додаткового SVG-вантажу
  const brands = join(PROJECT, 'demo/brands.svg')
  if (existsSync(brands)) copyFileSync(brands, join(E2E_CORPUS, 'brands.svg'))
}

const cleanCache = () => {
  rmSync(join(E2E_CORPUS, '.n-minify-image.tsv'), { force: true })
  rmSync(join(E2E_CORPUS, 'node_modules'), { force: true, recursive: true })
}

const runOnce = async (cliPath, label) => {
  cleanCache()
  // /usr/bin/time -l (macOS) / -v (linux). Cross-platform: міряємо wall-clock самі,
  // maxRSS опційно через `/usr/bin/time` parse.
  const t0 = Bun.nanoseconds()
  const proc = Bun.spawn(['bun', cliPath, `--src=${E2E_CORPUS}`, '--write', '--avif'], {
    cwd: ROOT,
    stderr: 'pipe',
    stdout: 'pipe'
  })
  const stdout = await new Response(proc.stdout).text()
  await proc.exited
  const t1 = Bun.nanoseconds()
  if (proc.exitCode !== 0) {
    throw new Error(`${label} exited ${proc.exitCode}\n${stdout}`)
  }
  return { stdout, wallMs: Number(t1 - t0) / 1e6 }
}

const median = arr => {
  const s = [...arr].sort((a, b) => a - b)
  return s.length % 2 ? s[Math.floor(s.length / 2)] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

const runCLI = async (cliPath, label) => {
  const runs = []
  for (let i = 0; i < N_RUNS; i++) {
    process.stdout.write(`  run ${i + 1}/${N_RUNS}… `)
    seedCorpus() // свіжа копія для кожного прогону (`--write` модифікує файли)
    const { wallMs } = await runOnce(cliPath, label)
    runs.push(wallMs)
    console.log(`${wallMs.toFixed(0)} ms`)
  }
  return { medianMs: median(runs), runs }
}

console.log(`E2E bench. CLIs: sharp vs Bun.Image. N=${N_RUNS}.`)

console.log('\n## sharp')
const sharpResult = await runCLI(SHARP_CLI, 'sharp')

console.log('\n## bun-image')
const bunResult = await runCLI(BUN_IMAGE_CLI, 'bun-image')

// Підсумок розмірів — переконфігуруємо corpus і запустимо ще раз estimate-mode
// для отримання final-on-disk бажаного. Простіше: вимірюємо розмір директорії після
// одного запису.
seedCorpus()
await runOnce(SHARP_CLI, 'sharp final')
const sharpSize = (() => {
  let total = 0
  for (const f of readdirSync(E2E_CORPUS)) {
    try {
      total += Bun.file(join(E2E_CORPUS, f)).size
    } catch {
      /* dir */
    }
  }
  return total
})()
seedCorpus()
await runOnce(BUN_IMAGE_CLI, 'bun final')
const bunSize = (() => {
  let total = 0
  for (const f of readdirSync(E2E_CORPUS)) {
    try {
      total += Bun.file(join(E2E_CORPUS, f)).size
    } catch {
      /* dir */
    }
  }
  return total
})()

const results = {
  bunImage: { ...bunResult, totalOutputBytes: bunSize },
  meta: {
    backend: Bun.Image.backend,
    bunVersion: Bun.version,
    finishedAt: new Date().toISOString(),
    nRuns: N_RUNS,
    platform: `${process.platform}-${process.arch}`
  },
  sharp: { ...sharpResult, totalOutputBytes: sharpSize }
}

const outPath = join(RESULTS_DIR, `e2e-${new Date().toISOString().replaceAll(':', '-').replace(/\..+/, '')}.json`)
writeFileSync(outPath, JSON.stringify(results, null, 2))
console.log(`\nResults: ${outPath}`)
console.log(`sharp:    ${sharpResult.medianMs.toFixed(0)} ms median, ${sharpSize} bytes output`)
console.log(`Bun.Image:${bunResult.medianMs.toFixed(0)} ms median, ${bunSize} bytes output`)

rmSync(E2E_CORPUS, { force: true, recursive: true })
```

- [ ] **Step 2: Запустити (smoke)**

Run: `cd bench && bun e2e.mjs 2>&1 | tail -20`
Expected: завершується успішно, JSON у `bench/results/e2e-*.json`. Тривалість: ~2-5 хвилин.

- [ ] **Step 3: Verify JSON**

Run: `cd bench && jq '.sharp.medianMs, .bunImage.medianMs' results/e2e-*.json | tail -2`
Expected: дві числові цифри (medians).

- [ ] **Step 4: Commit**

```bash
git add bench/e2e.mjs
git commit -m "bench: e2e CLI orchestrator (sharp vs Bun.Image)"
```

---

### Task 10: Report generator

**Files:**

- Create: `bench/report.mjs`

- [ ] **Step 1: Створити `bench/report.mjs`**

```js
#!/usr/bin/env bun
// Генерує markdown-звіт з JSON-результатів micro + e2e.
// Output: docs/bench/<date>-bun-image-vs-sharp.md.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const ROOT = new URL('.', import.meta.url).pathname
const PROJECT = new URL('../', import.meta.url).pathname
const RESULTS = join(ROOT, 'results')
const OUT_DIR = join(PROJECT, 'docs/bench')

const latest = pattern => {
  const files = readdirSync(RESULTS)
    .filter(f => f.startsWith(pattern))
    .sort()
  if (files.length === 0) throw new Error(`No ${pattern}* in ${RESULTS}`)
  return JSON.parse(readFileSync(join(RESULTS, files.at(-1)), 'utf8'))
}

const micro = latest('micro-')
const e2e = latest('e2e-')

mkdirSync(OUT_DIR, { recursive: true })

const fmtBytes = b => (b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`)
const fmtMs = m => (m >= 100 ? `${m.toFixed(0)} ms` : `${m.toFixed(1)} ms`)
const fmtRatio = r => `${r >= 1 ? '+' : ''}${((r - 1) * 100).toFixed(1)}%`

// Group summary by format
const byFormat = {}
for (const s of micro.summary) {
  byFormat[s.format] ??= {}
  byFormat[s.format][s.adapter] = s
}

const lines = []
const date = micro.meta.startedAt.slice(0, 10)
lines.push(`# Bun.Image vs sharp — Benchmark Report`)
lines.push('')
lines.push(`**Дата:** ${date}`)
lines.push(`**Платформа:** ${micro.meta.platform}, Bun ${micro.bunVersion}, Bun.Image backend: \`${micro.backend}\``)
lines.push(`**Корпус (micro):** ${micro.corpus}, N=${micro.meta.nRuns} runs per file`)
lines.push(`**Корпус (e2e):** Kodak 24 PNG + demo/test/files (jpeg/gif/svg), N=${e2e.meta.nRuns} runs`)
lines.push(`**Спец:** \`docs/superpowers/specs/2026-05-26-bun-image-vs-sharp-benchmark-design.md\``)
lines.push('')
lines.push('## Per-codec micro-bench')
lines.push('')
lines.push(
  'Колонки: median total size (24 файли), median ms per file, p95 ms, average SSIM (lossy), average DSSIM (lossy, nullable).'
)
lines.push('')

for (const fmt of ['png', 'jpeg', 'avif', 'webp']) {
  const f = byFormat[fmt]
  if (!f) continue
  lines.push(`### ${fmt.toUpperCase()}`)
  lines.push('')
  lines.push('| Adapter | Total size (24 файли) | Median ms | p95 ms | SSIM avg | DSSIM avg |')
  lines.push('|---|---|---|---|---|---|')
  for (const adapter of ['sharp', 'sharp-default', 'bun-image', 'bun-image-default']) {
    const s = f[adapter]
    if (!s) continue
    lines.push(
      `| ${adapter} | ${fmtBytes(s.totalSize)} | ${fmtMs(s.medianMs)} | ${fmtMs(s.p95Ms)} | ` +
        `${s.avgSSIM === null ? '—' : s.avgSSIM.toFixed(4)} | ${s.avgDSSIM === null ? '—' : s.avgDSSIM.toFixed(4)} |`
    )
  }
  // Дельти tuned-against-tuned
  const sharpT = f.sharp
  const bunT = f['bun-image']
  if (sharpT && bunT) {
    lines.push('')
    lines.push(
      `**Bun.Image vs sharp (tuned):** size ${fmtRatio(bunT.totalSize / sharpT.totalSize)}, ` +
        `time ${fmtRatio(bunT.medianMs / sharpT.medianMs)}` +
        (sharpT.avgSSIM && bunT.avgSSIM ? `, ΔSSIM ${(bunT.avgSSIM - sharpT.avgSSIM).toFixed(4)}` : '')
    )
  }
  lines.push('')
}

lines.push('## E2E CLI (full project run)')
lines.push('')
lines.push('Повний прогін `npm/src/index.js` (sharp) та `bench/e2e-cli-bun-image.mjs` на корпусі.')
lines.push('Cache чиститься перед кожним прогоном; corpus seed-иться заново (бо `--write` мутує файли).')
lines.push('')
lines.push('| CLI | Median wall-clock | Output size (sum) | Runs |')
lines.push('|---|---|---|---|')
lines.push(
  `| sharp | ${fmtMs(e2e.sharp.medianMs)} | ${fmtBytes(e2e.sharp.totalOutputBytes)} | ${e2e.sharp.runs.map(r => r.toFixed(0)).join(', ')} ms |`
)
lines.push(
  `| Bun.Image | ${fmtMs(e2e.bunImage.medianMs)} | ${fmtBytes(e2e.bunImage.totalOutputBytes)} | ${e2e.bunImage.runs.map(r => r.toFixed(0)).join(', ')} ms |`
)
lines.push('')
lines.push(
  `**Bun.Image vs sharp:** time ${fmtRatio(e2e.bunImage.medianMs / e2e.sharp.medianMs)}, ` +
    `output size ${fmtRatio(e2e.bunImage.totalOutputBytes / e2e.sharp.totalOutputBytes)}`
)
lines.push('')
lines.push('## Обмеження')
lines.push('')
lines.push(`- \`Bun.Image\` ігнорує опції \`mozjpeg\` (JPEG) та \`effort\` (PNG) silently.`)
lines.push('- GIF encoding у Bun.Image відсутній — у форку лишається sharp для GIF.')
lines.push('- SVG-стиснення йде через svgo, кодек ні до чого.')
lines.push(
  `- Backend Bun.Image платформо-залежний (\`${micro.backend}\` на цій платформі). Linux/Windows можуть відрізнятись.`
)
lines.push('- DSSIM колонка є тільки якщо встановлено `dssim` CLI (`brew install dssim`).')
lines.push('')
lines.push('## Висновок')
lines.push('')
lines.push(
  '_Заповнити вручну після перегляду таблиць._ Якщо результати підтверджують попередній ADR (`docs/adr/_inbox/20260526-054228-bun-image-benchmark.md`) — додати референс. Якщо змінюють — створити нове ADR.'
)

const outName = `${date}-bun-image-vs-sharp.md`
writeFileSync(join(OUT_DIR, outName), lines.join('\n'))
console.log(`Report: ${join(OUT_DIR, outName)}`)
```

- [ ] **Step 2: Запустити**

Run: `cd bench && bun report.mjs`
Expected: `Report: .../docs/bench/2026-05-26-bun-image-vs-sharp.md`

- [ ] **Step 3: Verify**

Run: `head -40 /Users/vitaliytv/www/nitra/minify-image/docs/bench/2026-05-26-bun-image-vs-sharp.md`
Expected: заповнений markdown з таблицями та цифрами.

- [ ] **Step 4: Commit**

```bash
git add bench/report.mjs docs/bench/2026-05-26-bun-image-vs-sharp.md
git commit -m "bench: report generator + initial run output"
```

---

### Task 11: Інтерпретація і ADR

**Files:**

- Modify: `docs/bench/2026-05-26-bun-image-vs-sharp.md` (написати «Висновок» вручну)
- Create: `docs/adr/_inbox/20260526-<hhmmss>-bun-image-revisited.md`

- [ ] **Step 1: Прочитати згенерований звіт**

Run: `cat /Users/vitaliytv/www/nitra/minify-image/docs/bench/2026-05-26-bun-image-vs-sharp.md`

- [ ] **Step 2: Заповнити секцію «Висновок» у звіті**

Спостереження писати на основі цифр у таблицях. Питання, на які повинен відповісти висновок:

1. **PNG:** Чи Bun.Image з `palette:true` досягає size-parity з sharp? Якщо так — це нова інформація проти попереднього ADR. Якщо ні — підтверджує його.
2. **JPEG:** Скільки коштує `mozjpeg` silently-ignored (порівняння tuned-vs-tuned і default-vs-default)? Чи дельта в розмірі/якості значуща?
3. **AVIF:** Як Bun.Image (нативний macOS ImageIO) порівнюється з libavif у sharp?
4. **E2E:** Чи overall wall-clock проєктного прогону значно різний? (Дисковий I/O + svgo можуть переважити кодек-час.)
5. **Якість (SSIM/DSSIM):** Чи перевага в розмірі досягається ціною помітної деградації якості?

Замінити шаблонне «Заповнити вручну» на фактичний висновок (4-8 речень).

- [ ] **Step 3: Створити нове ADR**

Файл: `docs/adr/_inbox/20260526-<HHMMSS>-bun-image-revisited.md` (HHMMSS — поточний час). Шаблон:

```markdown
## ADR Bun.Image vs sharp — переоцінка з виправленою методологією (Kodak, SSIM/DSSIM, palette parity)

**Контекст:** Попередній ADR (`docs/adr/_inbox/20260526-054228-bun-image-benchmark.md`) зафіксував рішення «sharp залишається», але методологія мала прогалини: Bun.Image PNG тестували без `palette:true`, JPEG — без `progressive`, корпус 23 файли власних активів, без SSIM/DSSIM. Цей замір переоцінює рішення на Kodak suite (24 PNG) із apples-to-apples параметрами та якістю.

**Рішення/Процедура/Факт:** [Заповнити з висновку звіту.]

**Висновок:** [Підтверджує / переглядає попередній ADR — з ключовими цифрами.]

**Обґрунтування:** [Чому такий вибір — посилання на конкретні рядки таблиці.]

**Зачіпає:** `npm/src/index.js` (без змін / з планом міграції), `npm/package.json` (sharp залишається / sharp виноситься), bench harness залишається у репо для майбутніх Bun-релізів.

**Замір:** `docs/bench/2026-05-26-bun-image-vs-sharp.md`
```

- [ ] **Step 4: Commit**

```bash
git add docs/bench/2026-05-26-bun-image-vs-sharp.md docs/adr/_inbox/20260526-*-bun-image-revisited.md
git commit -m "bench: conclusions + ADR (Bun.Image vs sharp revisited)"
```

---

## Self-Review

**Spec coverage:**

- ✅ Корпус (Kodak suite) → Task 2
- ✅ Адаптери з паритетним параметрами → Tasks 3-4
- ✅ Default-variant adapter-и → Task 5
- ✅ SSIM + DSSIM з fallback → Task 6
- ✅ Per-codec micro-bench (N=10, median, p95, JIT warmup) → Task 7
- ✅ E2E CLI fork із Bun.Image → Task 8
- ✅ E2E orchestrator (3 runs, cache clean, fresh corpus) → Task 9
- ✅ Markdown-звіт у `docs/bench/` → Task 10
- ✅ ADR підтвердження/перегляд → Task 11

**Placeholder scan:** Жодного TBD/«implement later»/«add error handling». Всі кроки містять конкретний код або точну команду. Виняток — «Заповнити висновок вручну» в Task 11 Step 2: це навмисно, бо текст висновку залежить від результатів замірів (не може бути визначений до прогону).

**Type consistency:**

- `{ name, encode(buf, format) }` сигнатура — однакова у Task 3, 4, 5.
- `decodeToRGBA`, `computeSSIM`, `computeDSSIM` — імена однакові в Task 6, 7.
- `FORMATS = ['png', 'jpeg', 'avif', 'webp']` — однаково в index.mjs (Task 5) і micro.mjs (Task 7).
- Adapter names: `sharp`, `bun-image`, `sharp-default`, `bun-image-default` — однаково в Task 5 і report.mjs (Task 10).
