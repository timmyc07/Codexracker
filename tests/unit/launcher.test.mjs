import { expect, it, vi } from 'vitest'
import { errorMessage, runAction } from '../../launcher/worker.mjs'

function fixture(status) {
  return {
    synchronize: vi.fn(async () => ({ status })),
    startDesktop: vi.fn(async () => ({ status: 'started' })),
    rollback: vi.fn(async () => ({ status: 'rolled-back' })),
    readProcesses: vi.fn(async () => ({ originalRunning: true, copyRunning: false })),
  }
}
it.each(['defer-running-app', 'defer-unstable-source'])(
  'does not launch when synchronization returns %s',
  async (status) => {
    const io = fixture(status)
    const events = []
    await runAction('launch', 'C:/data', {}, (event) => events.push(event), io)
    expect(io.startDesktop).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ type: 'result', status })
  },
)
it.each(['current', 'activated', 'defer-failed-build', 'defer-rolled-back-build'])(
  'launches only a verified current or retained version after %s',
  async (status) => {
    const io = fixture(status)
    const events = []
    await runAction('launch', 'C:/data', {}, (event) => events.push(event), io)
    expect(io.startDesktop).toHaveBeenCalledExactlyOnceWith('C:/data')
    expect(events.at(-1)).toMatchObject({ status: 'started' })
  },
)
it('check updates does not start the App; rollback verifies and then launches', async () => {
  const io = fixture('current')
  await runAction('sync', 'C:/data', {}, () => {}, io)
  expect(io.startDesktop).not.toHaveBeenCalled()
  await runAction('rollback', 'C:/data', {}, () => {}, io)
  expect(io.rollback).toHaveBeenCalledExactlyOnceWith('C:/data')
  expect(io.startDesktop).toHaveBeenCalledExactlyOnceWith('C:/data')
})
it('dependency diagnosis cannot copy, inject, launch or send model requests', async () => {
  const io = fixture('current')
  const events = []
  await runAction(
    'diagnose',
    'C:/data',
    {
      main: 'installDesktopMain',
      preload: 'installDesktopPreload',
    },
    (event) => events.push(event),
    io,
  )
  expect(io.synchronize).not.toHaveBeenCalled()
  expect(io.startDesktop).not.toHaveBeenCalled()
  expect(events.at(-1)).toMatchObject({ status: 'package-verified' })
})
it('errors expose only a useful category without leaking exception payloads', () => {
  expect(errorMessage({ code: 'EEXIST', message: 'PRIVATE_CONTENT' })).toContain('鎖')
  expect(errorMessage({ code: 'EPERM', message: 'PRIVATE_CONTENT' })).toContain('存取')
  expect(errorMessage({ code: 'ENOSPC', message: 'PRIVATE_CONTENT' })).toContain('空間')
  expect(errorMessage(new Error('PRIVATE_CONTENT'))).not.toContain('PRIVATE_CONTENT')
})
