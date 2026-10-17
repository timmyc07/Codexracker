import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

/** Dedicated profile, loopback CDP and categorical failures; no application logs. */
export async function desktopSession(app, profile, codexHome, check) {
  await mkdir(profile, { recursive: true })
  await unlink(path.join(profile, 'DevToolsActivePort')).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
  const env = {
    ...process.env,
    CODEX_HOME: codexHome,
    CODEXRACKER_PROBE_PROFILE: profile,
    CODEXRACKER_PROBE_OUTPUT: path.join(profile, 'probe-proof.json'),
  }
  delete env.OPENAI_API_KEY
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(
    path.join(app, 'ChatGPT.exe'),
    [
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
    ],
    { cwd: app, env, windowsHide: true, stdio: 'ignore' },
  )
  let spawnFailed = false
  let hasExited = false
  child.once('exit', () => {
    hasExited = true
  })
  child.on('error', () => {
    spawnFailed = true
  })
  const exited = new Promise((resolve) => child.once('close', resolve))
  let browser
  const stop = async () => {
    if (browser) await browser.close().catch(() => {})
    if (!hasExited && child.pid) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
      } catch {
        await Promise.race([exited, delay(1000)])
        if (!hasExited) throw new Error('desktop-stop-failed')
      }
    }
    await exited
  }
  try {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      if (spawnFailed || child.exitCode !== null) throw new Error('desktop-start-failed')
      try {
        const [port, target] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'))
          .trim()
          .split(/\r?\n/)
        if (
          !/^\d+$/.test(port) ||
          +port < 1 ||
          +port > 65535 ||
          !/^\/devtools\/browser\/[\w-]+$/.test(target)
        )
          throw new Error('invalid-local-endpoint')
        browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${target}`, {
          timeout: 1000,
        })
        break
      } catch {
        await delay(100)
      }
    }
    if (!browser) throw new Error('desktop-CDP-unavailable')
    let page
    while (Date.now() < deadline) {
      page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((page) => page.url().startsWith('app:'))
      if (page) break
      await delay(100)
    }
    if (!page) throw new Error('desktop-renderer-unavailable')
    await page.locator('codex-token-cache-hud').waitFor({ timeout: 20000 })
    await page.waitForFunction(() => !!window.codexracker, null, { timeout: 10000 })
    return await check(page)
  } finally {
    await stop()
  }
}
