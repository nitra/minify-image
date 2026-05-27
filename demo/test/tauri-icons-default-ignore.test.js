import { test, expect } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// eslint-disable-next-line n/no-unpublished-import -- demo не публікується; sharp у devDependencies для генерації тестових PNG
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const cli = join(here, '..', '..', 'npm', 'src', 'index.js')

/**
 * Запускає CLI як підпроцес і повертає `{ exitCode }`. stdout/stderr тут не
 * перевіряємо — `bun:test` всередині `Bun.spawn` не передає вивід підпроцесу,
 * тому розв'язка йде через стан файлів на диску.
 * @param {string[]} args — аргументи після шляху до index.js.
 * @param {string} cwd — робоча директорія для процесу.
 * @returns {Promise<{ exitCode: number }>} код виходу підпроцесу CLI.
 */
const runCli = async (args, cwd) => {
  const proc = Bun.spawn(['bun', cli, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const exitCode = await proc.exited
  return { exitCode }
}

/**
 * RGBA-PNG 256×256 з градієнтом — truecolor+alpha (color type 6) і досить
 * великий, щоб `palette: true` стискав >15% (поріг перезапису). Це робить
 * color-type після прогону прямим індикатором: 6 = ignored, 3 = processed
 * з квантизацією.
 * @returns {Promise<Buffer>} PNG-байти 256×256 RGBA.
 */
const rgbaPng = () => {
  const size = 256
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      pixels[i] = (x % 16) * 16
      pixels[i + 1] = (y % 16) * 16
      pixels[i + 2] = ((x + y) % 16) * 16
      pixels[i + 3] = 200
    }
  }
  return sharp(pixels, { raw: { channels: 4, height: size, width: size } })
    .png()
    .toBuffer()
}

/**
 * Зчитати PNG color type byte (IHDR offset 25).
 * 0=greyscale, 2=truecolor RGB, 3=indexed/palette, 4=greyscale+alpha, 6=truecolor+alpha (RGBA).
 * @param {string} path — абсолютний шлях до PNG.
 * @returns {number} значення байта color-type (0/2/3/4/6).
 */
const pngColorType = path => readFileSync(path)[25]

test('Tauri default-ignore: src-tauri/icons/**/*.png не чіпається без додаткових прапорців', async () => {
  const root = mkdtempSync(join(tmpdir(), 'minify-image-tauri-'))
  try {
    mkdirSync(join(root, 'src-tauri', 'icons'), { recursive: true })
    const target = join(root, 'src-tauri', 'icons', '32x32.png')
    writeFileSync(target, await rgbaPng())
    const before = readFileSync(target)

    const { exitCode } = await runCli([`--src=${root}`, '--write'], root)
    expect(exitCode).toBe(0)

    const after = readFileSync(target)
    expect(after.equals(before)).toBe(true)
    // 256×256 RGBA-градієнт стискається з palette на ~39% (>15% поріг),
    // тож якби файл не був ігнорований — color-type став би 3 (indexed).
    // 6 (RGBA) лишається лише коли default-ignore відсік файл повністю.
    expect(pngColorType(target)).toBe(6)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}, 60_000)

test('Tauri default-ignore: --avif не пише .avif для src-tauri/icons (друга лінія оборони)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'minify-image-tauri-avif-'))
  try {
    mkdirSync(join(root, 'src-tauri', 'icons'), { recursive: true })
    const target = join(root, 'src-tauri', 'icons', '128x128.png')
    writeFileSync(target, await rgbaPng())

    const { exitCode } = await runCli([`--src=${root}`, '--write', '--avif'], root)
    expect(exitCode).toBe(0)
    expect(existsSync(`${target}.avif`)).toBe(false)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}, 60_000)
