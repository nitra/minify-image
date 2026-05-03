#!/usr/bin/env node

import calcPercent from 'calc-percent'
import commandLineArgs from 'command-line-args'
import commandLineUsage from 'command-line-usage'
import consola from 'consola'
import imagemin from 'imagemin'
import imageminGifsicle from 'imagemin-gifsicle'
import imageminJpegtran from 'imagemin-jpegtran'
import imageminMozjpeg from 'imagemin-mozjpeg'
import imageminPngquant from 'imagemin-pngquant'
import imageminSvgo from 'imagemin-svgo'
import imageminZopfli from 'imagemin-zopfli'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { exit } from 'node:process'
import prettyBytes from 'pretty-bytes'
import { glob } from 'tinyglobby'

consola.info('START MINIFY IMAGES')

const sections = [
  {
    content: 'Minify if compressed size lower than 15%',
    header: 'Minify images (PNG, JPEG, GIF, SVG)'
  },
  {
    header: 'Options',
    optionList: [
      {
        description: 'If not set, only estimate size difference',
        name: 'write',
        type: Boolean
      },
      {
        defaultOption: true,
        description: 'The directory to process.',
        name: 'src',
        type: String,
        typeLabel: '={underline directory}'
      },
      {
        alias: 'h',
        description: 'Print this usage guide.',
        name: 'help',
        type: Boolean
      }
    ]
  }
]

const optionDefinitions = [
  { name: 'write', type: Boolean, defaultValue: false },
  { name: 'src', type: String, defaultValue: '.' },
  { name: 'help', alias: 'h', type: Boolean, defaultValue: false }
]

const options = commandLineArgs(optionDefinitions)

if (options.help || !options.src) {
  const usage = commandLineUsage(sections)
  consola.info(usage)
  exit()
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
 * Колонки `originalSize` і `size` стоять поряд — легко порівнювати в редакторі.
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

/**
 * Comparator для сортування `[path, value]`-кортежів за ключем.
 * @param {[string, unknown]} a — перший кортеж.
 * @param {[string, unknown]} b — другий кортеж.
 * @returns {number} -1/0/1 — стандартний результат для Array.prototype.sort.
 */
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

/**
 * Запустити imagemin над буфером, повертає новий буфер або `null` при помилці.
 * @param {Buffer} image — вхідний буфер.
 * @param {Array<unknown>} imageminPlugins — список плагінів imagemin.
 * @param {string} imagePath — шлях (для логів).
 * @returns {Promise<Buffer | null>} стиснений буфер або `null`.
 */
const compressBuffer = async (image, imageminPlugins, imagePath) => {
  try {
    return await imagemin.buffer(image, { plugins: imageminPlugins })
  } catch {
    consola.error('skip minify (error): ', imagePath)
    return null
  }
}

/**
 * Записати стиснене зображення на диск, якщо економія перевищує 15%.
 * Оновлює `totalSaving.compressed`.
 * @param {string} imagePath — шлях до файлу.
 * @param {Buffer} image — вхідний буфер.
 * @param {Buffer} compressedImage — стиснений буфер.
 * @param {{ compressed: number }} totalSaving — акумулятор економії.
 */
const persistIfBetter = (imagePath, image, compressedImage, totalSaving) => {
  if (compressedImage.length * 1.15 < image.length) {
    writeFileSync(imagePath, compressedImage)
    consola.debug(`${imagePath} compressed`)
    totalSaving.compressed += image.length - compressedImage.length
  }
}

/**
 * Стиснути набір зображень одним набором imagemin-плагінів.
 * На cache hit файл не читається — тільки один `statSync` на файл.
 * Оригінальний розмір (до першої компресії) зберігається в cache і
 * переноситься між стадіями (наприклад, JPEG проходить mozjpeg → jpegtran).
 * @param {Array<unknown>} imageminPlugins — плагіни imagemin.
 * @param {string[]} images — список абсолютних шляхів.
 * @param {Map<string, { size: number, mtime: number, originalSize: number }> | null} cache — null у estimate-режимі.
 * @returns {Promise<{ orig: number, compressed: number }>} підсумок розмірів.
 */
async function compress(imageminPlugins, images, cache) {
  const totalSaving = { compressed: 0, orig: 0 }

  for (const imagePath of images) {
    const relPath = cache ? relative(srcAbs, imagePath) : null

    if (cache) {
      const stat = statSync(imagePath)
      const cached = cache.get(relPath)
      if (cached && cached.size === stat.size && cached.mtime === stat.mtimeMs) {
        consola.info(`${imagePath} already compressed (size+mtime match)`)
        totalSaving.orig += stat.size
        continue
      }
    }

    const image = readFileSync(imagePath)
    totalSaving.orig += image.length

    const compressedImage = await compressBuffer(image, imageminPlugins, imagePath)
    if (!compressedImage) continue

    consola.info(
      `${imagePath} original size: ${prettyBytes(image.length)}, ` +
        `compressed size: ${prettyBytes(compressedImage.length)}`
    )

    if (cache) {
      persistIfBetter(imagePath, image, compressedImage, totalSaving)
      // Re-stat ПІСЛЯ можливого writeFileSync — щоб у cache потрапили нові size/mtime
      const stat = statSync(imagePath)
      // На наступній стадії pipeline (jpegtran після mozjpeg) запис уже існує —
      // зберігаємо найперший originalSize, не переписуємо post-mozjpeg розміром
      const existing = cache.get(relPath)
      cache.set(relPath, {
        mtime: stat.mtimeMs,
        originalSize: existing?.originalSize ?? image.length,
        size: stat.size
      })
    } else {
      totalSaving.compressed += image.length - compressedImage.length
    }
  }

  return totalSaving
}

const stats = { compressed: 0, orig: 0 }
const cache = options.write ? loadCache() : null
let totalSaving

const pngImages = await glob(['**/*.png'], globOptions)
totalSaving = await compress([imageminPngquant({ strip: true }), imageminZopfli({ more: true })], pngImages, cache)
stats.orig += totalSaving.orig
stats.compressed += totalSaving.compressed

const jpegImages = await glob(['**/*.{jpg,jpeg}'], globOptions)
totalSaving = await compress([imageminMozjpeg()], jpegImages, cache)
stats.orig += totalSaving.orig
stats.compressed += totalSaving.compressed

const jpegImages2 = await glob(['**/*.{jpg,jpeg}'], globOptions)
totalSaving = await compress([imageminJpegtran()], jpegImages2, cache)
stats.orig += totalSaving.orig
stats.compressed += totalSaving.compressed

const gifImages = await glob(['**/*.gif'], globOptions)
totalSaving = await compress([imageminGifsicle()], gifImages, cache)
stats.orig += totalSaving.orig
stats.compressed += totalSaving.compressed

const svgImages = await glob(['**/*.svg'], globOptions)
totalSaving = await compress([imageminSvgo({ plugins: [{ name: 'preset-default' }] })], svgImages, cache)
stats.orig += totalSaving.orig
stats.compressed += totalSaving.compressed

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
