import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { copyFile, cp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashFile, workspaceRoot } from '../injector/copy-runtime.mjs'

if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('Build requires Windows x64 Node')
const releaseRoot = path.join(workspaceRoot, 'release')
const build = path.join(releaseRoot, new Date().toISOString().replaceAll(/[:.]/g, '-'))
const payload = path.join(build, 'payload')
const app = path.join(payload, 'app')
await mkdir(path.join(app, 'injector'), { recursive: true })
await mkdir(path.join(app, 'launcher'))
await mkdir(path.join(app, 'dist'))
await copyFile(process.execPath, path.join(payload, 'node.exe'))
const license = fileURLToPath(
  new URL(`./licenses/node-${process.version}-LICENSE.txt`, import.meta.url),
)
await copyFile(license, path.join(payload, 'NODE-LICENSE.txt'))
await writeFile(
  path.join(app, 'package.json'),
  JSON.stringify({ name: 'tokentracker-desktop', private: true, type: 'module' }),
)
for (const file of [
  'runtime-manager.mjs',
  'runtime-patch.mjs',
  'repack-archive.mjs',
  'copy-runtime.mjs',
  'inspect-update.mjs',
  'inspect-installation.mjs',
  'owl-integrity.mjs',
  'desktop-startup.mjs',
  'registered-package.ps1',
  'runtime-processes.ps1',
])
  await copyFile(path.join(workspaceRoot, 'injector', file), path.join(app, 'injector', file))
await copyFile(
  fileURLToPath(new URL('./worker.mjs', import.meta.url)),
  path.join(app, 'launcher/worker.mjs'),
)
for (const file of ['desktop-main.cjs', 'desktop-preload.cjs'])
  await copyFile(path.join(workspaceRoot, 'dist', file), path.join(app, 'dist', file))

// Copy only runtime dependencies into ordinary directories: no pnpm links or dev toolchain.
const packages = new Map()
async function includePackage(name, requireFrom) {
  const entry = requireFrom.resolve(name)
  let directory = path.dirname(await realpath(entry))
  let metadata
  for (;;) {
    try {
      const candidate = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
      if (candidate.name === name) {
        metadata = candidate
        break
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const parent = path.dirname(directory)
    if (parent === directory) throw new Error(`Cannot locate package metadata: ${name}`)
    directory = parent
  }
  if (packages.has(name)) {
    if (packages.get(name) !== metadata.version)
      throw new Error(`Conflicting runtime dependency: ${name}`)
    return
  }
  packages.set(name, metadata.version)
  const destination = path.join(app, 'node_modules', name)
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(directory, destination, {
    recursive: true,
    dereference: true,
    errorOnExist: true,
    force: false,
    filter: (item) => !path.relative(directory, item).split(path.sep).includes('node_modules'),
  })
  const requirePackage = createRequire(path.join(directory, 'package.json'))
  for (const dependency of Object.keys(metadata.dependencies ?? {}).sort())
    await includePackage(dependency, requirePackage)
}
const requireProject = createRequire(path.join(workspaceRoot, 'package.json'))
for (const name of ['@electron/asar', '@electron/fuses']) await includePackage(name, requireProject)

const files = []
async function inventory(relative = '') {
  for (const entry of await readdir(path.join(payload, relative), { withFileTypes: true })) {
    const file = path.join(relative, entry.name)
    if (entry.isDirectory()) await inventory(file)
    else if (entry.isFile())
      files.push({
        path: file.replaceAll('\\', '/'),
        sha256: await hashFile(path.join(payload, file)),
      })
    else throw new Error('Unsupported payload link')
  }
}
await inventory()
const manifest = path.join(build, 'manifest.json')
await writeFile(manifest, JSON.stringify(files))
const archive = path.join(build, 'payload.zip')
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    fileURLToPath(new URL('./pack-archive.ps1', import.meta.url)),
    '-Source',
    payload,
    '-Destination',
    archive,
  ],
  { windowsHide: true, stdio: 'pipe' },
)
const hash = await hashFile(archive)
const hashPath = path.join(build, 'payload.sha256')
await writeFile(hashPath, hash)
const executable = path.join(build, 'TokenTracker.exe')
const icon = path.join(build, 'TokenTracker.ico')
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    fileURLToPath(new URL('./create-icon.ps1', import.meta.url)),
    '-Output',
    icon,
  ],
  { windowsHide: true, stdio: 'pipe' },
)
const compiler = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
execFileSync(
  compiler,
  [
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    '/optimize+',
    '/utf8output',
    '/reference:System.Windows.Forms.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.IO.Compression.dll',
    '/reference:System.IO.Compression.FileSystem.dll',
    '/reference:System.Web.Extensions.dll',
    '/reference:Microsoft.CSharp.dll',
    `/win32icon:${icon}`,
    `/resource:${archive},Codexracker.Payload`,
    `/resource:${manifest},Codexracker.Manifest`,
    `/resource:${hashPath},Codexracker.Hash`,
    `/out:${executable}`,
    fileURLToPath(new URL('./Program.cs', import.meta.url)),
  ],
  { windowsHide: true, stdio: 'pipe' },
)
const report = {
  builtAt: new Date().toISOString(),
  executable,
  sha256: await hashFile(executable),
  nodeVersion: process.version,
  packages: Object.fromEntries(packages),
  payloadFiles: files.length,
  selfContained: true,
  originalCodexRuntimeBundled: false,
}
await writeFile(path.join(releaseRoot, 'latest.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
