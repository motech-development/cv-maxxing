import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

const currentDirectoryPath = path.dirname(fileURLToPath(import.meta.url))
const desktopPackageJsonPath = path.resolve(currentDirectoryPath, '../../../package.json')
const electronBuilderConfigPath = path.resolve(
  currentDirectoryPath,
  '../../../electron-builder.config.mjs',
)

interface DesktopPackageManifest {
  scripts: Record<string, string>
}

const readDesktopPackageManifest = (): DesktopPackageManifest =>
  JSON.parse(readFileSync(desktopPackageJsonPath, 'utf8')) as DesktopPackageManifest

describe('mac packaging support', () => {
  test('builds macOS dir artifacts for both Intel and Apple Silicon', () => {
    const electronBuilderConfigSource = readFileSync(electronBuilderConfigPath, 'utf8')

    expect(electronBuilderConfigSource).toContain("arch: ['x64', 'arm64']")
    expect(electronBuilderConfigSource).toContain("target: 'dir'")
  })

  test('exposes explicit packaging scripts for default, Intel, and Apple Silicon builds', () => {
    const packageManifest = readDesktopPackageManifest()

    expect(packageManifest.scripts['package:mac']).toContain('--mac dir')
    expect(packageManifest.scripts['package:mac']).not.toContain('--x64')
    expect(packageManifest.scripts['package:mac']).not.toContain('--arm64')
    expect(packageManifest.scripts['package:mac:arm64']).toContain('--arm64')
    expect(packageManifest.scripts['package:mac:x64']).toContain('--x64')
  })
})
