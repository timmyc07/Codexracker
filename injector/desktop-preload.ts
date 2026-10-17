import { channels } from '../src/bridge'
import type { TrackerBridge } from '../src/bridge'
import type { Dashboard } from '../src/overlay/summary'
import { installIpcUsageInterceptor } from '../src/interceptor/proxy'
import type { IpcUsageSource } from '../src/interceptor/proxy'
import { createLiveObserver } from '../src/interceptor/live'
import { objectFrom } from '../src/interceptor/usage'

interface RendererIpc extends IpcUsageSource {
  send(channel: string, value: unknown): void
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

export function installDesktopPreload(
  ipc: RendererIpc,
  contextBridge: { exposeInMainWorld(name: string, value: unknown): void },
) {
  const live = createLiveObserver((state) => ipc.send(channels.live, state))
  const originalInvoke = ipc.invoke.bind(ipc)
  ipc.invoke = (channel, ...args) => {
    if (channel === 'codex_desktop:message-from-view') live.observeRequest(args[0])
    return originalInvoke(channel, ...args)
  }
  let sequence = 0
  let pending:
    | { id: string; done: () => void; timer: ReturnType<typeof setTimeout>; promise: Promise<void> }
    | undefined
  let polling: ReturnType<typeof setInterval> | undefined
  const refreshLimits = (): Promise<void> => {
    if (pending) return pending.promise
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    const id = `codexracker-rate-limits-${Date.now()}-${++sequence}`
    const timer = setTimeout(() => {
      if (pending?.id !== id) return
      pending = undefined
      live.limitsUnavailable()
      resolve()
    }, 15000)
    pending = { id, done: resolve, timer, promise }
    void originalInvoke('codex_desktop:message-from-view', {
      type: 'mcp-request',
      hostId: 'local',
      request: { id, method: 'account/rateLimits/read', params: {} },
    }).catch(() => {
      if (pending?.id !== id) return
      clearTimeout(timer)
      pending = undefined
      live.limitsUnavailable()
      resolve()
    })
    return promise
  }
  ipc.on('codex_desktop:message-for-view', (_event, value) => {
    try {
      live.observe(value)
      const envelope = objectFrom(value)
      const message = objectFrom(envelope.message)
      if (
        envelope.type === 'mcp-response' &&
        envelope.hostId === 'local' &&
        pending &&
        pending.id === message.id
      ) {
        const done = pending.done
        clearTimeout(pending.timer)
        pending = undefined
        if (message.error) live.limitsUnavailable()
        else live.receiveLimits(message.result)
        done()
      }
    } catch {
      /* Do not let observer failures escape into host dispatch. */
    }
  })
  // Only the observed IPC parser can write usage; the page receives no write API.
  installIpcUsageInterceptor(
    ipc,
    (metrics, identity) => ipc.send(channels.record, { metrics, identity }),
    live.modelFor,
  )
  const api: TrackerBridge = {
    snapshot: () => originalInvoke(channels.snapshot) as Promise<Dashboard>,
    saveSettings: (settings) => originalInvoke(channels.settings, settings) as Promise<Dashboard>,
    liveSnapshot: async () => {
      const snapshot = await originalInvoke(channels.liveSnapshot)
      if (!polling) {
        void refreshLimits()
        polling = setInterval(() => {
          void refreshLimits()
        }, 60000)
        if (typeof window !== 'undefined')
          window.addEventListener(
            'unload',
            () => {
              clearInterval(polling)
              if (pending) {
                clearTimeout(pending.timer)
                pending.done()
                pending = undefined
              }
            },
            { once: true },
          )
      }
      return snapshot as ReturnType<typeof live.snapshot>
    },
    refreshLimits,
    subscribeLive: (callback) => {
      const listener = (_event: unknown, value: unknown) =>
        callback(value as ReturnType<typeof live.snapshot>)
      ipc.on(channels.liveChanged, listener)
      return () => {
        ipc.removeListener(channels.liveChanged, listener)
      }
    },
    subscribe: (callback) => {
      const listener = (_event: unknown, value: unknown) => callback(value as Dashboard | null)
      ipc.on(channels.changed, listener)
      return () => {
        ipc.removeListener(channels.changed, listener)
      }
    },
  }
  contextBridge.exposeInMainWorld('codexracker', api)
}
