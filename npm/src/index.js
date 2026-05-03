#!/usr/bin/env node

import calcPercent from 'calc-percent'
import consola from 'consola'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { extname, join, relative, resolve } from 'node:path'
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
  -h, --help        Print this usage guide.
`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    help: { default: false, short: 'h', type: 'boolean' },
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
  src: values.src === '.' && positionals[0] ? positionals[0] : values.src,
  write: values.write
}
consola.info(options)

const srcAbs = resolve(options.src)

const globOptions = {
  absolute: true,
  caseSensitiveMatch: false,
  cwd: options.src,
  ignore: ['**/node_modules/**', '**/vendor/**']
}

const CACHE_FILE = '.minify-image-cache.tsv'

/**
 * Завантажує TSV-cache з `<srcAbs>/.minify-image-cache.tsv`.
 * Формат: `<rel-path>\t<mtime>\t<originalSize>\t<size>\n` (відсортовано за шляхом).
 * `Σ(originalSize − size)` = загальна економія по проєкту.
 * @returns {Map<string, { mtime: number, originalSize: number, size: number }>} cache.
 */
const loadCache = () => {
  const cache = new Map()
  try {
    const text = readFileSync(join(srcAbs, CACHE_FILE), 'utf8')
    for (const line of text.split('\n')) {
      if (!line) continue
      const [path, mtime, originalSize, size] = line.split('\t')
      if (!path || !mtime || !size) continue
      const sizeNum = Number(size)
      cache.set(path, {
        mtime: Number(mtime),
        originalSize: originalSize ? Number(originalSize) : sizeNum,
        size: sizeNum
      })
    }
  } catch {
    // файл відсутній/недоступний — стартуємо з порожнім cache
  }
  return cache
}

const compareByPath = ([a], [b]) => {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * Зберігає cache як TSV. Сортує за шляхом — стабільний diff у git.
 * @param {Map<string, { size: number, mtime: number, originalSize: number }>} cache — стан cache.
 */
const saveCache = cache => {
  const entries = [...cache.entries()].toSorted(compareByPath)
  const lines = entries.map(([path, { mtime, originalSize, size }]) => `${path}\t${mtime}\t${originalSize}\t${size}`)
  const body = lines.length ? `${lines.join('\n')}\n` : ''
  writeFileSync(join(srcAbs, CACHE_FILE), body)
}

// Sharp за замовчуванням викидає метадані (EXIF, tEXt). `mozjpeg: true` уже вмикає
// `optimiseScans` (≡ progressive); `progressive: true` залишаємо явно для наочності.
const compressors = {
  '.gif': buf => sharp(buf, { animated: true }).gif({ effort: 10 }).toBuffer(),
  '.jpeg': buf => sharp(buf).jpeg({ mozjpeg: true, progressive: true }).toBuffer(),
  '.jpg': buf => sharp(buf).jpeg({ mozjpeg: true, progressive: true }).toBuffer(),
  '.png': buf => sharp(buf).png({ compressionLevel: 9, effort: 10, palette: true }).toBuffer(),
  '.svg': buf => Buffer.from(svgoOptimize(buf.toString('utf8'), { plugins: [{ name: 'preset-default' }] }).data, 'utf8')
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
 * Обробити один файл. Cache hit → пропуск. Інакше — стиснути і (у `--write`) перезаписати,
 * якщо економія > 15%. Cache mutates у місці; результат описує внесок у `stats`.
 * @param {string} imagePath — абсолютний шлях.
 * @param {Map<string, { size: number, mtime: number, originalSize: number }> | null} cache — null у estimate-режимі.
 * @returns {Promise<{ orig: number, compressed: number }>} вклад файлу в підсумок.
 */
const processOne = async (imagePath, cache) => {
  const ext = extname(imagePath).toLowerCase()
  const compressor = compressors[ext]
  if (!compressor) return { compressed: 0, orig: 0 }

  const relPath = cache ? relative(srcAbs, imagePath) : null

  if (cache) {
    const stat = statSync(imagePath)
    const cached = cache.get(relPath)
    if (cached && cached.size === stat.size && cached.mtime === stat.mtimeMs) {
      consola.info(`${imagePath} already compressed (size+mtime match)`)
      return { compressed: 0, orig: stat.size }
    }
  }

  const image = readFileSync(imagePath)
  const compressedImage = await compressBuffer(image, compressor, imagePath)
  if (!compressedImage) return { compressed: 0, orig: image.length }

  consola.info(
    `${imagePath} original size: ${prettyBytes(image.length)}, ` +
      `compressed size: ${prettyBytes(compressedImage.length)}`
  )

  const result = { compressed: 0, orig: image.length }

  if (cache) {
    if (compressedImage.length * 1.15 < image.length) {
      writeFileSync(imagePath, compressedImage)
      consola.debug(`${imagePath} compressed`)
      result.compressed = image.length - compressedImage.length
    }
    // Re-stat ПІСЛЯ можливого writeFileSync — щоб у cache потрапили нові size/mtime
    const stat = statSync(imagePath)
    const existing = cache.get(relPath)
    cache.set(relPath, {
      mtime: stat.mtimeMs,
      originalSize: existing?.originalSize ?? image.length,
      size: stat.size
    })
  } else {
    // estimate-режим: рахуємо raw-дельту (може бути від'ємною)
    result.compressed = image.length - compressedImage.length
  }

  return result
}

const cache = options.write ? loadCache() : null
const limit = pLimit(availableParallelism())

const allImages = await glob(['**/*.{png,jpg,jpeg,gif,svg}'], globOptions)
const results = await Promise.all(allImages.map(imagePath => limit(() => processOne(imagePath, cache))))
const stats = { compressed: 0, orig: 0 }
for (const r of results) {
  stats.orig += r.orig
  stats.compressed += r.compressed
}

if (cache) saveCache(cache)

consola.info(`All image size: ${prettyBytes(stats.orig)}`)
if (options.write) {
  consola.info(
    `Images optimized, saving: ${prettyBytes(stats.compressed)}, ${calcPercent(stats.compressed, stats.orig)}%`
  )
} else {
  consola.info(`Estimated saving: ${prettyBytes(stats.compressed)}, ${calcPercent(stats.compressed, stats.orig)}%`)
}

if (cache && cache.size > 0) {
  let totalOriginal = 0
  let totalCurrent = 0
  for (const [, entry] of cache) {
    totalOriginal += entry.originalSize
    totalCurrent += entry.size
  }
  const projectSaving = totalOriginal - totalCurrent
  consola.info(
    `Project lifetime savings: ${prettyBytes(projectSaving)} ` +
      `(${calcPercent(projectSaving, totalOriginal)}% across ${cache.size} files)`
  )
}

consola.info('END MINIFY IMAGES')
