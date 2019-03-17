# Minify images (PNG, JPEG, GIF, SVG)

[![view on npm](https://img.shields.io/npm/v/@nitra/minify-image.svg)](https://www.npmjs.org/package/@nitra/minify-image)
[![npm module downloads](https://img.shields.io/npm/dt/@nitra/minify-image.svg)](https://www.npmjs.org/package/@nitra/minify-image)
[![Build Status](https://travis-ci.org/nitra/minify-image.svg?branch=master)](https://travis-ci.org/nitra/minify-image)
[![Coverage Status](https://coveralls.io/repos/github/nitra/minify-image/badge.svg?branch=master)](https://coveralls.io/github/nitra/minify-image?branch=master)
[![Dependency Status](https://david-dm.org/nitra/minify-image.svg)](https://david-dm.org/nitra/minify-image)
[![Known Vulnerabilities](https://snyk.io/test/github/nitra/minify-image/badge.svg?targetFile=package.json)](https://snyk.io/test/github/nitra/minify-image?targetFile=package.json)
[![Join the community on Spectrum](https://withspectrum.github.io/badge/badge.svg)](https://spectrum.chat/nitra)

Minify images in directory, if compressed size lower than 15%

## Installation:

```bash
yarn add minify-image
```

## Example run:

```bash
yarn run minify-image --src=.
```

## Options

    --write           If not set, only estimate size difference
    --src directory   The directory to process.
    -h, --help        Print this usage guide.
