/** Build Linux x64 Desktop packages (AppImage, deb, rpm) with freedesktop hicolor icons and runtime verification. */

import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import sharp from 'sharp'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const SCRIPTS_DIR = join(APP_ROOT, 'scripts')
const LINUX_BUILD_ROOT = join(APP_ROOT, '.desktop-build', 'local-appimage')
const LINUX_TARGET_ROOT = join(APP_ROOT, '.desktop-build', 'targets', 'linux-x64')

/** Standard freedesktop hicolor icon pixel dimensions installed under `/usr/share/icons/hicolor`. */
export const LINUX_HICOLOR_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024] as const

/** Supported Linux installer and bundle formats emitted by electron-builder. */
export type LinuxPackageFormat = 'AppImage' | 'deb' | 'rpm'

/** Validated command-line options for a Linux Desktop packaging run. */
export interface LinuxPackageInvocation {
  readonly targets: readonly LinuxPackageFormat[]
  readonly directory: boolean
  readonly prepared: boolean
  readonly onlyTargets: boolean
}

const TARGET_ALIASES: Readonly<Record<string, LinuxPackageFormat>> = {
  appimage: 'AppImage',
  AppImage: 'AppImage',
  deb: 'deb',
  rpm: 'rpm',
}

function parseTargetName(token: string): LinuxPackageFormat {
  const normalized = TARGET_ALIASES[token.trim()]
  if (normalized === undefined) {
    throw new Error(`desktop linux package: unsupported target ${JSON.stringify(token)}; expected AppImage, deb, or rpm`)
  }
  return normalized
}

/**
 * Parse command-line arguments for Linux Desktop packaging.
 * @param argv - Command-line arguments after the script entry point.
 * @param hasRpmbuild - Whether `rpmbuild` is available on `PATH` for default target selection.
 * @returns Validated Linux packaging invocation.
 */
export function parseLinuxPackageInvocation(
  argv: readonly string[],
  hasRpmbuild = true,
): LinuxPackageInvocation {
  const { values, positionals } = parseArgs({
    args: argv.filter(argument => argument !== '--'),
    allowPositionals: true,
    options: {
      targets: { type: 'string' },
      dir: { type: 'boolean', default: false },
      prepared: { type: 'boolean', default: false },
      'only-targets': { type: 'boolean', default: false },
      'rpm-only': { type: 'boolean', default: false },
    },
  })
  if (values.dir && values['only-targets']) {
    throw new Error('desktop linux package: --dir cannot be combined with --only-targets')
  }
  const explicitTokens = [
    ...(values['rpm-only'] ? ['rpm'] : []),
    ...(values.targets === undefined ? [] : values.targets.split(',').filter(part => part.trim() !== '')),
    ...positionals,
  ]
  const deduplicated: LinuxPackageFormat[] = []
  for (const token of explicitTokens) {
    const parsed = parseTargetName(token)
    if (!deduplicated.includes(parsed)) deduplicated.push(parsed)
  }
  if (deduplicated.includes('rpm') && !hasRpmbuild) {
    throw new Error('desktop linux package: rpm target requires rpmbuild on PATH')
  }
  const onlyTargets = values['only-targets'] || values['rpm-only']
  const defaultTargets: LinuxPackageFormat[] = onlyTargets
    ? ['deb', ...(hasRpmbuild ? ['rpm' as const] : [])]
    : ['AppImage', 'deb', ...(hasRpmbuild ? ['rpm' as const] : [])]
  return {
    targets: deduplicated.length > 0 ? deduplicated : defaultTargets,
    directory: values.dir,
    prepared: values.prepared,
    onlyTargets,
  }
}

/**
 * Render `after-install.tpl` and `after-remove.tpl` with hicolor icon cache refresh and `/usr/bin/dsh` CLI registration.
 * @param defaultTemplateDir - Directory containing `app-builder-lib`'s default Linux templates.
 * @param destinationDir - Directory where the augmented templates are written.
 * @returns Paths to the generated `afterInstall` and `afterRemove` template files.
 */
export function renderLinuxInstallTemplates(
  defaultTemplateDir: string,
  destinationDir: string,
): { readonly afterInstall: string; readonly afterRemove: string } {
  mkdirSync(destinationDir, { recursive: true })
  const afterInstall = join(destinationDir, 'after-install.tpl')
  const afterRemove = join(destinationDir, 'after-remove.tpl')
  writeFileSync(
    afterInstall,
    `${readFileSync(join(defaultTemplateDir, 'after-install.tpl'), 'utf8')}\n`
    + 'if hash gtk-update-icon-cache 2>/dev/null; then\n'
    + '    gtk-update-icon-cache -f -t /usr/share/icons/hicolor || true\n'
    + 'fi\n'
    + 'if hash xdg-icon-resource 2>/dev/null; then\n'
    + '    xdg-icon-resource forceupdate --theme hicolor || true\n'
    + 'fi\n'
    + "if [ -x '/opt/${sanitizedProductName}/resources/runtime/cli/bin/dsh' ]; then\n"
    + '    if type update-alternatives >/dev/null 2>&1; then\n'
    + "        update-alternatives --install '/usr/bin/dsh' 'dsh' '/opt/${sanitizedProductName}/resources/runtime/cli/bin/dsh' 50 || true\n"
    + "    elif [ ! -e '/usr/bin/dsh' ]; then\n"
    + "        ln -sf '/opt/${sanitizedProductName}/resources/runtime/cli/bin/dsh' '/usr/bin/dsh' || true\n"
    + '    fi\n'
    + 'fi\n',
  )
  writeFileSync(
    afterRemove,
    `${readFileSync(join(defaultTemplateDir, 'after-remove.tpl'), 'utf8')}\n`
    + 'if type update-alternatives >/dev/null 2>&1; then\n'
    + "    update-alternatives --remove 'dsh' '/opt/${sanitizedProductName}/resources/runtime/cli/bin/dsh' || true\n"
    + "elif [ -L '/usr/bin/dsh' ] && [ \"$(readlink '/usr/bin/dsh')\" = '/opt/${sanitizedProductName}/resources/runtime/cli/bin/dsh' ]; then\n"
    + "    rm -f '/usr/bin/dsh'\n"
    + 'fi\n'
    + 'if hash gtk-update-icon-cache 2>/dev/null; then\n'
    + '    gtk-update-icon-cache -f -t /usr/share/icons/hicolor || true\n'
    + 'fi\n'
    + 'if hash update-desktop-database 2>/dev/null; then\n'
    + '    update-desktop-database /usr/share/applications || true\n'
    + 'fi\n',
  )
  return { afterInstall, afterRemove }
}

/**
 * Render the 9 standard freedesktop hicolor PNG icons (`16x16` through `1024x1024`) from the 1024x1024 RGBA source icon.
 * @param sourcePngPath - Path to the 1024x1024 RGBA PNG source artwork (`resources/icon.png`).
 * @param destinationDir - Output directory populated with `<size>x<size>.png` files for `electron-builder`.
 * @returns Paths of the generated icon files in ascending size order.
 */
export async function renderLinuxHicolorIcons(
  sourcePngPath: string,
  destinationDir: string,
): Promise<readonly string[]> {
  const source = readFileSync(sourcePngPath)
  const metadata = await sharp(source).metadata()
  if (metadata.format !== 'png' || metadata.width !== 1024 || metadata.height !== 1024 || !metadata.hasAlpha) {
    throw new Error(`desktop linux package: icon source must be a 1024x1024 RGBA PNG: ${sourcePngPath}`)
  }
  rmSync(destinationDir, { recursive: true, force: true })
  mkdirSync(destinationDir, { recursive: true })
  return Promise.all(LINUX_HICOLOR_ICON_SIZES.map(async (size) => {
    const output = join(destinationDir, `${String(size)}x${String(size)}.png`)
    await sharp(source).resize(size, size).png().toFile(output)
    return output
  }))
}

/**
 * Construct the Linux desktop metadata and target options merged into `electron-builder` configuration.
 * @param options - Icon directory, maintainer/homepage environment, script paths, and target list.
 * @param options.iconsDir - Directory containing pre-rendered `<size>x<size>.png` icons.
 * @param options.afterInstall - Path to the augmented `after-install.tpl` script.
 * @param options.afterRemove - Path to the augmented `after-remove.tpl` script.
 * @param options.targets - Linux package formats to build.
 * @param options.env - Packaging environment carrying optional `DSH_DESKTOP_LINUX_HOMEPAGE` and `DSH_DESKTOP_LINUX_MAINTAINER`.
 * @returns Linux configuration fields for `electron-builder`.
 */
export function createLinuxDesktopPackageConfig(options: {
  readonly iconsDir: string
  readonly afterInstall: string
  readonly afterRemove: string
  readonly targets: readonly LinuxPackageFormat[]
  readonly env?: NodeJS.ProcessEnv
}): {
  readonly executableName: 'uph'
  readonly desktopName: 'uph.desktop'
  readonly homepage: string
  readonly linux: {
    readonly category: 'Development'
    readonly icon: string
    readonly syncDesktopName: true
    readonly maintainer: string
    readonly vendor: 'UPH'
    readonly synopsis: 'UPH Desktop Client'
    readonly target: readonly LinuxPackageFormat[]
  }
  readonly deb: {
    readonly packageName: 'uph'
    readonly priority: 'optional'
    readonly afterInstall: string
    readonly afterRemove: string
  }
  readonly rpm: {
    readonly packageName: 'uph'
    readonly afterInstall: string
    readonly afterRemove: string
  }
} {
  const env = options.env ?? process.env
  return {
    executableName: 'uph',
    desktopName: 'uph.desktop',
    homepage: env.DSH_DESKTOP_LINUX_HOMEPAGE?.trim() || 'https://www.unionpay.com',
    linux: {
      category: 'Development',
      icon: options.iconsDir,
      syncDesktopName: true,
      maintainer: env.DSH_DESKTOP_LINUX_MAINTAINER?.trim() || 'UPH <support@unionpay.com>',
      vendor: 'UPH',
      synopsis: 'UPH Desktop Client',
      target: options.targets,
    },
    deb: {
      packageName: 'uph',
      priority: 'optional',
      afterInstall: options.afterInstall,
      afterRemove: options.afterRemove,
    },
    rpm: {
      packageName: 'uph',
      afterInstall: options.afterInstall,
      afterRemove: options.afterRemove,
    },
  }
}

function hasCommand(command: string, env: NodeJS.ProcessEnv): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${command}`], { env, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function replaceRequired(source: string, from: string, to: string): string {
  if (!source.includes(from)) throw new Error(`desktop linux package: adaptation anchor not found: ${from}`)
  return source.replaceAll(from, to)
}

async function main(): Promise<void> {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error(`desktop linux package: linux-x64 requires a Linux x64 build host (got ${process.platform}-${process.arch})`)
  }
  mkdirSync(LINUX_BUILD_ROOT, { recursive: true })
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' }).trim()
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  }).trim() !== ''
  const cachedFpm = join(
    process.env.HOME ?? '',
    '.cache/electron-builder/fpm@2.1.4/fpm-1.17.0-ruby-3.4.3-linux-amd64-1nk0v/fpm',
  )
  const localToolsBin = join(LINUX_BUILD_ROOT, 'tools/bin')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: existsSync(localToolsBin) ? `${localToolsBin}:${process.env.PATH ?? ''}` : (process.env.PATH ?? ''),
    DSH_GATE_CONCURRENCY: '1',
    DSH_DESKTOP_TARGET_PLATFORM: 'linux',
    DSH_DESKTOP_TARGET_ARCH: 'x64',
    DSH_DESKTOP_UNSIGNED: '1',
    DSH_DESKTOP_APP_ID: process.env.DSH_DESKTOP_APP_ID ?? 'local.uph.linux',
    DSH_DESKTOP_BUILD_COMMIT: commit,
    DSH_DESKTOP_BUILD_DIRTY: dirty ? '1' : '0',
    ELECTRON_GET_USE_PROXY: '1',
    NODE_USE_ENV_PROXY: '1',
    XDG_CACHE_HOME: join(LINUX_BUILD_ROOT, 'cache'),
    XDG_CONFIG_HOME: join(LINUX_BUILD_ROOT, 'config'),
    XDG_STATE_HOME: join(LINUX_BUILD_ROOT, 'state'),
    ELECTRON_BUILDER_CACHE: join(LINUX_BUILD_ROOT, 'cache/electron-builder'),
    ...(existsSync(cachedFpm) ? { CUSTOM_FPM_PATH: cachedFpm } : {}),
    npm_config_devdir: join(LINUX_BUILD_ROOT, 'cache/node-gyp'),
    TMPDIR: join(REPOSITORY_ROOT, 'tmp/appimage'),
  }
  mkdirSync(env.TMPDIR!, { recursive: true })

  const invocation = parseLinuxPackageInvocation(process.argv.slice(2), hasCommand('rpmbuild', env))
  const temporaryFiles: string[] = []

  const runPnpm = (args: readonly string[], cwd = REPOSITORY_ROOT): Promise<void> => {
    console.log(`\npackage-linux: pnpm ${args.join(' ')}`)
    return new Promise((resolveRun, reject) => {
      const child = spawn(
        process.execPath,
        [
          join(REPOSITORY_ROOT, 'node_modules/pnpm/bin/pnpm.mjs'),
          '--config.verify-deps-before-run=false',
          '--config.manage-package-manager-versions=false',
          ...args,
        ],
        { cwd, env, stdio: 'inherit' },
      )
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        if (code === 0) resolveRun()
        else reject(new Error(`desktop linux package: pnpm exited with ${String(code ?? signal)}`))
      })
    })
  }

  const copyAdaptedScript = (name: string, replacements: readonly (readonly [string, string])[] = []): string => {
    const destination = join(SCRIPTS_DIR, `appimage-local-${name}`)
    if (existsSync(destination)) rmSync(destination, { force: true })
    let source = readFileSync(join(SCRIPTS_DIR, name), 'utf8')
    for (const [from, to] of replacements) source = replaceRequired(source, from, to)
    source = source
      .replaceAll("'./desktop-build-paths.mjs'", "'./appimage-local-desktop-build-paths.mjs'")
      .replaceAll("'./prepare-primary-runtime.ts'", "'./appimage-local-prepare-primary-runtime.ts'")
    writeFileSync(destination, source)
    temporaryFiles.push(destination)
    return destination
  }

  try {
    if (!invocation.prepared && !invocation.onlyTargets) {
      await runPnpm(['exec', 'tsx', 'scripts/build.ts', '--scope', 'artifacts', '--profile', 'official'])
      await runPnpm(['run', 'build:check'])
      await runPnpm(['run', 'release:pack', '--family', 'dsh', '--out', join(LINUX_TARGET_ROOT, 'packed/dsh'), '--concurrency', '2'])
      await runPnpm(['--dir', 'apps/desktop-host', 'pack', '--pack-destination', join(LINUX_TARGET_ROOT, 'packed/dsh')])
      await runPnpm(['run', 'release:pack', '--family', 'vendor', '--out', join(LINUX_TARGET_ROOT, 'packed/vendor'), '--concurrency', '2'])
      await runPnpm(['--dir', 'native/system', 'run', 'build:ts'])
      rmSync(join(LINUX_TARGET_ROOT, 'packed/landlock'), { recursive: true, force: true })
      mkdirSync(join(LINUX_TARGET_ROOT, 'packed/landlock'), { recursive: true })
      await runPnpm(['--dir', 'native/system/packages/entry', 'pack', '--pack-destination', join(LINUX_TARGET_ROOT, 'packed/landlock')])
    }

    copyAdaptedScript('desktop-build-paths.mjs', [
      ["new Set(['mac-arm64', 'mac-x64', 'win-x64'])", "new Set(['mac-arm64', 'mac-x64', 'win-x64', 'linux-x64'])"],
      ["target === 'win-x64' ? 'win32' : 'darwin'", "target === 'linux-x64' ? 'linux' : target === 'win-x64' ? 'win32' : 'darwin'"],
    ])
    copyAdaptedScript('prepare-primary-runtime.ts')
    const runtimeScript = copyAdaptedScript('prepare-runtime.ts', [
      [
        "platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron'",
        "platform === 'linux' ? 'electron' : platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron'",
      ],
      [
        "import { execFileSync } from 'node:child_process'",
        "import { execFileSync } from 'node:child_process'\nimport { createHash } from 'node:crypto'",
      ],
      [
        'chmodSync, cpSync, mkdirSync, rmSync, writeFileSync',
        'chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync',
      ],
      [
        "artifactName: 'electron', cacheRoot: BUILD_PATHS.downloads",
        "artifactName: 'electron', cacheRoot: BUILD_PATHS.downloads, checksums: require('electron/checksums.json'), downloader: { download: async (url, targetFilePath) => { mkdirSync(BUILD_PATHS.downloads, { recursive: true }); const name = new URL(url).pathname.split('/').at(-1); const partial = join(BUILD_PATHS.downloads, name + '.partial'); const checksum = require('electron/checksums.json')[name]; if (!existsSync(partial) || createHash('sha256').update(readFileSync(partial)).digest('hex') !== checksum) execFileSync('curl', ['--fail', '--location', '--http1.1', '--retry', '2', '--retry-all-errors', '--connect-timeout', '15', '--max-time', '180', '--speed-time', '25', '--speed-limit', '1024', '--continue-at', '-', '--output', partial, 'https://npmmirror.com/mirrors/electron/' + version + '/' + name], { stdio: 'inherit' }); cpSync(partial, targetFilePath) } }",
      ],
    ])
    const packageSetScript = copyAdaptedScript('prepare-package-set.ts')
    copyAdaptedScript('smoke-runtime.ts', [
      [
        "'- insert:\\n    - id: desktop-runtime-smoke-plugin",
        "'- id: office-to-pdf\\n  config:\\n    timeoutMs: 600000\\n- insert:\\n    - id: desktop-runtime-smoke-plugin",
      ],
      ['120_000', '600_000'],
    ])
    copyAdaptedScript('smoke-prepared-runtime.ts', [["'./smoke-runtime.ts'", "'./appimage-local-smoke-runtime.ts'"]])
    const dshScript = copyAdaptedScript('prepare-dsh.ts', [
      ["'./smoke-prepared-runtime.ts'", "'./appimage-local-smoke-prepared-runtime.ts'"],
      [
        "process.platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron'",
        "process.platform === 'linux' ? 'electron' : process.platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron'",
      ],
      ["const STORE_ROOT = join(BUILD_ROOT, 'store')", "const STORE_ROOT = join(BUILD_PATHS.root, 'dependency-store')"],
      [
        'createRuntimeProjectMetadata(BUILD_ROOT, release)',
        "createRuntimeProjectMetadata(BUILD_ROOT, release)\n      const manifestPath = join(BUILD_ROOT, 'package.json')\n      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))\n      manifest.dependencies['@img/sharp-wasm32'] = JSON.parse(readFileSync(join(APP_ROOT, 'node_modules/sharp/package.json'), 'utf8')).version\n      writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2))\n      const workspacePath = join(BUILD_ROOT, 'pnpm-workspace.yaml')\n      writeFileSync(workspacePath, readFileSync(workspacePath, 'utf8') + \"\\nsupportedArchitectures:\\n  cpu: [x64, wasm32]\\n\")",
      ],
      [
        "const modules = join(BUILD_ROOT, 'node_modules')",
        "const modules = join(BUILD_ROOT, 'node_modules')\n    if (!existsSync(join(modules, '@img/sharp-wasm32/package.json'))) throw new Error('Linux runtime: missing Sharp WASM backend')",
      ],
      [
        'filter: source => desktopRuntimeFileExclusion(relative(modules, source), target, officeEngine) === undefined,',
        'filter: source => !/(?:^|[/\\\\])@img[/\\\\]sharp-(?!wasm32(?:[/\\\\]|$))/.test(relative(modules, source)) && desktopRuntimeFileExclusion(relative(modules, source), target, officeEngine) === undefined,',
      ],
      [
        "writeFileSync(join(DSH_OUTPUT_ROOT, 'package.json')",
        "if (existsSync(join(DSH_OUTPUT_ROOT, 'node_modules/@img/sharp-linux-x64')) || existsSync(join(DSH_OUTPUT_ROOT, 'node_modules/@img/sharp-libvips-linux-x64'))) throw new Error('Linux runtime: native Sharp backend was retained')\n    if (!existsSync(join(DSH_OUTPUT_ROOT, 'node_modules/@img/sharp-wasm32/package.json'))) throw new Error('Linux runtime: Sharp WASM backend was omitted')\n    writeFileSync(join(DSH_OUTPUT_ROOT, 'package.json')",
      ],
      [
        "await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'runtime:manifests'",
        "for (const extension of ['cjs', 'mjs']) {\n      const path = join(DSH_OUTPUT_ROOT, 'node_modules/sharp/dist/sharp.' + extension)\n      const source = readFileSync(path, 'utf8')\n      const native = \"if (!sharp) {\\n  try {\\n    switch (runtimePlatform)\"\n      if (!source.includes(native)) throw new Error('Linux Sharp loader changed: ' + path)\n      writeFileSync(path, source.replace(native, \"if (!sharp && !(process.versions.electron && process.platform === 'linux')) {\\n  try {\\n    switch (runtimePlatform)\"))\n    }\n    for (const file of ['index.js', 'cli.js']) {\n      const kitPath = join(DSH_OUTPUT_ROOT, 'node_modules/@deepseek-ai/libreoffice-kit/lib', file)\n      const kit = readFileSync(kitPath, 'utf8')\n      const absent = \"lstatSync(join(directory, name), { throwIfNoEntry: false }) !== void 0\"\n      if (!kit.includes(absent)) throw new Error('Office package existence check changed: ' + kitPath)\n      writeFileSync(kitPath, kit.replace(absent, \"lstatSync(join(directory, name), { throwIfNoEntry: false }) != null\"))\n    }\n    await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'runtime:manifests'",
      ],
    ])

    const iconsDir = join(LINUX_BUILD_ROOT, 'icons')
    await renderLinuxHicolorIcons(join(APP_ROOT, 'resources/icon.png'), iconsDir)
    const { afterInstall, afterRemove } = renderLinuxInstallTemplates(
      join(APP_ROOT, 'node_modules/app-builder-lib/templates/linux'),
      LINUX_BUILD_ROOT,
    )
    const linuxConfig = createLinuxDesktopPackageConfig({
      iconsDir,
      afterInstall,
      afterRemove,
      targets: invocation.targets,
      env,
    })

    const builderModule = copyAdaptedScript('electron-builder-config.mjs', [
      [
        'packagesMacOS && unsigned ? undefined : resolveDesktopPolicyEnvironment(env)',
        'unsigned ? undefined : resolveDesktopPolicyEnvironment(env)',
      ],
      [
        'dshDesktopAppId: appId,',
        `dshDesktopAppId: appId,\n      desktopName: ${JSON.stringify(linuxConfig.desktopName)},\n      homepage: ${JSON.stringify(linuxConfig.homepage)},`,
      ],
      [
        "productName: 'UPH',",
        `productName: 'UPH',\n    executableName: ${JSON.stringify(linuxConfig.executableName)},`,
      ],
      [
        "    linux: {\n      category: 'Development',\n      target: ['AppImage'],\n    },",
        `    linux: ${JSON.stringify(linuxConfig.linux, null, 6).replace(/\n/g, '\n    ')},\n    deb: ${JSON.stringify(linuxConfig.deb, null, 6).replace(/\n/g, '\n    ')},\n    rpm: ${JSON.stringify(linuxConfig.rpm, null, 6).replace(/\n/g, '\n    ')},`,
      ],
    ])
    const configPath = join(LINUX_BUILD_ROOT, 'electron-builder.config.mjs')
    writeFileSync(configPath, `import { createElectronBuilderConfig } from ${JSON.stringify(builderModule)}\nexport default createElectronBuilderConfig()\n`)

    if (invocation.onlyTargets) {
      await runPnpm([
        'exec', 'electron-builder', '--config', configPath,
        '--prepackaged', join(LINUX_TARGET_ROOT, 'unsigned-artifacts/linux-unpacked'),
        '--linux', ...invocation.targets, '--x64', '--publish', 'never',
      ], APP_ROOT)
    } else {
      await runPnpm(['exec', 'tsx', runtimeScript], APP_ROOT)
      const launcher = join(LINUX_TARGET_ROOT, 'runtime/cli/bin/dsh')
      writeFileSync(launcher, replaceRequired(readFileSync(launcher, 'utf8'), '$resources/../MacOS/UPH', '$resources/../uph'))
      chmodSync(launcher, 0o755)
      await runPnpm(['exec', 'tsx', packageSetScript], APP_ROOT)
      await runPnpm(['exec', 'tsx', dshScript], APP_ROOT)
      await runPnpm([
        'exec', 'electron-builder', '--config', configPath,
        '--linux', ...(invocation.directory ? ['--dir'] : invocation.targets),
        '--x64', '--publish', 'never',
      ], APP_ROOT)
      const smokePath = join(LINUX_BUILD_ROOT, 'smoke.ts')
      writeFileSync(
        smokePath,
        [
          "import { join } from 'node:path'",
          `import { readDesktopRuntime, verifyDesktopRuntime } from ${JSON.stringify(join(APP_ROOT, 'src/runtime-tree.ts'))}`,
          `import { smokePreparedRuntime } from ${JSON.stringify(join(SCRIPTS_DIR, 'appimage-local-smoke-prepared-runtime.ts'))}`,
          `const paths = ${JSON.stringify({ dsh: join(LINUX_TARGET_ROOT, 'dsh'), application: join(LINUX_TARGET_ROOT, 'unsigned-artifacts/linux-unpacked') })}`,
          "const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version, { platform: 'linux', arch: 'x64' })",
          "const resources = join(paths.application, 'resources')",
          "await smokePreparedRuntime(join(resources, 'app.asar/dsh'), join(paths.application, 'uph'), join(resources, 'runtime'), descriptor)",
          '',
        ].join('\n'),
      )
      await runPnpm(['exec', 'tsx', smokePath], APP_ROOT)
    }
    console.log(`\npackage-linux: artifacts: ${join(LINUX_TARGET_ROOT, 'unsigned-artifacts')}`)
  } finally {
    for (const file of temporaryFiles) rmSync(file, { force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
