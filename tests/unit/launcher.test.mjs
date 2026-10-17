import { expect, it, vi } from 'vitest'
import { errorMessage, runAction } from '../../launcher/worker.mjs'
it.each(['diagnose', 'sync'])('%s is read-only and never launches Codex', async (action) => {
  const io = {
    inspectTracker: vi.fn(async () => ({ status: 'current', version: 'test' })),
    startTracker: vi.fn(),
    rollbackTracker: vi.fn(),
  }
  const events = []
  await runAction(action, 'C:/data', 'C:/program', (event) => events.push(event), io)
  expect(io.startTracker).not.toHaveBeenCalled()
  expect(io.rollbackTracker).not.toHaveBeenCalled()
  expect(events.at(-1).status).toBe(action === 'diagnose' ? 'package-verified' : 'current')
})
it('launches and rolls back only through the signed-application manager', async () => {
  const io = {
    inspectTracker: vi.fn(),
    startTracker: vi.fn(async () => ({ status: 'started' })),
    rollbackTracker: vi.fn(async () => ({ status: 'rolled-back' })),
  }
  await runAction('launch', 'C:/data', 'C:/program', () => {}, io)
  await runAction('rollback', 'C:/data', 'C:/program', () => {}, io)
  expect(io.startTracker).toHaveBeenCalledExactlyOnceWith('C:/data', 'C:/program')
  expect(io.rollbackTracker).toHaveBeenCalledExactlyOnceWith('C:/data', 'C:/program')
})
it('shows useful errors without raw exceptions or protection bypass', () => {
  for (const code of ['EEXIST', 'EPERM', 'ENOSPC', 'UNKNOWN'])
    expect(errorMessage({ code, message: 'PRIVATE' })).not.toContain('PRIVATE')
  expect(errorMessage(new Error('No previous version'))).toContain('尚無')
})
