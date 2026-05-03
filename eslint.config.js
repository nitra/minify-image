import { getConfig } from '@nitra/eslint-config'

export default [
  {
    ignores: ['**/auto-imports.d.ts']
  },
  ...getConfig({
    node: ['npm', 'demo']
  })
]
