import { spawn } from 'node:child_process'
import { mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { registeredApplication, hashFile } from './application.mjs'

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return null
  }
}
export async function trackerRunning(root) {
  const lease = await readJson(path.join(root, 'tracker.lock'))
  if (!lease) return false
  if (!Number.isSafeInteger(lease.pid) || lease.pid < 1) throw new Error('invalid-tracker-lock')
  try {
    process.kill(lease.pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}
export async function acquireLease(root) {
  await mkdir(root, { recursive: true })
  if ((await realpath(root)).toLowerCase() !== path.resolve(root).toLowerCase())
    throw new Error('redirected-tracker-root')
  const file = path.join(root, 'tracker.lock')
  let lock
  try {
    lock = await open(file, 'wx')
  } catch (error) {
    if (error.code !== 'EEXIST' || (await trackerRunning(root))) throw error
    await unlink(file)
    lock = await open(file, 'wx')
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
  return async () => {
    await lock.close()
    await unlink(file)
  }
}
async function version(program) {
  return {
    program: path.resolve(program),
    main: await hashFile(path.join(program, 'dist/companion.cjs')),
    page: await hashFile(path.join(program, 'dist/page.js')),
  }
}
const sameCode = (first, second) => first?.main === second?.main && first?.page === second?.page
async function verifiedVersion(root, selected) {
  if (!selected || typeof selected.program !== 'string')
    throw new Error('No previous verified tracker version')
  const prefix = path.resolve(root, '..', 'program') + path.sep
  const resolved = await realpath(selected.program)
  if (
    !resolved.toLowerCase().startsWith(prefix.toLowerCase()) ||
    resolved.toLowerCase() !== path.resolve(selected.program).toLowerCase()
  )
    throw new Error('invalid-tracker-version-path')
  const actual = await version(resolved)
  if (actual.main !== selected.main || actual.page !== selected.page)
    throw new Error('tracker-version-fingerprint-mismatch')
  return actual
}
async function saveVersions(root, state) {
  const staged = path.join(root, `tracker-versions-${randomUUID()}.json`)
  await writeFile(staged, JSON.stringify(state), { flag: 'wx' })
  await rename(staged, path.join(root, 'tracker-versions.json'))
}
async function launch(root, selected) {
  if (await trackerRunning(root)) return { status: 'already-running' }
  const readyFile = path.join(root, `launch-${randomUUID()}.json`)
  const env = { ...process.env }
  for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) delete env[name]
  const child = spawn(
    process.execPath,
    [path.join(selected.program, 'dist/companion.cjs'), root, readyFile],
    { cwd: selected.program, env, detached: true, windowsHide: true, stdio: 'ignore' },
  )
  let ended = false
  child.once('error', () => {
    ended = true
  })
  child.once('exit', () => {
    ended = true
  })
  const deadline = Date.now() + 35000
  while (Date.now() < deadline) {
    const ready = await readJson(readyFile)
    if (ready) {
      await unlink(readyFile)
      if (ready.status !== 'started') throw new Error('tracker-startup-failed')
      child.unref()
      return { status: 'started', version: ready.version }
    }
    if (ended) throw new Error('tracker-startup-failed')
    await delay(100)
  }
  child.unref()
  throw new Error('tracker-startup-timeout')
}
export async function startTracker(root, program) {
  await mkdir(root, { recursive: true })
  const current = await version(program)
  const state = await readJson(path.join(root, 'tracker-versions.json'))
  const selected = sameCode(state?.held, current)
    ? await verifiedVersion(root, state.active)
    : current
  const result = await launch(root, selected)
  if (result.status === 'started' && !sameCode(selected, state?.active))
    await saveVersions(root, { active: selected, previous: state?.active ?? null, held: null })
  return result
}
export async function inspectTracker(root, program) {
  await version(program)
  const application = registeredApplication()
  return {
    status: 'current',
    version: application.version,
    modifiedOfficialFiles: false,
    tcpDebugServer: false,
    running: await trackerRunning(root),
  }
}
export async function rollbackTracker(root, program) {
  const state = await readJson(path.join(root, 'tracker-versions.json'))
  const selected = await verifiedVersion(root, state?.previous)
  const result = await launch(root, selected)
  if (result.status === 'started') {
    await saveVersions(root, {
      active: selected,
      previous: state.active,
      held: await version(program),
    })
    return { ...result, status: 'rolled-back' }
  }
  return result
}
