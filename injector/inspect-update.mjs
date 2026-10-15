import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { experimentRoot, hashFile } from './copy-runtime.mjs'

export function readRegisteredPackage() {
  return JSON.parse(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fileURLToPath(new URL('./registered-package.ps1', import.meta.url)),
      ],
      { windowsHide: true, encoding: 'utf8' },
    ),
  )
}

export async function snapshotSource() {
  const registered = readRegisteredPackage()
  if (registered.packageStatus !== 'Ok')
    throw new Error(`Registered package is not ready: ${registered.packageStatus}`)
  const app = path.join(registered.installLocation, 'app')
  const hashes = {}
  for (const relative of [
    'resources/app.asar',
    'ChatGPT.exe',
    'chrome.dll',
    'resources/native/windows-updater.node',
  ]) {
    const file = path.join(app, relative)
    const before = await stat(file)
    hashes[relative] = await hashFile(file)
    const after = await stat(file)
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error('Installed package changed during fingerprinting')
  }
  const after = readRegisteredPackage()
  if (JSON.stringify(registered) !== JSON.stringify(after))
    throw new Error('Package registration changed during fingerprinting')
  return { ...registered, hashes }
}

export function assessUpdate(baseline, first, second, processes) {
  if (JSON.stringify(first) !== JSON.stringify(second)) return { status: 'defer-unstable-source' }
  const names = Object.keys(baseline.hashes).sort()
  const sourceChanged =
    first.packageFullName !== baseline.packageFullName ||
    first.installLocation !== baseline.installLocation ||
    names.some((name) => first.hashes[name] !== baseline.hashes[name])
  if (!sourceChanged) return { status: 'current' }
  if (processes.originalRunning || processes.copyRunning) return { status: 'defer-running-app' }
  return {
    status: 'rebuild-required',
    action:
      'Create a complete new versioned copy, verify it, and repatch; keep the previous working copy for rollback',
  }
}

export async function inspectUpdate() {
  const manifest = JSON.parse(
    await readFile(path.join(experimentRoot, 'copy-manifest.json'), 'utf8'),
  )
  const first = await snapshotSource()
  const second = await snapshotSource()
  const baseline = {
    packageFullName: path.basename(path.dirname(manifest.source)),
    installLocation: path.dirname(manifest.source),
    hashes: Object.fromEntries(
      Object.keys(first.hashes).map((name) => [
        name,
        manifest.files.find((file) => file.path === name)?.sha256,
      ]),
    ),
  }
  if (Object.values(baseline.hashes).some((hash) => typeof hash !== 'string'))
    throw new Error('Incomplete copy baseline fingerprint')
  const status = assessUpdate(baseline, first, second, { originalRunning: true, copyRunning: true })
  return {
    inspectedAt: new Date().toISOString(),
    ...status,
    baseline,
    current: first,
    twoSourceSnapshotsMatched: JSON.stringify(first) === JSON.stringify(second),
    mutationPerformed: false,
    note: 'Read-only status check. When a source change is detected, this command conservatively defers; rebuild tooling must verify both Apps are closed.',
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await inspectUpdate(), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
