# Minify images (PNG, JPEG, GIF, SVG)

[![view on npm](https://img.shields.io/npm/v/@nitra/minify-image.svg)](https://www.npmjs.org/package/@nitra/minify-image)
[![npm module downloads](https://img.shields.io/npm/dt/@nitra/minify-image.svg)](https://www.npmjs.org/package/@nitra/minify-image)
[![Build Status](https://travis-ci.org/nitra/minify-image.svg?branch=master)](https://travis-ci.org/nitra/minify-image)
[![Coverage Status](https://coveralls.io/repos/github/nitra/minify-image/badge.svg?branch=master)](https://coveralls.io/github/nitra/minify-image?branch=master)
[![Total alerts](https://img.shields.io/lgtm/alerts/g/nitra/minify-image.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/nitra/minify-image/alerts/)
[![Language grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/nitra/minify-image.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/nitra/minify-image/context:javascript)
[![Dependency Status](https://david-dm.org/nitra/minify-image.svg)](https://david-dm.org/nitra/minify-image)
[![Known Vulnerabilities](https://snyk.io/test/github/nitra/minify-image/badge.svg?targetFile=package.json)](https://snyk.io/test/github/nitra/minify-image?targetFile=package.json)
[![Join the community on Spectrum](https://withspectrum.github.io/badge/badge.svg)](https://spectrum.chat/nitra)

Minify images in directory, if compressed size lower than 15%

## Example run:

```bash
npx @nitra/minify-image --src=.
```

## Options

    --write           If not set, only estimate size difference
    --src directory   The directory to process.
    -h, --help        Print this usage guide.
