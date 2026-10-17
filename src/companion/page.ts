import { createTrackerBridge } from './bridge'
import { mountOverlay } from '../overlay/mount'

interface HostBridge {
  sendMessageFromView(value: unknown): Promise<void>
}
interface Packet {
  id?: number
  channel?: string
  value?: unknown
  error?: boolean
}

export function installPage(binding: string) {
  if (window.top !== window || location.protocol !== 'app:' || window.codexracker) return
  const globals = window as unknown as Record<string, unknown>
  const host = globals.electronBridge as HostBridge
  if (typeof host?.sendMessageFromView !== 'function' || typeof globals[binding] !== 'function')
    throw new Error('tracker-host-bridge-unavailable')
  const send = globals[binding] as (value: string) => void
  let sequence = 0
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const listeners = new Map<string, Set<(event: unknown, value: unknown) => void>>()
  const dispatch = (channel: string, value: unknown) => {
    for (const listener of listeners.get(channel) ?? []) {
      try {
        listener(undefined, value)
      } catch {
        /* Keep observers outside host dispatch. */
      }
    }
  }
  Object.defineProperty(window, `${binding}Receive`, {
    value: (packet: Packet) => {
      if (packet.id !== undefined) {
        const request = pending.get(packet.id)
        if (!request) return
        pending.delete(packet.id)
        clearTimeout(request.timer)
        if (packet.error) request.reject(new Error('tracker-operation-failed'))
        else request.resolve(packet.value)
      } else if (packet.channel) dispatch(packet.channel, packet.value)
    },
  })
  const ipc = {
    send: (channel: string, value: unknown) => send(JSON.stringify({ channel, value })),
    invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
      if (channel === 'codex_desktop:message-from-view') return host.sendMessageFromView(args[0])
      if (pending.size >= 100) return Promise.reject(new Error('tracker-busy'))
      return new Promise((resolve, reject) => {
        const id = ++sequence
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error('tracker-operation-timeout'))
        }, 15000)
        pending.set(id, { resolve, reject, timer })
        send(JSON.stringify({ id, channel, value: args[0] }))
      })
    },
    on: (channel: string, listener: (event: unknown, value: unknown) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set())
      listeners.get(channel)!.add(listener)
    },
    removeListener: (channel: string, listener: (event: unknown, value: unknown) => void) =>
      listeners.get(channel)?.delete(listener),
  }
  const api = createTrackerBridge(ipc)
  Object.defineProperty(window, 'codexracker', { value: api })
  window.addEventListener('message', (event) => {
    if (event.source !== null && event.source !== window) return
    dispatch('codex_desktop:message-for-view', event.data)
  })
  const originalPost = MessagePort.prototype.postMessage
  MessagePort.prototype.postMessage = function (
    ...args: [unknown, (Transferable[] | StructuredSerializeOptions)?]
  ) {
    dispatch('tokentracker:request', args[0])
    return Reflect.apply(originalPost, this, args)
  }
  window.addEventListener(
    'pagehide',
    () => {
      MessagePort.prototype.postMessage = originalPost
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(new Error('tracker-page-closed'))
      }
      pending.clear()
    },
    { once: true },
  )
  const mount = () => {
    void mountOverlay().then(
      () => ipc.send('tokentracker:ready', { version: 1 }),
      () => {},
    )
  }
  if (document.body) mount()
  else window.addEventListener('DOMContentLoaded', mount, { once: true })
}
