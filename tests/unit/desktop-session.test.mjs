import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { desktopSession } from '../../injector/desktop-session.mjs'

vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFileSync: vi.fn() }))
vi.mock('playwright', () => ({ chromium: { connectOverCDP: vi.fn() } }))
let profile = ''
afterEach(async () => {
  if (profile) await rm(profile, { recursive: true, force: true })
  vi.resetAllMocks()
})

it('does not kill a child that closed with a signal while disconnecting CDP', async () => {
  profile = await mkdtemp(path.join(os.tmpdir(), 'codexracker-session-'))
  const child = new EventEmitter()
  child.pid = 12345
  child.exitCode = null
  vi.mocked(spawn).mockImplementation(() => {
    void writeFile(path.join(profile, 'DevToolsActivePort'), '1234\n/devtools/browser/test-id\n')
    return child
  })
  const page = {
    url: () => 'app://-/index.html',
    locator: () => ({ waitFor: async () => {} }),
    waitForFunction: async () => {},
  }
  vi.mocked(chromium.connectOverCDP).mockResolvedValue({
    contexts: () => [{ pages: () => [page] }],
    close: async () => {
      child.emit('exit', null, 'SIGTERM')
      child.emit('close', null, 'SIGTERM')
    },
  })
  expect(await desktopSession('C:/test/app', profile, 'C:/test/home', async () => 'verified')).toBe(
    'verified',
  )
  expect(execFileSync).not.toHaveBeenCalled()
  expect(await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).toContain('1234')
})
