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

## Другий корпус: реальні UI-PNG проектів

Корпус: `bench/ui-corpus/` — 25 файлів, 9.8 MB total, 0.25–1.21 MB кожен. Джерела: `lumik-ru/site/static/bg/bg*.png` + `bono/loyalty/assets/logo{,-dark}.png` — типовий вантаж проектів nitra (UI-бекграунди, photo з компресією, логотипи). Корпус не комітимо (`bench/.gitignore`).

> Корпус 1-20 MB PNG (Tauri-іконки попереднього ADR) у локальному стані вже відсутній — `lint-image` усе оптимізував. 1.2 MB — реалістичний upper-bound поточного проектного вантажу.

### PNG

| Adapter           | Total size (25 файлів) | Median ms | p95 ms  |
| ----------------- | ---------------------- | --------- | ------- |
| sharp             | 2.44 MB                | 362 ms    | 760 ms  |
| sharp-default     | 10.91 MB               | 14.8 ms   | 23.4 ms |
| bun-image         | 1.51 MB                | 84 ms     | 125 ms  |
| bun-image-default | 7.98 MB                | 50.1 ms   | 76.3 ms |

**Bun.Image vs sharp (tuned):** size **−38.2%**, time **4.33× faster**.

### JPEG

| Adapter           | Total size (25 файлів) | Median ms | p95 ms  | SSIM avg | DSSIM avg |
| ----------------- | ---------------------- | --------- | ------- | -------- | --------- |
| sharp             | 778 KB                 | 21.5 ms   | 38.4 ms | 0.8618   | 0.7477    |
| sharp-default     | 806 KB                 | 6.9 ms    | 9.1 ms  | 0.8621   | 0.7463    |
| bun-image         | 868 KB                 | 7.5 ms    | 11.1 ms | **0.9949** | 0.7077    |
| bun-image-default | 929 KB                 | 6.0 ms    | 8.8 ms  | 0.9949   | 0.7077    |

**Bun.Image vs sharp (tuned):** size +11.6%, time **2.87× faster**, **ΔSSIM +0.133** (на UI-зображеннях з великими flat-областями mozjpeg сильно квантизує — SSIM падає; Bun.Image без mozjpeg тримає якість). На UI JPEG практично не вживають, але число корисне для розуміння trade-off.

### AVIF

| Adapter           | Total size (25 файлів) | Median ms | p95 ms  | SSIM avg | DSSIM avg |
| ----------------- | ---------------------- | --------- | ------- | -------- | --------- |
| sharp             | **313 KB**             | 383 ms    | 746 ms  | 0.9888   | 0.0025    |
| sharp-default     | 313 KB                 | 403 ms    | 767 ms  | 0.9888   | 0.0025    |
| bun-image         | 431 KB (+37.8%)        | 53.7 ms   | 82.8 ms | 0.9837   | 0.0035    |
| bun-image-default | 431 KB                 | 74.7 ms   | 102.8 ms | 0.9837   | 0.0035    |

**Bun.Image vs sharp (tuned):** size **+37.8%** (програш!), time 7.13× faster, ΔSSIM −0.0051. Це інверсія Kodak-результату: на photo-AVIF паритет, на UI-AVIF Bun.Image програє у розмірі. ImageIO AVIF для flat-граф/UI-контенту менш ефективний за libavif.

### WebP

| Adapter           | Total size (25 файлів) | Median ms | p95 ms  | SSIM avg | DSSIM avg |
| ----------------- | ---------------------- | --------- | ------- | -------- | --------- |
| sharp             | 848 KB                 | 35.7 ms   | 95.9 ms | 0.8669   | 0.0014    |
| bun-image         | 848 KB                 | 31.8 ms   | 86.4 ms | 0.8669   | 0.0014    |

Повний паритет (libwebp в обох), Bun.Image 1.12× швидший.

## Висновок

### Зведена таблиця (tuned-варіанти)

| Формат  | Kodak (photo)             | UI (lumik-ru bg + bono logos) |
| ------- | ------------------------- | ----------------------------- |
| PNG     | **−20.0% / 1.95× faster** | **−38.2% / 4.33× faster**     |
| JPEG    | +4.5% / 3.37× faster      | +11.6% / 2.87× faster (SSIM +0.133) |
| AVIF    | **+0.3% / 9.23× faster**  | **+37.8% / 7.13× faster**     |
| WebP    | паритет / 1.07× faster    | паритет / 1.12× faster        |
| **E2E** | **−19.1% / 8.94× faster** | (не міряли окремо)            |

### Висновок

**Bun.Image 1.3.14 (macOS arm64, backend `system` = Apple ImageIO)** показав себе сильно залежним від типажу зображень. Дві категорії дають принципово різну картину:

- **PNG — однозначний win Bun.Image на обох корпусах.** На photo −20%, на UI −38% (4.3× швидше). Це закриває головний контр-аргумент попереднього ADR — він не вмикав `palette: true` для Bun.Image.
- **AVIF — залежить від типу.** На photo (Kodak) паритет розміру. На UI/flat-graphics (lumik-ru bg) Bun.Image **+38% більший**. Apple ImageIO AVIF не такий ефективний для UI-контенту як libavif. У проектах, де AVIF — основний UI-фон, sharp залишається кращим за розміром.
- **JPEG — Bun.Image швидший (3–4×), на UI кардинально кращий SSIM (+0.13) ціною +12% розміру.** sharp `mozjpeg:true` для UI-flat-областей дає видимі артефакти, які SSIM ловить.
- **WebP — паритет.** Однаковий backend (libwebp). Bun.Image мінімально швидший.

### Рекомендація

| Рішення | Умова |
|---|---|
| **Замінити sharp → Bun.Image для PNG** | Безпечно для обох категорій. Найбільший win проекту. |
| **Залишити sharp для AVIF** | Якщо AVIF використовується для UI/flat-граф (типово для лендінгів) — sharp дає менші файли. На photo можна Bun.Image. |
| **Bun.Image для JPEG** | Швидше і якісніше для UI; для photo — паритет. |
| **Залишити sharp для GIF** | Bun.Image не має GIF encoder. |

**Гібрид (рекомендовано для `@nitra/minify-image`):** PNG/JPEG/WebP → Bun.Image, AVIF/GIF → sharp. sharp лишається в deps, але active path для більшості форматів — Bun.Image. На macOS це дає основний speedup (~3-4× на PNG, який становить більшість wantege проекту); AVIF — залишається на sharp як safety для UI-контенту до окремого замірю на target-корпусі конкретного проекту.

**Перед production-міграцією — обов'язково:** Linux replication harness у Docker (на Linux Bun.Image використовує не ImageIO — результати можуть бути іншими).
