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

const optionDefinitions = [
  { name: 'write', type: Boolean, defaultValue: false },
  { name: 'src', type: String, defaultValue: 'src' },
  { name: 'verbose', alias: 'v', type: Boolean, defaultValue: false }
]

exports.run = async (args: string[]) => {
  const options = commandLineArgs(optionDefinitions, {
    argv: args
  })

  log.debug(options)

  let totalSaving = 0

  // Find all PNGs
  const pngImages = await fg([`${options.src}/**/*.png`], { case: false })
  // Compress all PNGs
  totalSaving = await compress(
    [imageminPngquant({ strip: true, verbose: options.verbose }), imageminZopfli({ more: true })],
    pngImages,
    options
  )

  // Find all JPEGs
  const jpegImages = await fg([`${options.src}/**/*.(jpg|jpeg)`], { case: false })
  // Compress all JPEGs
  totalSaving += await compress([imageminMozjpeg()], jpegImages, options)

  // Find all GIFs
  const gifImages = await fg([`${options.src}/**/*.gif`], { case: false })
  // Compress all GIFs
  totalSaving += await compress([imageminGifsicle()], gifImages, options)

  // Find all SVGs
  const svgImages = await fg([`${options.src}/**/*.svg`], { case: false })
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

async function compress(imageminPlugins: any, images: [], options: any) {
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
