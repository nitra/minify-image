import { test, expect } from 'bun:test'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32 } from 'node:zlib'

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
  const proc = Bun.spawn(['bun', cli, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  return { exitCode, stdout }
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
const expectedFiles = ['ready.png', 'ready.Jpeg', 'big_jpeg_req_6.jpg', 'minified.gif', 'minified.svg']

test('estimate-режим: реально проганяє компресор для всіх форматів', async () => {
  const { exitCode, stdout } = await runCli([`--src=${filesDir}`], here)

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
