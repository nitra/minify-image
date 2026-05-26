# Bun.Image vs sharp — Benchmark Report

**Дата:** 2026-05-26
**Платформа:** darwin-arm64, Bun 1.3.14, Bun.Image backend: `system`
**Корпус (micro):** kodak (24 PNG), N=10 runs per file
**Корпус (e2e):** Kodak 24 PNG + demo/test/files (jpeg/gif/svg), N=3 runs
**Спец:** `docs/superpowers/specs/2026-05-26-bun-image-vs-sharp-benchmark-design.md`

## Per-codec micro-bench

Колонки: total size (24 файли), median ms per file, p95 ms, average SSIM (lossy), average DSSIM (lossy).
Tuned-варіанти (`sharp`, `bun-image`) — параметри з `npm/src/index.js`. `*-default` — без extras (no palette/progressive/mozjpeg/effort) для квантифікації втрат.

### PNG

| Adapter           | Total size (24 файли) | Median ms | p95 ms  | SSIM avg | DSSIM avg |
| ----------------- | --------------------- | --------- | ------- | -------- | --------- |
| sharp             | 5.38 MB               | 243 ms    | 432 ms  | —        | —         |
| sharp-default     | 17.72 MB              | 17.7 ms   | 20.2 ms | —        | —         |
| bun-image         | 4.30 MB               | 125 ms    | 134 ms  | —        | —         |
| bun-image-default | 16.47 MB              | 56.7 ms   | 59.0 ms | —        | —         |

**Bun.Image vs sharp (tuned):** size -20.0%, time -48.7% (1.95× faster)

### JPEG

| Adapter           | Total size (24 файли) | Median ms | p95 ms  | SSIM avg | DSSIM avg |
| ----------------- | --------------------- | --------- | ------- | -------- | --------- |
| sharp             | 1.42 MB               | 31.6 ms   | 44.7 ms | 0.9897   | 0.0018    |
| sharp-default     | 1.51 MB               | 6.4 ms    | 7.0 ms  | 0.9903   | 0.0020    |
| bun-image         | 1.48 MB               | 9.4 ms    | 11.4 ms | 0.9903   | 0.0020    |
| bun-image-default | 1.54 MB               | 5.6 ms    | 6.2 ms  | 0.9903   | 0.0020    |

**Bun.Image vs sharp (tuned):** size +4.5%, time -70.3% (3.37× faster), ΔSSIM 0.0006

### AVIF

| Adapter           | Total size (24 файли) | Median ms | p95 ms  | SSIM avg | DSSIM avg |
| ----------------- | --------------------- | --------- | ------- | -------- | --------- |
| sharp             | 558.2 KB              | 505 ms    | 695 ms  | 0.9703   | 0.0063    |
| sharp-default     | 558.2 KB              | 504 ms    | 694 ms  | 0.9703   | 0.0063    |
| bun-image         | 560.0 KB              | 54.7 ms   | 82.4 ms | 0.9665   | 0.0080    |
| bun-image-default | 560.0 KB              | 54.9 ms   | 82.3 ms | 0.9665   | 0.0080    |

**Bun.Image vs sharp (tuned):** size +0.3%, time -89.2% (9.23× faster), ΔSSIM -0.0038

### WEBP

| Adapter           | Total size (24 файли) | Median ms | p95 ms  | SSIM avg | DSSIM avg |
| ----------------- | --------------------- | --------- | ------- | -------- | --------- |
| sharp             | 1.37 MB               | 33.1 ms   | 40.2 ms | 0.9897   | 0.0020    |
| sharp-default     | 1.37 MB               | 33.3 ms   | 40.4 ms | 0.9897   | 0.0020    |
| bun-image         | 1.37 MB               | 30.9 ms   | 37.6 ms | 0.9897   | 0.0020    |
| bun-image-default | 1.37 MB               | 30.9 ms   | 37.6 ms | 0.9897   | 0.0020    |

**Bun.Image vs sharp (tuned):** size +0.0%, time -6.7% (1.07× faster), ΔSSIM 0.0000

## E2E CLI (full project run)

Повний прогін `npm/src/index.js` (sharp) та `bench/e2e-cli-bun-image.mjs` на корпусі.
Cache + corpus seed-иться заново перед кожним прогоном (`--write` мутує файли).
Прапори: `--src=<e2e-corpus> --write --avif` (тобто з AVIF-генерацією поряд із кожним PNG/JPEG).

| CLI       | Median wall-clock | Output size (sum) | Runs (ms)           |
| --------- | ----------------- | ----------------- | ------------------- |
| sharp     | 25045 ms          | 7.79 MB           | 24885, 25045, 25084 |
| Bun.Image | 2802 ms           | 6.30 MB           | 2890, 2781, 2802    |

**Bun.Image vs sharp:** time -88.8% (8.94× faster), output size -19.1%

## Обмеження

- `Bun.Image` ігнорує опції `mozjpeg` (JPEG) та `effort` (PNG) silently.
- GIF encoding у Bun.Image відсутній — у форку лишається sharp для GIF.
- SVG-стиснення йде через svgo, кодек ні до чого.
- Backend Bun.Image платформо-залежний (`system` на цій платформі). Linux/Windows можуть відрізнятись — на macOS це Apple ImageIO з можливою hardware acceleration (Neural Engine / Media Engine для AVIF).
- DSSIM колонка є тільки якщо встановлено `dssim` CLI (`brew install dssim`).
- Корпус — Kodak suite (24 фото 768×512). Великі UI-PNG (1-20 MB) можуть поводитись інакше — попередній ADR (`docs/adr/_inbox/20260526-054228-bun-image-benchmark.md`) на саме такому корпусі показав протилежну картину для sharp PNG.

## Висновок

### Зведена таблиця (tuned-варіанти)

| Формат  | Розмір Bun.Image vs sharp | Speedup (micro) | ΔSSIM                      |
| ------- | ------------------------- | --------------- | -------------------------- |
| PNG     | **−20.0%**                | 1.95×           | — (lossless)               |
| JPEG    | +4.5%                     | 3.37×           | +0.0006 (краще)            |
| AVIF    | **+0.3%**                 | **9.23×**       | −0.0038 (мінімально гірше) |
| WebP    | 0.0%                      | 1.07×           | 0.0000                     |
| **E2E** | **−19.1%**                | **8.94×**       | —                          |

### Висновок

**Bun.Image 1.3.14 (macOS arm64, backend `system`)** є де-факто конкурентоспроможним замінником sharp для PNG, AVIF та WebP:

- **PNG:** Bun.Image з `palette: true, compressionLevel: 9` дає _менші_ файли ніж sharp (−20%) і вдвічі швидше. Контрінтуїтивний результат — можливо завдяки Apple ImageIO hardware-accel для palettization.
- **AVIF:** майже рівноцінні файли (+0.3%), але **9× швидше**. Попередній ADR (20260526-054228) показав +55% — ймовірно через різний корпус або параметри.
- **JPEG:** +4.5% більший файл (через відсутність mozjpeg), але 3.4× швидше. Якість вища (SSIM +0.0006).
- **WebP:** ідентичний результат при рівній швидкості.
- **E2E CLI:** 8.94× швидше, −19.1% менший сумарний вивід (з AVIF-генерацією).

### Рекомендація

| Рішення                                           | Умова                                                                                                                                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Замінити sharp на Bun.Image** для PNG/AVIF/WebP | Якщо готові прийняти: (1) GIF залишається sharp або gif-encoder знаходиться окремо; (2) Platform lock-in на macOS arm64 до верифікації Linux; (3) можлива нестабільність API — Bun.Image є новим (v1.3.14). |
| **Залишити sharp**                                | Якщо GIF-підтримка критична, або потрібна Linux-сумісність, або mozjpeg JPEG має значення.                                                                                                                  |

**Гібрид (рекомендовано для @nitra/minify-image):** Bun.Image для PNG/AVIF/WebP + sharp тільки для GIF — мінімальна dep-зміна, максимальний виграш швидкості в E2E. Підтвердити після Linux benchmarks (Docker, libvips backend).
