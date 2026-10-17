import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { synchronize, rollback } from '../../injector/runtime-manager.mjs'
import { patchIdentity } from '../../injector/runtime-patch.mjs'

const extensions = { main: 'main', preload: 'preload' }
const source = {
  packageFullName: 'v1',
  installLocation: 'C:/WindowsApps/v1',
  hashes: { asar: 'one' },
}
const next = { ...source, packageFullName: 'v2' }
const closed = { originalRunning: false, copyRunning: false }

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codexracker-manager-'))
  t.after(async () => {
    if (
      path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) ||
      !path.basename(root).startsWith('codexracker-manager-')
    )
      throw new Error('Unsafe fixture path')
    await rm(root, { recursive: true, force: true })
  })
  const calls = []
  let current = source
  let processes = closed
  const io = {
    snapshot: async () => current,
    processes: async () => processes,
    copy: async (_source, destination) => {
      calls.push('copy')
      await mkdir(destination, { recursive: true })
    },
    patch: async () => {
      calls.push('patch')
      return { patchId: patchIdentity(extensions), hashes: { asar: 'patched' } }
    },
    verify: async () => {
      calls.push('verify')
    },
    verifySource: async () => {
      calls.push('verify-source')
    },
    smoke: async () => {
      calls.push('smoke')
    },
  }
  const pointer = async () => JSON.parse(await readFile(path.join(root, 'active.json'), 'utf8'))
  return {
    root,
    io,
    calls,
    pointer,
    source: (v) => {
      current = v
    },
    processes: (v) => {
      processes = v
    },
  }
}

test('activation follows verification; repeated sync skips injection; rollback retains both versions', async (t) => {
  const f = await fixture(t)
  assert.equal((await synchronize(f.root, extensions, f.io)).status, 'activated')
  assert.deepEqual(f.calls, ['copy', 'verify-source', 'patch', 'verify', 'smoke'])
  const initial = await f.pointer()
  f.calls.length = 0
  assert.equal((await synchronize(f.root, extensions, f.io)).status, 'current')
  assert.deepEqual(f.calls, ['verify'])
  f.source(next)
  assert.equal((await synchronize(f.root, extensions, f.io)).status, 'activated')
  const updated = await f.pointer()
  assert.equal(updated.previous.id, initial.active.id)
  assert.equal((await rollback(f.root, f.io)).status, 'rolled-back')
  const restored = await f.pointer()
  assert.equal(restored.active.id, initial.active.id)
  assert.equal(restored.previous.id, updated.active.id)
  assert.equal((await synchronize(f.root, extensions, f.io)).status, 'defer-rolled-back-build')
})

test('verification failure preserves active pointer and latches repeated failures', async (t) => {
  const f = await fixture(t)
  await synchronize(f.root, extensions, f.io)
  const initial = await f.pointer()
  f.source(next)
  await assert.rejects(
    synchronize(f.root, extensions, {
      ...f.io,
      smoke: async () => {
        throw new Error('unsupported')
      },
    }),
  )
  assert.deepEqual(await f.pointer(), initial)
  f.calls.length = 0
  assert.equal((await synchronize(f.root, extensions, f.io)).status, 'defer-failed-build')
  assert.deepEqual(f.calls, [])
})

test('each source checkpoint and each process checkpoint blocks activation', async (t) => {
  for (const unstableAt of [2, 3, 4]) {
    const f = await fixture(t)
    let count = 0
    const io = { ...f.io, snapshot: async () => (++count >= unstableAt ? next : source) }
    assert.equal((await synchronize(f.root, extensions, io)).status, 'defer-unstable-source')
    await assert.rejects(f.pointer(), { code: 'ENOENT' })
  }
  for (const runningAt of [1, 2, 3]) {
    const f = await fixture(t)
    let count = 0
    const io = {
      ...f.io,
      processes: async () => (++count === runningAt ? { ...closed, copyRunning: true } : closed),
    }
    assert.equal((await synchronize(f.root, extensions, io)).status, 'defer-running-app')
    await assert.rejects(f.pointer(), { code: 'ENOENT' })
  }
})

test('copy failure, patch failure and fingerprint failure preserve previous version', async (t) => {
  for (const method of ['copy', 'patch', 'verifySource', 'verify']) {
    const f = await fixture(t)
    await synchronize(f.root, extensions, f.io)
    const initial = await f.pointer()
    f.source(next)
    await assert.rejects(
      synchronize(f.root, extensions, {
        ...f.io,
        [method]: async () => {
          throw new Error('failure')
        },
      }),
    )
    assert.deepEqual(await f.pointer(), initial)
  }
})

test('lock contention, unknown process state, corrupt pointer and failed rollback fail closed', async (t) => {
  const f = await fixture(t)
  await writeFile(path.join(f.root, 'manager.lock'), 'occupied')
  await assert.rejects(synchronize(f.root, extensions, f.io), { code: 'EEXIST' })
  const g = await fixture(t)
  g.processes({})
  assert.equal((await synchronize(g.root, extensions, g.io)).status, 'defer-running-app')
  assert.deepEqual(g.calls, [])
  await writeFile(path.join(g.root, 'active.json'), '{}')
  await assert.rejects(synchronize(g.root, extensions, g.io), /Invalid active pointer/)
  const h = await fixture(t)
  await synchronize(h.root, extensions, h.io)
  h.source(next)
  await synchronize(h.root, extensions, h.io)
  const initial = await h.pointer()
  await assert.rejects(
    rollback(h.root, {
      ...h.io,
      verify: async () => {
        throw new Error('tampered')
      },
    }),
  )
  assert.deepEqual(await h.pointer(), initial)
})
