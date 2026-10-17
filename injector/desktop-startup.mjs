import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

/** Validate the actual renderer through its local proof file, without a debug server. */
export async function verifyDesktopStartup(app, root) {
  const profile = path.join(root, 'smoke', randomUUID())
  await mkdir(profile, { recursive: true })
  const env = {
    ...process.env,
    CODEX_HOME: path.join(root, 'smoke-home'),
    TOKENTRACKER_STARTUP_PROFILE: profile,
  }
  delete env.OPENAI_API_KEY
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(
    path.join(app, 'ChatGPT.exe'),
    [`--user-data-dir=${profile}`, '--no-first-run'],
    {
      cwd: app,
      env,
      windowsHide: true,
      stdio: 'ignore',
    },
  )
  let timedOut = false
  let timer
  try {
    const code = await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        try {
          if (child.pid)
            execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            })
        } catch {
          try {
            child.kill()
          } catch {
            /* Still reject the timed-out validation if termination is refused. */
          }
        } finally {
          reject(new Error('desktop-startup-timeout'))
        }
      }, 30000)
      child.once('error', reject)
      child.once('close', resolve)
    })
    if (timedOut) throw new Error('desktop-startup-timeout')
    if (code !== 0) throw new Error('desktop-startup-failed')
    const proof = JSON.parse(await readFile(path.join(profile, 'startup-proof.json'), 'utf8'))
    if (proof.result !== 'passed') throw new Error('desktop-renderer-validation-failed')
    return { result: 'passed', debugServer: false }
  } finally {
    clearTimeout(timer)
  }
}
