# Changelog

Усі помітні зміни в `@nitra/minify-image` зберігаються в цьому файлі.

Формат — [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/).

## [2.0.5] - 2026-05-02

### Added

- 4-та колонка в TSV-cache — `originalSize` (розмір ДО першої компресії).
- Підсумковий рядок `Project lifetime savings: X (Y% across N files)` —
  накопичена економія по всьому проєкту, рахується з cache: `Σ(originalSize − size)`.

### Changed

- Порядок колонок у TSV: `<rel-path>\t<mtime>\t<originalSize>\t<size>`.
  `originalSize` і `size` стоять поряд — легко порівняти візуально в редакторі.

## [2.0.4] - 2026-05-02

### Changed

- Cache-формат: JSON → TSV (`<rel-path>\t<size>\t<mtime>\n`). Шляхи відносні
  до `--src`, рядки відсортовані за шляхом — git показує осмислений diff.
  Файл називається `.minify-image-cache.tsv`. Розмір на ~60% менший за JSON.
- Cache завантажується/зберігається ОДИН раз за прогін (раніше — у кожному
  з 5 викликів `compress()`).

### Removed

- Залежність `flat-cache` (≈30 рядків мінімального TSV-loader/saver замість бібліотеки).

## [2.0.3] - 2026-05-02

### Changed

- Cache-ключ замінено з SHA-1 вмісту на tuple `(size, mtimeMs)` per-path.
  На cache hit файл взагалі не читається — тільки один `statSync`. Повторний
  запуск `npx @nitra/minify-image` тепер у ~100× швидший (≈0.35 с проти ≈30 с
  на 7 файлах) і не залежить від розміру зображень.

### Removed

- Залежність від `node:crypto` (SHA-1 хешування вмісту більше не потрібне).

## [2.0.2] - 2026-05-02

### Changed

- Cache-файл переїхав з `node_modules/flat-cache/.cache/minify-image` у `<src>/.minify-image-cache.json`
  — тепер пережив `npx`-запуски (де `node_modules` ефемерний) і прив'язаний до проєкту,
  не до глобального встановлення.

## [2.0.1] - 2026-05-01

### Added

- Згенеровані `types/index.d.ts` для публікації разом із пакетом.
- Поле `types` у `package.json` і запис `types` у `files`.
- `engines` для Node `>=24` та Bun `>=1.3`.

### Changed

- Перехід на ESM, Bun як єдиний package manager.

## [2.0.0] - 2025-01-01

### Added

- Перший публічний реліз під `@nitra/minify-image`.
