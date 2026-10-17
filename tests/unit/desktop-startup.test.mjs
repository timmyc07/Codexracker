import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { verifyDesktopStartup } from '../../injector/desktop-startup.mjs'

vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFileSync: vi.fn() }))
let root = ''
afterEach(async () => {
  vi.useRealTimers()
  vi.resetAllMocks()
  if (root) await rm(root, { recursive: true, force: true })
})

async function fixture(result = 'passed', code = 0) {
  root = await mkdtemp(path.join(os.tmpdir(), 'tokentracker-startup-'))
  const child = new EventEmitter()
  child.pid = 12345
  child.kill = vi.fn()
  vi.mocked(spawn).mockImplementation((_exe, _args, options) => {
    void writeFile(
      path.join(options.env.TOKENTRACKER_STARTUP_PROFILE, 'startup-proof.json'),
      JSON.stringify({ result }),
    ).then(() => child.emit('close', code))
    return child
  })
  return child
}

it('validates the renderer without a TCP debug port or Playwright and uses an isolated home', async () => {
  await fixture()
  await expect(verifyDesktopStartup('C:/app', root)).resolves.toEqual({
    result: 'passed',
    debugServer: false,
  })
  const [, args, options] = vi.mocked(spawn).mock.calls[0]
  expect(args).toEqual([
    `--user-data-dir=${options.env.TOKENTRACKER_STARTUP_PROFILE}`,
    '--no-first-run',
  ])
  expect(options.env.CODEX_HOME).toBe(path.join(root, 'smoke-home'))
  expect(options.env.OPENAI_API_KEY).toBeUndefined()
  expect(execFileSync).not.toHaveBeenCalled()
  expect(
    await readFile(
      path.join(options.env.TOKENTRACKER_STARTUP_PROFILE, 'startup-proof.json'),
      'utf8',
    ),
  ).toContain('passed')
})

it.each([
  ['failed', 0, 'renderer-validation'],
  ['passed', 1, 'startup-failed'],
])('rejects proof %s with exit %s', async (result, code, message) => {
  await fixture(result, code)
  await expect(verifyDesktopStartup('C:/app', root)).rejects.toThrow(message)
})

it('bounds a hung startup and terminates only its own child tree', async () => {
  const child = await fixture()
  vi.mocked(spawn).mockReturnValue(child)
  vi.mocked(execFileSync).mockImplementation(() => {
    child.emit('close', 1)
  })
  vi.useFakeTimers()
  const pending = expect(verifyDesktopStartup('C:/app', root)).rejects.toThrow('startup-timeout')
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
  await vi.advanceTimersByTimeAsync(30000)
  await pending
  expect(execFileSync).toHaveBeenCalledWith(
    'taskkill.exe',
    ['/PID', '12345', '/T', '/F'],
    expect.any(Object),
  )
})

it('still rejects a timeout if Windows refuses to terminate the child', async () => {
  const child = await fixture()
  vi.mocked(spawn).mockReturnValue(child)
  vi.mocked(execFileSync).mockImplementation(() => {
    throw new Error('denied')
  })
  child.kill.mockImplementation(() => {
    throw new Error('denied')
  })
  vi.useFakeTimers()
  const pending = expect(verifyDesktopStartup('C:/app', root)).rejects.toThrow('startup-timeout')
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
  await vi.advanceTimersByTimeAsync(30000)
  await pending
})
