# Replace sharp with Bun.Image in @nitra/minify-image 4.0.0

**Дата:** 2026-05-27
**Статус:** Design approved, ready for implementation plan
**Тип:** Breaking change (major bump 3.6.0 → 4.0.0)

## Контекст

Бенчмарки (`docs/bench/2026-05-26-bun-image-vs-sharp.md`, `docs/bench/2026-05-27-kodak-png-to-avif.md`) показали, що `Bun.Image` (Bun 1.3.14) на macOS дає кращі або порівнянні результати з `sharp` для PNG, JPEG, AVIF, WebP. GIF-encoding у Bun.Image відсутній, але аналіз корпусу `~/www` показав, що 87% GIF — це `<10 KB` loaders, а серед файлів `>1 MB` лише 5–7 унікальних (Bono анімації, дубльовані по white-label проектах). Підтримка GIF — маргінальний use case, що не виправдовує тримати sharp у dep-tree (16.6 MB native binaries локально на macOS, кратно більше на Linux CI).

Цей spec описує заміну `sharp` на `Bun.Image` для всіх растрових форматів у `@nitra/minify-image` і одночасне видалення GIF-стискання.

## Goal

`@nitra/minify-image` 4.0.0:
- runtime dep-tree без `sharp` (native binary видалено повністю)
- кодери PNG/JPEG/AVIF через `Bun.Image`
- SVG залишається через svgo
- GIF — warn + skip (без crash)
- `engines.bun >= 1.3` залишається (вже наявне) — забезпечує `Bun.Image` API

## Файли, що змінюються

### Production (`npm/`)

**`npm/src/index.js`:**
- Видалити `import sharp from 'sharp'`
- Видалити `sharp.cache(false)` / `sharp.concurrency(1)` (Bun.Image внутрішньо керує)
- Оновити `HELP_TEXT`: `"Minify images (PNG, JPEG, GIF, SVG)"` → `"Minify images (PNG, JPEG, SVG)"`; рядок «PNG/JPEG/GIF» у `--avif` description → «PNG/JPEG»
- `compressors` (мапа): видалити `.gif`; замінити `.jpeg`/`.jpg`/`.png` на Bun.Image (див. секцію «Compressor mapping»)
- `AVIF_SOURCE_EXTS`: видалити `.gif`. Залишити `['.jpeg', '.jpg', '.png']`
- `writeAvif` (функція): замінити sharp-виклик на Bun.Image
- `processOne` (на початку, перед `compressor lookup`): додати warn для `.gif`-файлів (див. «GIF поведінка»)
- `glob`-pattern залишається `'**/*.{png,jpg,jpeg,gif,svg}'` — щоб виявляти GIF і warn-ити

**`npm/package.json`:**
- `version`: `3.6.0` → `4.0.0`
- `dependencies`: видалити `sharp`

**`npm/CHANGELOG.md`:**
- Додати запис у форматі Keep a Changelog:

```markdown
## [4.0.0] - 2026-05-27

### Changed
- BREAKING: image codec replaced from `sharp` to `Bun.Image`. PNG/JPEG/AVIF encoding now uses Bun's built-in image API (introduced in Bun 1.3.14). On macOS this leverages Apple ImageIO with hardware acceleration; on Linux/Windows — Bun's native backend.

### Removed
- BREAKING: `sharp` runtime dependency removed. Reduces installed footprint by ~16.6 MB on macOS arm64, more on multi-arch CI/Docker setups.
- BREAKING: GIF compression removed. `Bun.Image` has no GIF encoder, and the use case is marginal (in our corpus: 87% of GIFs are <10 KB loaders, only ~7 unique files >1 MB across all projects). `.gif` files are now logged via `consola.warn` and skipped; existing GIFs remain untouched on disk. To compress GIFs going forward, use `gifsicle` CLI directly or migrate animations to WebP/APNG.
```

### Tests (`demo/`)

**`demo/test/run.test.js`:**
- `expectedFiles` array: видалити `'minified.gif'`
- решту тестів не змінюємо (PNG/JPEG/SVG логіка та сама)
- `sharp` у `import` залишається — він використовується для **генерації** test-fixture PNG (вшивання tEXt chunks через sharp), це не runtime CLI
- `demo/package.json` — `sharp` у `devDependencies` залишається (не публікується)

**`demo/test/files/minified.gif`:** залишити на місці — тест буде перевіряти, що CLI його **не торкнувся** (warn + skip). Якщо `expectedFiles` залишає його як «має існувати без змін» — це і є новий behavioral test для GIF skip.

Нюанс: треба перевірити що `minified.gif` дійсно залишається байт-в-байт після прогону CLI. Якщо поточна логіка перевіряє checksum — нічого додавати. Якщо ні — додати асерцію `crc32` до/після.

**`demo/test/avif-opt-out.test.js`, `demo/test/tauri-icons-default-ignore.test.js`:** теоретично не змінюються (логіка opt-out і ignore не зачіпає кодеки). Перевірити, що тести пройдуть; якщо є асерції про GIF — виправити.

## Compressor mapping (drop-in заміна)

```js
// Було:
const compressors = {
  '.gif': buf => sharp(buf, { animated: true }).gif({ effort: 10 }).toBuffer(),
  '.jpeg': buf => sharp(buf).jpeg({ mozjpeg: true, progressive: true }).toBuffer(),
  '.jpg': buf => sharp(buf).jpeg({ mozjpeg: true, progressive: true }).toBuffer(),
  '.png': buf => sharp(buf).png({ compressionLevel: 9, effort: 10, palette: true }).toBuffer(),
  '.svg': buf => { /* svgo, без змін */ }
}

// Стане:
const compressors = {
  '.jpeg': async buf => Buffer.from(await new Bun.Image(buf).jpeg({ progressive: true, quality: 75 }).bytes()),
  '.jpg': async buf => Buffer.from(await new Bun.Image(buf).jpeg({ progressive: true, quality: 75 }).bytes()),
  '.png': async buf => Buffer.from(await new Bun.Image(buf).png({ compressionLevel: 9, palette: true }).bytes()),
  '.svg': buf => { /* svgo, без змін */ }
}
```

Зміни параметрів:
- **JPEG:** `mozjpeg: true` → `quality: 75` (Bun.Image ігнорує `mozjpeg` silently; явний `quality: 75` фіксує апроксимацію sharp default). `progressive: true` працює.
- **PNG:** `effort: 10` видалено (Bun.Image ігнорує silently). `compressionLevel: 9` і `palette: true` працюють.

## AVIF (writeAvif function)

```js
// Було:
const writeAvif = async (image, avifPath, imagePath) => {
  try {
    const buf = await sharp(image).avif({ quality: 40 }).toBuffer()
    writeFileSync(avifPath, buf)
    consola.info(`${imagePath} → ${avifPath} avif size: ${prettyBytes(buf.length)}`)
  } catch {
    consola.error('skip avif (error): ', imagePath)
  }
}

// Стане:
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

`AVIF_SOURCE_EXTS` (раніше включав `.gif`): `new Set(['.jpeg', '.jpg', '.png'])`.

## GIF поведінка

У `processOne` на самому початку, перед `compressor lookup`:

```js
const processOne = async (imagePath, mtimeCache, hashCache) => {
  const ext = extname(imagePath).toLowerCase()
  if (ext === '.gif') {
    consola.warn(`GIF compression removed in 4.0, file skipped: ${imagePath}`)
    return { compressed: 0, orig: 0 }
  }
  const compressor = compressors[ext]
  if (!compressor) return { compressed: 0, orig: 0 }
  // ... решта без змін
}
```

Це гарантує, що:
1. Кожен `.gif`-файл у corpus дає рівно один warn у лог.
2. Файл залишається байт-в-байт на disk.
3. Cache (mtime/hash TSV) не оновлюється для GIF — наступні прогони знову warn-итимуть (consistent behavior, бо файл не змінився).

## Versioning

`npm/package.json`: `3.6.0` → `4.0.0`. Major bump виправданий:
- Видалена підтримка одного з оголошених форматів (GIF) — observable breaking change.
- Замінений кодек — користувачі, що покладалися на конкретні параметри sharp (наприклад, mozjpeg-оптимізація), бачитимуть інший результат розміру/якості.

## Validation (acceptance criteria)

1. **Тести проходять:** `cd demo && bun test` — всі 3 файли (`run`, `avif-opt-out`, `tauri-icons-default-ignore`).
2. **Lint проходить:** `bun run lint` у корені проекту (eslint, cspell, markdownlint).
3. **`sharp` не імпортується в `npm/src/`:** `grep -r "from 'sharp'" npm/src/` → empty.
4. **`sharp` не в `npm/package.json` dependencies:** `jq '.dependencies.sharp' npm/package.json` → `null`.
5. **CLI smoke test:** `bun npm/src/index.js --src=demo/test/files --avif` (без `--write` для безпеки) — exit code 0, у виводі є рядок `GIF compression removed in 4.0, file skipped: …/minified.gif`.
6. **E2E парність:** запустити `bench/e2e-cli-bun-image.mjs` (наш бенч-форк) і нову `npm/src/index.js` на однаковому corpus — output має бути ідентичний по байтам (обидва тепер використовують Bun.Image з тими ж параметрами, окрім GIF, який у бенч-форку йшов через sharp). Розбіжність тільки на GIF: бенч-форк його стискає, новий CLI — пропускає з warn.
7. **Footprint виміряти:** `du -sh node_modules/` до/після `rm -rf node_modules && bun install`. Записати в CHANGELOG factual delta.

## Out of scope

- **Linux replication.** Поточні бенчмарки виміряні лише на macOS arm64 (`Bun.Image.backend === 'system'` = Apple ImageIO). На Linux backend інший — результати можуть відрізнятись. Це **відоме обмеження** для 4.0.0; у CHANGELOG зазначити, що Linux/Windows replication — follow-up. Якщо там Bun.Image програє — реакція буде в окремому PR (наприклад, повернення sharp для AVIF). Поки що користувачі на Linux отримають той самий API і функціонал, а швидкодія/розмір — на ризик першого користувача (з можливістю pin 3.x).
- **Migration of existing large GIFs.** Bono `cap-yellow-puls*.gif`, `gift-box-puls.gif` тощо — окрема задача. Не входить у цей spec. Пропозиція (для окремого ADR): one-time `gifsicle` прогон + перевести анімації на WebP/APNG.
- **WebP CLI підтримка.** WebP — найкращий формат за бенч (паритет + швидкість), але поточний CLI його не виводить. Додавання `--webp` прапору — окремий feature spec.

## Транзит у implementation plan

Наступний крок — `writing-plans` для розбиття на конкретні TDD-задачі:
1. Замінити compressors PNG/JPEG (sharp → Bun.Image)
2. Замінити AVIF в writeAvif
3. Додати GIF warn+skip у processOne
4. Видалити sharp.cache/concurrency
5. Оновити HELP_TEXT
6. Видалити sharp із `npm/package.json` dependencies
7. Bump version 4.0.0
8. Адаптувати `demo/test/run.test.js`
9. Додати CHANGELOG запис
10. Виміряти `node_modules` до/після, записати у CHANGELOG
11. Запустити lint + всі тести
