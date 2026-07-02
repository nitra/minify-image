import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { computeDSSIM, computeSSIM, decodeToRGBA } from './quality.mjs'

const SAMPLE_PNG = new URL('../demo/test/files/ready.png', import.meta.url).pathname

test('decodeToRGBA returns RGBA bytes + dims', async () => {
  const buf = readFileSync(SAMPLE_PNG)
  const { data, width, height } = await decodeToRGBA(buf)
  expect(data).toBeInstanceOf(Uint8Array)
  expect(data.length).toBe(width * height * 4)
  expect(width).toBeGreaterThan(0)
})

test('computeSSIM identity ≈ 1.0', async () => {
  const buf = readFileSync(SAMPLE_PNG)
  const ssim = await computeSSIM(buf, buf)
  expect(ssim).toBeCloseTo(1, 4)
})

test('computeSSIM кидає Error при розбіжності розмірів', async () => {
  const buf = readFileSync(SAMPLE_PNG)
  const smaller = await sharp(buf).resize(10, 10).toBuffer()
  await expect(computeSSIM(buf, smaller)).rejects.toThrow('dimension mismatch')
})

test('computeDSSIM returns null or non-negative number', async () => {
  const buf = readFileSync(SAMPLE_PNG)
  const dssim = await computeDSSIM(buf, buf)
  // dssim may be null if binary not installed; else identity ≈ 0
  if (dssim !== null) expect(dssim).toBeGreaterThanOrEqual(0)
}, 30_000)
