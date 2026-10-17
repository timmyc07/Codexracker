import { randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { copyRuntime, workspaceRoot } from './copy-runtime.mjs'
import { snapshotSource, assessUpdate } from './inspect-update.mjs'
import { patchIdentity, patchRuntime, runtimeHashes, verifyRuntime } from './runtime-patch.mjs'
import { desktopSession } from './desktop-session.mjs'

export const managedRoot = path.join(workspaceRoot, '.local-runtime', 'desktop')
const pointerPath = (root) => path.join(root, 'active.json')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

async function readPointer(root) {
  try {
    const state = JSON.parse(await readFile(pointerPath(root), 'utf8'))
    if (state.schemaVersion !== 1 || !state.active) throw new Error('Invalid active pointer')
    for (const generation of [state.active, state.previous].filter(Boolean)) {
      if (
        !/^[\w-]+$/.test(generation.id) ||
        !generation.receipt?.hashes ||
        !generation.source?.hashes
      )
        throw new Error('Invalid generation metadata')
    }
    return state
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return null
}

async function savePointer(root, state) {
  const temporary = path.join(root, `pointer-${randomUUID()}.json`)
  await writeFile(temporary, JSON.stringify(state, null, 2), { flag: 'wx' })
  await rename(temporary, pointerPath(root))
}

export function readProcesses(root) {
  return JSON.parse(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fileURLToPath(new URL('./runtime-processes.ps1', import.meta.url)),
        '-ManagedRoot',
        root,
      ],
      { windowsHide: true, encoding: 'utf8' },
    ),
  )
}

async function locked(root, action) {
  await mkdir(root, { recursive: true })
  if ((await realpath(root)).toLowerCase() !== path.resolve(root).toLowerCase())
    throw new Error('Refusing redirected managed root')
  const lockPath = path.join(root, 'manager.lock')
  const lock = await open(lockPath, 'wx')
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))
    return await action()
  } finally {
    await lock.close()
    await unlink(lockPath)
  }
}

const appPath = (root, generation) => path.join(root, 'versions', generation.id, 'app')
async function assertGenerationPath(root, generation) {
  const app = appPath(root, generation)
  if ((await realpath(app)).toLowerCase() !== app.toLowerCase())
    throw new Error('Refusing redirected generation')
  return app
}
const production = {
  snapshot: snapshotSource,
  processes: readProcesses,
  copy: copyRuntime,
  patch: patchRuntime,
  verify: verifyRuntime,
  verifySource: async (app, source) => {
    if (!same(await runtimeHashes(app), source.hashes))
      throw new Error('Copied source fingerprint mismatch')
  },
  smoke: (app, root) =>
    desktopSession(
      app,
      path.join(root, 'smoke', randomUUID()),
      path.join(root, 'smoke-home'),
      async (page) => {
        const snapshot = await page.evaluate(() => window.codexracker.snapshot())
        if (!snapshot?.settings || snapshot.total.usageUpdateCount !== 0)
          throw new Error('Renderer injection validation failed')
      },
    ),
}

function running(processes) {
  // Missing process data is unsafe, including unavailable WMI information.
  return processes.originalRunning !== false || processes.copyRunning !== false
}

/** Injectable IO permits failure/ordering tests without starting an App or model request. */
export async function synchronize(root, extensions, overrides = {}) {
  const io = { ...production, ...overrides }
  return locked(root, async () => {
    const state = await readPointer(root)
    const first = await io.snapshot()
    const second = await io.snapshot()
    if (!same(first, second)) return { status: 'defer-unstable-source' }
    const patchId = patchIdentity(extensions)
    if (
      state?.active.receipt.patchId === patchId &&
      assessUpdate(state.active.source, first, second, {}).status === 'current'
    ) {
      await io.verify(await assertGenerationPath(root, state.active), state.active.receipt)
      return { status: 'current', generation: state.active.id }
    }
    let failure
    try {
      failure = JSON.parse(await readFile(path.join(root, 'failed-build.json'), 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (failure?.patchId === patchId && same(failure.source, second))
      return {
        status: failure.reason === 'rolled-back' ? 'defer-rolled-back-build' : 'defer-failed-build',
        generation: failure.generation,
      }
    if (running(await io.processes(root))) return { status: 'defer-running-app' }
    const generation = { id: randomUUID(), source: second }
    const directory = path.join(root, 'versions', generation.id)
    await mkdir(directory, { recursive: true })
    if ((await realpath(directory)).toLowerCase() !== directory.toLowerCase())
      throw new Error('Refusing redirected staging directory')
    try {
      const app = appPath(root, generation)
      await io.copy(path.join(second.installLocation, 'app'), app)
      if (!same(second, await io.snapshot())) return { status: 'defer-unstable-source' }
      await io.verifySource(app, second)
      if (running(await io.processes(root))) return { status: 'defer-running-app' }
      generation.receipt = await io.patch(app, extensions)
      await io.verify(app, generation.receipt)
      await io.smoke(app, root)
      // Recheck after the smoke child exits, immediately before activation.
      if (!same(second, await io.snapshot())) return { status: 'defer-unstable-source' }
      if (running(await io.processes(root))) return { status: 'defer-running-app' }
      await savePointer(root, {
        schemaVersion: 1,
        active: generation,
        previous: state?.active ?? null,
      })
      return { status: 'activated', generation: generation.id, previousRetained: !!state }
    } catch (error) {
      await writeFile(
        path.join(directory, 'failure.json'),
        JSON.stringify({
          failedAt: new Date().toISOString(),
          category: 'build-or-validation-failed',
          previousRetained: !!state,
        }),
      )
      await writeFile(
        path.join(root, 'failed-build.json'),
        JSON.stringify({
          source: second,
          patchId,
          generation: generation.id,
        }),
      )
      throw error
    }
  })
}

export async function rollback(root, overrides = {}) {
  const io = { ...production, ...overrides }
  return locked(root, async () => {
    const state = await readPointer(root)
    if (!state?.previous) throw new Error('No previous verified generation')
    if (running(await io.processes(root))) return { status: 'defer-running-app' }
    const app = await assertGenerationPath(root, state.previous)
    await io.verify(app, state.previous.receipt)
    await io.smoke(app, root)
    if (running(await io.processes(root))) return { status: 'defer-running-app' }
    // A watcher must not immediately rebuild the version the user just rolled back.
    await writeFile(
      path.join(root, 'failed-build.json'),
      JSON.stringify({
        source: state.active.source,
        patchId: state.active.receipt.patchId,
        generation: state.active.id,
        reason: 'rolled-back',
      }),
    )
    await savePointer(root, { ...state, active: state.previous, previous: state.active })
    return { status: 'rolled-back', generation: state.previous.id }
  })
}

export async function startDesktop(root) {
  return locked(root, async () => {
    const state = await readPointer(root)
    if (!state) throw new Error('No verified runtime. Run desktop:sync with both Apps closed')
    if (running(readProcesses(root))) return { status: 'defer-running-app' }
    const app = await assertGenerationPath(root, state.active)
    await verifyRuntime(app, state.active.receipt)
    const profile = path.join(root, 'profile')
    await mkdir(profile, { recursive: true })
    if ((await realpath(profile)).toLowerCase() !== profile.toLowerCase())
      throw new Error('Refusing redirected profile')
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(path.join(app, 'ChatGPT.exe'), [`--user-data-dir=${profile}`], {
      cwd: app,
      env,
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    })
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    child.unref()
    return { status: 'started', generation: state.active.id }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const action = process.argv[2]
    if (action === 'start') console.log(JSON.stringify(await startDesktop(managedRoot)))
    else if (action === 'rollback') console.log(JSON.stringify(await rollback(managedRoot)))
    else if (action === 'sync' || action === 'watch') {
      const extensions = {
        main: await readFile(path.join(workspaceRoot, 'dist/desktop-main.cjs'), 'utf8'),
        preload: await readFile(path.join(workspaceRoot, 'dist/desktop-preload.cjs'), 'utf8'),
      }
      do {
        try {
          console.log(JSON.stringify(await synchronize(managedRoot, extensions)))
        } catch (error) {
          if (action !== 'watch') throw error
          console.error(JSON.stringify({ status: 'deferred', reason: error.message }))
        }
        if (action === 'watch') await delay(60000)
      } while (action === 'watch')
    } else throw new Error('Expected sync, watch, start or rollback')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
