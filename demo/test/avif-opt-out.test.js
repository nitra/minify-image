import { test, expect } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// eslint-disable-next-line n/no-unpublished-import -- demo не публікується; sharp у devDependencies для генерації тестових PNG
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const cli = join(here, '..', '..', 'npm', 'src', 'index.js')
const filesDir = join(here, 'files')

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
 * Solid-color PNG (64×64) — детермінований AVIF-вивід при заданому RGB.
 * @param {{ r: number, g: number, b: number }} rgb — колір тла.
 * @returns {Promise<Buffer>} вміст PNG.
 */
const solidPng = rgb =>
  sharp({ create: { background: rgb, channels: 3, height: 64, width: 64 } })
    .png()
    .toBuffer()

/**
 * Будує fixture-репо з вкладеними «workspace»-ами.
 *
 * - корінь: package.json без opt-out + img.png
 * - site/: package.json з `disable-avif: true`, asset-и в `assets/` і `sub/`
 * - other/: package.json без opt-out + pic.png
 *
 * Зображення копіюються з `demo/test/files/ready.png` — він стискається >15%,
 * тож за тим самим порогом мініфікатор реально перепише оригінал у opt-out
 * пакеті (опт-аут стосується тільки AVIF, не звичайного стиснення).
 * @returns {string} абсолютний шлях fixture-кореня.
 */
const buildOptOutFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'minify-image-opt-out-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root' }))
  cpSync(join(filesDir, 'ready.png'), join(root, 'img.png'))

  mkdirSync(join(root, 'site', 'assets'), { recursive: true })
  mkdirSync(join(root, 'site', 'sub'), { recursive: true })
  writeFileSync(
    join(root, 'site', 'package.json'),
    JSON.stringify({ '@nitra/minify-image': { 'disable-avif': true }, name: 'site' })
  )
  cpSync(join(filesDir, 'ready.png'), join(root, 'site', 'assets', 'logo.png'))
  cpSync(join(filesDir, 'ready.png'), join(root, 'site', 'sub', 'deep.png'))

  mkdirSync(join(root, 'other'), { recursive: true })
  writeFileSync(join(root, 'other', 'package.json'), JSON.stringify({ name: 'other' }))
  cpSync(join(filesDir, 'ready.png'), join(root, 'other', 'pic.png'))

  return root
}

test('--avif opt-out: AVIF створюється поза opt-out, не створюється всередині', async () => {
  const root = buildOptOutFixture()
  try {
    const { exitCode } = await runCli([`--src=${root}`, '--write', '--avif'], root)
    expect(exitCode).toBe(0)

    expect(existsSync(join(root, 'img.png.avif'))).toBe(true)
    expect(existsSync(join(root, 'other', 'pic.png.avif'))).toBe(true)

    expect(existsSync(join(root, 'site', 'assets', 'logo.png.avif'))).toBe(false)
    expect(existsSync(join(root, 'site', 'sub', 'deep.png.avif'))).toBe(false)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}, 120_000)

test('--avif opt-out: оригінали в opt-out пакеті стискаються як зазвичай', async () => {
  const root = buildOptOutFixture()
  try {
    const target = join(root, 'site', 'assets', 'logo.png')
    const before = readFileSync(target).length
    const { exitCode } = await runCli([`--src=${root}`, '--write', '--avif'], root)
    expect(exitCode).toBe(0)
    const after = readFileSync(target).length
    expect(after).toBeLessThan(before * 0.85)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}, 120_000)

test('--avif opt-out: наявні .avif всередині opt-out пакета не чіпаються', async () => {
  const root = buildOptOutFixture()
  try {
    const stub = Buffer.from('not-a-real-avif-stub')
    const stubPath = join(root, 'site', 'assets', 'logo.png.avif')
    writeFileSync(stubPath, stub)

    const { exitCode } = await runCli([`--src=${root}`, '--write', '--avif'], root)
    expect(exitCode).toBe(0)
    expect(readFileSync(stubPath).equals(stub)).toBe(true)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}, 120_000)

test('--avif opt-out: битий package.json не валить CLI — трактуємо як «не знайдено»', async () => {
  const root = mkdtempSync(join(tmpdir(), 'minify-image-broken-pkg-'))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root' }))
    mkdirSync(join(root, 'pkg'), { recursive: true })
    writeFileSync(join(root, 'pkg', 'package.json'), '{ this is not json')
    const target = join(root, 'pkg', 'a.png')
    writeFileSync(target, await solidPng({ b: 0, g: 0, r: 255 }))

    const { exitCode } = await runCli([`--src=${root}`, '--write', '--avif'], root)
    expect(exitCode).toBe(0)
    expect(existsSync(`${target}.avif`)).toBe(true)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}, 60_000)

test('--avif opt-out: { "disable-avif": false } еквівалентно відсутності прапорця', async () => {
  const root = mkdtempSync(join(tmpdir(), 'minify-image-flag-false-'))
  try {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ '@nitra/minify-image': { 'disable-avif': false }, name: 'root' })
    )
    const target = join(root, 'a.png')
    writeFileSync(target, await solidPng({ b: 0, g: 0, r: 255 }))

    const { exitCode } = await runCli([`--src=${root}`, '--write', '--avif'], root)
    expect(exitCode).toBe(0)
    expect(existsSync(`${target}.avif`)).toBe(true)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}, 60_000)
