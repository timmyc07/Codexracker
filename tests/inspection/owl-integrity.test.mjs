import assert from 'node:assert/strict'
import { test } from 'node:test'
import { integrityRecord, replaceEmbeddedIntegrity } from '../../injector/owl-integrity.mjs'
import { mainProbe, preloadProbe } from '../../injector/probe-payload.mjs'
import vm from 'node:vm'

const original = 'a'.repeat(64)
const patched = 'b'.repeat(64)

test('changes only the supported integrity record, preserving binary length and input', () => {
  const binary = Buffer.concat([
    Buffer.from('PE-prefix'),
    integrityRecord(original),
    Buffer.from('tail'),
  ])
  const before = Buffer.from(binary)
  const result = replaceEmbeddedIntegrity(binary, original, patched)
  assert.equal(result.binary.length, binary.length)
  assert.equal(result.resourceOffset, 9)
  assert.deepEqual(binary, before)
  assert.deepEqual(
    result.binary,
    Buffer.concat([Buffer.from('PE-prefix'), integrityRecord(patched), Buffer.from('tail')]),
  )
})

test('refuses unsupported, mismatched and duplicated integrity records', () => {
  assert.throws(
    () => replaceEmbeddedIntegrity(Buffer.from(original), original, patched),
    /exactly one/,
  )
  assert.throws(
    () => replaceEmbeddedIntegrity(integrityRecord(patched), original, patched),
    /exactly one/,
  )
  assert.throws(
    () =>
      replaceEmbeddedIntegrity(
        Buffer.concat([integrityRecord(original), integrityRecord(original)]),
        original,
        patched,
      ),
    /exactly one/,
  )
  assert.throws(() => integrityRecord('../bad'), /SHA256/)
})

test('generated main and preload payloads parse as CommonJS scripts', () => {
  assert.doesNotThrow(() => new vm.Script(mainProbe('test-nonce')))
  assert.doesNotThrow(() => new vm.Script(preloadProbe('test-nonce')))
})

test('preload exposes the nonce and reports readiness only after DOM is available', () => {
  let callback
  let bridge
  let sent
  const document = { readyState: 'loading', documentElement: { dataset: {} } }
  vm.runInNewContext(preloadProbe('test-nonce'), {
    document,
    console: { log() {} },
    window: {
      addEventListener(event, fn) {
        assert.equal(event, 'DOMContentLoaded')
        callback = fn
      },
    },
    require(name) {
      assert.equal(name, 'electron')
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            bridge = { name, nonce: value.nonce }
          },
        },
        ipcRenderer: {
          send(channel, nonce) {
            sent = { channel, nonce }
          },
        },
      }
    },
  })
  assert.deepEqual(bridge, { name: 'codexrackerProbe', nonce: 'test-nonce' })
  assert.equal(sent, undefined)
  callback()
  assert.equal(document.documentElement.dataset.codexrackerProbe, 'test-nonce')
  assert.deepEqual(sent, { channel: 'codexracker:probe-ready', nonce: 'test-nonce' })
})
