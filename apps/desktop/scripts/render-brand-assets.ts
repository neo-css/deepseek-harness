/** Generate Web, Desktop, installer, and tray artwork from the shared UPH PNG. */
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { packIco, renderTrayIconEntries, TRAY_ICON_PATHS } from './render-tray-icon.ts'

const source = await readFile(TRAY_ICON_PATHS.source)
const metadata = await sharp(source).metadata()
if (metadata.format !== 'png' || metadata.width !== 1024 || metadata.height !== 1024 || !metadata.hasAlpha) {
  throw new Error('UPH artwork must be a 1024x1024 PNG with an alpha channel: resources/icon.png')
}

for (const platform of ['windows', 'macos']) {
  await copyFile(TRAY_ICON_PATHS.source, new URL(`../resources/icon-${platform}.png`, import.meta.url))
}
await writeFile(TRAY_ICON_PATHS.output, packIco(await renderTrayIconEntries(source)))

for (const size of [192, 512]) {
  await sharp(source).resize(size, size).png().toFile(fileURLToPath(new URL(`../../web/public/icon-${String(size)}.png`, import.meta.url)))
}
const favicon = await sharp(source).resize(128, 128).png().toBuffer()
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><image width="128" height="128" href="data:image/png;base64,${favicon.toString('base64')}"/></svg>\n`
for (const name of ['favicon.svg', 'favicon-dark.svg']) {
  await writeFile(new URL(`../../web/public/${name}`, import.meta.url), svg)
}
const sidebar = await sharp(source).resize(96, 96).png().toBuffer()
await writeFile(new URL('../../../packages/client/ui-unionpay/src/client/EnterpriseBrand.module.css', import.meta.url),
  `/* Generated from apps/desktop/resources/icon.png by render:brand-assets. */\n.mark {\n  display: block;\n  flex-shrink: 0;\n  background: url("data:image/png;base64,${sidebar.toString('base64')}") center / contain no-repeat;\n}\n`)

for (const dark of [false, true]) {
  for (const scale of [1, 2]) {
    const mark = await sharp(source).resize(128 * scale, 128 * scale).png().toBuffer()
    const label = Buffer.from(`<svg width="${String(600 * scale)}" height="${String(196 * scale)}" xmlns="http://www.w3.org/2000/svg"><text x="${String(300 * scale)}" y="${String(180 * scale)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${String(32 * scale)}" font-weight="500" fill="${dark ? '#ffffff' : '#18181b'}">UPH</text></svg>`)
    const name = `brand${dark ? '-dark' : ''}${scale === 2 ? '-2x' : ''}.png`
    await sharp({ create: { width: 600 * scale, height: 196 * scale, channels: 4, background: '#00000000' } })
      .composite([{ input: mark, left: 236 * scale, top: 8 * scale }, { input: label }])
      .png().toFile(fileURLToPath(new URL(`../installer/assets/${name}`, import.meta.url)))
  }
}
const sidebarMark = await sharp(source).resize(132, 132).png().toBuffer()
await sharp({ create: { width: 164, height: 314, channels: 4, background: '#f3f4f6' } })
  .composite([{ input: sidebarMark, left: 16, top: 91 }])
  .png().toFile(fileURLToPath(new URL('../installer/assets/uninstaller-sidebar.png', import.meta.url)))
console.info('UPH artwork: generated Web, Desktop, installer, and tray assets')
