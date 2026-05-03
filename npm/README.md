# Minify images (PNG, JPEG, GIF, SVG)

[![view on npm](https://img.shields.io/npm/v/@nitra/minify-image.svg)](https://www.npmjs.org/package/@nitra/minify-image)
[![npm module downloads](https://img.shields.io/npm/dt/@nitra/minify-image.svg)](https://www.npmjs.org/package/@nitra/minify-image)
[![license](https://img.shields.io/npm/l/@nitra/minify-image.svg)](https://github.com/nitra/minify-image/blob/main/LICENSE)

Minify images in directory, if compressed size lower than 15%

## Example run

```bash
npx @nitra/minify-image --src=.
```

## Options

```text
--write           If not set, only estimate size difference
--src directory   The directory to process.
--avif            With --write, create <name>.<ext>.avif (quality 40) next
                  to each raster image (PNG/JPEG/GIF) before compressing the
                  original.
-h, --help        Print this usage guide.
```

## AVIF companion files

With `--write --avif`, each raster image (`.png`/`.jpg`/`.jpeg`/`.gif`) gets a
sibling `<name>.<ext>.avif` (e.g. `hero.png` → `hero.png.avif`) encoded from
the **original** bytes (quality 40) before the original is compressed in
place. The full source extension is kept in the AVIF filename so two images
that share a basename (`hero.png` and `hero.jpg`) do not collide on the same
`hero.avif`. SVG is skipped (vector → AVIF is pointless). On a cache hit the
AVIF is created only when the file is missing; on a cache miss it is
rewritten so it stays in sync with edits to the source image.

## Cache

When run with `--write`, the CLI maintains two TSV files with different
roles and locations:

### `<src>/.n-minify-image.tsv` — committed source of truth

Per line: `<relative-path>\t<sha1-hex>\t<originalSize>\t<size>`.

This file is the slow-path cache and the source for
`Project lifetime savings`. **Commit it.** Lines are sorted alphabetically;
the SHA-1 column changes only when content actually changes — diffs stay
minimal.

After `git clone` or `git checkout` (which reset file `mtime` to checkout
time), the CLI reads each file, computes its SHA-1, compares to the cached
hash; on match the local mtime cache is warmed and no reprocessing happens.
`originalSize` records the size BEFORE the first compression, fed to
`Project lifetime savings: X (Y% across N files)` printed at the end of
each `--write` run.

### `<src>/node_modules/.cache/@nitra/minify-image/mtime.tsv` — local fast path

Per line: `<relative-path>\t<mtime>\t<size>`.

When `(size, mtime)` match the cached tuple, the file is skipped without
reading — constant time per file, ideal for the warm dev-loop on a single
machine. Lives under `node_modules/` so it is automatically gitignored
(matches the convention used by ESLint, Babel, webpack, Turbo, etc.).
`rm -rf node_modules` wipes it; the next run rebuilds it via the slow
path against `.n-minify-image.tsv` — no images are reprocessed.

### Migration from versions < 3.2

Earlier versions kept a single `<src>/.minify-image-cache.tsv` (4 columns:
`path\tmtime\toriginalSize\tsize`), usually gitignored. On first run after
upgrade:

1. The new files are created — `<src>/.n-minify-image.tsv` is seeded with
   `originalSize`/`size` from the old TSV (with empty hash placeholder),
   so `Project lifetime savings` does not reset.
2. Each file goes through the slow path (empty hash means cache miss);
   SHA-1 is computed and stored. **No reprocessing happens** unless a
   file's content actually changed.
3. The old `.minify-image-cache.tsv` is left in place — remove it manually:

   ```bash
   git rm --cached .minify-image-cache.tsv 2>/dev/null || true
   rm -f .minify-image-cache.tsv
   ```

   Add `.n-minify-image.tsv` to git, ensure `node_modules/` covers the local
   cache (it usually already does).
