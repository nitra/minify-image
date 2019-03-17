const getLogger = require('loglevel-colored-level-prefix')
const log = getLogger()
log.debug('START in DEBUG MODE')

const fg = require('fast-glob')
const imagemin = require('imagemin')
const imageminZopfli = require('imagemin-zopfli')
const imageminPngquant = require('imagemin-pngquant')
const imageminMozjpeg = require('imagemin-mozjpeg')
const imageminGifsicle = require('imagemin-gifsicle')
const imageminSvgo = require('imagemin-svgo')
const flatCache = require('flat-cache')
const fs = require('fs')
const { createHash } = require('crypto')
const prettyBytes = require('pretty-bytes')
const calcPercent = require('calc-percent')
const commandLineArgs = require('command-line-args')
const commandLineUsage = require('command-line-usage')
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

interface IOption {
  write: boolean
  src: string
  help: boolean
}

interface ISaving {
  orig: number
  compressed: number
}

const globOptions = {
  case: false,
  ignore: ['**/node_modules/**', '**/vendor/**']
}

exports.run = async (args: string[]) => {
  let options: IOption
  try {
    options = commandLineArgs(optionDefinitions, {
      argv: args
    })
  } catch (err) {
    const usage = commandLineUsage(sections)
    log.info(usage)
    return
  }

  log.debug(options)

  if (options.help || !options.src) {
    const usage = commandLineUsage(sections)
    log.info(usage)
    return
  }

  let totalSaving: ISaving
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
        plugins: [{ removeViewBox: false }]
      })
    ],
    svgImages,
    options
  )
  orig += totalSaving.orig
  compressed += totalSaving.compressed

  log.info(`All image size: ${prettyBytes(orig)}`)
  if (options.write) {
    log.info(`Images optimized, saving: ${prettyBytes(compressed)}, ${calcPercent(compressed, orig)}%`)
  } else {
    log.info(`Estimated saving: ${prettyBytes(compressed)}, ${calcPercent(compressed, orig)}%`)
  }

  return 'success'
}

async function compress(imageminPlugins: any[], images: string[], options: IOption): Promise<ISaving> {
  const totalSaving: ISaving = {
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
    const image = fs.readFileSync(imagePath)
    totalSaving.orig += image.length

    if (options.write) {
      const hashKey = createHash('sha1')
        .update(image)
        .digest('base64')

      if (cache.getKey(hashKey)) {
        log.info(`${imagePath} allready compressed, hash: ${hashKey}`)
        continue
      }
    }

    // compress PNG image
    const compressedImage = await imagemin.buffer(image, {
      plugins: imageminPlugins
    })

    log.info(
      `${imagePath} original size: ${prettyBytes(image.length)}, compressed size: ${prettyBytes(
        compressedImage.length
      )}`
    )

    // if result + 15% < original
    if (options.write && compressedImage.length * 1.15 < image.length) {
      fs.writeFileSync(imagePath, compressedImage)
      log.debug(`${imagePath} compressed`)

      // sets a key on the cache
      const hashKeyCompressed = createHash('sha1')
        .update(compressedImage)
        .digest('base64')
      log.debug(`${hashKeyCompressed} hash`)
      cache.setKey(hashKeyCompressed, 1)

      totalSaving.compressed += image.length - compressedImage.length
    } else if (!options.write) {
      totalSaving.compressed += image.length - compressedImage.length
    }
  }

  if (options.write) {
    log.debug(`save cache to disk`)
    cache.save(true)
  }

  return totalSaving
}
