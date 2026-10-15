import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createPackage } from '@electron/asar'
import {
  inspectArchive,
  inspectFuses,
  inspectInstallation,
} from '../../injector/inspect-installation.mjs'

async function fixture(t, main, includeEntry = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codexracker-inspection-'))
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('codexracker-inspection-'))
    await rm(root, { recursive: true, force: true })
  })
  const source = path.join(root, 'source')
  await mkdir(path.join(source, '.vite', 'build'), { recursive: true })
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'fixture', main }))
  if (includeEntry) await writeFile(path.join(source, '.vite', 'build', 'main.js'), 'void 0')
  await writeFile(path.join(source, '.vite', 'build', 'preload.js'), 'void 0')
  const archive = path.join(root, 'app.asar')
  await createPackage(source, archive)
  return { root, archive }
}

test('reads the main and preload metadata without changing the archive', async (t) => {
  const { archive } = await fixture(t, '.vite/build/main.js')
  const before = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex')
  const report = inspectArchive(archive)
  assert.equal(report.main, '.vite/build/main.js')
  assert.equal(report.mainSizeBytes, 6)
  assert.deepEqual(report.preloadCandidates, ['.vite/build/preload.js'])
  assert.equal(report.injectionVerified, false)
  assert.equal(
    createHash('sha256')
      .update(await readFile(archive))
      .digest('hex'),
    before,
  )
})

test('fails when the declared main is missing', async (t) => {
  const { archive } = await fixture(t, '.vite/build/missing.js', false)
  assert.throws(() => inspectArchive(archive), /not found/)
})

for (const main of ['../outside.js', '/outside.js', 'C:\\outside.js', undefined]) {
  test(`rejects unsafe or absent main: ${main}`, async (t) => {
    const { archive } = await fixture(t, main)
    assert.throws(() => inspectArchive(archive), /Archive main/)
  })
}

test('a binary without standard fuses remains unverified', async (t) => {
  const { root } = await fixture(t, '.vite/build/main.js')
  const executable = path.join(root, 'ChatGPT.exe')
  await writeFile(executable, 'fixture without Electron sentinel')
  const before = await readFile(executable)
  const report = await inspectFuses(executable)
  assert.equal(report.status, 'unverified')
  assert.equal(report.embeddedAsarIntegrity, 'unknown')
  assert.deepEqual(await readFile(executable), before)
})

test('a readable installation never passes injection acceptance from metadata alone', async (t) => {
  const { root, archive } = await fixture(t, '.vite/build/main.js')
  const resources = path.join(root, 'app', 'resources')
  await mkdir(resources, { recursive: true })
  await copyFile(archive, path.join(resources, 'app.asar'))
  await writeFile(
    path.join(resources, 'owl-electron-app.json'),
    JSON.stringify({ runtimeName: 'owl' }),
  )
  await writeFile(path.join(root, 'app', 'ChatGPT.exe'), 'fixture without Electron sentinel')
  const report = await inspectInstallation(root)
  assert.equal(report.result, 'blocked')
  assert.equal(report.archive.fingerprintUnchangedDuringInspection, true)
  assert.equal(report.archive.injectionVerified, false)
  assert.equal(report.fuses.embeddedAsarIntegrity, 'unknown')
  assert.ok(report.blockers.some((reason) => reason.includes('patching is blocked')))
  assert.equal(report.applicationFilesModified, false)
  assert.equal(report.applicationLaunched, false)
  assert.equal(report.realRequestsSent, false)
})
