import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { copyWhenUnlocked, experimentRoot, hashFile } from './copy-runtime.mjs'

export async function runProbe(staleIntegrity = false) {
  const state = JSON.parse(await readFile(path.join(experimentRoot, 'probe-state.json'), 'utf8'))
  if (state.status !== 'patched') throw new Error('Prepare a probe first')
  const app = path.join(experimentRoot, 'app')
  const executable = path.join(app, 'ChatGPT.exe')
  if (
    (await hashFile(executable)) !== state.patchedHashes['ChatGPT.exe'] ||
    (await hashFile(path.join(app, 'resources', 'app.asar'))) !== state.patchedHashes['app.asar']
  ) {
    throw new Error('Unexpected experimental runtime modification')
  }
  const run = path.join(
    experimentRoot,
    `run-${state.nonce}-${staleIntegrity ? 'mismatch' : 'matched'}`,
  )
  await mkdir(run)
  const output = path.join(run, 'proof.json')
  const profile = path.join(run, 'profile')
  await mkdir(profile)
  const env = {
    ...process.env,
    CODEX_HOME: path.join(run, 'codex-home'),
    CODEXRACKER_PROBE_OUTPUT: output,
    CODEXRACKER_PROBE_PROFILE: profile,
  }
  delete env.OPENAI_API_KEY
  delete env.ELECTRON_RUN_AS_NODE
  let result
  let child
  const logs = []
  try {
    if (staleIntegrity)
      await copyWhenUnlocked(path.join(experimentRoot, 'backup', 'ChatGPT.exe'), executable)
    const startedAt = Date.now()
    child = spawn(
      executable,
      [
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--enable-logging=stderr',
      ],
      {
        cwd: app,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    child.stdout.on('data', (data) => logs.push(data.toString()))
    child.stderr.on('data', (data) => logs.push(data.toString()))
    const exit = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Terminate only the process tree created by this exact spawn, never by name.
        if (child.exitCode === null && child.pid) {
          try {
            execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            })
          } catch {
            /* The process may have just exited. */
          }
        }
      }, 20000)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (code, signal) => {
        clearTimeout(timer)
        resolve({ code, signal })
      })
    })
    let proof = null
    try {
      proof = JSON.parse(await readFile(output, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const log = logs.join('')
    await writeFile(path.join(run, 'runtime.log'), log)
    result = {
      mode: state.mode,
      staleIntegrity,
      elapsedMs: Date.now() - startedAt,
      exit,
      nonce: state.nonce,
      proof,
      asarIntegrityFailureObserved:
        /integrity.*(?:fail|mismatch)|(?:fail|mismatch).*integrity/i.test(log),
      packageIdentityFailureObserved:
        /no package identity|has no identity|APPMODEL_ERROR_NO_PACKAGE|15700/i.test(log),
      userDataProfile: profile,
      realModelRequestSent: false,
    }
    await writeFile(path.join(run, 'result.json'), JSON.stringify(result, null, 2))
  } finally {
    if (staleIntegrity)
      await copyWhenUnlocked(path.join(experimentRoot, `probe-${state.nonce}.exe`), executable)
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== 'mismatch'))
      throw new Error('Usage: node injector/run-probe.mjs [mismatch]')
    console.log(JSON.stringify(await runProbe(process.argv[2] === 'mismatch'), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
