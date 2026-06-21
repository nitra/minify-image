export const HASH_CACHE_FILE: '.n-minify-image.tsv'
export const MTIME_CACHE_FILE: 'node_modules/.cache/@nitra/minify-image/mtime.tsv'
export function hashBuffer(buf: Buffer): string
export function loadMtimeCache(srcAbs: string): Map<
  string,
  {
    mtime: number
    size: number
  }
>
export function loadHashCache(srcAbs: string): Map<
  string,
  {
    hash: string
    originalSize: number
    size: number
  }
>
export function saveMtimeCache(
  srcAbs: string,
  cache: Map<
    string,
    {
      mtime: number
      size: number
    }
  >
): void
export function saveHashCache(
  srcAbs: string,
  cache: Map<
    string,
    {
      hash: string
      originalSize: number
      size: number
    }
  >
): void
