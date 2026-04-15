import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

test('electron builder publishes the desktop app with the human-friendly product name', () => {
  const configContents = readFileSync(
    new URL('../../../electron-builder.config.mjs', import.meta.url),
    'utf8',
  )

  expect(configContents).toContain("productName: 'CV Maxxing'")
})

test('desktop package metadata publishes the human-friendly product name', () => {
  const packageContents = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')

  expect(packageContents).toContain('"productName": "CV Maxxing"')
})
