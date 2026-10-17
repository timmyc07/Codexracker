import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { PipeConnection } from '../../companion/pipe.mjs'
let pipe
afterEach(() => {
  pipe?.close()
  vi.useRealTimers()
})
function fixture() {
  const input = new PassThrough(),
    output = new PassThrough()
  pipe = new PipeConnection(input, output)
  return { input, output }
}
it('preserves split UTF-8 frames and multiple replies without sockets', async () => {
  const { input, output } = fixture()
  const first = pipe.call('one'),
    second = pipe.call('two', { value: 1 }, 'session')
  expect(output.read().toString()).toContain('"sessionId":"session"')
  const frames = Buffer.from(
    JSON.stringify({ id: 1, result: { value: '你好😀' } }) +
      '\0' +
      JSON.stringify({ id: 2, result: { ok: true } }) +
      '\0',
  )
  for (const byte of frames) input.write(Buffer.from([byte]))
  expect(await first).toEqual({ value: '你好😀' })
  expect(await second).toEqual({ ok: true })
})
it('rejects outstanding operations when the application disconnects', async () => {
  fixture()
  const pending = expect(pipe.call('one')).rejects.toThrow('pipe-closed')
  pipe.close()
  await pending
  await expect(pipe.call('two')).rejects.toThrow('pipe-closed')
})
it('bounds commands and does not expose protocol error text', async () => {
  vi.useFakeTimers()
  const { input } = fixture()
  const failed = expect(pipe.call('private')).rejects.toThrow('pipe-command-rejected')
  input.write(JSON.stringify({ id: 1, error: { message: 'PRIVATE_CONTENT' } }) + '\0')
  await failed
  const expired = expect(pipe.call('never')).rejects.toThrow('pipe-command-timeout')
  await vi.advanceTimersByTimeAsync(15000)
  await expired
  expect(pipe.pending.size).toBe(0)
})
it('fails closed on invalid incoming data', async () => {
  const { input } = fixture()
  const failed = expect(pipe.call('one')).rejects.toThrow('pipe-closed')
  input.write('not-json\0')
  await failed
  expect(pipe.closed).toBe(true)
})
