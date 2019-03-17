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
const fs = require('fs')
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

  let totalSaving = 0

  // Find all PNGs
  const pngImages = await fg([`${options.src}/**/*.png`], { case: false, ignore: ['**/node_modules/**'] })
  // Compress all PNGs
  totalSaving = await compress([imageminPngquant({ strip: true }), imageminZopfli({ more: true })], pngImages, options)

  // Find all JPEGs
  const jpegImages = await fg([`${options.src}/**/*.(jpg|jpeg)`], { case: false, ignore: ['**/node_modules/**'] })
  // Compress all JPEGs
  totalSaving += await compress([imageminMozjpeg()], jpegImages, options)

  // Find all GIFs
  const gifImages = await fg([`${options.src}/**/*.gif`], { case: false, ignore: ['**/node_modules/**'] })
  // Compress all GIFs
  totalSaving += await compress([imageminGifsicle()], gifImages, options)

  // Find all SVGs
  const svgImages = await fg([`${options.src}/**/*.svg`], { case: false, ignore: ['**/node_modules/**'] })
  // Compress all SVGs
  totalSaving += await compress(
    [
      imageminSvgo({
        plugins: [{ removeViewBox: false }]
      })
    ],
    svgImages,
    options
  )

  const totalSavingString = `${Math.ceil(totalSaving / 1000)} Kb`
  if (options.write) {
    log.info(`Images optimized, saving: ${totalSavingString}`)
  } else {
    log.info(`Estimated saving: ${totalSavingString}`)
  }

  return 'success'
}

async function compress(imageminPlugins: any[], images: string[], options: IOption) {
  let totalSaving = 0

  for (const imagePath of images) {
    // read image
    const image = fs.readFileSync(imagePath)

    // compress PNG image
    const compressedImage = await imagemin.buffer(image, {
      plugins: imageminPlugins
    })

    log.info(`${imagePath} original size: ${image.length}, compressed size: ${compressedImage.length}`)

    // if result + 15% < original
    if (options.write && compressedImage.length * 1.15 < image.length) {
      fs.writeFileSync(imagePath, compressedImage)
      log.debug(`${imagePath} compressed`)

      totalSaving += image.length - compressedImage.length
    } else if (!options.write) {
      totalSaving += image.length - compressedImage.length
    }
  }

  return totalSaving
}
