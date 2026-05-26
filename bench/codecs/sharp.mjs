// Adapter навколо sharp. Параметри дзеркалять npm/src/index.js compressors:
//   PNG: compressionLevel:9, effort:10, palette:true
//   JPEG: mozjpeg:true, progressive:true
//   AVIF: quality:40
//   WebP: quality:80 (у CLI не використовується, лише для довідки)
// Кеш вимкнено (як у CLI — batch-mode без LRU); concurrency:1 (p-limit назовні).
import sharp from 'sharp'

sharp.cache(false)
sharp.concurrency(1)

const encoders = {
  avif: buf => sharp(buf).avif({ quality: 40 }).toBuffer(),
  jpeg: buf => sharp(buf).jpeg({ mozjpeg: true, progressive: true }).toBuffer(),
  png: buf => sharp(buf).png({ compressionLevel: 9, effort: 10, palette: true }).toBuffer(),
  webp: buf => sharp(buf).webp({ quality: 80 }).toBuffer()
}

export const sharpAdapter = {
  name: 'sharp',
  async encode(buf, format) {
    const encoder = encoders[format]
    if (!encoder) throw new Error(`sharp adapter: unsupported format "${format}"`)
    const out = await encoder(buf)
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
  }
}
