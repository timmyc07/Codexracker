import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assessUpdate } from '../../injector/inspect-update.mjs'

const baseline = {
  packageFullName: 'OpenAI.Codex_v1',
  installLocation: 'C:/WindowsApps/v1',
  hashes: {
    'resources/app.asar': 'original-asar',
    'chrome.dll': 'original-native',
    'ChatGPT.exe': 'original-exe',
    'resources/native/windows-updater.node': 'original-updater',
  },
}
const closed = { originalRunning: false, copyRunning: false }

test('unchanged original fingerprints are current while Apps are running', () => {
  assert.equal(
    assessUpdate(baseline, baseline, baseline, { originalRunning: true, copyRunning: true }).status,
    'current',
  )
})
test('changed registration defers while either App runs', () => {
  const next = {
    ...baseline,
    packageFullName: 'OpenAI.Codex_v2',
    installLocation: 'C:/WindowsApps/v2',
  }
  for (const running of [
    { originalRunning: true, copyRunning: false },
    { originalRunning: false, copyRunning: true },
  ]) {
    assert.equal(assessUpdate(baseline, next, next, running).status, 'defer-running-app')
  }
  assert.equal(assessUpdate(baseline, next, next, closed).status, 'rebuild-required')
})
test('same-version ASAR replacement and native-only replacement both require rebuild', () => {
  for (const name of Object.keys(baseline.hashes)) {
    const next = { ...baseline, hashes: { ...baseline.hashes, [name]: 'changed' } }
    assert.equal(assessUpdate(baseline, next, next, closed).status, 'rebuild-required')
  }
})
test('registration changing during observations defers without rebuilding', () => {
  const next = { ...baseline, packageFullName: 'OpenAI.Codex_v2' }
  assert.equal(assessUpdate(baseline, baseline, next, closed).status, 'defer-unstable-source')
})
