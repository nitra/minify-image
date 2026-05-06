#!/usr/bin/env node

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

// У batch-режимі повторного доступу до тих самих декодованих зображень не буває —
// LRU sharp лише з'їдає пам'ять. Паралелізм даємо назовні через p-limit (рекомендований
// підхід sharp для batch-обробки): на кожну операцію — 1 потік, на CPU — N операцій.
sharp.cache(false)
sharp.concurrency(1)

consola.info('START MINIFY IMAGES')

const HELP_TEXT = `Minify images (PNG, JPEG, GIF, SVG)
  Minify if compressed size lower than 15%

Options:
  --write           If not set, only estimate size difference
  --src=<dir>       The directory to process. (default: ".")
  --avif            With --write, create <name>.<ext>.avif (quality 40) next
                    to each raster image (PNG/JPEG/GIF) before compressing the
                    original.
  --ignore=<glob>   Extra glob to exclude (repeatable). Always-on defaults
                    (node_modules, vendor, test, dist, **/.*/**) залишаються
                    активними. Приклад: --ignore="docs/**".
  -h, --help        Print this usage guide.
`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    avif: { default: false, type: 'boolean' },
    help: { default: false, short: 'h', type: 'boolean' },
    ignore: { multiple: true, type: 'string' },
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
  src: values.src === '.' && positionals[0] ? positionals[0] : values.src,
  write: values.write
}
consola.info(options)

const srcAbs = resolve(options.src)

// `test/**` — тестові фікстури навмисно неоптимальні (мають перетинати поріг
// 15% при реальному прогоні компресора), оптимізація зробила б їх непридатними.
// `**/.*/**` — будь-які dot-директорії (`.git`, `.next`, `.cache`, `.idea` тощо):
// технічні артефакти, не вихідні зображення, чіпати їх не треба.
// `**/dist/**` — згенеровані бандли: образи там — копії з `src/`, оптимізувати
// другий раз безглуздо (а CI наступного білду все одно перезапише).
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
    ...options.ignore
  ]
}

// Закомічений source of truth: SHA-1 + originalSize. Лежить у корені src — у git.
const HASH_CACHE_FILE = '.n-minify-image.tsv'

// Локальний mtime fast-path. Авто-gitignored через node_modules/. Якщо node_modules
// нема (наприклад, fresh repo без bun install) — mkdir створює всю гілку рекурсивно.
const MTIME_CACHE_FILE = 'node_modules/.cache/@nitra/minify-image/mtime.tsv'

/**
 * SHA-1 (hex) байтів буфера. Не криптографічна вимога — лише cache-ключ;
 * SHA-1 вибрано як вбудоване в Node без додаткових залежностей.
 * @param {Buffer} buf — байти файлу.
 * @returns {string} hex-дайджест (40 символів).
 */
// eslint-disable-next-line sonarjs/hashing -- cache-ключ, не security-context (колізії атакувати ніхто не буде)
const hashBuffer = buf => createHash('sha1').update(buf).digest('hex')

const compareByPath = ([a], [b]) => {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * Локальний mtime-cache з `<src>/node_modules/.cache/@nitra/minify-image/mtime.tsv`.
 * Формат: `<rel-path>\t<mtime>\t<size>`. Fast-path: при збігу size+mtime — skip
 * без читання файлу. Машинно-залежний (mtime скидається при git clone/checkout),
 * тому лежить у node_modules/ — авто-gitignored.
 * @returns {Map<string, { mtime: number, size: number }>} relPath → { mtime, size }.
 */
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
    // файл відсутній — стартуємо з порожнім cache (cold start або після rm -rf node_modules)
  }
  return cache
}

/**
 * Прочитати 4-колонковий TSV у `cache` через `parseLine`. Повертає `true`,
 * якщо файл прочитався (навіть з 0 валідних рядків — це означає, що source
 * of truth присутній і fallback на legacy не потрібен). `false` лише на read-error.
 * @param {string} file — абсолютний шлях TSV.
 * @param {Map<string, { hash: string, originalSize: number, size: number }>} cache — куди писати.
 * @param {(cols: string[], cache: Map<string, { hash: string, originalSize: number, size: number }>) => void} parseLine — парсер одного рядка (4 колонки).
 * @returns {boolean} `true`, якщо файл вдалося прочитати; `false` на read-error.
 */
const readTsv4 = (file, cache, parseLine) => {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return false
  }
  for (const line of text.split('\n')) {
    if (!line) continue
    const cols = line.split('\t')
    if (cols.length === 4) parseLine(cols, cache)
  }
  return true
}

const parseHashLine = (cols, cache) => {
  const [path, hash, originalSize, size] = cols
  if (!path || !hash || !size) return
  const sizeNum = Number(size)
  cache.set(path, { hash, originalSize: Number(originalSize) || sizeNum, size: sizeNum })
}

const parseLegacyLine = (cols, cache) => {
  const [path, , originalSize, size] = cols // mtime ігноруємо
  if (!path || !size) return
  const sizeNum = Number(size)
  cache.set(path, { hash: '', originalSize: Number(originalSize) || sizeNum, size: sizeNum })
}

/**
 * Закомічений hash-cache з `<src>/.n-minify-image.tsv`. Формат:
 * `<rel-path>\t<sha1-hex>\t<originalSize>\t<size>`. Slow-path і source of truth
 * для `Project lifetime savings`. Переживає `git clone`/`checkout` — slow-path
 * дає cache hit за SHA-1, локальний mtime cache вмить зігрівається.
 *
 * Міграція: якщо файл відсутній, але існує старий `<src>/.minify-image-cache.tsv`
 * (4 колонки `path\tmtime\toriginalSize\tsize`) — підтягуємо `originalSize`/`size`
 * з нього з порожнім hash, щоб lifetime savings не скидався при міграції.
 * Hash заповниться при першому slow-path-запуску (read+sha1) без reprocess.
 * @returns {Map<string, { hash: string, originalSize: number, size: number }>} relPath → { hash, originalSize, size }.
 */
const loadHashCache = () => {
  const cache = new Map()
  if (readTsv4(join(srcAbs, HASH_CACHE_FILE), cache, parseHashLine)) return cache
  readTsv4(join(srcAbs, '.minify-image-cache.tsv'), cache, parseLegacyLine)
  return cache
}

/**
 * Зберігає локальний mtime-cache. Створює `<src>/node_modules/.cache/@nitra/minify-image/`
 * рекурсивно при потребі (на свіжому репо без bun install).
 * @param {Map<string, { mtime: number, size: number }>} cache — стан mtime-cache на запис.
 */
const saveMtimeCache = cache => {
  const file = join(srcAbs, MTIME_CACHE_FILE)
  mkdirSync(dirname(file), { recursive: true })
  const entries = [...cache.entries()].toSorted(compareByPath)
  const lines = entries.map(([path, { mtime, size }]) => `${path}\t${mtime}\t${size}`)
  writeFileSync(file, lines.length ? `${lines.join('\n')}\n` : '')
}

/**
 * Зберігає закомічений hash-cache. Сортує за шляхом — стабільний git diff;
 * hash і size змінюються лише коли реально змінюється контент файлу.
 * Якщо cache порожній — файл не пишемо (запуск без зображень не повинен
 * плодити порожній артефакт у корені).
 * @param {Map<string, { hash: string, originalSize: number, size: number }>} cache — стан hash-cache на запис.
 */
const saveHashCache = cache => {
  const entries = [...cache.entries()].toSorted(compareByPath)
  // Не пишемо записи з порожнім hash — це міграційні placeholder-и зі старого
  // 4-колонкового файлу; вони заповнюються справжніми хешами при slow-path-запуску.
  const lines = entries
    .filter(([, { hash }]) => hash)
    .map(([path, { hash, originalSize, size }]) => `${path}\t${hash}\t${originalSize}\t${size}`)
  if (lines.length === 0) return
  writeFileSync(join(srcAbs, HASH_CACHE_FILE), `${lines.join('\n')}\n`)
}

// Sharp за замовчуванням викидає метадані (EXIF, tEXt). `mozjpeg: true` уже вмикає
// `optimiseScans` (≡ progressive); `progressive: true` залишаємо явно для наочності.
const compressors = {
  '.gif': buf => sharp(buf, { animated: true }).gif({ effort: 10 }).toBuffer(),
  '.jpeg': buf => sharp(buf).jpeg({ mozjpeg: true, progressive: true }).toBuffer(),
  '.jpg': buf => sharp(buf).jpeg({ mozjpeg: true, progressive: true }).toBuffer(),
  '.png': buf => sharp(buf).png({ compressionLevel: 9, effort: 10, palette: true }).toBuffer(),
  '.svg': buf =>
    Buffer.from(
      svgoOptimize(buf.toString('utf8'), {
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
                // Зберігати `<?xml version="1.0" encoding="utf-8"?>` — деякі парсери
                // змінюють режим рендерингу без декларації.
                removeXMLProcInst: false
              }
            }
          }
        ]
      }).data,
      'utf8'
    )
}

// AVIF створюємо тільки для растрових форматів — для SVG (вектор) це безглуздо.
const AVIF_SOURCE_EXTS = new Set(['.gif', '.jpeg', '.jpg', '.png'])

/**
 * Кодує буфер у AVIF (quality 40) і записує поряд з оригіналом.
 * @param {Buffer} image — буфер оригіналу.
 * @param {string} avifPath — куди писати .avif.
 * @param {string} imagePath — шлях оригіналу (для логів).
 */
const writeAvif = async (image, avifPath, imagePath) => {
  try {
    const buf = await sharp(image).avif({ quality: 40 }).toBuffer()
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
  const compressor = compressors[ext]
  if (!compressor) return { compressed: 0, orig: 0 }

  const usingCache = Boolean(mtimeCache && hashCache)
  const relPath = usingCache ? relative(srcAbs, imagePath) : null
  // `<name>.<ext>.avif` (а не `<name>.avif`) — щоб `ready.png` і `ready.jpg`
  // не цілили в один `ready.avif` і не затирали один одного.
  const avifPath = options.avif && usingCache && AVIF_SOURCE_EXTS.has(ext) ? `${imagePath}.avif` : null

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

const mtimeCache = options.write ? loadMtimeCache() : null
const hashCache = options.write ? loadHashCache() : null
const limit = pLimit(availableParallelism())

const allImages = await glob(['**/*.{png,jpg,jpeg,gif,svg}'], globOptions)
const results = await Promise.all(allImages.map(imagePath => limit(() => processOne(imagePath, mtimeCache, hashCache))))
const stats = { compressed: 0, orig: 0 }
for (const r of results) {
  stats.orig += r.orig
  stats.compressed += r.compressed
}

if (mtimeCache) saveMtimeCache(mtimeCache)
if (hashCache) saveHashCache(hashCache)

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
