import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  createPackage,
  createPackageFromStreams,
  extractFile,
  getRawHeader,
  uncache,
} from '@electron/asar'
import { getCurrentFuseWire, FuseState, FuseV1Options } from '@electron/fuses'
import { copyWhenUnlocked, experimentRoot, hashFile } from './copy-runtime.mjs'
import { headerHash, replaceEmbeddedIntegrity } from './owl-integrity.mjs'
import { mainProbe, preloadProbe } from './probe-payload.mjs'

const app = path.join(experimentRoot, 'app')
const archive = path.join(app, 'resources', 'app.asar')
const executable = path.join(app, 'ChatGPT.exe')
const backup = path.join(experimentRoot, 'backup')
const statePath = path.join(experimentRoot, 'probe-state.json')
const marker = '[Codexracker]'

async function assertCopy() {
  const manifest = JSON.parse(
    await readFile(path.join(experimentRoot, 'copy-manifest.json'), 'utf8'),
  )
  if (path.resolve(manifest.destination) !== app)
    throw new Error('Not the managed experimental copy')
  if ((await realpath(app)).toLowerCase() !== app.toLowerCase())
    throw new Error('Refusing redirected copy directory')
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      fileURLToPath(new URL('./assert-copy-closed.ps1', import.meta.url)),
      '-AppDirectory',
      app,
    ],
    { windowsHide: true, stdio: 'pipe' },
  )
  return manifest
}

async function verifyBackups(state) {
  for (const [name, hash] of Object.entries(state.originalHashes)) {
    if ((await hashFile(path.join(backup, name))) !== hash)
      throw new Error(`Backup hash mismatch: ${name}`)
  }
}

export async function restoreCopy() {
  await assertCopy()
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  await verifyBackups(state)
  for (const [name, target] of [
    ['app.asar', archive],
    ['ChatGPT.exe', executable],
  ]) {
    const hash = await hashFile(target)
    if (hash !== state.originalHashes[name] && hash !== state.patchedHashes?.[name]) {
      throw new Error(`Unknown local modification; preserving files: ${name}`)
    }
  }
  await copyWhenUnlocked(path.join(backup, 'app.asar'), archive)
  await copyWhenUnlocked(path.join(backup, 'ChatGPT.exe'), executable)
  uncache(archive)
  for (const [name, target] of [
    ['app.asar', archive],
    ['ChatGPT.exe', executable],
  ]) {
    if ((await hashFile(target)) !== state.originalHashes[name])
      throw new Error(`Restore failed: ${name}`)
  }
  state.status = 'restored'
  await writeFile(statePath, JSON.stringify(state, null, 2))
  return { restored: true, originalHashes: state.originalHashes }
}

async function repackProbe(source, destination, nonce) {
  const { header } = getRawHeader(source)
  const pkg = JSON.parse(extractFile(source, 'package.json').toString())
  const main = path.normalize(pkg.main)
  const preload = path.normalize('.vite/build/preload.js')
  const mainCode = extractFile(source, main).toString()
  const preloadCode = extractFile(source, preload).toString()
  if (mainCode.includes(marker) || preloadCode.includes(marker)) throw new Error('Already injected')
  const replacements = new Map([
    [main, Buffer.from(mainProbe(nonce) + mainCode)],
    [preload, Buffer.from(preloadCode + preloadProbe(nonce))],
  ])
  const streams = []
  function visit(entries, parent = '') {
    for (const [name, entry] of Object.entries(entries)) {
      const file = path.join(parent, name)
      if (entry.link) throw new Error('Unsupported ASAR links; no patch applied')
      if (entry.files) {
        streams.push({ path: file, type: 'directory', unpacked: !!entry.unpacked })
        visit(entry.files, file)
      } else {
        streams.push({
          path: file,
          type: 'file',
          unpacked: !!entry.unpacked,
          stat: {
            size: replacements.get(file)?.length ?? entry.size,
            mode: entry.executable ? 0o100755 : 0o100644,
          },
          streamGenerator: () =>
            Readable.from([replacements.get(file) ?? extractFile(source, file)]),
        })
      }
    }
  }
  visit(header.files)
  await createPackageFromStreams(destination, streams)
  for (const [file, bytes] of replacements) {
    if (!extractFile(destination, file).equals(bytes))
      throw new Error(`Repacked probe mismatch: ${file}`)
  }
}

export async function prepareProbe(mode) {
  if (!['harness', 'application'].includes(mode))
    throw new Error('Mode must be harness or application')
  const manifest = await assertCopy()
  const expected = (name) => manifest.files.find((f) => f.path === name)?.sha256
  // Each experiment starts from the untouched copy, never from a previous patch.
  if (
    (await hashFile(archive)) !== expected('resources/app.asar') ||
    (await hashFile(executable)) !== expected('ChatGPT.exe')
  )
    throw new Error('Restore the copy before preparing another probe')
  await mkdir(backup, { recursive: true })
  for (const [name, source] of [
    ['app.asar', archive],
    ['ChatGPT.exe', executable],
  ]) {
    try {
      await copyFile(source, path.join(backup, name), constants.COPYFILE_EXCL)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
  const state = {
    mode,
    nonce: randomUUID(),
    status: 'preparing',
    originalHashes: {
      'app.asar': expected('resources/app.asar'),
      'ChatGPT.exe': expected('ChatGPT.exe'),
    },
    originalHeaderHash: headerHash(archive),
  }
  await verifyBackups(state)
  const wire = await getCurrentFuseWire(path.join(app, 'chrome.dll'))
  if (
    wire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] !== FuseState.ENABLE ||
    wire[FuseV1Options.OnlyLoadAppFromAsar] !== FuseState.ENABLE
  )
    throw new Error('Unexpected Owl integrity configuration')
  const staged = path.join(experimentRoot, `probe-${state.nonce}.asar`)
  if (mode === 'harness') {
    const source = path.join(experimentRoot, `harness-${state.nonce}`)
    await mkdir(source)
    await writeFile(
      path.join(source, 'package.json'),
      JSON.stringify({ name: 'codexracker-probe', version: '1.0.0', main: 'main.cjs' }),
    )
    await writeFile(
      path.join(source, 'main.cjs'),
      mainProbe(state.nonce) +
        `
      const {app,BrowserWindow} = require('electron')
      const path = require('node:path')
      app.whenReady().then(async () => {
        const window = new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(__dirname,'preload.cjs')}})
        await window.loadURL('data:text/html,<html><body>Codexracker probe</body></html>')
      })
    `,
    )
    await writeFile(path.join(source, 'preload.cjs'), preloadProbe(state.nonce))
    await createPackage(source, staged)
  } else {
    await repackProbe(archive, staged, state.nonce)
  }
  const newHeaderHash = headerHash(staged)
  const patchedExe = replaceEmbeddedIntegrity(
    await readFile(executable),
    state.originalHeaderHash,
    newHeaderHash,
  )
  const stagedExe = path.join(experimentRoot, `probe-${state.nonce}.exe`)
  await writeFile(stagedExe, patchedExe.binary, { flag: 'wx' })
  state.patchedHeaderHash = newHeaderHash
  state.resourceOffset = patchedExe.resourceOffset
  state.patchedHashes = {
    'app.asar': await hashFile(staged),
    'ChatGPT.exe': await hashFile(stagedExe),
  }
  await writeFile(statePath, JSON.stringify(state, null, 2))
  // The copied app must be closed while replacing this pair. Originals remain in backup.
  try {
    await copyWhenUnlocked(staged, archive)
    await copyWhenUnlocked(stagedExe, executable)
    if (
      (await hashFile(archive)) !== state.patchedHashes['app.asar'] ||
      (await hashFile(executable)) !== state.patchedHashes['ChatGPT.exe']
    )
      throw new Error('Installed probe hash mismatch')
  } catch (error) {
    try {
      await restoreCopy()
    } catch (restoreError) {
      throw new Error(
        `Patch failed: ${error.message}; restore failed: ${restoreError.message}; backups preserved`,
      )
    }
    throw new Error(`Patch failed and was restored: ${error.message}`)
  }
  uncache(archive)
  state.status = 'patched'
  await writeFile(statePath, JSON.stringify(state, null, 2))
  return state
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const action = process.argv[2]
    const result = action === 'restore' ? await restoreCopy() : await prepareProbe(action)
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
