import { copyFile, lstat, mkdir, readFile, realpath, rename } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { hashFile } from '../companion/application.mjs'

const source = path.resolve(process.argv[2] ?? fileURLToPath(new URL('../../', import.meta.url)))
const manifestFile = path.join(source, 'manifest.json')
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
if (
  manifest.version !== '0.5.0' ||
  !Array.isArray(manifest.files) ||
  manifest.files.length < 10 ||
  manifest.files.length > 30
)
  throw new Error('Invalid TokenTracker bundle')
const files = new Map()
for (const file of manifest.files) {
  if (
    typeof file.path !== 'string' ||
    files.has(file.path.toLowerCase()) ||
    !/^[a-f0-9]{64}$/.test(file.sha256)
  )
    throw new Error('Invalid bundle manifest')
  files.set(file.path.toLowerCase(), file)
}
for (const required of [
  'node.exe',
  'tokentracker.ico',
  'app/launcher/start.mjs',
  'app/dist/companion.cjs',
  'app/dist/page.js',
])
  if (!files.has(required)) throw new Error('Incomplete TokenTracker bundle')
const bundledFile = (directory, relative) => {
  const target = path.resolve(directory, relative)
  if (
    path.isAbsolute(relative) ||
    relative.includes(':') ||
    !target.toLowerCase().startsWith(directory.toLowerCase() + path.sep)
  )
    throw new Error('Invalid bundled path')
  return target
}
const verify = async (directory) => {
  if ((await realpath(directory)).toLowerCase() !== directory.toLowerCase())
    throw new Error('Redirected program directory')
  for (const file of files.values()) {
    const target = bundledFile(directory, file.path)
    if (
      (await lstat(target)).isSymbolicLink() ||
      (await realpath(target)).toLowerCase() !== target.toLowerCase() ||
      (await hashFile(target)) !== file.sha256
    )
      throw new Error('Bundle fingerprint mismatch')
  }
}
await verify(source)
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
      env: { ...process.env, TT_NODE_FILE: path.join(source, 'node.exe') },
    },
  ),
)
if (signature.status !== 'Valid' || !signature.publisher.includes('CN=OpenJS Foundation,'))
  throw new Error('Official Node signature invalid')
if (!process.env.LOCALAPPDATA || !path.isAbsolute(process.env.LOCALAPPDATA))
  throw new Error('Local application data unavailable')
const root = path.join(process.env.LOCALAPPDATA, 'Codexracker')
const programs = path.join(root, 'program')
await mkdir(programs, { recursive: true })
if ((await realpath(programs)).toLowerCase() !== programs.toLowerCase())
  throw new Error('Redirected install directory')
const bundleHash = await hashFile(manifestFile)
const installed = path.join(programs, bundleHash.slice(0, 24))
let exists = false
try {
  await lstat(installed)
  exists = true
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
if (exists) {
  await verify(installed)
  if ((await hashFile(path.join(installed, 'manifest.json'))) !== bundleHash)
    throw new Error('Installed manifest changed')
} else {
  const staged = path.join(programs, `.staging-${randomUUID()}`)
  await mkdir(staged)
  for (const file of files.values()) {
    const destination = bundledFile(staged, file.path)
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(bundledFile(source, file.path), destination)
  }
  await copyFile(manifestFile, path.join(staged, 'manifest.json'))
  await verify(staged)
  await rename(staged, installed)
}
const shortcut = JSON.parse(
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference='Stop';[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);$p=Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'TokenTracker.lnk';$shell=New-Object -ComObject WScript.Shell;if(Test-Path -LiteralPath $p){$old=$shell.CreateShortcut($p);if(-not $old.Description.StartsWith('TokenTracker')){throw 'Refusing unrelated shortcut'}};$s=$shell.CreateShortcut($p);$s.TargetPath=$env:TT_NODE_FILE;$s.Arguments='\"'+$env:TT_START_FILE+'\" \"'+$env:TT_DATA_DIR+'\"';$s.WorkingDirectory=$env:TT_APP_DIR;$s.Description='TokenTracker - Codex Token usage tracker';$s.IconLocation=$env:TT_ICON_FILE+',0';$s.WindowStyle=1;$s.Save();[pscustomobject]@{shortcut=$p;target=$s.TargetPath}|ConvertTo-Json -Compress",
    ],
    {
      windowsHide: true,
      encoding: 'utf8',
      env: {
        ...process.env,
        TT_NODE_FILE: path.join(installed, 'node.exe'),
        TT_START_FILE: path.join(installed, 'app/launcher/start.mjs'),
        TT_DATA_DIR: path.join(root, 'data'),
        TT_APP_DIR: path.join(installed, 'app'),
        TT_ICON_FILE: path.join(installed, 'TokenTracker.ico'),
      },
    },
  ),
)
console.log(
  JSON.stringify({
    ...shortcut,
    bundleSha256: bundleHash,
    nodeSignature: 'Valid',
    unsignedExecutable: false,
    officialFilesModified: false,
  }),
)
