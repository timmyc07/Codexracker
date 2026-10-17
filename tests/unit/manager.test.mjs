import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import {
  acquireLease,
  startTracker,
  rollbackTracker,
  trackerRunning,
} from '../../companion/manager.mjs'
vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFileSync: vi.fn() }))
let directory = ''
afterEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  if (directory) await rm(directory, { recursive: true, force: true })
})
async function fixture() {
  directory = await mkdtemp(path.join(os.tmpdir(), 'tokentracker-manager-'))
  const root = path.join(directory, 'data'),
    programs = []
  for (const name of ['first', 'second']) {
    const program = path.join(directory, 'program', name, 'app')
    await mkdir(path.join(program, 'dist'), { recursive: true })
    await writeFile(path.join(program, 'dist/companion.cjs'), name)
    await writeFile(path.join(program, 'dist/page.js'), name)
    programs.push(program)
  }
  vi.mocked(spawn).mockImplementation((_exe, args) => {
    const child = new EventEmitter()
    child.unref = vi.fn()
    void writeFile(args[2], JSON.stringify({ status: 'started', version: 'test' }))
    return child
  })
  return {
    root,
    programs,
    state: async () => JSON.parse(await readFile(path.join(root, 'tracker-versions.json'), 'utf8')),
  }
}
it('records versions, rolls back verified local code and keeps that selection', async () => {
  const f = await fixture()
  await startTracker(f.root, f.programs[0])
  await startTracker(f.root, f.programs[1])
  expect((await f.state()).previous.program).toBe(f.programs[0])
  expect((await rollbackTracker(f.root, f.programs[1])).status).toBe('rolled-back')
  await startTracker(f.root, f.programs[1])
  expect(spawn.mock.calls.at(-1)[1][0]).toBe(path.join(f.programs[0], 'dist/companion.cjs'))
  expect((await f.state()).active.program).toBe(f.programs[0])
})
it('rejects altered rollback files and preserves the active selection', async () => {
  const f = await fixture()
  await startTracker(f.root, f.programs[0])
  await startTracker(f.root, f.programs[1])
  const before = await f.state()
  await writeFile(path.join(f.programs[0], 'dist/page.js'), 'changed')
  await expect(rollbackTracker(f.root, f.programs[1])).rejects.toThrow('fingerprint')
  expect(await f.state()).toEqual(before)
})
it('registers an overlay-only update when the controller code is unchanged', async () => {
  const f = await fixture()
  await writeFile(path.join(f.programs[1], 'dist/companion.cjs'), 'first')
  await startTracker(f.root, f.programs[0])
  await startTracker(f.root, f.programs[1])
  expect((await f.state()).active.program).toBe(f.programs[1])
  expect((await f.state()).previous.program).toBe(f.programs[0])
  await rollbackTracker(f.root, f.programs[1])
  await startTracker(f.root, f.programs[1])
  expect(spawn.mock.calls.at(-1)[1][0]).toBe(path.join(f.programs[0], 'dist/companion.cjs'))
})
it('serializes launches and recovers a proven stale process lock', async () => {
  const f = await fixture(),
    release = await acquireLease(f.root)
  expect(await trackerRunning(f.root)).toBe(true)
  await expect(acquireLease(f.root)).rejects.toThrow()
  expect((await startTracker(f.root, f.programs[0])).status).toBe('already-running')
  expect(spawn).not.toHaveBeenCalled()
  await release()
  await writeFile(path.join(f.root, 'tracker.lock'), JSON.stringify({ pid: 12345678 }))
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('missing'), { code: 'ESRCH' })
  })
  const recovered = await acquireLease(f.root)
  await recovered()
})
