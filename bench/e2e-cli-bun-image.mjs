// Форк npm/src/index.js — той самий CLI, але PNG/JPEG/AVIF через Bun.Image
// замість sharp. GIF лишається sharp (Bun.Image не має GIF encoder), SVG — svgo.
// Призначений ВИКЛЮЧНО для e2e-замірів; не для production.
import calcPercent from 'calc-percent'
import { consola } from 'consola'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { extname, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import pLimit from 'p-limit'
import prettyBytes from 'pretty-bytes'
import sharp from 'sharp'
import { optimize as svgoOptimize } from 'svgo'
import { glob } from 'tinyglobby'
import { hashBuffer, loadHashCache, loadMtimeCache, saveHashCache, saveMtimeCache } from '../npm/src/cache.js'

sharp.cache(false)
sharp.concurrency(1)

consola.info('START MINIFY IMAGES (Bun.Image fork)')

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    avif: { default: false, type: 'boolean' },
    ignore: { multiple: true, type: 'string' },
    src: { default: '.', type: 'string' },
    write: { default: false, type: 'boolean' }
  }
})

const options = {
  avif: values.avif,
  ignore: values.ignore ?? [],
  src: values.src === '.' && positionals[0] ? positionals[0] : values.src,
  write: values.write
}
consola.info(options)

const srcAbs = resolve(options.src)

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

// Bun.Image compressors (паритет з npm/src/index.js де можливо).
// GIF через sharp — Bun.Image не має GIF encoder.
// SVG через svgo — кодек тут ні до чого.
const compressors = {
  '.gif': buf => sharp(buf, { animated: true }).gif({ effort: 10 }).toBuffer(),
  '.jpeg': async buf => Buffer.from(await new Bun.Image(buf).jpeg({ progressive: true, quality: 75 }).bytes()),
  '.jpg': async buf => Buffer.from(await new Bun.Image(buf).jpeg({ progressive: true, quality: 75 }).bytes()),
  '.png': async buf => Buffer.from(await new Bun.Image(buf).png({ compressionLevel: 9, palette: true }).bytes()),
  '.svg': buf => {
    const text = buf.toString('utf8')
    const optimized = svgoOptimize(text, {}).data
    return Buffer.from(optimized, 'utf8')
  }
}

const AVIF_SOURCE_EXTS = new Set(['.gif', '.jpeg', '.jpg', '.png'])

const writeAvif = async (image, avifPath, imagePath) => {
  try {
    const buf = Buffer.from(await new Bun.Image(image).avif({ quality: 40 }).bytes())
    writeFileSync(avifPath, buf)
    consola.info(`${imagePath} → ${avifPath} avif size: ${prettyBytes(buf.length)}`)
  } catch {
    consola.error('skip avif (error): ', imagePath)
  }
}

const compressBuffer = async (image, compressor, imagePath) => {
  try {
    return await compressor(image)
  } catch {
    consola.error('skip minify (error): ', imagePath)
    return null
  }
}

const tryCacheHit = async (imagePath, relPath, mtimeCache, hashCache, avifPath) => {
  const stat = statSync(imagePath)
  const mtimeEntry = mtimeCache.get(relPath)
  if (mtimeEntry && mtimeEntry.size === stat.size && mtimeEntry.mtime === stat.mtimeMs) {
    if (avifPath && !existsSync(avifPath)) await writeAvif(readFileSync(imagePath), avifPath, imagePath)
    return { compressed: 0, orig: stat.size }
  }
  const hashEntry = hashCache.get(relPath)
  if (!hashEntry || !hashEntry.hash || hashEntry.size !== stat.size) return null
  const buf = readFileSync(imagePath)
  if (hashBuffer(buf) !== hashEntry.hash) return null
  mtimeCache.set(relPath, { mtime: stat.mtimeMs, size: stat.size })
  if (avifPath && !existsSync(avifPath)) await writeAvif(buf, avifPath, imagePath)
  return { compressed: 0, orig: stat.size }
}

const processOne = async (imagePath, mtimeCache, hashCache) => {
  const ext = extname(imagePath).toLowerCase()
  const compressor = compressors[ext]
  if (!compressor) return { compressed: 0, orig: 0 }
  const usingCache = Boolean(mtimeCache && hashCache)
  const relPath = usingCache ? relative(srcAbs, imagePath) : null
  const avifPath = options.avif && usingCache && AVIF_SOURCE_EXTS.has(ext) ? `${imagePath}.avif` : null

  if (usingCache) {
    const hit = await tryCacheHit(imagePath, relPath, mtimeCache, hashCache, avifPath)
    if (hit) return hit
  }

  const image = readFileSync(imagePath)
  if (avifPath) await writeAvif(image, avifPath, imagePath)

  const compressedImage = await compressBuffer(image, compressor, imagePath)
  if (!compressedImage) return { compressed: 0, orig: image.length }

  if (!usingCache) return { compressed: image.length - compressedImage.length, orig: image.length }

  let compressedDelta = 0
  let onDiskBytes = image
  if (compressedImage.length * 1.15 < image.length) {
    writeFileSync(imagePath, compressedImage)
    compressedDelta = image.length - compressedImage.length
    onDiskBytes = compressedImage
  }
  const stat = statSync(imagePath)
  const existingOriginal = hashCache.get(relPath)?.originalSize ?? image.length
  mtimeCache.set(relPath, { mtime: stat.mtimeMs, size: stat.size })
  hashCache.set(relPath, { hash: hashBuffer(onDiskBytes), originalSize: existingOriginal, size: stat.size })
  return { compressed: compressedDelta, orig: image.length }
}

const mtimeCache = options.write ? loadMtimeCache(srcAbs) : null
const hashCache = options.write ? loadHashCache(srcAbs) : null
const limit = pLimit(availableParallelism())

const allImages = await glob(['**/*.{png,jpg,jpeg,gif,svg}'], globOptions)
const results = await Promise.all(allImages.map(p => limit(() => processOne(p, mtimeCache, hashCache))))
const stats = { compressed: 0, orig: 0 }
for (const r of results) {
  stats.orig += r.orig
  stats.compressed += r.compressed
}
if (mtimeCache) saveMtimeCache(srcAbs, mtimeCache)
if (hashCache) saveHashCache(srcAbs, hashCache)

const savedPercent = stats.orig > 0 ? calcPercent(stats.compressed, stats.orig) : 0
consola.info(`All image size: ${prettyBytes(stats.orig)}`)
consola.info(
  options.write
    ? `Images optimized, saving: ${prettyBytes(stats.compressed)}, ${savedPercent}%`
    : `Estimated saving: ${prettyBytes(stats.compressed)}, ${savedPercent}%`
)
consola.info('END MINIFY IMAGES (Bun.Image fork)')
