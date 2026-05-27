# Replace sharp with Bun.Image — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@nitra/minify-image` 4.0.0 — runtime-deps без sharp, PNG/JPEG/AVIF через Bun.Image, GIF warn+skip, SVG svgo як було.

**Architecture:** In-place рефакторинг `npm/src/index.js` без зміни структури файлів. Тести (`demo/test/`) адаптуються мінімально (видалення `'minified.gif'` зі списку очікуваних + перевірка warn-у + перевірка byte-equality GIF). sharp у `npm/package.json` deps видаляємо, у `demo/devDependencies` лишаємо (потрібен для генерації test-fixture PNG).

**Tech Stack:** Bun ≥1.3 (вже в `engines`), `Bun.Image` (1.3.14+), consola, svgo, tinyglobby, p-limit.

**Spec:** `docs/superpowers/specs/2026-05-27-replace-sharp-with-bun-image.md`

---

## File Structure

```
npm/
  src/index.js                  — модифікуємо (compressors, AVIF, GIF gate, HELP_TEXT)
  package.json                  — version 4.0.0, видалити sharp з deps
  CHANGELOG.md                  — додати запис [4.0.0]
demo/
  test/run.test.js              — adapt expectedFiles + new GIF skip assertions
  package.json                  — без змін (sharp у devDeps лишається)
```

Інші тести (`avif-opt-out.test.js`, `tauri-icons-default-ignore.test.js`) — перевіряємо що проходять без правок.

---

### Task 1: Baseline — capture before-state metrics

**Files:**
- Read-only: `node_modules/` (поточний стан)

- [ ] **Step 1: Заміряти sharp + node_modules footprint**

Run:
```bash
du -sh /Users/vitaliytv/www/nitra/minify-image/node_modules/sharp /Users/vitaliytv/www/nitra/minify-image/node_modules/@img /Users/vitaliytv/www/nitra/minify-image/node_modules
```

Expected: записати числа (sharp + @img + total). Знадобиться для CHANGELOG.

- [ ] **Step 2: Зафіксувати поточну версію та CHANGELOG останній запис**

Run:
```bash
jq -r '.version' /Users/vitaliytv/www/nitra/minify-image/npm/package.json
head -10 /Users/vitaliytv/www/nitra/minify-image/npm/CHANGELOG.md
```

Expected: version `3.6.0`; останній запис `[3.6.0]` або подібний.

- [ ] **Step 3: Запустити поточні тести як baseline**

Run:
```bash
cd /Users/vitaliytv/www/nitra/minify-image/demo && bun test
```

Expected: всі тести проходять (pre-change baseline). Зберегти summary (X pass, Y fail).

---

### Task 2: Add GIF warn+skip gate in processOne

**Files:**
- Modify: `npm/src/index.js` (функція `processOne`)
- Modify: `demo/test/run.test.js` (новий тест на warn)

- [ ] **Step 1: Написати failing-тест на GIF warn у `demo/test/run.test.js`**

Знайти секцію після `test('estimate-режим: ...'` і додати **новий тест** (після нього):

```js
test('GIF skipped with warn (compression removed in 4.0)', async () => {
  const { exitCode, stdout } = await runCli([`--src=${filesDir}`], here)
  expect(exitCode).toBe(0)
  expect(stdout).toContain('GIF compression removed in 4.0')
  expect(stdout).toContain('minified.gif')
  // CLI НЕ має викликати компресор для GIF — рядок "original size:" відсутній
  expect(stdout).not.toContain('minified.gif original size:')
}, 30_000)
```

- [ ] **Step 2: Run — має впасти**

Run: `cd /Users/vitaliytv/www/nitra/minify-image/demo && bun test run.test.js`
Expected: новий тест FAIL (поточний CLI не друкує warn).

- [ ] **Step 3: Додати GIF gate у `npm/src/index.js`**

Знайти функцію `processOne` (приблизно рядок 547) і змінити її початок з:

```js
const processOne = async (imagePath, mtimeCache, hashCache) => {
  const ext = extname(imagePath).toLowerCase()
  const compressor = compressors[ext]
  if (!compressor) return { compressed: 0, orig: 0 }
```

На:

```js
const processOne = async (imagePath, mtimeCache, hashCache) => {
  const ext = extname(imagePath).toLowerCase()
  // GIF support видалений у 4.0 (Bun.Image не має encoder). Файл лишається на диску.
  if (ext === '.gif') {
    consola.warn(`GIF compression removed in 4.0, file skipped: ${imagePath}`)
    return { compressed: 0, orig: 0 }
  }
  const compressor = compressors[ext]
  if (!compressor) return { compressed: 0, orig: 0 }
```

- [ ] **Step 4: Run — новий тест має пройти**

Run: `cd /Users/vitaliytv/www/nitra/minify-image/demo && bun test run.test.js`
Expected: новий тест PASS. Решта поточних тестів запасть, бо `'minified.gif'` ще у `expectedFiles` і чекає `original size:` — це OK, виправимо в Task 3.

---

### Task 3: Remove GIF from expectedFiles + add byte-equality assert

**Files:**
- Modify: `demo/test/run.test.js`

- [ ] **Step 1: Прибрати `'minified.gif'` з `expectedFiles`**

У `demo/test/run.test.js` знайти рядок:

```js
const expectedFiles = ['ready.png', 'ready.Jpeg', 'big_jpeg_req_6.jpg', 'minified.gif', 'minified.svg']
```

Замінити на:

```js
const expectedFiles = ['ready.png', 'ready.Jpeg', 'big_jpeg_req_6.jpg', 'minified.svg']
```

- [ ] **Step 2: Додати assert byte-equality для GIF у `--write`-тесті**

Знайти `test('--write режим: ...')`. Після `cpSync(filesDir, workDir, { recursive: true })` і виклику `runCli([..., '--write'], workDir)`, **перед** `expect(first.exitCode).toBe(0)` зберегти оригінальний GIF розмір, а ПІСЛЯ перевірки exitCode додати byte-check.

Конкретно: знайти блок з `const first = await runCli([...], workDir)`. Перед ним додати:

```js
const gifPath = join(workDir, 'minified.gif')
const gifBefore = readFileSync(gifPath)
```

А після `expect(first.exitCode).toBe(0)` (тобто після рядка ~98) додати:

```js
// GIF support removed in 4.0 — файл має лишитись байт-в-байт після прогону.
const gifAfter = readFileSync(gifPath)
expect(gifAfter.equals(gifBefore)).toBe(true)
// Cache (TSV) НЕ має містити запис для GIF
expect(tsvLines.some(line => line.startsWith('minified.gif\t'))).toBe(false)
```

Примітка: `tsvLines` уже визначений нижче по тексту функції — переконатись, що цей блок додається **після** `const tsvLines = readFileSync(cachePath, 'utf8').trimEnd().split('\n')`.

- [ ] **Step 3: Виправити tsvLines.length асерцію**

У тому ж тесті знайти:

```js
expect(tsvLines.length).toBe(expectedFiles.length)
```

Це вже автоматично коректно (expectedFiles тепер 4 елементи без GIF, а TSV cache теж не містить GIF). Перевірити, що рядок працює як є. Жодних змін.

- [ ] **Step 4: Run тестів — мають проходити**

Run: `cd /Users/vitaliytv/www/nitra/minify-image/demo && bun test run.test.js`
Expected: всі тести у run.test.js PASS (включно з новим GIF warn + byte-equality).

---

### Task 4: Replace JPEG compressor with Bun.Image

**Files:**
- Modify: `npm/src/index.js` (`compressors` map)

- [ ] **Step 1: Замінити `.jpeg` і `.jpg` у `compressors`**

Знайти у `npm/src/index.js` (приблизно рядок 317-322):

```js
const compressors = {
  '.gif': buf => sharp(buf, { animated: true }).gif({ effort: 10 }).toBuffer(),
  '.jpeg': buf => sharp(buf).jpeg({ mozjpeg: true, progressive: true }).toBuffer(),
  '.jpg': buf => sharp(buf).jpeg({ mozjpeg: true, progressive: true }).toBuffer(),
  '.png': buf => sharp(buf).png({ compressionLevel: 9, effort: 10, palette: true }).toBuffer(),
```

Замінити на:

```js
const compressors = {
  '.jpeg': async buf => Buffer.from(await new Bun.Image(buf).jpeg({ progressive: true, quality: 75 }).bytes()),
  '.jpg': async buf => Buffer.from(await new Bun.Image(buf).jpeg({ progressive: true, quality: 75 }).bytes()),
  '.png': buf => sharp(buf).png({ compressionLevel: 9, effort: 10, palette: true }).toBuffer(),
```

(Запис `.gif` видаляємо разом із sharp.gif — він уже не використовується через GIF gate з Task 2.)

- [ ] **Step 2: Run тестів — JPEG-тести мають проходити**

Run: `cd /Users/vitaliytv/www/nitra/minify-image/demo && bun test`
Expected: всі тести PASS. CLI тепер кодує JPEG через Bun.Image, sharp лишається тільки для PNG/AVIF — це проміжний стан.

---

### Task 5: Replace PNG compressor with Bun.Image

**Files:**
- Modify: `npm/src/index.js`

- [ ] **Step 1: Замінити `.png` у `compressors`**

У `npm/src/index.js` замінити рядок:

```js
  '.png': buf => sharp(buf).png({ compressionLevel: 9, effort: 10, palette: true }).toBuffer(),
```

На:

```js
  '.png': async buf => Buffer.from(await new Bun.Image(buf).png({ compressionLevel: 9, palette: true }).bytes()),
```

(`effort: 10` видалено — Bun.Image його ігнорує silently.)

- [ ] **Step 2: Run тестів — PNG-тести мають проходити**

Run: `cd /Users/vitaliytv/www/nitra/minify-image/demo && bun test`
Expected: всі тести PASS. Особливо: `expect(Number(readySize)).toBeLessThan(Number(readyOrig) * 0.85)` (з рядка ~129) має триматися — Bun.Image PNG з palette дає кращий результат (бенч показав −38% на UI vs sharp −20% на Kodak).

---

### Task 6: Replace AVIF in writeAvif with Bun.Image

**Files:**
- Modify: `npm/src/index.js` (`writeAvif` function)

- [ ] **Step 1: Замінити sharp в `writeAvif`**

Знайти функцію `writeAvif` (приблизно рядок 474):

```js
const writeAvif = async (image, avifPath, imagePath) => {
  try {
    const buf = await sharp(image).avif({ quality: 40 }).toBuffer()
    writeFileSync(avifPath, buf)
    consola.info(`${imagePath} → ${avifPath} avif size: ${prettyBytes(buf.length)}`)
  } catch {
    consola.error('skip avif (error): ', imagePath)
  }
}
```

Замінити на:

```js
const writeAvif = async (image, avifPath, imagePath) => {
  try {
    const buf = Buffer.from(await new Bun.Image(image).avif({ quality: 40 }).bytes())
    writeFileSync(avifPath, buf)
    consola.info(`${imagePath} → ${avifPath} avif size: ${prettyBytes(buf.length)}`)
  } catch {
    consola.error('skip avif (error): ', imagePath)
  }
}
```

- [ ] **Step 2: Видалити `.gif` із `AVIF_SOURCE_EXTS`**

Знайти (приблизно рядок 375):

```js
const AVIF_SOURCE_EXTS = new Set(['.gif', '.jpeg', '.jpg', '.png'])
```

Замінити на:

```js
const AVIF_SOURCE_EXTS = new Set(['.jpeg', '.jpg', '.png'])
```

- [ ] **Step 3: Run тестів**

Run: `cd /Users/vitaliytv/www/nitra/minify-image/demo && bun test`
Expected: всі тести PASS, включно з `avif-opt-out.test.js` і `tauri-icons-default-ignore.test.js`.

---

### Task 7: Remove sharp import + cleanup HELP_TEXT

**Files:**
- Modify: `npm/src/index.js`

- [ ] **Step 1: Видалити `import sharp` та `sharp.cache/concurrency`**

Знайти у `npm/src/index.js`:

```js
import sharp from 'sharp'
```

Видалити цей рядок цілком.

Знайти:

```js
// У batch-режимі повторного доступу до тих самих декодованих зображень не буває —
// LRU sharp лише з'їдає пам'ять. Паралелізм даємо назовні через p-limit (рекомендований
// підхід sharp для batch-обробки): на кожну операцію — 1 потік, на CPU — N операцій.
sharp.cache(false)
sharp.concurrency(1)
```

Видалити цей блок цілком (коментар + два виклики).

- [ ] **Step 2: Оновити HELP_TEXT**

Знайти:

```js
const HELP_TEXT = `Minify images (PNG, JPEG, GIF, SVG)
  Minify if compressed size lower than 15%

Options:
  --write           If not set, only estimate size difference
  --src=<dir>       The directory to process. (default: ".")
  --avif            With --write, create <name>.<ext>.avif (quality 40) next
                    to each raster image (PNG/JPEG/GIF) before compressing the
                    original. Skipped inside dist/, build/, android/, ios/,
```

Замінити:
- `Minify images (PNG, JPEG, GIF, SVG)` → `Minify images (PNG, JPEG, SVG)`
- `each raster image (PNG/JPEG/GIF)` → `each raster image (PNG/JPEG)`

- [ ] **Step 3: Видалити `gif` з glob-pattern**

Знайти (приблизно рядок 618):

```js
const allImages = await glob(['**/*.{png,jpg,jpeg,gif,svg}'], globOptions)
```

Залишити `gif` у глобі — щоб GIF файли все ж потрапляли у `processOne` і генерували warn. **Жодних змін у глоб-патерні.** (Цей крок «без змін» — фіксуємо рішення явно для майбутніх ревьюверів.)

- [ ] **Step 4: Verify no sharp references in npm/src/**

Run: `grep -n "sharp" /Users/vitaliytv/www/nitra/minify-image/npm/src/index.js`
Expected: жодного збігу (тільки коментарі без слова sharp, якщо є).

- [ ] **Step 5: Run тестів**

Run: `cd /Users/vitaliytv/www/nitra/minify-image/demo && bun test`
Expected: всі тести PASS.

---

### Task 8: Remove sharp from npm/package.json deps + bump version

**Files:**
- Modify: `npm/package.json`

- [ ] **Step 1: Прочитати поточний `npm/package.json`**

Run: `cat /Users/vitaliytv/www/nitra/minify-image/npm/package.json`

- [ ] **Step 2: Видалити sharp і bump version**

У `npm/package.json` змінити:
- `"version": "3.6.0"` → `"version": "4.0.0"`
- У `"dependencies"` видалити рядок `"sharp": "^0.34.5",` (зокрема кому в попереднього рядка, якщо sharp був останнім або в середині — orderring alphabetical, sharp між `pretty-bytes` та `svgo`)

Очікуваний final `dependencies` блок:

```json
"dependencies": {
  "calc-percent": "^1.0.1",
  "consola": "^3.4.2",
  "p-limit": "^7.3.0",
  "pretty-bytes": "^7.1.0",
  "svgo": "^4.0.1",
  "tinyglobby": "^0.2.16"
}
```

- [ ] **Step 3: Verify package.json**

Run: `jq '.version, .dependencies.sharp, (.dependencies | keys)' /Users/vitaliytv/www/nitra/minify-image/npm/package.json`
Expected:
```
"4.0.0"
null
["calc-percent", "consola", "p-limit", "pretty-bytes", "svgo", "tinyglobby"]
```

- [ ] **Step 4: Reinstall deps**

Run: `cd /Users/vitaliytv/www/nitra/minify-image && rm -rf node_modules bun.lock && bun install 2>&1 | tail -15`
Expected: install successful, sharp і @img не з'являються у списку install.

- [ ] **Step 5: Verify sharp gone from node_modules root**

Run: `ls /Users/vitaliytv/www/nitra/minify-image/node_modules/sharp /Users/vitaliytv/www/nitra/minify-image/node_modules/@img 2>&1 | head -5`
Expected: `No such file or directory` для обох. (Sharp може лишитися у `demo/node_modules/sharp` — це OK, demo тримає його як devDep для test-fixture generation.)

- [ ] **Step 6: Run тестів**

Run: `cd /Users/vitaliytv/www/nitra/minify-image/demo && bun test`
Expected: всі тести PASS. (demo/node_modules/sharp лишився для генерації фікстур у тестах — це фейкові PNG, не CLI runtime.)

---

### Task 9: Measure after-state footprint

**Files:**
- Read-only

- [ ] **Step 1: Замiряти new footprint**

Run:
```bash
du -sh /Users/vitaliytv/www/nitra/minify-image/node_modules /Users/vitaliytv/www/nitra/minify-image/demo/node_modules 2>&1
ls /Users/vitaliytv/www/nitra/minify-image/node_modules/@img 2>&1 || echo "@img: gone ✓"
ls /Users/vitaliytv/www/nitra/minify-image/node_modules/sharp 2>&1 || echo "sharp: gone ✓"
```

Expected: total зменшився від baseline (Task 1, Step 1). Зафіксувати delta — піде в CHANGELOG.

- [ ] **Step 2: Зберегти числа для CHANGELOG**

Записати:
- Before: `<N MB>` (з Task 1)
- After: `<M MB>`
- Delta: `−<N-M> MB` (приблизно 15-17 MB на macOS arm64)

---

### Task 10: Update CHANGELOG

**Files:**
- Modify: `npm/CHANGELOG.md`

- [ ] **Step 1: Прочитати поточний CHANGELOG**

Run: `head -30 /Users/vitaliytv/www/nitra/minify-image/npm/CHANGELOG.md`

- [ ] **Step 2: Додати запис [4.0.0] у верху**

Insert у CHANGELOG.md одразу після головного заголовка (`# Changelog` чи перед першим `## [3.6.0]`):

```markdown
## [4.0.0] - 2026-05-27

### Changed

- BREAKING: image codec replaced from `sharp` to `Bun.Image`. PNG/JPEG/AVIF encoding now uses Bun's built-in image API (introduced in Bun 1.3.14). On macOS this leverages Apple ImageIO with hardware acceleration (Neural Engine / Media Engine for AVIF); on Linux/Windows — Bun's native backend.

### Removed

- BREAKING: `sharp` runtime dependency removed. Reduces installed footprint by ~<X> MB on macOS arm64 (from <BEFORE> MB to <AFTER> MB), more on multi-arch CI/Docker setups that previously installed libvips binaries for each platform.
- BREAKING: GIF compression removed. `Bun.Image` has no GIF encoder, and the use case was marginal in our corpus (87% of GIFs are <10 KB loaders; only ~7 unique files >1 MB across all nitra projects). `.gif` files are now logged via `consola.warn` and left untouched on disk. To compress GIFs going forward, use `gifsicle` CLI directly or migrate animations to WebP/APNG.

### Migration notes

- If your project relies on GIF compression via `@nitra/minify-image`: pin to `^3.6.0` or run `gifsicle -O3 --lossy=80` directly on relevant files.
- Behavioral parity: bench on Kodak photo corpus shows PNG `-20%` size + 2× faster vs sharp; on UI corpus `-38%` size + 4× faster (palette: true on both sides). AVIF: photo parity at 9× faster; UI `+38%` size at 7× faster (Apple ImageIO less effective for flat/UI content vs libavif). See `docs/bench/2026-05-26-bun-image-vs-sharp.md` for detailed numbers.
- Platform note: benchmarks measured on macOS arm64. Linux/Windows replication is a follow-up; behavior on those platforms uses Bun's native backend (not ImageIO). If you hit regressions, pin to 3.x and open an issue.
```

Замінити `<X>`, `<BEFORE>`, `<AFTER>` на фактичні числа з Task 9.

- [ ] **Step 3: Verify CHANGELOG format**

Run: `head -25 /Users/vitaliytv/www/nitra/minify-image/npm/CHANGELOG.md`
Expected: новий блок `## [4.0.0] - 2026-05-27` зверху, далі попередній `## [3.6.0]`.

- [ ] **Step 4: Run n-changelog check (project rule)**

Run: `cd /Users/vitaliytv/www/nitra/minify-image && npx @nitra/cursor check changelog 2>&1 | tail -10`
Expected: pass (правило `n-changelog` валідує формат і присутність bump).

---

### Task 11: Full validation pass

**Files:**
- Read-only

- [ ] **Step 1: Smoke test CLI на demo/test/files (estimate-mode)**

Run:
```bash
cd /Users/vitaliytv/www/nitra/minify-image && bun npm/src/index.js --src=demo/test/files 2>&1 | tail -20
```

Expected:
- Exit code 0
- У виводі є рядок `GIF compression removed in 4.0, file skipped: …minified.gif`
- Є рядки `original size:` для `ready.png`, `ready.Jpeg`, `big_jpeg_req_6.jpg`
- Немає `minified.gif original size:` (GIF не пройшов компресор)

- [ ] **Step 2: Smoke test з --avif прапором (без --write для безпеки)**

Run:
```bash
cd /Users/vitaliytv/www/nitra/minify-image && bun npm/src/index.js --src=demo/test/files --avif 2>&1 | tail -10
```

Expected: exit code 0, без помилок sharp/import.

- [ ] **Step 3: Повний тестовий прогон**

Run: `cd /Users/vitaliytv/www/nitra/minify-image/demo && bun test 2>&1 | tail -10`
Expected: `Y pass, 0 fail` (Y = baseline count + 1 новий тест GIF warn).

- [ ] **Step 4: Lint**

Run: `cd /Users/vitaliytv/www/nitra/minify-image && bun run lint 2>&1 | tail -20`
Expected: clean (no errors). Якщо є — виправити inline.

- [ ] **Step 5: Final verify — no sharp anywhere in published code**

Run:
```bash
grep -rn "sharp" /Users/vitaliytv/www/nitra/minify-image/npm/src/ /Users/vitaliytv/www/nitra/minify-image/npm/types/ 2>&1
jq '.dependencies' /Users/vitaliytv/www/nitra/minify-image/npm/package.json
```

Expected:
- Перший grep: жодного збігу (або тільки коментарі без слова sharp).
- Друга команда: dependencies без `sharp`.

---

## Self-Review

**Spec coverage:**
- ✅ Видалити `import sharp` → Task 7 Step 1
- ✅ Видалити sharp.cache/concurrency → Task 7 Step 1
- ✅ HELP_TEXT update → Task 7 Step 2
- ✅ compressors PNG/JPEG via Bun.Image → Tasks 4, 5
- ✅ AVIF via Bun.Image → Task 6 Step 1
- ✅ AVIF_SOURCE_EXTS без .gif → Task 6 Step 2
- ✅ GIF warn+skip у processOne → Task 2
- ✅ glob лишається з gif → Task 7 Step 3 (явно зафіксовано «без змін»)
- ✅ package.json: version + remove sharp → Task 8
- ✅ CHANGELOG → Task 10
- ✅ demo/test/run.test.js адапт → Task 3
- ✅ Footprint measurement → Tasks 1, 9
- ✅ Lint → Task 11 Step 4
- ✅ Smoke test CLI → Task 11 Steps 1-2
- ✅ Full tests pass → Task 11 Step 3

**Placeholder scan:** Жодного TBD/«implement later». Винятки — `<X>`, `<BEFORE>`, `<AFTER>` у Task 10 Step 2 (CHANGELOG template), які явно інструктують замінити на числа з Task 9. Це не placeholder для коду — це template для документа, який наповнюється фактичними замірами.

**Type/identifier consistency:**
- `processOne` — однакова сигнатура у всіх задачах.
- `compressors` об'єкт — мутується in-place, ключі `.jpeg/.jpg/.png/.svg` consistent.
- `AVIF_SOURCE_EXTS` — Set, без .gif після Task 6.
- `Bun.Image` API: `.jpeg({progressive, quality})`, `.png({compressionLevel, palette})`, `.avif({quality})`, `.bytes()` → Uint8Array → `Buffer.from()` для compatibility з downstream Buffer-методами (`.length`, `.equals`).

**Commits:** Tasks без явних commit-кроків — користувач за домовленістю комітить сам у кінці. Якщо змінить рішення, кожна Task має чисту bounded зміну, що дозволяє split на окремі commits.
