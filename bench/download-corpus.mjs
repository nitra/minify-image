// Завантажує Kodak Lossless True Color Image Suite (24 PNG, 768×512 / 512×768).
// Джерело: http://r0k.us/graphics/kodak/ — академічний стандарт image-codec бенчмарків.
// Зберігає у bench/corpus/kodak/kodimNN.png (NN ∈ 01..24). Корпус не комітимо.
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Шлях на сайті: /graphics/kodak/ — index, реальні PNG живуть у /graphics/kodak/kodak/.
const BASE = 'https://r0k.us/graphics/kodak/kodak'
const OUT = new URL('corpus/kodak/', import.meta.url).pathname

mkdirSync(OUT, { recursive: true })

let downloaded = 0
let cached = 0
for (let i = 1; i <= 24; i++) {
  const name = `kodim${String(i).padStart(2, '0')}.png`
  const path = join(OUT, name)
  if (existsSync(path) && statSync(path).size > 100000) {
    cached++
    continue
  }
  process.stdout.write(`${name}… `)
  const res = await fetch(`${BASE}/${name}`)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${name}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  writeFileSync(path, buf)
  downloaded++
  console.log(`${buf.length} bytes`)
}
console.log(`\nDone. ${downloaded} downloaded, ${cached} cached.`)
