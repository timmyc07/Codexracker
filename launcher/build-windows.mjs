import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashFile } from '../companion/application.mjs'
const workspaceRoot = fileURLToPath(new URL('../', import.meta.url))

if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('Build requires Windows x64 Node')
const releaseRoot = path.join(workspaceRoot, 'release')
const build = path.join(releaseRoot, new Date().toISOString().replaceAll(/[:.]/g, '-'))
const payload = path.join(build, 'payload')
const app = path.join(payload, 'app')
const signature = JSON.parse(
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference='Stop';Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1');$s=Get-AuthenticodeSignature -FilePath $env:TT_NODE_FILE;[pscustomobject]@{status=$s.Status.ToString();publisher=$s.SignerCertificate.Subject}|ConvertTo-Json -Compress",
    ],
    {
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, TT_NODE_FILE: process.execPath },
    },
  ),
)
if (signature.status !== 'Valid' || !signature.publisher.includes('CN=OpenJS Foundation,'))
  throw new Error('Build requires the unmodified, officially signed Node runtime')
await mkdir(path.join(app, 'companion'), { recursive: true })
await mkdir(path.join(app, 'launcher'))
await mkdir(path.join(app, 'dist'))
await copyFile(process.execPath, path.join(payload, 'node.exe'))
const license = fileURLToPath(
  new URL(`./licenses/node-${process.version}-LICENSE.txt`, import.meta.url),
)
await copyFile(license, path.join(payload, 'NODE-LICENSE.txt'))
const requireProject = createRequire(import.meta.url)
const steno = path.resolve(
  path.dirname(createRequire(requireProject.resolve('lowdb')).resolve('steno')),
  '../LICENSE',
)
const notices = await Promise.all(
  [
    ['Svelte', path.join(workspaceRoot, 'node_modules/svelte/LICENSE.md')],
    ['lowdb', path.join(workspaceRoot, 'node_modules/lowdb/LICENSE')],
    ['steno', steno],
  ].map(async ([name, file]) => `${name}\n\n${await readFile(file, 'utf8')}`),
)
await writeFile(path.join(payload, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n'))
await writeFile(
  path.join(app, 'package.json'),
  JSON.stringify({ name: 'tokentracker-desktop', private: true, type: 'module' }),
)
for (const file of ['application.mjs', 'manager.mjs'])
  await copyFile(path.join(workspaceRoot, 'companion', file), path.join(app, 'companion', file))
for (const file of ['worker.mjs', 'start.mjs', 'install-shortcut.mjs'])
  await copyFile(fileURLToPath(new URL(file, import.meta.url)), path.join(app, 'launcher', file))
for (const file of ['companion.cjs', 'page.js'])
  await copyFile(path.join(workspaceRoot, 'dist', file), path.join(app, 'dist', file))

await copyFile(
  fileURLToPath(new URL('./TokenTracker.ico', import.meta.url)),
  path.join(payload, 'TokenTracker.ico'),
)
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
await writeFile(
  path.join(payload, 'manifest.json'),
  JSON.stringify({ version: '0.5.0', files }, null, 2),
)
const archive = path.join(build, 'TokenTracker.zip')
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::CreateFromDirectory($env:TT_PACK_SOURCE,$env:TT_PACK_DEST,[IO.Compression.CompressionLevel]::Optimal,$false)",
  ],
  {
    windowsHide: true,
    stdio: 'pipe',
    env: { ...process.env, TT_PACK_SOURCE: payload, TT_PACK_DEST: archive },
  },
)
const report = {
  builtAt: new Date().toISOString(),
  directory: payload,
  archive,
  sha256: await hashFile(archive),
  nodeVersion: process.version,
  nodeSha256: await hashFile(process.execPath),
  nodeSignature: signature.status,
  nodePublisher: signature.publisher,
  payloadFiles: files.length,
  selfContained: true,
  unsignedExecutable: false,
  originalCodexRuntimeBundled: false,
  officialFilesModified: false,
  tcpDebugServer: false,
}
await writeFile(path.join(releaseRoot, 'latest.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
