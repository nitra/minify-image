#!/usr/bin/env node

import calcPercent from 'calc-percent'
import { consola } from 'consola'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { exit, stdout } from 'node:process'
import { parseArgs } from 'node:util'
import pLimit from 'p-limit'
import prettyBytes from 'pretty-bytes'
import { optimize as svgoOptimize } from 'svgo'
import { glob } from 'tinyglobby'
import { HASH_CACHE_FILE, hashBuffer, loadHashCache, loadMtimeCache, saveHashCache, saveMtimeCache } from './cache.js'

const HELP_TEXT = `Minify images (PNG, JPEG, SVG)
  Minify if compressed size lower than 15%

Options:
  --write           If not set, only estimate size difference
  --json            Print read-only JSON report: scanned files vs
                    .n-minify-image.tsv. No files are compressed or written.
  --src=<dir>       The directory to process. (default: ".")
  --avif            With --write, create <name>.<ext>.avif (quality 40) next
                    to each raster image (PNG/JPEG) before compressing the
                    original. Skipped inside dist/, build/, android/, ios/,
                    .output/, .nuxt/, .cache/. Also skipped per-package when
                    package.json contains
                    { "@nitra/minify-image": { "disable-avif": true } } —
                    mirrors @nitra/cursor's image-avif opt-out so the two
                    sides agree on what to generate vs delete.
  --ignore=<glob>   Extra glob to exclude (repeatable). Always-on defaults
                    (node_modules, vendor, test, dist, src-tauri/icons,
                    **/.*/**) залишаються активними. Приклад: --ignore="docs/**".
  -h, --help        Print this usage guide.
`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    avif: { default: false, type: 'boolean' },
    help: { default: false, short: 'h', type: 'boolean' },
    ignore: { multiple: true, type: 'string' },
    json: { default: false, type: 'boolean' },
    src: { default: '.', type: 'string' },
    write: { default: false, type: 'boolean' }
  }
})

if (values.help) {
  consola.info(HELP_TEXT)
  exit()
}

// `--src=…` має пріоритет; якщо не заданий — fallback на перший positional, далі CWD.
const options = {
  avif: values.avif,
  ignore: values.ignore ?? [],
  json: values.json,
  src: values.src === '.' && positionals[0] ? positionals[0] : values.src,
  write: values.json ? false : values.write
}

if (!options.json) {
  consola.info('START MINIFY IMAGES')
  consola.info(options)
}

const srcAbs = resolve(options.src)

// `test/**` — тестові фікстури навмисно неоптимальні (мають перетинати поріг
// 15% при реальному прогоні компресора), оптимізація зробила б їх непридатними.
// `**/.*/**` — будь-які dot-директорії (`.git`, `.next`, `.cache`, `.idea` тощо):
// технічні артефакти, не вихідні зображення, чіпати їх не треба.
// `**/dist/**` — згенеровані бандли: образи там — копії з `src/`, оптимізувати
// другий раз безглуздо (а CI наступного білду все одно перезапише).
// `**/src-tauri/icons/**` — канонічна локація іконок Tauri (генерується
// `tauri icon` CLI). Квантизація RGBA-PNG у palette там ламає
// `tauri::generate_context!` (panic «icon … is not RGBA»), а користь —
// нульова: іконки все одно дрібні.
// Користувацькі `--ignore=<glob>` додаються згори дефолтів — вимкнути їх не можна.
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

const MINIFY_SOURCE_EXTS = new Set(['.jpeg', '.jpg', '.png', '.svg'])

/**
 * Побудувати read-only JSON-звіт: які image-файли є в src і які вже мають
 * актуальний запис у `.n-minify-image.tsv` після `--write`.
 * @param {string[]} imagePaths — абсолютні шляхи знайдених зображень.
 * @returns {{ cacheFile: string, files: Array<{ path: string, hash: string | null, size: number, cachedHash: string | null, cachedOriginalSize: number | null, cachedSize: number | null, needsCompression: boolean, processed: boolean, supported: boolean }>, src: string, summary: { needsCompression: number, processed: number, total: number, unsupported: number } }} JSON-ready звіт.
 */
const buildJsonReport = imagePaths => {
  const hashCache = loadHashCache(srcAbs)
  const files = imagePaths
    .map(imagePath => {
      const relPath = relative(srcAbs, imagePath)
      const ext = extname(imagePath).toLowerCase()
      const stat = statSync(imagePath)
      const entry = hashCache.get(relPath)
      const supported = MINIFY_SOURCE_EXTS.has(ext)
      const hash = supported ? hashBuffer(readFileSync(imagePath)) : null
      const processed = Boolean(supported && entry?.hash && hash && entry.hash === hash && entry.size === stat.size)
      return {
        cachedHash: entry?.hash || null,
        cachedOriginalSize: entry?.originalSize ?? null,
        cachedSize: entry?.size ?? null,
        hash,
        needsCompression: supported && !processed,
        path: relPath,
        processed,
        size: stat.size,
        supported
      }
    })
    .toSorted((a, b) => a.path.localeCompare(b.path))

  const processed = files.filter(file => file.processed).length
  const needsCompression = files.filter(file => file.needsCompression).length
  const unsupported = files.filter(file => !file.supported).length
  return {
    cacheFile: HASH_CACHE_FILE,
    files,
    src: srcAbs,
    summary: {
      needsCompression,
      processed,
      total: files.length,
      unsupported
    }
  }
}

const SVG_ROOT_TAG_RE = /<svg\b[^>]*>/i
const SVG_ROOT_HIDDEN_RE = /style\s*=\s*["'][^"']*display\s*:\s*none/i
const SVG_SYMBOL_RE = /<symbol\b/gi

// SVG-sprite (Font Awesome тощо): корінь — `<svg style="display:none">` з купою
// `<symbol id="...">`, на які посилаються ззовні через `<use href="file.svg#id">`.
// SVGO про зовнішні посилання не знає: `removeHiddenElems` зрізає весь вміст
// прихованого кореня, а `cleanupIds` видаляє ID, які виглядають невикористаними
// в межах файлу — `<symbol>`-и стають сиротами і теж знімаються. Підсумок —
// 458 KB → 38 байт, тільки XML-декларація. Детектимо два сигнали (display:none
// на корені або ≥2 `<symbol>` у файлі) і повністю пропускаємо оптимізацію.
// @param {string} svgText — вміст SVG як utf-8 рядок.
// @returns {boolean}
const isSvgSprite = svgText => {
  const root = svgText.match(SVG_ROOT_TAG_RE)
  if (root && SVG_ROOT_HIDDEN_RE.test(root[0])) return true
  const symbols = svgText.match(SVG_SYMBOL_RE)
  return symbols !== null && symbols.length >= 2
}

// License/copyright-маркери, що вимагають збереження блоку (коментаря або <metadata>).
// CC BY (4.0 і похідні) — Font Awesome icons, OFL — шрифти, MIT/BSD/Apache/ISC/(L|A)GPL/
// MPL/EPL/Zlib/Artistic — коди. Окремий патерн для `creativecommons.org/licenses/by/...`
// потрібен через RDF-метадані виду `<cc:license rdf:resource="https://...by/4.0/"/>` —
// у тексті там URL, не «CC BY». Голий copyright (©, (c), copyright YYYY/Author) — теж
// атрибуція: достатньо для CC0+© edge case, тож окремої гілки в shouldPreserveBlock не треба.
const ATTRIBUTION_MARKERS = [
  /\bCC[\s-]?BY(?:[\s-]?(?:SA|NC|ND))?(?:[\s-]?\d(?:\.\d)?)?\b/i,
  /\bCreative\s+Commons\s+Attribution\b/i,
  /creativecommons\.org\/licenses\/(?:by|by-sa|by-nc|by-nd)\b/i,
  /\bMIT\s+Licen[sc]e\b/i,
  /\bBSD(?:[\s-]?\d[\s-]?Clause)?\b/i,
  /\bApache(?:[\s-]+Licen[sc]e|[\s-]+v?\d(?:\.\d)?)?\b/i,
  /\bISC\s+Licen[sc]e\b/i,
  /\bL?GPL(?:[\s-]?v?\d(?:\.\d)?)?\b/i,
  /\bAGPL\b/i,
  /\bMPL[\s-]?\d(?:\.\d)?\b/i,
  /\bEPL[\s-]?\d(?:\.\d)?\b/i,
  /\b(?:SIL\s+)?OFL\b/i,
  /\bOpen\s+Font\s+Licen[sc]e\b/i,
  /\bZlib\s+Licen[sc]e\b/i,
  /\bArtistic\s+Licen[sc]e\b/i,
  /(?:©|\(c\)|copyright)\s*(?:\d{4}|[a-z])/i
]

// Permissive-без-атрибуції: блок з самим CC0/Public Domain/Unlicense/WTFPL — стрипаємо.
// Якщо в блоці поряд є copyright (©) — лишаємо: автор міг додати власний © поверх CC0.
const PERMISSIVE_MARKERS = [
  /\bCC0(?:[\s-]?\d(?:\.\d)?)?\b/i,
  /\bCreative\s+Commons\s+Zero\b/i,
  /\bPublic\s+Domain\b/i,
  /\bUnlicense\b/i,
  /\bWTFPL\b/i
]

const COPYRIGHT_MARKER = /(?:©|\(c\)|copyright)\s*(?:\d{4}|[a-z])/i

// @param {string} text — об'єднаний текст блоку (коментар або плоский text+attrs <metadata>).
// @returns {boolean} `true` — блок несе атрибуцію і має лишитись; `false` — можна вирізати.
const shouldPreserveBlock = text => {
  if (PERMISSIVE_MARKERS.some(re => re.test(text))) return COPYRIGHT_MARKER.test(text)
  return ATTRIBUTION_MARKERS.some(re => re.test(text))
}

// `<metadata>...</metadata>` — раннє пре-вирізання. SVGO-плагін через AST не годиться:
// preset-default `removeUnknownsAndDefaults` зрізає сторонні namespace-и (rdf/cc/dc)
// всередині збереженого <metadata>, лишаючи `<metadata/>`. Тож обробляємо текстом:
// license-bearing блоки виносимо в placeholder-коментар, після SVGO підставляємо
// вербатим назад. Non-license <metadata> просто стирається.
const METADATA_BLOCK_RE = /<metadata\b[\s\S]*?<\/metadata\s*>/gi
const METADATA_PLACEHOLDER_PREFIX = 'N_MINIFY_KEEP_META_'
const METADATA_PLACEHOLDER_SUFFIX = '_PLACEHOLDER'
// eslint-disable-next-line security/detect-non-literal-regexp -- template-інтерполяція тільки наших module-scope констант, не user input
const METADATA_PLACEHOLDER_DETECT_RE = new RegExp(
  String.raw`${METADATA_PLACEHOLDER_PREFIX}\d+${METADATA_PLACEHOLDER_SUFFIX}`
)
// eslint-disable-next-line security/detect-non-literal-regexp -- template-інтерполяція тільки наших module-scope констант, не user input
const METADATA_PLACEHOLDER_REPLACE_RE = new RegExp(
  String.raw`<!--\s*${METADATA_PLACEHOLDER_PREFIX}(\d+)${METADATA_PLACEHOLDER_SUFFIX}\s*-->`,
  'g'
)

// Bun.Image (Bun 1.3+, backend: system = Apple ImageIO on macOS).
// `effort` ігнорується silently у Bun.Image; `palette: true` — ключова PNG-оптимізація.
const compressors = {
  '.jpeg': async buf => Buffer.from(await new Bun.Image(buf).jpeg({ progressive: true, quality: 75 }).bytes()),
  '.jpg': async buf => Buffer.from(await new Bun.Image(buf).jpeg({ progressive: true, quality: 75 }).bytes()),
  '.png': async buf => Buffer.from(await new Bun.Image(buf).png({ compressionLevel: 9, palette: true }).bytes()),
  '.svg': buf => {
    const text = buf.toString('utf8')
    if (isSvgSprite(text)) return buf

    // Перед SVGO виносимо license-bearing <metadata> у placeholder-коментар,
    // який потім re-injection-имо вербатим. Non-license <metadata> просто стираємо.
    const preserved = []
    const stripped = text.replaceAll(METADATA_BLOCK_RE, match => {
      if (!shouldPreserveBlock(match)) return ''
      const idx = preserved.push(match) - 1
      return `<!--${METADATA_PLACEHOLDER_PREFIX}${idx}${METADATA_PLACEHOLDER_SUFFIX}-->`
    })

    const optimized = svgoOptimize(stripped, {
      plugins: [
        {
          name: 'preset-default',
          params: {
            overrides: {
              // Не конвертувати `rgba(...,0)` → `transparent`: семантично еквівалентно,
              // але деякі рендерери (зокрема SourceTree з темною темою) трактують
              // короткий запис інакше і показують темне тло замість прозорого.
              // Керує конвертацією кольорів у *атрибутах* (`fill="rgba(...)"`).
              convertColors: { names2hex: true, rgb2hex: true, shortname: false, shorthex: true },
              // CSS усередині `style="..."` обробляє `minifyStyles` (під капотом csso),
              // і саме він перетворює `rgba(...,0)` → `transparent` — незалежно від
              // `convertColors`. Вимикаємо цілком, щоб таке стиснення не псувало
              // прев'ю в SourceTree-подібних рендерерах.
              minifyStyles: false,
              // Коментарі: лишаємо блоки з license/copyright-атрибуцією
              // (CC BY, MIT, BSD, OFL, ©…) і наші placeholder-и для post-process
              // re-injection <metadata>. Інструментальні `<!-- generated by ... -->`
              // та CC0/Public Domain без © вирізаються. Дефолт preset-default —
              // `[/^!/]` (тільки `<!--! ... -->`) — недостатній для Font Awesome
              // та подібних, де license-блок не має префіксу `!`.
              removeComments: { preservePatterns: [METADATA_PLACEHOLDER_DETECT_RE, ...ATTRIBUTION_MARKERS] },
              // Зберігати `<?xml version="1.0" encoding="utf-8"?>` — деякі парсери
              // змінюють режим рендерингу без декларації.
              removeXMLProcInst: false
            }
          }
        }
      ]
    }).data

    return Buffer.from(
      optimized.replaceAll(METADATA_PLACEHOLDER_REPLACE_RE, (_, idx) => preserved[Number(idx)]),
      'utf8'
    )
  }
}

// AVIF створюємо тільки для растрових форматів — для SVG (вектор) це безглуздо.
// GIF видалено в 4.0 (Bun.Image не має GIF encoder).
const AVIF_SOURCE_EXTS = new Set(['.jpeg', '.jpg', '.png'])

// `--avif` пропускає build-outputs, wrapper-директорії та канонічну Tauri-локацію
// іконок: `dist`/`build` (Vite/webpack/Rollup), `android`/`ios` (Capacitor copy
// образів у нативні проєкти — native runtime не читає AVIF і Capacitor затирає
// файли при `cap sync`), `.output`/`.nuxt`/`.cache` (Nuxt і generic кеші),
// `src-tauri/icons` (Tauri вбудовує ці PNG/`.icns`/`.ico` через
// `tauri::generate_context!`, AVIF-сусід безглуздий).
// Більшість уже зрізає global ignore (`**/dist/**`, `**/.*/**`, `**/src-tauri/icons/**`),
// але `build`, `android`, `ios` глобально не зрізаються (там можуть бути валідні
// committed-картинки) — тому зрізаємо лише AVIF-генерацію, мінімізація оригіналу
// далі працює як зазвичай. Запис `src-tauri/icons` лишається й тут — друга лінія
// оборони, якщо хтось перевизначить default-ignore через зміну глобів.
// Перевіряється по segment-у відносного шляху, щоб не ловити false-positive типу `dist-doc/`.
const AVIF_IGNORE_PATH_RE =
  /(?:^|[/\\])(?:dist|build|android|ios|\.output|\.nuxt|\.cache|src-tauri[/\\]icons)(?:[/\\]|$)/i

/**
 * Кеш «найближчий package.json вище за каталог із disable-avif». Узгоджено з
 * `@nitra/cursor` (`@nitra/minify-image.disable-avif` у package.json workspace-пакета):
 * якщо файл лежить усередині пакета з opt-out — AVIF-двійник для нього не створюємо
 * (а звичайне стиснення лишається). Кешуємо по каталогу, бо для тисяч зображень
 * у тому ж пакеті відповідь та сама.
 *
 * Ключ: абсолютний шлях каталогу. Значення: boolean (true ⇒ opt-out активний).
 * @type {Map<string, boolean>}
 */
const dirAvifOptOutCache = new Map()

/**
 * Прочитати opt-out-прапорець із `<dir>/package.json`. Повертає:
 * - `true`/`false` — файл присутній і валідний JSON (= межа найближчого пакета);
 * - `null` — файла нема або JSON битий (поводимось як «нема» — caller іде вище).
 *
 * Битий package.json свідомо не валить CLI: для AVIF-генерації це м'який сигнал,
 * не критичний (звичайне стиснення оригіналу від цього не залежить).
 * @param {string} dir — абсолютний шлях каталогу.
 * @returns {boolean | null} `true`/`false` ⇒ межа пакета знайдена; `null` ⇒ йти вище.
 */
const readDirAvifOptOut = dir => {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    return pkg?.['@nitra/minify-image']?.['disable-avif'] === true
  } catch {
    return null
  }
}

/**
 * Записати остаточну відповідь у `dirAvifOptOutCache` для всіх відвіданих каталогів
 * і повернути її. Дозволяє caller-у уникнути вкладеного циклу на кожному ранньому
 * виході (важливо для cognitive-complexity ліміту).
 * @param {string[]} visited — каталоги, що чекали відповіді під час walk-up.
 * @param {boolean} value — фінальна opt-out-відповідь.
 * @returns {boolean} та сама `value`.
 */
const cacheAvifOptOut = (visited, value) => {
  for (const v of visited) dirAvifOptOutCache.set(v, value)
  return value
}

/**
 * Чи файл лежить у workspace-пакеті з `"@nitra/minify-image": { "disable-avif": true }`?
 * Іде вгору по дереву каталогів від `imagePath` до `srcAbs` (включно), на кожному
 * рівні шукає `package.json`. Перший знайдений (= найближчий до файлу) визначає
 * відповідь. Якщо до `srcAbs` не зустрів жодного — opt-out не активний.
 *
 * Семантика «зупинись на першому package.json»: у monorepo один package.json лежить
 * у корені й по одному в кожному workspace. Прапорець ставлять у workspace-пакеті,
 * не в кореневому.
 * Якщо найближчий package.json не має opt-out — пакет його не хоче, і шукати вище
 * нема сенсу (інакше прапорець на root-package.json випадково вимкнув би AVIF
 * для всіх workspace-ів).
 * @param {string} imagePath — абсолютний шлях зображення.
 * @returns {boolean} `true` ⇒ для цього файлу AVIF не створювати; `false` ⇒ створювати як зазвичай.
 */
const isAvifOptedOut = imagePath => {
  const visited = []
  let dir = dirname(imagePath)
  for (;;) {
    const cached = dirAvifOptOutCache.get(dir)
    if (cached !== undefined) return cacheAvifOptOut(visited, cached)
    visited.push(dir)
    const fromPkg = readDirAvifOptOut(dir)
    if (fromPkg !== null) return cacheAvifOptOut(visited, fromPkg)
    const parent = dirname(dir)
    if (parent === dir || dir === srcAbs) return cacheAvifOptOut(visited, false)
    dir = parent
  }
}

/**
 * Кодує буфер у AVIF (quality 40) і записує поряд з оригіналом.
 * @param {Buffer} image — буфер оригіналу.
 * @param {string} avifPath — куди писати .avif.
 * @param {string} imagePath — шлях оригіналу (для логів).
 */
const writeAvif = async (image, avifPath, imagePath) => {
  try {
    const buf = Buffer.from(await new Bun.Image(image).avif({ quality: 40 }).bytes())
    writeFileSync(avifPath, buf)
    consola.info(`${imagePath} → ${avifPath} avif size: ${prettyBytes(buf.length)}`)
  } catch {
    consola.error('skip avif (error): ', imagePath)
  }
}

/**
 * Запустити обраний компресор над буфером, повертає новий буфер або `null` при помилці.
 * @param {Buffer} image — вхідний буфер.
 * @param {(image: Buffer) => Promise<Buffer> | Buffer} compressor — функція стиснення.
 * @param {string} imagePath — шлях (для логів).
 * @returns {Promise<Buffer | null>} стиснений буфер або `null`.
 */
const compressBuffer = async (image, compressor, imagePath) => {
  try {
    return await compressor(image)
  } catch {
    consola.error('skip minify (error): ', imagePath)
    return null
  }
}

/**
 * Перевіряє mtime → hash cache; на hit довиконує AVIF (якщо треба) і повертає внесок у stats.
 * Cache miss → null, тоді caller стискає файл як зазвичай.
 * @param {string} imagePath — абсолютний шлях.
 * @param {string} relPath — шлях відносно srcAbs (cache key).
 * @param {Map<string, { mtime: number, size: number }>} mtimeCache — локальний fast-path cache.
 * @param {Map<string, { hash: string, originalSize: number, size: number }>} hashCache — закомічений slow-path cache.
 * @param {string | null} avifPath — куди писати AVIF, або null якщо не треба.
 * @returns {Promise<{ orig: number, compressed: number } | null>} результат або null на cache miss.
 */
const tryCacheHit = async (imagePath, relPath, mtimeCache, hashCache, avifPath) => {
  const stat = statSync(imagePath)
  const mtimeEntry = mtimeCache.get(relPath)

  // Fast path: розмір + mtime збігаються — skip без читання
  if (mtimeEntry && mtimeEntry.size === stat.size && mtimeEntry.mtime === stat.mtimeMs) {
    if (avifPath && !existsSync(avifPath)) {
      await writeAvif(readFileSync(imagePath), avifPath, imagePath)
    }
    consola.info(`${imagePath} already compressed (mtime hit)`)
    return { compressed: 0, orig: stat.size }
  }

  // Slow path: hash cache. Розмір — first cheap filter; hash — підтвердження контенту.
  const hashEntry = hashCache.get(relPath)
  if (!hashEntry || !hashEntry.hash || hashEntry.size !== stat.size) return null

  const buf = readFileSync(imagePath)
  if (hashBuffer(buf) !== hashEntry.hash) return null

  // Той самий контент після git clone/checkout — зігріваємо локальний mtime cache.
  mtimeCache.set(relPath, { mtime: stat.mtimeMs, size: stat.size })
  if (avifPath && !existsSync(avifPath)) {
    await writeAvif(buf, avifPath, imagePath)
  }
  consola.info(`${imagePath} already compressed (hash hit, mtime warmed)`)
  return { compressed: 0, orig: stat.size }
}

/**
 * Обробити один файл. Cache hit (mtime або hash) → пропуск. Cache miss → стиснути
 * і записати, якщо економія > 15%. Оновлює обидва cache у місці.
 * @param {string} imagePath — абсолютний шлях.
 * @param {Map<string, { mtime: number, size: number }> | null} mtimeCache — null у estimate-режимі.
 * @param {Map<string, { hash: string, originalSize: number, size: number }> | null} hashCache — null у estimate-режимі.
 * @returns {Promise<{ orig: number, compressed: number }>} вклад файлу в підсумок.
 */
const processOne = async (imagePath, mtimeCache, hashCache) => {
  const ext = extname(imagePath).toLowerCase()
  if (ext === '.gif') {
    consola.warn(`GIF compression removed in 4.0, file skipped: ${relative(srcAbs, imagePath)}`)
    return { compressed: 0, orig: 0 }
  }
  const compressor = compressors[ext]
  if (!compressor) return { compressed: 0, orig: 0 }

  const usingCache = Boolean(mtimeCache && hashCache)
  const relPath = usingCache ? relative(srcAbs, imagePath) : null
  // `<name>.<ext>.avif` (а не `<name>.avif`) — щоб `ready.png` і `ready.jpg`
  // не цілили в один `ready.avif` і не затирали один одного.
  // AVIF_IGNORE_PATH_RE тестується по relPath (не imagePath), щоб коли користувач запускає
  // мініфікатор всередині директорії з ім'ям `dist`/`build`/тощо, її ім'я в абсолютному
  // шляху не блокувало AVIF для всього проєкту.
  const avifPath =
    options.avif &&
    usingCache &&
    AVIF_SOURCE_EXTS.has(ext) &&
    !AVIF_IGNORE_PATH_RE.test(relPath) &&
    !isAvifOptedOut(imagePath)
      ? `${imagePath}.avif`
      : null

  if (usingCache) {
    const hit = await tryCacheHit(imagePath, relPath, mtimeCache, hashCache, avifPath)
    if (hit) return hit
  }

  const image = readFileSync(imagePath)

  // Перед стисненням — створюємо AVIF з ОРИГІНАЛУ (не зі стисненого), щоб
  // не накладати артефакти двох кодеків. Cache miss → перезаписуємо без перевірок.
  if (avifPath) {
    await writeAvif(image, avifPath, imagePath)
  }

  const compressedImage = await compressBuffer(image, compressor, imagePath)
  if (!compressedImage) return { compressed: 0, orig: image.length }

  consola.info(
    `${imagePath} original size: ${prettyBytes(image.length)}, ` +
      `compressed size: ${prettyBytes(compressedImage.length)}`
  )

  if (!usingCache) {
    // estimate-режим: рахуємо raw-дельту (може бути від'ємною)
    return { compressed: image.length - compressedImage.length, orig: image.length }
  }

  let compressedDelta = 0
  let onDiskBytes = image
  if (compressedImage.length * 1.15 < image.length) {
    writeFileSync(imagePath, compressedImage)
    consola.debug(`${imagePath} compressed`)
    compressedDelta = image.length - compressedImage.length
    onDiskBytes = compressedImage
  }
  // Re-stat ПІСЛЯ можливого writeFileSync — щоб у cache потрапили нові size/mtime
  const stat = statSync(imagePath)
  const existingOriginal = hashCache.get(relPath)?.originalSize ?? image.length
  mtimeCache.set(relPath, { mtime: stat.mtimeMs, size: stat.size })
  hashCache.set(relPath, {
    hash: hashBuffer(onDiskBytes),
    originalSize: existingOriginal,
    size: stat.size
  })
  return { compressed: compressedDelta, orig: image.length }
}

const limit = pLimit(availableParallelism())
const allImages = await glob(['**/*.{png,jpg,jpeg,gif,svg}'], globOptions)

if (options.json) {
  stdout.write(`${JSON.stringify(buildJsonReport(allImages), null, 2)}\n`)
  exit()
}

const mtimeCache = options.write ? loadMtimeCache(srcAbs) : null
const hashCache = options.write ? loadHashCache(srcAbs) : null
const results = await Promise.all(allImages.map(imagePath => limit(() => processOne(imagePath, mtimeCache, hashCache))))
const stats = { compressed: 0, orig: 0 }
for (const r of results) {
  stats.orig += r.orig
  stats.compressed += r.compressed
}

if (mtimeCache) saveMtimeCache(srcAbs, mtimeCache)
if (hashCache) saveHashCache(srcAbs, hashCache)

consola.info(`All image size: ${prettyBytes(stats.orig)}`)
const savedPercent = stats.orig > 0 ? calcPercent(stats.compressed, stats.orig) : 0
if (options.write) {
  consola.info(`Images optimized, saving: ${prettyBytes(stats.compressed)}, ${savedPercent}%`)
} else {
  consola.info(`Estimated saving: ${prettyBytes(stats.compressed)}, ${savedPercent}%`)
}

if (hashCache && hashCache.size > 0) {
  let totalOriginal = 0
  let totalCurrent = 0
  for (const [, entry] of hashCache) {
    totalOriginal += entry.originalSize
    totalCurrent += entry.size
  }
  const projectSaving = totalOriginal - totalCurrent
  consola.info(
    `Project lifetime savings: ${prettyBytes(projectSaving)} ` +
      `(${calcPercent(projectSaving, totalOriginal)}% across ${hashCache.size} files)`
  )
}

consola.info('END MINIFY IMAGES')
