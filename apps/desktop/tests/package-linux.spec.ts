import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  createLinuxDesktopPackageConfig,
  LINUX_HICOLOR_ICON_SIZES,
  parseLinuxPackageInvocation,
  renderLinuxHicolorIcons,
  renderLinuxInstallTemplates,
} from '../scripts/package-linux.ts'

describe('linux desktop packaging', () => {
  it('resolves default and explicit Linux package targets (AppImage, deb, rpm)', () => {
    expect(parseLinuxPackageInvocation([], true)).toEqual({
      targets: ['AppImage', 'deb', 'rpm'],
      directory: false,
      prepared: false,
      onlyTargets: false,
    })
    expect(parseLinuxPackageInvocation([], false)).toEqual({
      targets: ['AppImage', 'deb'],
      directory: false,
      prepared: false,
      onlyTargets: false,
    })
    expect(parseLinuxPackageInvocation(['--only-targets'], true)).toEqual({
      targets: ['deb', 'rpm'],
      directory: false,
      prepared: false,
      onlyTargets: true,
    })
    expect(parseLinuxPackageInvocation(['--rpm-only'], true)).toEqual({
      targets: ['rpm'],
      directory: false,
      prepared: false,
      onlyTargets: true,
    })
    expect(parseLinuxPackageInvocation(['--', '--targets', 'appimage,deb', '--prepared'], false)).toEqual({
      targets: ['AppImage', 'deb'],
      directory: false,
      prepared: true,
      onlyTargets: false,
    })
    expect(parseLinuxPackageInvocation(['deb', 'rpm'], true).targets).toEqual(['deb', 'rpm'])
  })

  it('rejects unsupported target names, missing rpmbuild, and conflicting flags', () => {
    expect(() => parseLinuxPackageInvocation(['snap'], true)).toThrow(/unsupported target/u)
    expect(() => parseLinuxPackageInvocation(['rpm'], false)).toThrow(/requires rpmbuild/u)
    expect(() => parseLinuxPackageInvocation(['--dir', '--only-targets'], true)).toThrow(/cannot be combined/u)
  })

  it('renders all 9 standard freedesktop hicolor icon sizes from resources/icon.png', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-linux-icons-'))
    onTestFinished(() => { rmSync(dir, { recursive: true, force: true }) })
    const source = fileURLToPath(new URL('../resources/icon.png', import.meta.url))
    const files = await renderLinuxHicolorIcons(source, dir)
    expect(files).toHaveLength(LINUX_HICOLOR_ICON_SIZES.length)
    for (const size of LINUX_HICOLOR_ICON_SIZES) {
      const iconPath = join(dir, `${String(size)}x${String(size)}.png`)
      expect(existsSync(iconPath)).toBe(true)
      const metadata = await sharp(iconPath).metadata()
      expect(metadata.width).toBe(size)
      expect(metadata.height).toBe(size)
      expect(metadata.format).toBe('png')
      expect(metadata.hasAlpha).toBe(true)
    }
    const invalidSource = join(dir, '16x16.png')
    await expect(renderLinuxHicolorIcons(invalidSource, join(dir, 'invalid'))).rejects.toThrow(/1024x1024 RGBA PNG/u)
  })

  it('augments Linux after-install and after-remove templates with icon cache refresh and /usr/bin/dsh links', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-linux-tpl-'))
    onTestFinished(() => { rmSync(dir, { recursive: true, force: true }) })
    const sourceDir = join(dir, 'default')
    const outDir = join(dir, 'out')
    rmSync(sourceDir, { recursive: true, force: true })
    renderLinuxInstallTemplates(
      fileURLToPath(new URL('../node_modules/app-builder-lib/templates/linux', import.meta.url)),
      outDir,
    )
    const afterInstall = readFileSync(join(outDir, 'after-install.tpl'), 'utf8')
    const afterRemove = readFileSync(join(outDir, 'after-remove.tpl'), 'utf8')
    expect(afterInstall).toContain('gtk-update-icon-cache -f -t /usr/share/icons/hicolor')
    expect(afterInstall).toContain('xdg-icon-resource forceupdate --theme hicolor')
    expect(afterInstall).toContain("update-alternatives --install '/usr/bin/dsh' 'dsh' '/opt/${sanitizedProductName}/resources/runtime/cli/bin/dsh'")
    expect(afterRemove).toContain("update-alternatives --remove 'dsh' '/opt/${sanitizedProductName}/resources/runtime/cli/bin/dsh'")
    expect(afterRemove).toContain('gtk-update-icon-cache -f -t /usr/share/icons/hicolor')
    expect(afterRemove).toContain('update-desktop-database /usr/share/applications')
    writeFileSync(join(dir, 'dummy.txt'), 'ok')
  })

  it('builds electron-builder Linux configuration for AppImage, deb, and rpm', () => {
    const config = createLinuxDesktopPackageConfig({
      iconsDir: '/tmp/icons',
      afterInstall: '/tmp/after-install.tpl',
      afterRemove: '/tmp/after-remove.tpl',
      targets: ['AppImage', 'deb', 'rpm'],
      env: {},
    })
    expect(config).toEqual({
      executableName: 'uph',
      desktopName: 'uph.desktop',
      homepage: 'https://www.unionpay.com',
      linux: {
        category: 'Development',
        icon: '/tmp/icons',
        syncDesktopName: true,
        maintainer: 'UPH <support@unionpay.com>',
        vendor: 'UPH',
        synopsis: 'UPH Desktop Client',
        target: ['AppImage', 'deb', 'rpm'],
      },
      deb: {
        packageName: 'uph',
        priority: 'optional',
        afterInstall: '/tmp/after-install.tpl',
        afterRemove: '/tmp/after-remove.tpl',
      },
      rpm: {
        packageName: 'uph',
        afterInstall: '/tmp/after-install.tpl',
        afterRemove: '/tmp/after-remove.tpl',
      },
    })
  })
})
