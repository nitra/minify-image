# Bench: Bun.Image vs sharp

Standalone harness — не workspace. Запуск:

```bash
cd bench
bun install
bun run all      # corpus → tests → micro → e2e → report
```

Або по кроках: `bun run corpus`, `bun run micro`, etc.

DSSIM (optional, для повного quality-звіту):

```bash
brew install dssim   # macOS
# або: cargo install dssim
```

Без DSSIM — колонка пропускається, SSIM залишається.

Платформа: результати позначені платформо/бекенд-комбо (`Bun.Image.backend`).

Spec: `../docs/superpowers/specs/2026-05-26-bun-image-vs-sharp-benchmark-design.md`
Plan: `../docs/superpowers/plans/2026-05-26-bun-image-vs-sharp-benchmark.md`
