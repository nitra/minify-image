# Architecture (C4 model)

Source of truth for `@nitra/minify-image` design. Read this **before** any
change that adds/removes integrations, components, or shifts dependency
direction. Update this file in the same PR as the code change — see
[`.cursor/rules/n-ci4.mdc`](../../.cursor/rules/n-ci4.mdc).

Notation: [C4 model](https://c4model.com). Mermaid `C4Context` /
`C4Container` / `C4Component` blocks render natively on GitHub; the source
text is also readable as-is.

## Level 1 — System Context

Who interacts with `@nitra/minify-image`, and which external systems it
talks to.

```mermaid
C4Context
    Person(dev, "Developer / CI", "Runs the CLI to compress images in a project")
    System(mini, "@nitra/minify-image", "CLI: minifies PNG/JPEG/GIF/SVG, optionally generates AVIF companions")
    SystemDb_Ext(fs, "Project filesystem", "Source images, TSV caches, package.json opt-out flags")
    System_Ext(cursor, "@nitra/cursor", "Sibling tool: image-avif rule reads the same disable-avif flag for orphan-AVIF cleanup")
    System_Ext(npm, "npm registry", "Distributes the package")

    Rel(dev, mini, "Invokes", "npx / bun")
    Rel(mini, fs, "Reads/writes images and TSV caches")
    Rel(cursor, fs, "Reads disable-avif flag")
    Rel(mini, npm, "Published to", "npm publish CI")
```

## Level 2 — Containers

`@nitra/minify-image` is a single short-lived CLI process. External storage
and consumers are repeated from level 1 as concrete artifacts the CLI
touches.

```mermaid
C4Container
    Person(dev, "Developer / CI")

    System_Boundary(mini, "@nitra/minify-image") {
        Container(cli, "CLI process", "Node.js 24 / Bun 1.3 (ESM)", "Single entry npm/src/index.js. Walks --src, classifies files by extension, runs cache → compressor → cache write-back")
    }

    ContainerDb_Ext(hashCache, "src/.n-minify-image.tsv", "TSV (committed)", "rel-path + sha1 + originalSize + size — slow-path cache, source for Project lifetime savings")
    ContainerDb_Ext(mtimeCache, "src/node_modules/.cache/@nitra/minify-image/mtime.tsv", "TSV (local, gitignored)", "rel-path + mtime + size — fast-path cache, machine-local")
    Container_Ext(images, "Image files", "PNG/JPEG/GIF/SVG plus optional .avif companions", "")
    Container_Ext(pkgJson, "package.json (consumer)", "JSON", "Per-package opt-out via @nitra/minify-image.disable-avif=true")
    System_Ext(cursor, "@nitra/cursor")

    Rel(dev, cli, "Invokes with --src/--write/--avif/--ignore")
    Rel(cli, images, "Reads original; writes compressed in-place if save > 15%")
    Rel(cli, hashCache, "Slow-path read on cold start; write on cache miss")
    Rel(cli, mtimeCache, "Fast-path read/write each run")
    Rel(cli, pkgJson, "Walks up directories, reads disable-avif")
    Rel(cursor, pkgJson, "Reads same disable-avif flag for orphan-AVIF cleanup")
```

## Level 3 — Components (CLI process)

All components live in [npm/src/index.js](../../npm/src/index.js) — a single
file is intentional (small surface, trivial `bun run` import, no internal
boundaries to maintain). The component view groups functions by
responsibility.

```mermaid
C4Component
    Container_Boundary(cli, "CLI process · npm/src/index.js") {
        Component(args, "Argument parser", "node:util parseArgs", "Parses --src, --write, --avif, --ignore (repeatable). Default --src=. fallback to first positional then CWD")
        Component(globWalker, "Glob discovery", "tinyglobby", "Walks --src for png/jpg/jpeg/gif/svg files. Always-on ignore: node_modules, vendor, test, dist, src-tauri/icons, dot-dirs; plus user --ignore")
        Component(processOne, "Per-file orchestrator", "async function processOne", "Routes ext → compressor; consults caches before re-encoding; writes back only if compressed * 1.15 < original; updates both caches in-place")
        Component(rasterCompress, "Raster compressor", "sharp / libvips", "PNG palette + zlib(level 9, effort 10), JPEG mozjpeg+progressive, GIF effort 10. Sharp default-strips metadata")
        Component(svgCompress, "SVG compressor", "SVGO 4 + custom pre/post", "Sprite detection (skip on display:none root or 2+ symbol elements), license-bearing metadata blocks hoisted to placeholder and re-injected after SVGO, preset-default with tuned overrides")
        Component(avifGen, "AVIF encoder", "sharp.avif", "Optional companion name.ext.avif at quality 40. Skipped in dist/build/android/ios/.output/.nuxt/.cache/src-tauri/icons; raster only")
        Component(avifResolver, "AVIF opt-out resolver", "Walk-up package.json", "isAvifOptedOut walks dirname up to --src, reads disable-avif from nearest package.json, per-directory cache")
        Component(hashCacheIO, "Hash cache I/O", "Plain TSV", "loadHashCache / saveHashCache (.n-minify-image.tsv). SHA-1 source of truth + originalSize for lifetime savings; legacy .minify-image-cache.tsv migration on first run")
        Component(mtimeCacheIO, "Mtime cache I/O", "Plain TSV", "loadMtimeCache / saveMtimeCache (node_modules/.cache/.../mtime.tsv). Local fast-path; auto-recreated under node_modules")
    }

    ContainerDb_Ext(hashCache, "src/.n-minify-image.tsv")
    ContainerDb_Ext(mtimeCache, "src/node_modules/.cache/@nitra/minify-image/mtime.tsv")
    Container_Ext(images, "Image files")
    Container_Ext(pkgJson, "package.json (consumer)")

    Rel(args, globWalker, "Passes --src and --ignore")
    Rel(globWalker, processOne, "For each matched path")
    Rel(processOne, mtimeCacheIO, "Try fast-path hit (size+mtime)")
    Rel(processOne, hashCacheIO, "Try slow-path hit (size+SHA-1)")
    Rel(processOne, rasterCompress, "PNG/JPEG/GIF on cache miss")
    Rel(processOne, svgCompress, "SVG on cache miss")
    Rel(processOne, avifGen, "If --avif and not opted-out and raster")
    Rel(avifGen, avifResolver, "Asks before writing")
    Rel(avifResolver, pkgJson, "Reads disable-avif flag")
    Rel(processOne, images, "Reads original; writes if save > 15%")
    Rel(mtimeCacheIO, mtimeCache, "Read on start, write on exit")
    Rel(hashCacheIO, hashCache, "Read on start, write on exit")
```

## Component → tests

Each component links to the test that exercises it. Cache contracts and the
SVG branch are heavily covered; new branches must add a test next to one
of these files.

| Component                                                                  | Test file                                                                                                                                                                           |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Argument parser, globWalker, processOne, rasterCompress (golden path)      | [demo/test/run.test.js](../../demo/test/run.test.js) — `estimate-режим` + `--write режим` blocks, vendor/test/dist exclusion                                                        |
| svgCompress                                                                | [demo/test/run.test.js](../../demo/test/run.test.js) — `SVG: ...` blocks (sprite skip, license-bearing comments, `<metadata>` preservation, attribution markers, CC0 + © edge case) |
| avifGen + avifResolver                                                     | [demo/test/avif-opt-out.test.js](../../demo/test/avif-opt-out.test.js) — opt-out fixture with nested workspaces, broken package.json tolerance, `disable-avif: false` no-op         |
| Default ignore for `src-tauri/icons/**` (glob + AVIF segment)              | [demo/test/tauri-icons-default-ignore.test.js](../../demo/test/tauri-icons-default-ignore.test.js)                                                                                  |
| Hash cache + mtime cache contract (cold start, hit/miss, lifetime savings) | [demo/test/run.test.js](../../demo/test/run.test.js) — `--write …наповнює cache` + `--write …перезаписує файл коли економія >15%`                                                   |

## Decisions

Architectural decisions live in [docs/adr/](../adr/). Inbox entries
(`docs/adr/_inbox/`) are auto-captured drafts (see
[`.cursor/rules/n-adr.mdc`](../../.cursor/rules/n-adr.mdc)); promote them to
numbered ADRs after review. When a decision adds, removes, or relocates a
component above, the same PR must update this file — that is the contract
in [`.cursor/rules/n-ci4.mdc`](../../.cursor/rules/n-ci4.mdc).
