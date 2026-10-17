import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { openSignedSession } from '../../companion/session.mjs'
const state = vi.hoisted(() => ({ child: null, pipe: null, binding: null }))
vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFileSync: vi.fn() }))
vi.mock('../../companion/pipe.mjs', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    PipeConnection: class extends EventEmitter {
      constructor() {
        super()
        state.pipe = this
      }
      async call(method, params) {
        if (method === 'Target.getTargets')
          return { targetInfos: [{ targetId: 'target', type: 'page', url: 'app://-/index.html' }] }
        if (method === 'Target.attachToTarget') return { sessionId: 'page' }
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } }
        if (method === 'Runtime.enable')
          this.emit('event', {
            method: 'Runtime.executionContextCreated',
            sessionId: 'page',
            params: {
              context: { id: 5, origin: 'app://-', auxData: { isDefault: true, frameId: 'main' } },
            },
          })
        if (method === 'Runtime.addBinding') state.binding = params.name
        if (
          method === 'Runtime.evaluate' &&
          params.expression.includes('TokenTrackerPage.installPage')
        )
          queueMicrotask(() =>
            this.emit('event', {
              method: 'Runtime.bindingCalled',
              sessionId: 'page',
              params: {
                name: state.binding,
                executionContextId: 5,
                payload: JSON.stringify({ channel: 'tokentracker:ready' }),
              },
            }),
          )
        if (method === 'Browser.close') {
          state.child.emit('exit', 0)
          state.child.emit('close', 0)
        }
        return { result: { value: true } }
      }
      close() {}
    },
  }
})
let profile = ''
afterEach(async () => {
  vi.clearAllMocks()
  if (profile) await rm(profile, { recursive: true, force: true })
})
it('uses only inherited pipes and rejects page bindings outside the main app frame', async () => {
  profile = await mkdtemp(path.join(os.tmpdir(), 'tokentracker-session-'))
  const child = new EventEmitter()
  child.pid = 1234
  child.stdio = [null, null, null, {}, {}]
  state.child = child
  vi.mocked(spawn).mockReturnValue(child)
  const handle = vi.fn(async () => undefined)
  const session = await openSignedSession('C:/official', profile, '/* overlay */', () => handle)
  expect(spawn.mock.calls[0][1]).toEqual([
    `--user-data-dir=${profile}`,
    '--remote-debugging-pipe',
    '--no-first-run',
  ])
  expect(spawn.mock.calls[0][2].windowsHide).toBe(false)
  const binding = (context, payload) =>
    state.pipe.emit('event', {
      method: 'Runtime.bindingCalled',
      sessionId: 'page',
      params: { name: state.binding, executionContextId: context, payload },
    })
  binding(6, JSON.stringify({ id: 1, channel: 'codexracker:settings', value: {} }))
  binding(5, 'null')
  binding(5, '[]')
  binding(5, 'x'.repeat(100001))
  expect(handle).not.toHaveBeenCalled()
  binding(5, JSON.stringify({ id: 1, channel: 'codexracker:snapshot' }))
  expect(handle).toHaveBeenCalledExactlyOnceWith('codexracker:snapshot', undefined)
  state.pipe.emit('event', {
    method: 'Runtime.executionContextDestroyed',
    sessionId: 'page',
    params: { executionContextId: 5 },
  })
  binding(5, JSON.stringify({ id: 2, channel: 'codexracker:settings' }))
  expect(handle).toHaveBeenCalledTimes(1)
  await session.close()
  expect(execFileSync).not.toHaveBeenCalled()
})
