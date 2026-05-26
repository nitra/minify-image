import { getConfig } from '@nitra/eslint-config'

export default [
  {
    ignores: ['**/auto-imports.d.ts', 'docs/superpowers/**']
  },
  ...getConfig({
    node: ['npm', 'demo', 'bench']
  }),
  {
    files: ['bench/**'],
    languageOptions: {
      globals: { Bun: 'readonly' }
    }
  }
]
