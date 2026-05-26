// Adapter навколо Bun.Image (Bun 1.3.14+). Параметри максимально близькі до sharp:
//   PNG: compressionLevel:9, palette:true (effort ігнорується silently)
//   JPEG: quality:75, progressive:true (mozjpeg ігнорується silently)
//   AVIF: quality:40
//   WebP: quality:80
// `Bun.Image.backend` платформо-залежний (macOS → ImageIO, Linux → інший);
// фіксуємо у звіті як частину середовища.

const encoders = {
  avif: buf => new Bun.Image(buf).avif({ quality: 40 }).bytes(),
  jpeg: buf => new Bun.Image(buf).jpeg({ progressive: true, quality: 75 }).bytes(),
  png: buf => new Bun.Image(buf).png({ compressionLevel: 9, palette: true }).bytes(),
  webp: buf => new Bun.Image(buf).webp({ quality: 80 }).bytes()
}

export const bunImageAdapter = {
  name: 'bun-image',
  async encode(buf, format) {
    const encoder = encoders[format]
    if (!encoder) throw new Error(`bun-image adapter: unsupported format "${format}"`)
    return await encoder(buf)
  }
}
