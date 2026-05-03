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

When run with `--write`, the CLI maintains `<src>/.minify-image-cache.tsv` —
one tab-separated line per image:
`<relative-path>\t<mtime>\t<originalSize>\t<size>`.

On the next run each file is matched by a single `stat` syscall — when
`(size, mtime)` match the cached tuple, the file is skipped without reading
its contents. Re-runs of `npx @nitra/minify-image` in the same directory are
therefore cheap (constant time per file, independent of image size) and
survive ephemeral `node_modules`.

`originalSize` records the size BEFORE the first compression and stands next
to `size` so you can eyeball the savings per file in any editor. The CLI
prints `Project lifetime savings: X (Y% across N files)` at the end of every
`--write` run, computed as `Σ(originalSize − size)` across cache entries.

Lines are sorted alphabetically so the cache produces a clean git diff if you
choose to commit it. Otherwise add it to `.gitignore`:

```text
.minify-image-cache.tsv
```
