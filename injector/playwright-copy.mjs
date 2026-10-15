import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { experimentRoot, hashFile } from './copy-runtime.mjs'

export async function verifyPlaywrightCopy() {
  const state = JSON.parse(await readFile(path.join(experimentRoot, 'probe-state.json'), 'utf8'))
  if (state.status !== 'patched' || state.mode !== 'playwright')
    throw new Error('Prepare the playwright probe first')
  const app = path.join(experimentRoot, 'app')
  for (const [name, target] of [
    ['ChatGPT.exe', path.join(app, 'ChatGPT.exe')],
    ['app.asar', path.join(app, 'resources', 'app.asar')],
  ]) {
    if ((await hashFile(target)) !== state.patchedHashes[name])
      throw new Error(`Unexpected copy modification: ${name}`)
  }
  const run = path.join(experimentRoot, `playwright-${randomUUID()}`)
  await mkdir(run)
  const profile = path.join(run, 'profile')
  await mkdir(profile)
  const proofPath = path.join(run, 'proof.json')
  const env = {
    ...process.env,
    CODEX_HOME: path.join(run, 'codex-home'),
    CODEXRACKER_PROBE_PROFILE: profile,
    CODEXRACKER_PROBE_OUTPUT: proofPath,
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
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--enable-logging=stderr',
    ],
    { cwd: app, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const logs = []
  child.stdout.on('data', (data) => logs.push(data.toString()))
  child.stderr.on('data', (data) => logs.push(data.toString()))
  let spawnError
  child.on('error', (error) => {
    spawnError = error
  })
  const exited = new Promise((resolve) =>
    child.once('close', (code, signal) => resolve({ code, signal })),
  )
  let browser
  let result
  try {
    const deadline = Date.now() + 15000
    let endpoint
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError
      if (child.exitCode !== null)
        throw new Error(`Copied App exited before CDP became available: ${child.exitCode}`)
      try {
        const [port, target] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'))
          .trim()
          .split(/\r?\n/)
        if (
          !/^\d+$/.test(port) ||
          +port < 1 ||
          +port > 65535 ||
          !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(target)
        )
          throw new Error('Invalid local DevTools endpoint')
        endpoint = `ws://127.0.0.1:${port}${target}`
        break
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      await delay(100)
    }
    if (!endpoint) throw new Error('Owl did not expose a CDP endpoint within 15 seconds')
    browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 })
    let page
    while (Date.now() < deadline) {
      page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith('app:'))
      if (page) break
      await delay(100)
    }
    if (!page) throw new Error('No actual App renderer target found')
    await page.waitForFunction(
      (nonce) =>
        window.codexrackerProbe?.nonce === nonce &&
        document.documentElement?.dataset.codexrackerProbe === nonce,
      state.nonce,
      { timeout: 5000 },
    )
    const marker = await page.evaluate(() => ({
      nonce: window.codexrackerProbe.nonce,
      dom: document.documentElement.dataset.codexrackerProbe,
    }))
    await page.evaluate(() => {
      const button = document.createElement('button')
      button.id = 'codexracker-playwright-check'
      button.textContent = 'Codexracker test'
      button.style.cssText = 'position:fixed;top:5px;left:5px;z-index:2147483647'
      button.addEventListener('click', () => {
        button.dataset.clicked = 'true'
      })
      document.body.appendChild(button)
    })
    const button = page.locator('#codexracker-playwright-check')
    await button.click({ timeout: 5000 })
    const clickVerified = (await button.getAttribute('data-clicked')) === 'true'
    await button.evaluate((element) => element.remove())
    let proof
    const proofDeadline = Date.now() + 5000
    while (Date.now() < proofDeadline) {
      try {
        proof = JSON.parse(await readFile(proofPath, 'utf8'))
        break
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      }
      await delay(50)
    }
    if (!proof) throw new Error('Main-process probe proof did not become available')
    result = {
      result:
        marker.nonce === state.nonce &&
        marker.dom === state.nonce &&
        clickVerified &&
        proof.result === 'passed' &&
        proof.isolatedProfile
          ? 'passed'
          : 'failed',
      method: 'spawn-managed-copy-and-playwright-connectOverCDP',
      pageProtocol: new URL(page.url()).protocol,
      preloadMarkerVerified: marker.nonce === state.nonce,
      domMarkerVerified: marker.dom === state.nonce,
      playwrightClickVerified: clickVerified,
      probeProof: proof,
      realModelRequestsSent: false,
    }
    await page.evaluate(() => window.codexrackerProbe.finish())
    await Promise.race([exited, delay(3000)])
  } catch (error) {
    result = {
      result: 'failed',
      method: 'spawn-managed-copy-and-playwright-connectOverCDP',
      reason: error.message,
      realModelRequestsSent: false,
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (child.exitCode === null && child.pid)
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
    await exited
    await writeFile(path.join(run, 'runtime.log'), logs.join(''))
    await writeFile(path.join(run, 'result.json'), JSON.stringify(result, null, 2))
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await verifyPlaywrightCopy()
    console.log(JSON.stringify(result, null, 2))
    if (result.result !== 'passed') process.exitCode = 1
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
