import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Закомічений source of truth: SHA-1 + originalSize. Лежить у корені src — у git.
export const HASH_CACHE_FILE = '.n-minify-image.tsv'

// Локальний mtime fast-path. Авто-gitignored через node_modules/. Якщо node_modules
// нема (наприклад, fresh repo без bun install) — mkdir створює всю гілку рекурсивно.
export const MTIME_CACHE_FILE = 'node_modules/.cache/@nitra/minify-image/mtime.tsv'

/**
 * SHA-1 (hex) байтів буфера. Не криптографічна вимога — лише cache-ключ;
 * SHA-1 вибрано як вбудоване в Node без додаткових залежностей.
 * @param {Buffer} buf — байти файлу.
 * @returns {string} hex-дайджест (40 символів).
 */
// eslint-disable-next-line sonarjs/hashing -- cache-ключ, не security-context (колізії атакувати ніхто не буде)
export const hashBuffer = buf => createHash('sha1').update(buf).digest('hex')

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
 * @param {string} srcAbs — абсолютний корінь скану.
 * @returns {Map<string, { mtime: number, size: number }>} relPath → { mtime, size }.
 */
export const loadMtimeCache = srcAbs => {
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
 * @param {string} srcAbs — абсолютний корінь скану.
 * @returns {Map<string, { hash: string, originalSize: number, size: number }>} relPath → { hash, originalSize, size }.
 */
export const loadHashCache = srcAbs => {
  const cache = new Map()
  if (readTsv4(join(srcAbs, HASH_CACHE_FILE), cache, parseHashLine)) return cache
  readTsv4(join(srcAbs, '.minify-image-cache.tsv'), cache, parseLegacyLine)
  return cache
}

/**
 * Зберігає локальний mtime-cache. Створює `<src>/node_modules/.cache/@nitra/minify-image/`
 * рекурсивно при потребі (на свіжому репо без bun install).
 * @param {string} srcAbs — абсолютний корінь скану.
 * @param {Map<string, { mtime: number, size: number }>} cache — стан mtime-cache на запис.
 */
export const saveMtimeCache = (srcAbs, cache) => {
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
 * @param {string} srcAbs — абсолютний корінь скану.
 * @param {Map<string, { hash: string, originalSize: number, size: number }>} cache — стан hash-cache на запис.
 */
export const saveHashCache = (srcAbs, cache) => {
  const entries = [...cache.entries()].toSorted(compareByPath)
  // Не пишемо записи з порожнім hash — це міграційні placeholder-и зі старого
  // 4-колонкового файлу; вони заповнюються справжніми хешами при slow-path-запуску.
  const lines = entries
    .filter(([, { hash }]) => hash)
    .map(([path, { hash, originalSize, size }]) => `${path}\t${hash}\t${originalSize}\t${size}`)
  if (lines.length === 0) return
  writeFileSync(join(srcAbs, HASH_CACHE_FILE), `${lines.join('\n')}\n`)
}
