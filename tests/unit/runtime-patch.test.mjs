import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createPackage, extractFile, uncache } from '@electron/asar'
import { getCurrentFuseWire, FuseState, FuseV1Options } from '@electron/fuses'
import { headerHash, integrityRecord } from '../../injector/owl-integrity.mjs'
import { patchRuntime, patchMarker, verifyRuntime } from '../../injector/runtime-patch.mjs'

vi.mock('@electron/fuses', async (original) => {
  const actual = await original()
  return { ...actual, getCurrentFuseWire: vi.fn() }
})
let root = ''
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  vi.resetAllMocks()
})
const extensions = { main: '\n// main\n', preload: '\n// preload\n' }
async function fixture() {
  root = await mkdtemp(path.join(os.tmpdir(), 'codexracker-patch-'))
  const source = path.join(root, 'source')
  const app = path.join(root, 'generation/app')
  await mkdir(path.join(source, '.vite/build'), { recursive: true })
  await mkdir(path.join(app, 'resources/native'), { recursive: true })
  await writeFile(
    path.join(source, 'package.json'),
    JSON.stringify({ main: '.vite/build/main.js' }),
  )
  await writeFile(path.join(source, '.vite/build/main.js'), 'console.log("host")')
  await writeFile(
    path.join(source, '.vite/build/preload.js'),
    'const channel="codex_desktop:message-for-view"',
  )
  await writeFile(path.join(source, 'unchanged.txt'), 'preserve-me')
  const archive = path.join(app, 'resources/app.asar')
  await createPackage(source, archive)
  await writeFile(
    path.join(app, 'ChatGPT.exe'),
    Buffer.concat([Buffer.from('fake-PE'), integrityRecord(headerHash(archive))]),
  )
  await writeFile(path.join(app, 'chrome.dll'), 'fake-runtime')
  await writeFile(path.join(app, 'resources/native/windows-updater.node'), 'fake-updater')
  vi.mocked(getCurrentFuseWire).mockResolvedValue({
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FuseState.ENABLE,
    [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.ENABLE,
  })
  return { app, archive }
}

it('repacks and updates integrity once; subsequent identical patch verifies without rewriting', async () => {
  const { app, archive } = await fixture()
  const receipt = await patchRuntime(app, extensions)
  await verifyRuntime(app, receipt)
  expect(
    extractFile(archive, path.normalize('.vite/build/main.js')).toString().split(patchMarker),
  ).toHaveLength(2)
  expect(extractFile(archive, 'unchanged.txt').toString()).toBe('preserve-me')
  const patched = await readFile(archive)
  expect((await patchRuntime(app, extensions)).skipped).toBe(true)
  expect(await readFile(archive)).toEqual(patched)
  await expect(patchRuntime(app, { ...extensions, main: 'different' })).rejects.toThrow(
    'new generation',
  )
  await writeFile(path.join(app, 'ChatGPT.exe'), 'tampered')
  await expect(patchRuntime(app, extensions)).rejects.toThrow('fingerprint')
  uncache(archive)
})

it('rejects unsupported integrity before touching the original archive', async () => {
  const { app, archive } = await fixture()
  const original = await readFile(archive)
  vi.mocked(getCurrentFuseWire).mockResolvedValue({})
  await expect(patchRuntime(app, extensions)).rejects.toThrow('Unsupported integrity')
  expect(await readFile(archive)).toEqual(original)
  uncache(archive)
})
