## ADR Bun.Image потенційно є конкурентоспроможним замінником sharp — підтверджено методологічно виправленим бенчмарком

**Контекст:** Попередній ADR (`20260526-054228-bun-image-benchmark.md`) зробив висновок «залишити sharp» без `palette: true` для PNG та `mozjpeg` для JPEG у Bun.Image і без метрик якості (SSIM/DSSIM). Цей ADR — переоцінка з Kodak corpus (24 PNG, 768×512, академічний стандарт), apples-to-apples параметрами та SSIM + DSSIM 3.5.0. Harness: `bench/`, звіт: `docs/bench/2026-05-26-bun-image-vs-sharp.md`.

**Рішення:** Рекомендовано гібридний підхід — Bun.Image для PNG/AVIF/WebP + sharp тільки для GIF. Повна заміна sharp не рекомендується поки не верифіковано на Linux.

**Обґрунтування результатів:**

- **PNG:** Bun.Image −20% менше, 1.95× швидше (порівняно з tuned sharp, обидва з `palette: true`).
- **AVIF:** Bun.Image +0.3% більше, **9.23× швидше**; ΔSSIM = −0.0038 (мінімально гірша якість).
- **JPEG:** Bun.Image +4.5% більше, 3.37× швидше; SSIM навіть вищий (+0.0006).
- **WebP:** Bun.Image ідентичний розмір і якість, 1.07× швидше.
- **E2E CLI (с --avif):** Bun.Image 8.94× швидше, −19.1% менший сумарний вивід.

**Обмеження:**

- GIF encoder у Bun.Image відсутній — для GIF залишається sharp.
- `mozjpeg`, `effort` ігноруються silently на macOS ImageIO.
- Backend = `system` (macOS ImageIO, можлива Apple Neural Engine / Media Engine акселерація). Linux = libvips — результати невідомі.

**Розглянуті альтернативи:**

- Повна заміна sharp — відхилено через GIF та Platform lock-in.
- Залишити sharp (попередній ADR) — відхилено через суттєвий E2E speedup і рівноцінну/кращу компресію.

**Зачіпає:** `npm/src/index.js` (не змінено), `bench/` (новий harness), `docs/bench/2026-05-26-bun-image-vs-sharp.md` (повний звіт).

**Follow-up:** Перепрогнати бенч у Linux Docker (libvips backend); якщо результати схожі — мігрувати PNG/AVIF/WebP на Bun.Image.
