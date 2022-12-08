#!/usr/bin/env node

import consola from 'consola'
import fg from 'fast-glob'
import imagemin from 'imagemin'
import imageminZopfli from 'imagemin-zopfli'
import imageminPngquant from 'imagemin-pngquant'
import imageminMozjpeg from 'imagemin-mozjpeg'
import imageminJpegtran from 'imagemin-jpegtran'
import imageminGifsicle from 'imagemin-gifsicle'
import imageminSvgo from 'imagemin-svgo'
import flatCache from 'flat-cache'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { exit } from 'node:process'
import prettyBytes from 'pretty-bytes'
import calcPercent from 'calc-percent'
import commandLineArgs from 'command-line-args'
import commandLineUsage from 'command-line-usage'

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

const globOptions = {
  case: false,
  ignore: ['**/node_modules/**', '**/vendor/**']
}

const options = commandLineArgs(optionDefinitions)

if (options.help || !options.src) {
  const usage = commandLineUsage(sections)
  consola.info(usage)
  exit()
}
consola.info(options)

let totalSaving
let orig = 0
let compressed = 0

// Find all PNGs
const pngImages = await fg([`${options.src}/**/*.png`], globOptions)
// Compress all PNGs
totalSaving = await compress([imageminPngquant({ strip: true }), imageminZopfli({ more: true })], pngImages, options)
orig = totalSaving.orig
compressed = totalSaving.compressed

// Find all JPEGs
const jpegImages = await fg([`${options.src}/**/*.(jpg|jpeg)`], globOptions)
// Compress all JPEGs
totalSaving = await compress([imageminMozjpeg()], jpegImages, options)
orig += totalSaving.orig
compressed += totalSaving.compressed

// Find all JPEGs (second chance with jpegoptim)
const jpegImages2 = await fg([`${options.src}/**/*.(jpg|jpeg)`], globOptions)
// Compress all JPEGs
totalSaving = await compress([imageminJpegtran()], jpegImages2, options)
orig += totalSaving.orig
compressed += totalSaving.compressed

// Find all GIFs
const gifImages = await fg([`${options.src}/**/*.gif`], globOptions)
// Compress all GIFs
totalSaving = await compress([imageminGifsicle()], gifImages, options)
orig += totalSaving.orig
compressed += totalSaving.compressed

// Find all SVGs
const svgImages = await fg([`${options.src}/**/*.svg`], globOptions)
// Compress all SVGs
totalSaving = await compress(
  [
    imageminSvgo({
      plugins: [
        {
          name: 'preset-default'
        }
      ]
    })
  ],
  svgImages,
  options
)
orig += totalSaving.orig
compressed += totalSaving.compressed

consola.info(`All image size: ${prettyBytes(orig)}`)
if (options.write) {
  consola.info(`Images optimized, saving: ${prettyBytes(compressed)}, ${calcPercent(compressed, orig)}%`)
} else {
  consola.info(`Estimated saving: ${prettyBytes(compressed)}, ${calcPercent(compressed, orig)}%`)
}

async function compress(imageminPlugins, images, options) {
  const totalSaving = {
    compressed: 0,
    orig: 0
  }
  // loads the cache, if one does not exists for the given
  // Id a new one will be prepared to be created
  let cache
  if (options.write) {
    cache = flatCache.load('minify-image')
  }

  for (const imagePath of images) {
    // read image
    const image = readFileSync(imagePath)
    totalSaving.orig += image.length

    if (options.write) {
      const hashKey = createHash('sha1').update(image).digest('base64')

      if (cache.getKey(hashKey)) {
        consola.info(`${imagePath} already compressed, hash: ${hashKey}`)
        continue
      }
    }

    let compressedImage
    // compress PNG image
    try {
      compressedImage = await imagemin.buffer(image, {
        plugins: imageminPlugins
      })
    } catch (e) {
      consola.error('skip minify (error): ', imagePath)
      continue
    }

    consola.info(
      `${imagePath} original size: ${prettyBytes(image.length)}, compressed size: ${prettyBytes(
        compressedImage.length
      )}`
    )

    if (options.write) {
      let hashKey

      // if result + 15% < original
      if (compressedImage.length * 1.15 < image.length) {
        writeFileSync(imagePath, compressedImage)

        // hash of compressed image for future ignore
        hashKey = createHash('sha1').update(compressedImage).digest('base64')

        consola.debug(`${imagePath} compressed, ${hashKey} hash`)

        totalSaving.compressed += image.length - compressedImage.length
      } else {
        // hash of original image for future ignore
        hashKey = createHash('sha1').update(image).digest('base64')
      }

      cache.setKey(hashKey, 1)
    } else {
      totalSaving.compressed += image.length - compressedImage.length
    }
  }

  if (options.write) {
    consola.debug(`save cache to disk`)
    cache.save(true)
  }

  return totalSaving
}

consola.info('END MINIFY IMAGES')
