import { createHash } from 'node:crypto'
import { readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { extractFile, uncache } from '@electron/asar'
import { getCurrentFuseWire, FuseState, FuseV1Options } from '@electron/fuses'
import { hashFile } from './copy-runtime.mjs'
import { headerHash, replaceEmbeddedIntegrity } from './owl-integrity.mjs'
import { repackArchive } from './repack-archive.mjs'
import { inspectArchive } from './inspect-installation.mjs'

export const patchMarker = '/* Codexracker desktop v1 */'
export const patchIdentity = (extensions) =>
  createHash('sha256')
    .update(patchMarker + extensions.main + extensions.preload)
    .digest('hex')

export async function runtimeHashes(app) {
  return Object.fromEntries(
    await Promise.all(
      [
        'resources/app.asar',
        'ChatGPT.exe',
        'chrome.dll',
        'resources/native/windows-updater.node',
      ].map(async (file) => [file, await hashFile(path.join(app, file))]),
    ),
  )
}

export async function verifyRuntime(app, receipt) {
  if (JSON.stringify(await runtimeHashes(app)) !== JSON.stringify(receipt.hashes))
    throw new Error('Managed runtime fingerprint mismatch')
  const archive = path.join(app, 'resources/app.asar')
  const pkg = JSON.parse(extractFile(archive, 'package.json').toString())
  for (const file of [pkg.main, '.vite/build/preload.js']) {
    const code = extractFile(archive, path.normalize(file)).toString()
    if (code.split(patchMarker).length !== 2) throw new Error('Missing or duplicated injection')
  }
  const binary = await readFile(path.join(app, 'ChatGPT.exe'))
  // Also verifies that the current ASAR header has exactly one matching PE record.
  replaceEmbeddedIntegrity(binary, headerHash(archive), headerHash(archive))
}

/** Only called on a new, closed generation; a failed generation is never activated. */
export async function patchRuntime(app, extensions) {
  const receiptPath = path.join(path.dirname(app), 'patch.json')
  const patchId = patchIdentity(extensions)
  let existing
  try {
    existing = JSON.parse(await readFile(receiptPath, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (existing) {
    if (existing.patchId !== patchId) throw new Error('Build a new generation for a new patch')
    await verifyRuntime(app, existing)
    return { ...existing, skipped: true }
  }
  const archive = path.join(app, 'resources/app.asar')
  const executable = path.join(app, 'ChatGPT.exe')
  const wire = await getCurrentFuseWire(path.join(app, 'chrome.dll'))
  if (
    wire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] !== FuseState.ENABLE ||
    wire[FuseV1Options.OnlyLoadAppFromAsar] !== FuseState.ENABLE
  )
    throw new Error('Unsupported integrity configuration')
  const main = path.normalize(inspectArchive(archive).main)
  const preload = path.normalize('.vite/build/preload.js')
  const mainCode = extractFile(archive, main).toString()
  const preloadCode = extractFile(archive, preload).toString()
  if (
    !preloadCode.includes('codex_desktop:message-for-view') ||
    [mainCode, preloadCode].some((code) => code.includes('Codexracker'))
  )
    throw new Error('Unsupported or already modified source')
  const staged = path.join(app, 'resources/app.codexracker.asar')
  await repackArchive(
    archive,
    staged,
    new Map([
      [main, Buffer.from(patchMarker + extensions.main + mainCode)],
      [preload, Buffer.from(preloadCode + '\n' + patchMarker + extensions.preload)],
    ]),
  )
  const patched = replaceEmbeddedIntegrity(
    await readFile(executable),
    headerHash(archive),
    headerHash(staged),
  )
  await writeFile(executable + '.staged', patched.binary, { flag: 'wx' })
  await rename(staged, archive)
  await rename(executable + '.staged', executable)
  uncache(archive)
  const receipt = { patchId, hashes: await runtimeHashes(app) }
  await verifyRuntime(app, receipt)
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { flag: 'wx' })
  return receipt
}
