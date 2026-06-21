import { test, expect } from 'bun:test'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32 } from 'node:zlib'
// eslint-disable-next-line n/no-unpublished-import -- demo не публікується; sharp у devDependencies для генерації тестових PNG
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const cli = join(here, '..', '..', 'npm', 'src', 'index.js')
const filesDir = join(here, 'files')
const cacheFileName = '.n-minify-image.tsv'

/**
 * Запускає CLI як підпроцес і повертає `{ exitCode, stdout }`.
 * @param {string[]} args — аргументи після шляху до index.js.
 * @param {string} cwd — робоча директорія для процесу.
 * @returns {Promise<{ exitCode: number, stdout: string }>} результат запуску.
 */
const runCli = async (args, cwd) => {
  // bun:test встановлює NODE_ENV=test для дочірніх процесів, що змушує consola
  // глушити info-логи (вона вважає, що в тестах вивід зайвий). Підміняємо на
  // production, щоб тести бачили реальний CLI-вивід.
  const env = { ...process.env, NODE_ENV: 'production' }
  const proc = Bun.spawn(['bun', cli, ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  return { exitCode, stderr, stdout }
}

/**
 * Будує валідний PNG `tEXt`-чанк (спосіб додати "роздуті" метадані).
 * sharp за замовчуванням викидає метадані — фактичний розмір падає до базової PNG.
 * @param {string} keyword — латинський ключ ≤79 символів.
 * @param {string} text — корисне навантаження (latin1).
 * @returns {Buffer} готовий чанк (length + type + data + crc).
 */
const buildTextChunk = (keyword, text) => {
  const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')])
  const type = Buffer.from('tEXt', 'latin1')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])))
  return Buffer.concat([length, type, data, crc])
}

/**
 * Створює "товсту" PNG: бере справжню PNG і вшиває tEXt-чанк перед IEND.
 * @param {string} srcPng — шлях до базового PNG.
 * @param {string} dstPath — куди записати fat-варіант.
 * @param {number} payloadSize — розмір сміття в tEXt (байт).
 */
const writeFatPng = (srcPng, dstPath, payloadSize) => {
  const png = readFileSync(srcPng)
  // IEND — завжди 12 останніх байтів (4 length=0 + 4 type + 4 crc)
  const iendStart = png.length - 12
  const fat = Buffer.concat([
    png.subarray(0, iendStart),
    buildTextChunk('Comment', 'X'.repeat(payloadSize)),
    png.subarray(iendStart)
  ])
  writeFileSync(dstPath, fat)
}

/** Регекс для перевірки рядка з ненульовою економією: `Images optimized, saving: X kB, Y%`. */
const NON_ZERO_SAVING_RE = /Images optimized, saving: [^,]+, [1-9]\d*%/

/** SHA-1 hex-дайджест: рівно 40 [0-9a-f]. */
const SHA1_HEX_RE = /^[\da-f]{40}$/

/** Файли-фікстури, які CLI має знайти за глобами (vendor/* виключено через ignore). */
const expectedFiles = ['ready.png', 'ready.Jpeg', 'big_jpeg_req_6.jpg', 'minified.svg']

test('estimate-режим: реально проганяє компресор для всіх форматів', async () => {
  const { exitCode, stderr, stdout } = await runCli([`--src=${filesDir}`], here)

  expect(exitCode).toBe(0)

  // Кожна фікстура має пройти компресор (рядок з "original size:")
  for (const name of expectedFiles) {
    expect(stdout).toContain(`${name} original size:`)
  }

  // vendor/* має бути проігнорований
  expect(stdout).not.toContain('vendor/ready.svg')

  // підсумок estimate-режиму
  expect(stdout).toContain('All image size:')
  expect(stdout).toContain('Estimated saving:')
  expect(stdout).not.toContain('Images optimized')

  // 4.0: GIF support removed — кожен .gif видає warn у stderr і не обробляється
  expect(stderr).toContain('GIF compression removed in 4.0')
  expect(stderr).toContain('minified.gif')
  expect(stdout).not.toContain('minified.gif original size:')
}, 60_000)

test('--write режим: проганяє компресор для всіх файлів і наповнює cache', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'minify-image-test-'))
  try {
    cpSync(filesDir, workDir, { recursive: true })

    const first = await runCli([`--src=${workDir}`, '--write'], workDir)
    expect(first.exitCode).toBe(0)
    expect(first.stdout).toContain('Images optimized, saving:')
    expect(first.stdout).not.toContain('Estimated saving:')
    // На чистому cache кожен файл має пройти компресор рівно раз
    for (const name of expectedFiles) {
      expect(first.stdout).toContain(`${name} original size:`)
    }

    // Cache-файл має лежати в каталозі --src — переживає npx-запуски
    const cachePath = join(workDir, cacheFileName)
    expect(existsSync(cachePath)).toBe(true)

    // Перевіряємо TSV-формат: 4 колонки (rel-path, sha1-hex, originalSize, size)
    const tsvLines = readFileSync(cachePath, 'utf8').trimEnd().split('\n')
    expect(tsvLines.length).toBe(expectedFiles.length)
    for (const line of tsvLines) {
      const cols = line.split('\t')
      expect(cols.length).toBe(4)
      const [relPath, hash, originalSize, size] = cols
      expect(relPath.startsWith('/')).toBe(false)
      expect(SHA1_HEX_RE.test(hash)).toBe(true)
      expect(Number.isInteger(Number(originalSize))).toBe(true)
      expect(Number.isInteger(Number(size))).toBe(true)
      // size ніколи не може перевищувати originalSize
      expect(Number(size)).toBeLessThanOrEqual(Number(originalSize))
    }

    // ready.png — палітровий PNG, має реально стиснутися >15%
    // завдяки sharp `palette: true, effort: 10, compressionLevel: 9` (≈pngquant + zopfli)
    const readyPngLine = tsvLines.find(line => line.startsWith('ready.png\t'))
    expect(readyPngLine).toBeDefined()
    // eslint-disable-next-line unicorn/no-unreadable-array-destructuring -- TSV-колонки за позицією
    const [, , readyOrig, readySize] = readyPngLine.split('\t')
    expect(Number(readySize)).toBeLessThan(Number(readyOrig) * 0.85)

    // vendor/ready.svg — навмисно "товстий" (verbose), але vendor/* ігнорується
    // через glob — у cache рядка нема, файл на диску не змінений
    expect(tsvLines.some(line => line.startsWith('vendor/'))).toBe(false)
    expect(statSync(join(workDir, 'vendor', 'ready.svg')).size).toBe(
      statSync(join(filesDir, 'vendor', 'ready.svg')).size
    )

    // GIF підтримку видалено в 4.0: minified.gif має лишитися байт-в-байт,
    // а у cache TSV для нього не повинно бути запису
    const gifBefore = readFileSync(join(filesDir, 'minified.gif'))
    const gifAfter = readFileSync(join(workDir, 'minified.gif'))
    expect(gifAfter.equals(gifBefore)).toBe(true)
    expect(tsvLines.some(line => line.startsWith('minified.gif\t'))).toBe(false)

    // CLI має звітувати ненульову економію (через ready.png)
    expect(first.stdout).toMatch(NON_ZERO_SAVING_RE)

    const second = await runCli([`--src=${workDir}`, '--write'], workDir)
    expect(second.exitCode).toBe(0)
    // Після першого --write cache має знати всі файли — другий запуск їх пропускає
    for (const name of expectedFiles) {
      expect(second.stdout).toContain(`${name} already compressed`)
    }
    expect(second.stdout).not.toContain('original size:')
  } finally {
    rmSync(workDir, { force: true, recursive: true })
  }
}, 120_000)

test('--json режим: звіряє файли з TSV без запису або компресії', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'minify-image-json-'))
  try {
    const target = join(workDir, 'fat.png')
    writeFatPng(join(filesDir, 'ready.png'), target, 50_000)
    const before = readFileSync(target)
    const cachePath = join(workDir, cacheFileName)

    const cold = await runCli([`--src=${workDir}`, '--json'], workDir)
    expect(cold.exitCode).toBe(0)
    expect(existsSync(cachePath)).toBe(false)
    expect(readFileSync(target).equals(before)).toBe(true)

    const coldReport = JSON.parse(cold.stdout)
    expect(coldReport.summary).toEqual({ needsCompression: 1, processed: 0, total: 1, unsupported: 0 })
    expect(coldReport.files).toHaveLength(1)
    expect(coldReport.files[0]).toMatchObject({
      cachedHash: null,
      cachedOriginalSize: null,
      cachedSize: null,
      needsCompression: true,
      path: 'fat.png',
      processed: false,
      supported: true,
      size: before.length
    })
    expect(SHA1_HEX_RE.test(coldReport.files[0].hash)).toBe(true)

    await runCliOk([`--src=${workDir}`, '--write'], workDir)
    const afterWrite = readFileSync(target)
    expect(afterWrite.length).toBeLessThan(before.length)

    const warm = await runCli([`--src=${workDir}`, '--json'], workDir)
    expect(warm.exitCode).toBe(0)
    expect(readFileSync(target).equals(afterWrite)).toBe(true)

    const warmReport = JSON.parse(warm.stdout)
    expect(warmReport.summary).toEqual({ needsCompression: 0, processed: 1, total: 1, unsupported: 0 })
    expect(warmReport.files[0]).toMatchObject({
      needsCompression: false,
      path: 'fat.png',
      processed: true,
      supported: true,
      size: afterWrite.length
    })
    expect(warmReport.files[0].cachedHash).toBe(warmReport.files[0].hash)
    expect(warmReport.files[0].cachedOriginalSize).toBe(before.length)
    expect(warmReport.files[0].cachedSize).toBe(afterWrite.length)
  } finally {
    rmSync(workDir, { force: true, recursive: true })
  }
}, 60_000)

/**
 * Записує SVG із заданим вмістом і ганяє --write поки розмір не зміниться.
 * Повертає мінімізований текст SVG. Поріг 15% обходимо великим payload-ом —
 * <rect>-полотно достатньо «жирне», щоб реальна оптимізація завжди перетнула поріг.
 * @param {string} svgContent — повний XML.
 * @returns {Promise<string>} мінімізований SVG.
 */
const minifySvg = async svgContent => {
  const workDir = mkdtempSync(join(tmpdir(), 'minify-image-svg-'))
  try {
    const target = join(workDir, 'sample.svg')
    writeFileSync(target, svgContent)
    const before = statSync(target).size
    const { exitCode } = await runCli([`--src=${workDir}`, '--write'], workDir)
    expect(exitCode).toBe(0)
    const after = statSync(target).size
    // Якщо файл не пройшов поріг 15% — він залишиться без змін: тести мають
    // самі будувати достатньо «жирний» SVG (велика payload-зона), щоб реальна
    // оптимізація гарантовано спрацювала.
    expect(after).toBeLessThan(before)
    return readFileSync(target, 'utf8')
  } finally {
    rmSync(workDir, { force: true, recursive: true })
  }
}

// Велике «полотно» рандомних <rect>-ів — payload, що компресується SVGO незалежно
// від тестованого блоку (коментар/metadata) і перевищує поріг 15%.
const fatBody = Array.from(
  { length: 200 },
  (_, i) =>
    `  <rect x="${i}" y="${i}" width="10" height="10" fill="rgb(${i % 256},${(i * 3) % 256},${(i * 7) % 256})"/>`
).join('\n')

const wrapSvg = inner =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" viewBox="0 0 256 256">\n${inner}\n${fatBody}\n</svg>\n`

test('SVG: license-bearing коментар лишається, інструментальний — видаляється', async () => {
  const svg = wrapSvg(
    [
      '<!--',
      'Font Awesome Free 5.15.3 by @fontawesome - https://fontawesome.com',
      'License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License)',
      '-->',
      '<!-- generator: inkscape -->'
    ].join('\n')
  )
  const out = await minifySvg(svg)
  expect(out).toContain('Font Awesome')
  expect(out).toContain('CC BY 4.0')
  expect(out).not.toContain('inkscape')
}, 60_000)

test('SVG: <metadata> з <dc:rights>MIT</dc:rights> лишається, інструментальний — видаляється', async () => {
  const svg = wrapSvg(
    [
      '<metadata><rdf:RDF><cc:Work><dc:rights>MIT License</dc:rights></cc:Work></rdf:RDF></metadata>',
      '<metadata><dc:title>Generated</dc:title></metadata>'
    ].join('\n')
  )
  const out = await minifySvg(svg)
  expect(out).toContain('MIT License')
  expect(out).not.toContain('Generated')
}, 60_000)

test('SVG: коментар з самим CC0 (без ©) — видаляється', async () => {
  const svg = wrapSvg('<!-- Released under CC0 -->')
  const out = await minifySvg(svg)
  expect(out).not.toContain('CC0')
}, 60_000)

test('SVG: коментар CC0 + © залишається', async () => {
  const svg = wrapSvg('<!-- Based on CC0, © 2024 Acme -->')
  const out = await minifySvg(svg)
  expect(out).toContain('© 2024 Acme')
}, 60_000)

test('SVG: інструментальний коментар без license/copyright — видаляється', async () => {
  const svg = wrapSvg('<!-- generated by Sketch -->')
  const out = await minifySvg(svg)
  expect(out).not.toContain('Sketch')
}, 60_000)

test('SVG: <metadata> з RDF cc:license URL → атрибуція через rdf:resource атрибут', async () => {
  const svg = wrapSvg(
    '<metadata><rdf:RDF><cc:Work><cc:license rdf:resource="https://creativecommons.org/licenses/by/4.0/"/></cc:Work></rdf:RDF></metadata>'
  )
  const out = await minifySvg(svg)
  expect(out).toContain('creativecommons.org/licenses/by/4.0')
}, 60_000)

/**
 * Будує solid-color PNG заданого кольору. Дві такі PNG з різним RGB дають
 * різний AVIF-вивід байт-у-байт — зручний детектор повторного кодування.
 * @param {{ r: number, g: number, b: number }} rgb — колір тла.
 * @returns {Promise<Buffer>} вміст PNG.
 */
const solidPng = rgb =>
  sharp({ create: { background: rgb, channels: 3, height: 64, width: 64 } })
    .png()
    .toBuffer()

/**
 * Запустити CLI і ствердити успішний вихід, не вертаючи stdout (його легко
 * губить throttling consola у швидкоплинних запусках). Використовуємо коли
 * перевіряємо стан файлової системи, а не консольний вивід.
 * @param {string[]} args — аргументи CLI.
 * @param {string} cwd — робоча директорія.
 */
const runCliOk = async (args, cwd) => {
  const result = await runCli(args, cwd)
  expect(result.exitCode).toBe(0)
}

test('--avif: регенерує .avif коли вміст оригіналу змінюється (slow-path cache miss)', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'minify-image-avif-'))
  try {
    const target = join(workDir, 'a.png')
    const avifPath = `${target}.avif`
    writeFileSync(target, await solidPng({ b: 0, g: 0, r: 255 }))

    const first = await runCli([`--src=${workDir}`, '--write', '--avif'], workDir)
    expect(first.exitCode).toBe(0)
    expect(existsSync(avifPath)).toBe(true)
    const avifV1 = readFileSync(avifPath)

    // Підмінюємо файл на інший вміст (новий sha1, інші пікселі — AVIF-вивід
    // гарантовано буде різним байт-у-байт).
    writeFileSync(target, await solidPng({ b: 255, g: 0, r: 0 }))

    const second = await runCli([`--src=${workDir}`, '--write', '--avif'], workDir)
    expect(second.exitCode).toBe(0)
    expect(existsSync(avifPath)).toBe(true)
    const avifV2 = readFileSync(avifPath)
    expect(avifV2.equals(avifV1)).toBe(false)
  } finally {
    rmSync(workDir, { force: true, recursive: true })
  }
}, 60_000)

test('--avif: лишає .avif незмінним коли оригінал не редагували', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'minify-image-avif-'))
  try {
    const target = join(workDir, 'a.png')
    const avifPath = `${target}.avif`
    writeFileSync(target, await solidPng({ b: 0, g: 0, r: 255 }))

    await runCliOk([`--src=${workDir}`, '--write', '--avif'], workDir)
    const avifV1 = readFileSync(avifPath)

    await runCliOk([`--src=${workDir}`, '--write', '--avif'], workDir)
    const avifV2 = readFileSync(avifPath)
    expect(avifV2.equals(avifV1)).toBe(true)
  } finally {
    rmSync(workDir, { force: true, recursive: true })
  }
}, 60_000)

test('--avif: регенерує .avif коли він зник з диска (cache hit + missing AVIF)', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'minify-image-avif-'))
  try {
    const target = join(workDir, 'a.png')
    const avifPath = `${target}.avif`
    writeFileSync(target, await solidPng({ b: 0, g: 0, r: 255 }))

    await runCliOk([`--src=${workDir}`, '--write', '--avif'], workDir)
    expect(existsSync(avifPath)).toBe(true)

    unlinkSync(avifPath)
    expect(existsSync(avifPath)).toBe(false)

    await runCliOk([`--src=${workDir}`, '--write', '--avif'], workDir)
    expect(existsSync(avifPath)).toBe(true)
  } finally {
    rmSync(workDir, { force: true, recursive: true })
  }
}, 60_000)

test('--avif: регенерує .avif коли запису в .n-minify-image.tsv ще нема', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'minify-image-avif-'))
  try {
    const target = join(workDir, 'a.png')
    const avifPath = `${target}.avif`
    writeFileSync(target, await solidPng({ b: 0, g: 0, r: 255 }))
    // Заглушка-AVIF, написана не нашим CLI, без жодного TSV-кеша поряд —
    // моделює сценарій upgrade з 3.1 → 3.2+, де AVIF лежить, а hash-кешу нема.
    const stub = Buffer.from('not-a-real-avif-stub')
    writeFileSync(avifPath, stub)
    expect(existsSync(join(workDir, cacheFileName))).toBe(false)

    await runCliOk([`--src=${workDir}`, '--write', '--avif'], workDir)

    const avifAfter = readFileSync(avifPath)
    expect(avifAfter.equals(stub)).toBe(false)
    expect(avifAfter.length).toBeGreaterThan(stub.length)
  } finally {
    rmSync(workDir, { force: true, recursive: true })
  }
}, 60_000)

test('--avif: оновлює sha1 у .n-minify-image.tsv після регенерації', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'minify-image-avif-'))
  try {
    const target = join(workDir, 'a.png')
    writeFileSync(target, await solidPng({ b: 0, g: 0, r: 255 }))
    await runCliOk([`--src=${workDir}`, '--write', '--avif'], workDir)

    const tsvPath = join(workDir, cacheFileName)
    const sha1V1 = readFileSync(tsvPath, 'utf8').trim().split('\t')[1]
    expect(SHA1_HEX_RE.test(sha1V1)).toBe(true)

    writeFileSync(target, await solidPng({ b: 255, g: 0, r: 0 }))
    await runCliOk([`--src=${workDir}`, '--write', '--avif'], workDir)

    const sha1V2 = readFileSync(tsvPath, 'utf8').trim().split('\t')[1]
    expect(SHA1_HEX_RE.test(sha1V2)).toBe(true)
    expect(sha1V2).not.toBe(sha1V1)
  } finally {
    rmSync(workDir, { force: true, recursive: true })
  }
}, 60_000)

test('--avif вимкнено: оригінал стискається, але .avif не оновлюється', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'minify-image-avif-'))
  try {
    const target = join(workDir, 'a.png')
    const avifPath = `${target}.avif`
    writeFileSync(target, await solidPng({ b: 0, g: 0, r: 255 }))

    await runCliOk([`--src=${workDir}`, '--write', '--avif'], workDir)
    const avifV1 = readFileSync(avifPath)

    writeFileSync(target, await solidPng({ b: 255, g: 0, r: 0 }))
    // Без --avif: компресор для PNG усе одно спрацює, sha1 у TSV оновиться,
    // але AVIF-двійник не повинен переписатися.
    await runCliOk([`--src=${workDir}`, '--write'], workDir)

    const avifAfter = readFileSync(avifPath)
    expect(avifAfter.equals(avifV1)).toBe(true)
  } finally {
    rmSync(workDir, { force: true, recursive: true })
  }
}, 60_000)

test('--write: реально перезаписує файл коли економія >15%', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'minify-image-test-'))
  try {
    const fatPath = join(workDir, 'fat.png')
    writeFatPng(join(filesDir, 'ready.png'), fatPath, 50_000)
    const before = statSync(fatPath).size
    expect(before).toBeGreaterThan(50_000)

    const { exitCode, stdout } = await runCli([`--src=${workDir}`, '--write'], workDir)

    expect(exitCode).toBe(0)
    expect(stdout).toContain('fat.png original size:')

    const after = statSync(fatPath).size
    // sharp за замовчуванням викидає tEXt-баласт; відсоток економії має перетнути поріг 15%
    expect(after).toBeLessThan(before * 0.85)

    // Cache має зберегти originalSize (= before), щоб проєктна статистика його врахувала
    expect(stdout).toContain('Project lifetime savings:')
    const cacheLines = readFileSync(join(workDir, cacheFileName), 'utf8').trimEnd().split('\n')
    const fatLine = cacheLines.find(line => line.startsWith('fat.png\t'))
    expect(fatLine).toBeDefined()
    const [, , originalSize, currentSize] = fatLine.split('\t') // eslint-disable-line unicorn/no-unreadable-array-destructuring -- TSV-колонки за позицією
    expect(Number(originalSize)).toBe(before)
    expect(Number(currentSize)).toBe(after)
  } finally {
    rmSync(workDir, { force: true, recursive: true })
  }
}, 60_000)
