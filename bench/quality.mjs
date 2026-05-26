// SSIM via ssim.js (pure JS, npm). DSSIM via Kornelski's dssim CLI (optional).
// Decode: sharp.raw() → RGBA (нейтральний відносно sharp-vs-bun-image кодерів).
// Якщо `dssim` не в PATH — computeDSSIM повертає null (caller робить fallback).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import ssimModule from 'ssim.js'

// ssim.js експортує named `ssim` і default — обережно з ESM-interop.
const ssimFn = ssimModule.ssim ?? ssimModule.default ?? ssimModule

sharp.cache(false)

const WHITESPACE_RE = /\s+/

/**
 * Декодує encoded image buffer у RGBA через sharp (нейтральний декодер).
 * @param {Uint8Array | Buffer} buf - вхідний закодований буфер (будь-який формат, який розуміє sharp)
 * @returns {Promise<{ data: Uint8Array, width: number, height: number }>} RGBA-буфер з розмірами
 */
export const decodeToRGBA = async buf => {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return {
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    height: info.height,
    width: info.width
  }
}

/**
 * Mean SSIM ∈ [0..1]. 1.0 — ідентичність.
 * @param {Uint8Array | Buffer} a - оригінальний буфер
 * @param {Uint8Array | Buffer} b - стиснутий буфер для порівняння
 * @returns {Promise<number>} середнє SSIM по всьому зображенню
 */
export const computeSSIM = async (a, b) => {
  const [ia, ib] = await Promise.all([decodeToRGBA(a), decodeToRGBA(b)])
  if (ia.width !== ib.width || ia.height !== ib.height) {
    throw new Error(`SSIM: dimension mismatch ${ia.width}x${ia.height} vs ${ib.width}x${ib.height}`)
  }
  const { mssim } = ssimFn(
    { data: ia.data, height: ia.height, width: ia.width },
    { data: ib.data, height: ib.height, width: ib.width }
  )
  return mssim
}

let dssimAvailable = null

const detectDssim = () => {
  if (dssimAvailable !== null) return dssimAvailable
  // dssim 3.4.0 не підтримує --version/--help для exit-code probing
  // (виходить з non-zero на будь-який unknown flag). Тому перевіряємо
  // наявність бінарки у PATH через Bun.which.
  dssimAvailable = Bun.which('dssim') !== null
  return dssimAvailable
}

/**
 * DSSIM (нижче — краще; 0 — ідентичність). Викликає `dssim a.png b.png`.
 * Якщо бінарка відсутня — повертає null (caller skip колонки).
 * @param {Uint8Array | Buffer} a - оригінальний буфер (будь-який формат)
 * @param {Uint8Array | Buffer} b - стиснутий буфер для порівняння
 * @returns {Promise<number | null>} DSSIM score або null якщо dssim CLI відсутній
 */
export const computeDSSIM = async (a, b) => {
  if (!detectDssim()) return null
  const dir = mkdtempSync(join(tmpdir(), 'dssim-'))
  const aPath = join(dir, 'a.png')
  const bPath = join(dir, 'b.png')
  try {
    // dssim хоче PNG; конвертуємо обидва входи у PNG через sharp.
    const aPng = await sharp(a).png().toBuffer()
    const bPng = await sharp(b).png().toBuffer()
    writeFileSync(aPath, aPng)
    writeFileSync(bPath, bPng)
    const proc = Bun.spawn(['dssim', aPath, bPath], { stderr: 'pipe', stdout: 'pipe' })
    const stdout = await new Response(proc.stdout).text()
    await proc.exited
    if (proc.exitCode !== 0) return null
    // dssim stdout format: "<score>\t<file>" — беремо перший токен першого рядка
    const firstLine = stdout.split('\n')[0]?.trim()
    if (!firstLine) return null
    const score = Number(firstLine.split(WHITESPACE_RE)[0])
    return Number.isFinite(score) ? score : null
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}
