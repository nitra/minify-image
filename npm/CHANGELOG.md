# Changelog

Усі помітні зміни в `@nitra/minify-image` зберігаються в цьому файлі.

Формат — [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/).

## [4.0.0] - 2026-05-27

### Changed

- Кодек PNG/JPEG/AVIF замінено з `sharp` на вбудований `Bun.Image` (Bun ≥ 1.3).
  На macOS (Apple ImageIO backend) — у 4–9× швидше за sharp, розмір файлів
  PNG/JPEG порівнюваний або менший. AVIF: паритет на фото-контенті, +38% на
  flat UI-контенті — прийнятний trade-off за повне видалення native binary.
- `sharp` видалено з `dependencies`. Заміряно `bun add @nitra/minify-image` у
  чистій директорії (macOS arm64): з sharp — 28 MB, без — 11 MB,
  **delta −17 MB**. На Linux/Windows економія зазвичай більша через multi-arch
  libvips binaries у `@img/sharp-libvips-*`.
- Параметри стиснення: PNG `palette: true, compressionLevel: 9`; JPEG `quality: 75,
  progressive: true`; AVIF `quality: 40`.

### Removed

- Підтримку GIF (`--gif`/`.gif`) видалено: `Bun.Image` не має GIF encoder.
  Файли `.gif` зустрічає CLI з `consola.warn` і пропускає без обробки.
  Рекомендація для наявних GIF: конвертуйте в WebP/MP4 або стискайте
  окремо через `gifsicle`.

## [3.6.0] - 2026-05-10

### Added

- `**/src-tauri/icons/**` тепер у дефолтному exclude-списку поряд з
  `node_modules`/`vendor`/`test`/`dist`/`**/.*/**`. Tauri фіксує цей шлях
  як канонічну локацію іконок (генерується `tauri icon` CLI); попередня
  поведінка — palette-квантизація RGBA-PNG — ламала
  `tauri::generate_context!` (panic «icon … is not RGBA»). За тим самим
  принципом сегмент `src-tauri/icons` додано до AVIF-skip-сету (`.icns`/`.ico`
  поряд з PNG однаково AVIF-генерувати немає сенсу).

## [3.5.0] - 2026-05-10

### Changed

- `svgo` оновлено `3.3.2 → 4.0.1`. У `preset-default` v4 плагіни
  `removeViewBox` і `removeTitle` тепер вимкнено за замовчуванням
  (раніше були ввімкнені) — `viewBox` залишається в SVG (масштабованість
  не псується), `<title>` зберігається (доступність). Якщо потрібно
  повернути попередню агресивну поведінку — додати їх явно у конфіг
  плагінів. Деталі — [SVGO release notes](https://github.com/svg/svgo/releases).
- `sharp` оновлено `0.34.1 → 0.34.5` (patch).
- `p-limit` оновлено `7.1.1 → 7.3.0` (minor).

## [3.4.0] - 2026-05-09

### Added

- `--avif` тепер поважає per-package opt-out: якщо найближчий вгору
  `package.json` містить `"@nitra/minify-image": { "disable-avif": true }`,
  AVIF-двійник для зображень усередині цього пакета не створюється.
  Звичайне стиснення оригіналу продовжує працювати — опт-аут стосується
  тільки AVIF. Узгоджено з правилом `image-avif` у `@nitra/cursor`: обидві
  сторони читають той самий прапорець, тож генерація AVIF і прибирання
  «осиротілих» AVIF лишаються синхронними. Раніше згенеровані `.avif`-файли
  всередині opt-out пакета сам мініфікатор не чіпає; після першого вмикання
  прапорця їх потрібно прибрати разово вручну, далі вони не з'являтимуться:
  `find <pkg> -name "*.avif" -delete`.
- Внутрішній кеш `dirAvifOptOutCache` (Map по абсолютному каталогу) — на
  тисячі зображень в одному пакеті `package.json` читається один раз,
  не один раз на файл. Шлях вгору від файла припиняється на першому
  знайденому `package.json`, тож прапорець у workspace-пакеті не вимагає
  дублювання у root-`package.json`. Битий `package.json` (невалідний JSON)
  не валить CLI — обробляється як «opt-out не виявлено», пошук іде вище.

## [3.3.3] - 2026-05-09

### Added

- `npm/jsconfig.json` — канонічний editor-конфіг (`NodeNext`, `include: src/**/*`)
  згідно правила `js-run` для backend-пакетів зі структурою `src/`.

## [3.3.2] - 2026-05-09

### Changed

- `--avif` пропускає build-output, wrapper- та cache-директорії: `dist/`,
  `build/`, `android/`, `ios/`, `.output/`, `.nuxt/`, `.cache/`. Більшість
  з них уже зрізала глобальна `ignore`-логіка (`**/dist/**`, `**/.*/**`),
  але `build/`, `android/`, `ios/` глобально не зрізалися — там можуть
  бути валідні committed-картинки (Capacitor-wrapper копії, кастомні
  build-виходи), які треба мініфікувати, проте AVIF поряд з ними
  безглуздий: native iOS/Android runtime його не читає, а наступний
  `cap sync` / build стирає сусідній `.avif`. Тому AVIF-генерацію в цих
  директоріях вимикаємо точково; мініфікація оригіналу й далі працює.
  Збіг — по сегменту відносного шляху (regex `(?:^|[/\\])(?:dist|...)
(?:[/\\]|$)`), тож проєкт з ім'ям `dist-doc/` чи папка `built/` повз
  фільтр не пройде.

## [3.3.1] - 2026-05-07

### Added

- Регресійні тести AVIF↔source coherency: AVIF повторно кодується, коли
  (а) SHA-1 оригіналу не збігається з записом у `.n-minify-image.tsv`,
  (б) `.avif` зник з диска при cache hit, (в) запису в TSV ще нема (перший
  прогін або upgrade з 3.1). Лишається байт-у-байт стабільним при повторних
  запусках на незмінному оригіналі. Без `--avif` PNG/JPEG/GIF стискається,
  але `<src>.avif` не чіпається. Реалізовано через `sharp({ create })`
  (solid-color PNG двох кольорів дають детермінований AVIF-diff). Покриває
  граничний випадок з 3.2.0+: AVIF не лишається застарілим після
  редагування оригіналу.

### Changed

- README: секція `## AVIF companion files` явно перелічує три умови
  повторної генерації (`.avif` відсутній / SHA-1 не збігається / нема
  запису в TSV) і фіксує no-op-поведінку, коли оригінал не змінювався.

## [3.3.0] - 2026-05-06

### Added

- Per-block license-aware preservation для SVG. Коментарі та `<metadata>`
  скануються індивідуально; лишаються лише блоки з маркерами ліцензій,
  що вимагають атрибуції (CC BY, MIT, BSD, Apache, ISC, (L|A)GPL, MPL,
  EPL, OFL, Zlib, Artistic, copyright/©) або CC0+© парою. Інструментальні
  блоки на кшталт `<!-- generated by Sketch -->`, `<!-- Created by Inkscape -->`
  та permissive-only без атрибуції (CC0, Public Domain, Unlicense, WTFPL)
  стрипаються. Реалізація: SVGO `removeComments.preservePatterns` для
  коментарів і власний плагін `filterLicenseMetadata` (бо `removeMetadata`
  опції `preservePatterns` не має). Покриває Font Awesome (CC BY 4.0 + OFL +
  MIT в одному коментарі) і RDF-метадані з URL-атрибуцією
  (`<cc:license rdf:resource="https://creativecommons.org/licenses/by/4.0/"/>`).

## [3.2.5] - 2026-05-06

### Fixed

- SVG-sprite (Font Awesome — `<svg style="display:none">` з набором
  `<symbol id="...">`, на які посилаються ззовні через
  `<use href="file.svg#id">`) більше не «оптимізується» в порожній файл.
  SVGO про зовнішні посилання не знає: `removeHiddenElems` зрізає весь
  вміст прихованого кореня, а `cleanupIds` стирає ID, які виглядають
  невикористаними в межах файлу — `<symbol>`-и стають сиротами і теж
  видаляються; підсумок — 458 KB → 38 байт, лишається тільки XML-декларація.
  Детектимо два сигнали (`display:none` на корені або ≥2 `<symbol>` у файлі)
  і повністю пропускаємо оптимізацію — буфер повертається як є.

## [3.2.4] - 2026-05-06

### Added

- CLI-опція `--ignore=<glob>` (повторювана) — дозволяє виключати з обробки
  додаткові шляхи поза дефолтами. Приклад:
  `npx @nitra/minify-image --src=. --write --ignore="docs/**"`.
  Дефолтні ignore лишаються активними завжди — користувацькі додаються згори.

### Changed (ignore defaults)

- Розширено вшитий список ignore: додано `**/.*/**` (усі dot-директорії
  на кшталт `.git`, `.next`, `.cache`, `.idea` — технічні артефакти, не
  вихідні зображення) і `**/dist/**` (згенеровані збірки — копії з `src/`,
  повторне стиснення безглузде). Повний дефолтний список:
  `node_modules`, `vendor`, `test`, `**/.*/**`, `dist`.

### Changed

- SVGO `preset-default` запускається з overrides замість дефолтних:
  `convertColors.shortname: false` — щоб `rgba(...,0)` в _атрибутах_
  (`fill="rgba(...)"`) не схлопувався в `transparent`; `minifyStyles: false` —
  щоб csso всередині `minifyStyles` не робив тієї ж конвертації для CSS у
  `style="fill: rgba(...)"` (csso ігнорує опції `convertColors`, єдиний спосіб —
  вимкнути плагін цілком); `removeXMLProcInst: false` — щоб зберігалась
  `<?xml version="1.0" ?>`. Мотивація: семантично `transparent` рівнозначно
  `rgba(...,0)`, але SourceTree та подібні рендерери з темною темою показують
  такий запис як темне тло замість прозорого, а без XML-декларації частина
  парсерів змінює режим рендерингу. Інші стиснення кольорів (`names2hex`,
  `rgb2hex`, `shorthex`) і решта плагінів preset-default (mergePaths,
  convertPathData, cleanupNumericValues тощо) працюють як раніше.

## [3.2.2] - 2026-05-06

### Fixed

- Виведення `NaN%` у підсумкових рядках `Images optimized` / `Estimated saving`,
  коли `glob` не знайшов жодного зображення (`stats.orig === 0`): `calcPercent`
  при ділені `0/0` повертав `NaN`. Тепер при порожньому наборі показуємо `0%`.

## [3.2.1] - 2026-05-03

### Fixed

- Імпорт `consola` через named export `{ consola }` замість default — усуває
  попередження `eslint-plugin-import/no-named-as-default` під час `bun lint-js`.

## [3.2.0] - 2026-05-03

### Added

- Split-cache: новий `<src>/.n-minify-image.tsv` (формат
  `path\tsha1\toriginalSize\tsize`) — закомічений source of truth для
  slow-path і `Project lifetime savings`. Новий
  `<src>/node_modules/.cache/@nitra/minify-image/mtime.tsv` (формат
  `path\tmtime\tsize`) — локальний fast-path під `node_modules/`,
  авто-gitignored за конвенцією JS-tooling-у (ESLint, Babel, webpack
  кешуються там же). Дворівнева перевірка: при збігу `(size, mtime)` —
  skip без читання (як було); при mtime mismatch — read+SHA-1 проти
  закоміченого hash-cache, на match warm локальний mtime cache і skip.
  `git clone`/`git checkout` тепер не викликає reprocess: hash переживає,
  mtime відновлюється.
- SHA-1 — через вбудований `node:crypto`, без нових залежностей.

### Changed

- `<src>/.minify-image-cache.tsv` (4 колонки `path\tmtime\toriginalSize\tsize`)
  замінено на два файли — див. вище. При першому запуску `originalSize`/`size`
  зі старого файлу автоматично переїжджають у `.n-minify-image.tsv` (з порожнім
  hash, що змусить пройти slow-path без reprocess і записати справжній SHA-1).
  Старий файл лишається на диску — користувач видаляє його вручну (`git rm
--cached .minify-image-cache.tsv` + `rm`), у README є інструкція.
- README: секція `## Cache` переписана під два файли + блок Migration.
  Рекомендація — комітити `.n-minify-image.tsv`. Локальний `mtime.tsv`
  лежить у `node_modules/.cache/` і не потребує окремого `.gitignore`-рядка.
- `Project lifetime savings` тепер рахується з закоміченого hash-cache —
  переживає `git clone` (раніше скидався, бо TSV був гітignored).

## [3.1.0] - 2026-05-03

### Added

- Прапорець `--avif`: у режимі `--write` поряд з кожним растровим файлом
  (PNG/JPEG/GIF) створюється `<name>.<ext>.avif` (наприклад,
  `hero.png` → `hero.png.avif`) із якістю 40, закодований з ОРИГІНАЛУ до
  основної компресії — щоб не накладати артефакти двох кодеків. Розширення
  оригіналу зберігається в імені AVIF, тож `hero.png` і `hero.jpg` не цілять
  в один `hero.avif`. SVG ігнорується (вектор → AVIF безглуздий).
  На cache hit AVIF створюється лише якщо його ще нема; на cache miss —
  перезаписується.

## [3.0.0] - 2026-05-03

### Changed

- Рушій компресії: `imagemin` → `sharp` (libvips) для PNG/JPEG/GIF; SVG —
  через `svgo` напряму. PNG: `palette: true, effort: 10, compressionLevel: 9`
  (≈pngquant + zopfli). JPEG: `mozjpeg: true, progressive: true` одним проходом
  (раніше було два — mozjpeg і jpegtran). GIF: `animated: true, effort: 10`.
- JPEG-стадія тепер одна — підсумковий `All image size` більше не подвоює
  розмір JPEG-файлів через cache-hit на другому проході.
- Файли обробляються **паралельно** через `p-limit` із межею
  `os.availableParallelism()` (раніше — послідовний `for…of await`). Sharp
  переведено в режим `concurrency(1)`: один потік на операцію, N паралельних
  операцій — рекомендований патерн sharp для batch-обробки. Прискорення
  ≈ кількість CPU на репозиторіях зі значною кількістю зображень.
- Один `glob('**/*.{png,jpg,jpeg,gif,svg}')` замість чотирьох окремих —
  один прохід ФС, вибір компресора за розширенням файлу.
- CLI-парсер: `command-line-args` + `command-line-usage` → вбудований
  `node:util#parseArgs`. Поверхня прапорців не змінилась: `--write`,
  `--src=<dir>` (або позиційний), `-h/--help`.

### Added

- `sharp.cache(false)` на старті — не тримати LRU декодованих зображень
  (у batch-обробці повторного декодування не буває).
- Залежності: `sharp ^0.34.1`, `svgo ^3.3.2`, `p-limit ^7.1.1`.

### Removed

- Залежності: `imagemin`, `imagemin-gifsicle`, `imagemin-jpegtran`,
  `imagemin-mozjpeg`, `imagemin-pngquant`, `imagemin-svgo`, `imagemin-zopfli`
  — вся екосистема замінена на `sharp` (один prebuilt-бінарник на платформу)
  і `svgo` (pure-JS).
- Залежності: `command-line-args`, `command-line-usage` — заміна на
  `node:util#parseArgs` (мінус 4 транзитивні пакети, швидший `npx`-старт).

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
