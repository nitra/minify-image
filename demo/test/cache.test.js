import { test, expect, describe } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HASH_CACHE_FILE,
  MTIME_CACHE_FILE,
  hashBuffer,
  loadHashCache,
  loadMtimeCache,
  saveHashCache,
  saveMtimeCache
} from '../../npm/src/cache.js'

const here = dirname(fileURLToPath(import.meta.url))

// ─── hashBuffer ────────────────────────────────────────────────────────────

describe('hashBuffer', () => {
  test('повертає SHA-1 hex-рядок завдовжки 40 символів', () => {
    const hash = hashBuffer(Buffer.from('hello'))
    expect(hash).toHaveLength(40)
    expect(hash).toMatch(/^[\da-f]{40}$/)
  })

  test('детерміновано: однаковий вміст → однаковий хеш', () => {
    const a = hashBuffer(Buffer.from('abc'))
    const b = hashBuffer(Buffer.from('abc'))
    expect(a).toBe(b)
  })

  test('різний вміст → різний хеш', () => {
    expect(hashBuffer(Buffer.from('foo'))).not.toBe(hashBuffer(Buffer.from('bar')))
  })

  test('порожній буфер → валідний SHA-1', () => {
    const hash = hashBuffer(Buffer.alloc(0))
    expect(hash).toHaveLength(40)
  })
})

// ─── saveMtimeCache / loadMtimeCache ───────────────────────────────────────

describe('saveMtimeCache + loadMtimeCache', () => {
  test('зберігає і відновлює кілька записів, відсортованих за шляхом', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-test-'))
    try {
      const cache = new Map([
        ['b/img.png', { mtime: 1_700_000_002, size: 2048 }],
        ['a/logo.svg', { mtime: 1_700_000_001, size: 512 }]
      ])
      saveMtimeCache(dir, cache)

      const tsv = readFileSync(join(dir, MTIME_CACHE_FILE), 'utf8')
      // Перший рядок — 'a/...' (відсортовано)
      expect(tsv.split('\n')[0]).toStartWith('a/logo.svg\t')

      const loaded = loadMtimeCache(dir)
      expect(loaded.size).toBe(2)
      expect(loaded.get('a/logo.svg')).toEqual({ mtime: 1_700_000_001, size: 512 })
      expect(loaded.get('b/img.png')).toEqual({ mtime: 1_700_000_002, size: 2048 })
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('saveMtimeCache створює директорію node_modules/.cache при потребі', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-test-'))
    try {
      const cache = new Map([['img.png', { mtime: 100, size: 200 }]])
      // node_modules/ відсутній — saveMtimeCache має сам створити шлях
      saveMtimeCache(dir, cache)
      const content = readFileSync(join(dir, MTIME_CACHE_FILE), 'utf8')
      expect(content).toContain('img.png')
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('saveMtimeCache з порожнім cache пише порожній файл', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-test-'))
    try {
      saveMtimeCache(dir, new Map())
      const content = readFileSync(join(dir, MTIME_CACHE_FILE), 'utf8')
      expect(content).toBe('')
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('loadMtimeCache повертає порожній Map коли файл відсутній', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-test-'))
    try {
      const loaded = loadMtimeCache(dir)
      expect(loaded.size).toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('loadMtimeCache пропускає рядки з неправильною кількістю колонок', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-test-'))
    try {
      const cacheFile = join(dir, MTIME_CACHE_FILE)
      mkdirSync(dirname(cacheFile), { recursive: true })
      // рядок із 2 колонок — неповний, рядок із 3 — валідний
      writeFileSync(cacheFile, 'bad\t123\ngood.png\t100\t200\n')
      const loaded = loadMtimeCache(dir)
      expect(loaded.size).toBe(1)
      expect(loaded.get('good.png')).toEqual({ mtime: 100, size: 200 })
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })
})

// ─── saveHashCache / loadHashCache ─────────────────────────────────────────

describe('saveHashCache + loadHashCache', () => {
  test('зберігає і відновлює кілька записів, відсортованих за шляхом', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-test-'))
    try {
      const sha1 = 'a'.repeat(40)
      const cache = new Map([
        ['z/big.png', { hash: sha1, originalSize: 5000, size: 3000 }],
        ['a/small.png', { hash: 'b'.repeat(40), originalSize: 100, size: 80 }]
      ])
      saveHashCache(dir, cache)

      const tsv = readFileSync(join(dir, HASH_CACHE_FILE), 'utf8')
      // Перший рядок — 'a/...' (відсортовано)
      expect(tsv.split('\n')[0]).toStartWith('a/small.png\t')

      const loaded = loadHashCache(dir)
      expect(loaded.size).toBe(2)
      expect(loaded.get('a/small.png')).toEqual({
        hash: 'b'.repeat(40),
        originalSize: 100,
        size: 80
      })
      expect(loaded.get('z/big.png')).toEqual({
        hash: sha1,
        originalSize: 5000,
        size: 3000
      })
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('saveHashCache пропускає записи з порожнім hash (міграційні placeholder-и)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-test-'))
    try {
      const cache = new Map([
        ['with-hash.png', { hash: 'a'.repeat(40), originalSize: 1000, size: 800 }],
        ['no-hash.png', { hash: '', originalSize: 500, size: 400 }]
      ])
      saveHashCache(dir, cache)
      const loaded = loadHashCache(dir)
      expect(loaded.has('with-hash.png')).toBe(true)
      expect(loaded.has('no-hash.png')).toBe(false)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('saveHashCache не створює файл коли cache порожній або всі хеші порожні', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-test-'))
    try {
      saveHashCache(dir, new Map())
      const loaded = loadHashCache(dir)
      // файл не з'явився — loadHashCache повертає порожній Map
      expect(loaded.size).toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('loadHashCache повертає порожній Map коли ні новий ні legacy файл не існує', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-test-'))
    try {
      const loaded = loadHashCache(dir)
      expect(loaded.size).toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('loadHashCache мігрує legacy .minify-image-cache.tsv (path/mtime/origSize/size)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-test-'))
    try {
      // Старий формат: path\tmtime\toriginalSize\tsize (hash відсутній)
      writeFileSync(join(dir, '.minify-image-cache.tsv'), 'old.png\t1700000000\t5000\t3500\n')
      const loaded = loadHashCache(dir)
      expect(loaded.size).toBe(1)
      const entry = loaded.get('old.png')
      expect(entry.hash).toBe('')
      expect(entry.originalSize).toBe(5000)
      expect(entry.size).toBe(3500)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('новий .n-minify-image.tsv має пріоритет над legacy файлом', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-test-'))
    try {
      const sha1 = 'c'.repeat(40)
      writeFileSync(join(dir, HASH_CACHE_FILE), `img.png\t${sha1}\t1000\t800\n`)
      // Legacy файл теж є, але не має читатися
      writeFileSync(join(dir, '.minify-image-cache.tsv'), 'img.png\t0\t9999\t7777\n')
      const loaded = loadHashCache(dir)
      expect(loaded.size).toBe(1)
      expect(loaded.get('img.png')?.originalSize).toBe(1000)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('loadHashCache використовує size як fallback для originalSize коли в TSV 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-test-'))
    try {
      const sha1 = 'd'.repeat(40)
      // originalSize=0 → fallback на size
      writeFileSync(join(dir, HASH_CACHE_FILE), `img.png\t${sha1}\t0\t500\n`)
      const loaded = loadHashCache(dir)
      expect(loaded.get('img.png')?.originalSize).toBe(500)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('loadHashCache пропускає рядки з порожнім шляхом або порожнім size у новому форматі', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-test-'))
    try {
      const sha1 = 'e'.repeat(40)
      // Рядки з 4 колонок але порожній path або size — пропускаються parseHashLine guard
      writeFileSync(
        join(dir, HASH_CACHE_FILE),
        `\t${sha1}\t1000\t800\nvalid.png\t${sha1}\t1000\t800\nother.png\t${sha1}\t1000\t\n`
      )
      const loaded = loadHashCache(dir)
      expect(loaded.size).toBe(1)
      expect(loaded.has('valid.png')).toBe(true)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('loadHashCache пропускає legacy рядки з порожнім шляхом або size', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-test-'))
    try {
      // Legacy формат: path\tmtime\toriginalSize\tsize — порожній path або size → guard return
      writeFileSync(
        join(dir, '.minify-image-cache.tsv'),
        `\t1700000000\t5000\t3500\nvalid.png\t1700000000\t5000\t3500\nother.png\t1700000000\t5000\t\n`
      )
      const loaded = loadHashCache(dir)
      expect(loaded.size).toBe(1)
      expect(loaded.has('valid.png')).toBe(true)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })
})

// ─── round-trip: save → load з реальними хешами ────────────────────────────

describe('round-trip із реальним hashBuffer', () => {
  test('hash з hashBuffer коректно зберігається і відновлюється через saveHashCache/loadHashCache', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-test-'))
    try {
      const buf = readFileSync(join(here, 'files', 'ready.png'))
      const hash = hashBuffer(buf)
      const cache = new Map([['ready.png', { hash, originalSize: 5000, size: buf.length }]])
      saveHashCache(dir, cache)
      const loaded = loadHashCache(dir)
      expect(loaded.get('ready.png')?.hash).toBe(hash)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })
})
