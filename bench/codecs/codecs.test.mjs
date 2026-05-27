import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { adapters, FORMATS } from './index.mjs'
import { bunImageAdapter } from './bun-image.mjs'
import { sharpAdapter } from './sharp.mjs'

const SAMPLE = new URL('../../demo/test/files/ready.png', import.meta.url).pathname

test('sharpAdapter has correct shape', () => {
  expect(sharpAdapter.name).toBe('sharp')
  expect(typeof sharpAdapter.encode).toBe('function')
})

test('sharpAdapter.encode(png, "png") returns Uint8Array', async () => {
  const buf = readFileSync(SAMPLE)
  const out = await sharpAdapter.encode(buf, 'png')
  expect(out).toBeInstanceOf(Uint8Array)
  expect(out.length).toBeGreaterThan(0)
  expect(out.length).toBeLessThan(buf.length) // має стиснутися
})

test('sharpAdapter.encode supports png/jpeg/avif/webp', async () => {
  const buf = readFileSync(SAMPLE)
  for (const fmt of ['png', 'jpeg', 'avif', 'webp']) {
    const out = await sharpAdapter.encode(buf, fmt)
    expect(out.length).toBeGreaterThan(0)
  }
}, 120_000)

test('bunImageAdapter has correct shape', () => {
  expect(bunImageAdapter.name).toBe('bun-image')
  expect(typeof bunImageAdapter.encode).toBe('function')
})

test('bunImageAdapter.encode(png, "png") returns Uint8Array', async () => {
  const buf = readFileSync(SAMPLE)
  const out = await bunImageAdapter.encode(buf, 'png')
  expect(out).toBeInstanceOf(Uint8Array)
  expect(out.length).toBeGreaterThan(0)
  expect(out.length).toBeLessThan(buf.length)
}, 30_000)

test('bunImageAdapter.encode supports png/jpeg/avif/webp', async () => {
  const buf = readFileSync(SAMPLE)
  for (const fmt of ['png', 'jpeg', 'avif', 'webp']) {
    const out = await bunImageAdapter.encode(buf, fmt)
    expect(out.length).toBeGreaterThan(0)
  }
}, 120_000)

test('adapters registry has all four variants', () => {
  const names = adapters.map(a => a.name).toSorted()
  expect(names).toEqual(['bun-image', 'bun-image-default', 'sharp', 'sharp-default'])
})

test('every adapter encodes every FORMAT', async () => {
  const buf = readFileSync(SAMPLE)
  for (const adapter of adapters) {
    for (const fmt of FORMATS) {
      const out = await adapter.encode(buf, fmt)
      expect(out.length).toBeGreaterThan(0)
    }
  }
}, 300_000)
