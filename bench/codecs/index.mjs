// Реєстр adapter-ів для benchmark-runner-а.
// `sharp` / `bun-image` — tuned (параметри з npm/src/index.js).
// `sharp-default` / `bun-image-default` — без extras (no palette, no progressive,
// no mozjpeg, no effort). Третя/четверта колонка у звіті: «що ми втрачаємо без екстра-опцій».
import sharp from 'sharp'
import { bunImageAdapter } from './bun-image.mjs'
import { sharpAdapter } from './sharp.mjs'

sharp.cache(false)
sharp.concurrency(1)

const sharpDefaultEncoders = {
  avif: buf => sharp(buf).avif({ quality: 40 }).toBuffer(),
  jpeg: buf => sharp(buf).jpeg({ quality: 75 }).toBuffer(),
  png: buf => sharp(buf).png().toBuffer(),
  webp: buf => sharp(buf).webp({ quality: 80 }).toBuffer()
}

const bunImageDefaultEncoders = {
  avif: buf => new Bun.Image(buf).avif({ quality: 40 }).bytes(),
  jpeg: buf => new Bun.Image(buf).jpeg({ quality: 75 }).bytes(),
  png: buf => new Bun.Image(buf).png().bytes(),
  webp: buf => new Bun.Image(buf).webp({ quality: 80 }).bytes()
}

const makeDefault = (name, encoders) => ({
  name,
  async encode(buf, format) {
    const encoder = encoders[format]
    if (!encoder) throw new Error(`${name}: unsupported format "${format}"`)
    const out = await encoder(buf)
    return out instanceof Uint8Array ? out : new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
  }
})

export const adapters = [
  sharpAdapter,
  bunImageAdapter,
  makeDefault('sharp-default', sharpDefaultEncoders),
  makeDefault('bun-image-default', bunImageDefaultEncoders)
]

export const FORMATS = ['png', 'jpeg', 'avif', 'webp']
