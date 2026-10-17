import { spawn, execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdir, realpath } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { PipeConnection } from './pipe.mjs'

export async function openSignedSession(application, profile, pageCode, controller) {
  await mkdir(profile, { recursive: true })
  if ((await realpath(profile)).toLowerCase() !== path.resolve(profile).toLowerCase())
    throw new Error('redirected-tracker-profile')
  const env = { ...process.env }
  for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) delete env[name]
  const child = spawn(
    path.join(application, 'ChatGPT.exe'),
    [`--user-data-dir=${profile}`, '--remote-debugging-pipe', '--no-first-run'],
    {
      cwd: application,
      env,
      windowsHide: false,
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    },
  )
  const pipe = new PipeConnection(child.stdio[4], child.stdio[3])
  const binding = `__tokentracker_${randomBytes(16).toString('hex')}`
  const source = pageCode + `\n;TokenTrackerPage.installPage(${JSON.stringify(binding)});`
  const pages = new Map()
  const attached = new Set()
  let readyResolve, readyReject
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const timer = setTimeout(() => readyReject(new Error('tracker-renderer-timeout')), 30000)
  const closed = new Promise((resolve) => child.once('close', resolve))
  child.once('error', () => {
    readyReject(new Error('official-app-start-failed'))
    pipe.close()
  })
  child.once('close', () => {
    readyReject(new Error('official-app-closed'))
    pipe.close()
  })
  child.once('exit', () => pipe.close())
  const evaluate = async (page, expression) => {
    if (!page.context) return
    const result = await pipe.call(
      'Runtime.evaluate',
      { expression, contextId: page.context, awaitPromise: true, returnByValue: true },
      page.session,
    )
    if (result.exceptionDetails) throw new Error('tracker-page-evaluation-failed')
    return result.result?.value
  }
  const deliver = (page, packet) =>
    evaluate(
      page,
      `globalThis[${JSON.stringify(binding + 'Receive')}]?.(${JSON.stringify(packet)})`,
    )
  const broadcast = (channel, value) => {
    for (const page of pages.values())
      if (page.context) void deliver(page, { channel, value }).catch(() => {})
  }
  const handle = controller(broadcast)
  pipe.on('event', (message) => {
    const { method, params, sessionId } = message
    const page = pages.get(sessionId)
    if (method === 'Target.detachedFromTarget') {
      pages.delete(params.sessionId)
      return
    }
    if (method === 'Target.targetCreated' || method === 'Target.targetInfoChanged') {
      const target = params.targetInfo
      if (target.type === 'page' && target.url.startsWith('app:'))
        void attach(target).catch(() => {})
    }
    if (!page) return
    if (method === 'Runtime.executionContextDestroyed') {
      page.contexts.delete(params.executionContextId)
      if (page.context === params.executionContextId) page.context = null
    }
    if (method === 'Runtime.executionContextCreated') {
      const context = params.context
      if (context.auxData?.isDefault && context.origin.startsWith('app:')) {
        page.contexts.set(context.id, context.auxData.frameId)
        if (context.auxData.frameId === page.frame) page.context = context.id
      }
    }
    if (method === 'Runtime.executionContextsCleared') {
      page.context = null
      page.contexts.clear()
    }
    if (
      method !== 'Runtime.bindingCalled' ||
      params.name !== binding ||
      params.executionContextId !== page.context ||
      params.payload.length > 100000
    )
      return
    let packet
    try {
      packet = JSON.parse(params.payload)
    } catch {
      return
    }
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return
    if (packet.channel === 'tokentracker:ready') {
      clearTimeout(timer)
      readyResolve({ page, evaluate: (expression) => evaluate(page, expression) })
      return
    }
    if (typeof packet.channel !== 'string') return
    if (packet.id !== undefined && (!Number.isSafeInteger(packet.id) || packet.id < 1)) return
    void Promise.resolve(handle(packet.channel, packet.value))
      .then(
        (value) => (packet.id === undefined ? undefined : deliver(page, { id: packet.id, value })),
        () => (packet.id === undefined ? undefined : deliver(page, { id: packet.id, error: true })),
      )
      .catch(() => {})
  })
  async function attach(target) {
    if (attached.has(target.targetId)) return
    attached.add(target.targetId)
    const { sessionId } = await pipe.call('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    })
    const page = { session: sessionId, frame: null, context: null, contexts: new Map() }
    pages.set(sessionId, page)
    const tree = await pipe.call('Page.getFrameTree', {}, sessionId)
    page.frame = tree.frameTree.frame.id
    await pipe.call('Runtime.enable', {}, sessionId)
    for (const [id, frame] of page.contexts) if (frame === page.frame) page.context = id
    // Bind new documents to their own main-world context; other frames are rejected above.
    await pipe.call('Runtime.addBinding', { name: binding }, sessionId)
    await pipe.call('Page.addScriptToEvaluateOnNewDocument', { source }, sessionId)
    await pipe.call('Runtime.evaluate', { expression: source, awaitPromise: true }, sessionId)
  }
  const close = async () => {
    clearTimeout(timer)
    await pipe.call('Browser.close').catch(() => {})
    const exited = await Promise.race([closed.then(() => true), delay(3000).then(() => false)])
    if (!exited && child.pid) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
      } catch {
        if (!(await Promise.race([closed.then(() => true), delay(1000).then(() => false)])))
          throw new Error('tracker-app-stop-failed')
      }
    }
    await closed
    pipe.close()
  }
  try {
    await pipe.call('Target.setDiscoverTargets', { discover: true })
    const { targetInfos } = await pipe.call('Target.getTargets')
    for (const target of targetInfos)
      if (target.type === 'page' && target.url.startsWith('app:'))
        void attach(target).catch(readyReject)
    const first = await ready
    return { child, pipe, closed, close, evaluate: first.evaluate, pages }
  } catch (error) {
    await close()
    throw error
  }
}
