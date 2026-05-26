# Bun.Image vs sharp — Methodologically Sound Benchmark

**Дата:** 2026-05-26
**Статус:** Design approved, ready for implementation plan
**Контекст:** Перевірка чи `Bun.Image` (Bun 1.3.14+) може замінити `sharp` у `@nitra/minify-image`.

## Передумова

ADR `docs/adr/_inbox/20260526-054228-bun-image-benchmark.md` уже зафіксувало: «sharp залишається». Але той замір був не apples-to-apples:

1. `Bun.Image` PNG тестували `quality: 100` (PNG lossless — noop), **без `palette: true`**. Поточний CLI використовує `palette: true`, що дає основну економію PNG. Probe з 2026-05-26 показав, що `Bun.Image` приймає `palette: true` і теж квантизує: 32 242 → 10 792 байти (-66%).
2. JPEG порівнювали `quality: 85` для обох, ігноруючи `mozjpeg: true, progressive: true` з реального CLI. `Bun.Image` `mozjpeg` ігнорує silently, але `progressive: true` приймає і дає -35% на тестовому файлі.
3. Корпус — 23 файли власних активів, не репродукований і не публічний.
4. Метрик якості (SSIM/DSSIM) не було — порівнювали лише розмір, що нечесно для lossy форматів.

Цей замір переоцінює рішення з виправленою методологією. Якщо результат той самий — ADR підтверджується додатковими даними. Якщо інший — ADR переглядається.

## Корпус

**Kodak Lossless True Color Image Suite** (24 PNG 768×512, ~18 MB total) — академічний стандарт image-codec бенчмарків (PSNR/SSIM tracks AVIF/WebP/JPEG-XL/MozJPEG саме на ньому).

Завантаження: `bench/download-corpus.mjs` → `bench/corpus/kodak/kodim01.png … kodim24.png`. Корпус не комітимо (`.gitignore`).

З Kodak PNG генеруємо чотири треки:

- **PNG lossless** — поточні Kodak PNG → recompressed PNG (sharp vs Bun.Image)
- **JPEG lossy** — Kodak PNG → JPEG
- **AVIF lossy** — Kodak PNG → AVIF
- **WebP lossy** — Kodak PNG → WebP (для контексту; у проді CLI WebP не використовує)

**Out of scope:** GIF (Bun.Image не має encoder), SVG (SVGO незалежний від кодека). Зафіксувати в звіті як обмеження.

## Адаптери та параметри

Два адаптери з ідентичною сигнатурою:

```js
{ name: 'sharp' | 'bun-image', encode(buf, format) => Promise<Uint8Array> }
```

Параметри дзеркалять поточний CLI (`npm/src/index.js`):

| Формат | sharp                                         | Bun.Image                          | Примітка                             |
| ------ | --------------------------------------------- | ---------------------------------- | ------------------------------------ |
| PNG    | `compressionLevel:9, effort:10, palette:true` | `compressionLevel:9, palette:true` | `effort` Bun.Image ігнорує silently  |
| JPEG   | `mozjpeg:true, progressive:true` (≈Q75)       | `quality:75, progressive:true`     | `mozjpeg` Bun.Image ігнорує silently |
| AVIF   | `quality:40`                                  | `quality:40`                       | паритет                              |
| WebP   | `quality:80`                                  | `quality:80`                       | паритет                              |

Окремо знімаємо **«default vs default»** колонку — без `palette`/`progressive`/`mozjpeg`/`effort` — щоб квантифікувати «що ми втрачаємо без MozJPEG/effort».

## Метрики якості

- **Розмір (bytes)** — всі формати.
- **SSIM** — `ssim.js` (npm, pure JS, без бінарок). Apply для lossy (JPEG/AVIF/WebP).
  - Декодування результату: один спільний декодер (`Bun.Image(buf).bytes()` → RGBA). Це нейтральний крок, не вносить упередження ні за одного з тестованих кодерів.
- **DSSIM** — Kornelski `dssim` CLI (рекомендований Mozilla для AVIF/JPEG). Установка: `brew install dssim` (macOS) або `cargo install dssim`. Виклик через `Bun.spawn`.
  - **Fallback:** якщо `dssim` не в PATH — пропускаємо колонку, в звіті явно фіксуємо. SSIM достатньо для базового висновку.
- **butteraugli** — НЕ беремо. DSSIM + SSIM достатньо й однозначно інтерпретовано; butteraugli додає трактовну плутанину без виграшу в інформативності.

PNG (lossless): тільки розмір. SSIM/DSSIM по визначенню = 1.0/0.0.

## Швидкодія

### Per-codec мікро-бенч (`bench/micro.mjs`)

- Для кожного з 24 Kodak зображень × 4 формати × 2 адаптери:
  - 10 прогонів `encode(buf)`, відкидаємо перший (JIT warmup), беремо медіану
  - Wrap: `Bun.nanoseconds()` перед і після
  - **Cold-instance:** `new Bun.Image(buf)` / `sharp(buf)` створюємо всередині таймера — як у реальному CLI
- Агрегація: median-of-medians + p95 + standard deviation per (формат, адаптер)
- Якщо variance >20% — N збільшуємо до 20 і перепрогоняємо

### End-to-end CLI (`bench/e2e.mjs`)

- `bench/e2e-corpus/` — копія Kodak suite (24 PNG) + 2 GIF / 2 SVG / 2 JPEG із `demo/test/files/`
- Два варіанти CLI:
  - **sharp:** поточний `node npm/src/index.js`
  - **Bun.Image:** окремий файл `bench/e2e-cli-bun-image.mjs` — копія `npm/src/index.js` із заміненими `compressors` (PNG/JPEG/AVIF → Bun.Image, GIF/SVG → залишити sharp/svgo)
- Перед кожним прогоном: видалити `bench/e2e-corpus/.n-minify-image.tsv` і `bench/e2e-corpus/node_modules/.cache/`
- Виконати 3 рази, взяти медіану wall-clock і maxRSS (через `/usr/bin/time -l` macOS / `-v` linux — детект з `process.platform`)
- Команди оточуємо `Bun.spawn` + `Bun.nanoseconds()` для wall-clock

## Структура файлів

```
bench/
  README.md                — як запускати
  download-corpus.mjs      — fetch Kodak suite
  codecs/
    sharp.mjs              — adapter
    bun-image.mjs          — adapter
  quality.mjs              — SSIM + DSSIM wrapper
  micro.mjs                — per-codec мікро-бенч → bench/results/micro-YYYY-MM-DDTHH-MM-SS.json
  e2e.mjs                  — підготовка corpus + два CLI-прогони → bench/results/e2e-YYYY-MM-DDTHH-MM-SS.json
  e2e-cli-bun-image.mjs    — форк npm/src/index.js з Bun.Image компресорами
  report.mjs               — JSON → markdown → docs/bench/YYYY-MM-DD-bun-image-vs-sharp.md
  .gitignore               — corpus/**, e2e-corpus/**, results/**
docs/bench/
  YYYY-MM-DD-bun-image-vs-sharp.md  — фінальний звіт, committed
```

**Що комітимо:** harness (`bench/*.mjs`, `bench/README.md`), фінальний звіт.
**Що НЕ комітимо:** корпус, e2e-corpus, raw JSON-результати (sample-of-the-day, артефакт точки в часі — звіт уже містить агрегати).

## Що НЕ робимо

- **Не змінюємо** `npm/src/index.js`. CLI-форк для e2e — окремий файл, який живе тільки в `bench/`.
- **Не додаємо** `bun-image` адаптер у production CLI. Це окреме рішення за результатами замірів.
- **Не пишемо** тести в `demo/test/` для бенчмарку — разовий замір, не behavior.
- **Не комітимо** `package.json` у root з новими залежностями (`ssim.js`). Bench `package.json` — окремий workspace або через `bunx ssim.js`.

## Ризики та обмеження

1. **Платформо-залежність.** `Bun.Image.backend === 'system'` на macOS = Apple ImageIO. На Linux буде інший бекенд (libvips чи нативний код Zig). Результати позначити: «macOS arm64, Bun 1.3.14, ImageIO backend». Linux-replication — follow-up.
2. **Silent option ignoring.** `mozjpeg`, `effort` Bun.Image приймає, але не використовує. У звіті явно зафіксувати поряд із кожним рядком.
3. **JIT variance.** N=10 + median + p95. Якщо σ/median >20% — піднімаємо до N=20.
4. **DSSIM optional.** Якщо бінарка не встановлена — пропускаємо колонку, не падаємо.
5. **«Bun.Image не має effort»** для PNG — це не bench-баг, це властивість Bun.Image. У звіті це аргумент проти переходу, а не методологічна вада.

## Очікувані інсайти

Замір цілеспрямовано перевіряє три гіпотези попереднього ADR:

1. **Чи PNG-розрив зникає з `palette: true`?** Probe вже показав, що Bun.Image теж квантизує — отже за розміром паритет можливий. Залишається питання швидкодії.
2. **Чи Bun.Image AVIF/WebP конкурентний?** Попередній замір AVIF не тестував — це найперспективніша зона для Bun.Image (нативний macOS бекенд).
3. **Чи JPEG-перевага Bun.Image на великих файлах підтверджується на Kodak (фотографічний контент)?** Попередній замір показав +41% швидше на одному файлі — статистично негодящий sample.

## Транзит у implementation plan

Наступний крок — `writing-plans` для розбиття на конкретні задачі:

1. Скрипт завантаження Kodak suite
2. Два адаптери з тестами на ідентичну сигнатуру
3. SSIM/DSSIM quality module
4. Micro-bench orchestrator
5. E2E CLI-форк + orchestrator
6. Report generator
7. Прогін + аналіз → markdown-звіт + або підтвердження поточного ADR, або новий ADR
