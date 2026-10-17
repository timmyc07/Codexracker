import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { openSignedSession } from '../../companion/session.mjs'
import { registeredApplication, hashFile } from '../../companion/application.mjs'
import { buildCompanion } from '../../companion/build.mjs'

await buildCompanion()
const { createController } = createRequire(import.meta.url)('../../dist/companion.cjs')
const root = path.resolve('.local-runtime', `signed-overlay-${randomUUID()}`)
await mkdir(root, { recursive: true })
process.env.CODEX_HOME = path.join(root, 'home')
delete process.env.OPENAI_API_KEY
const application = registeredApplication()
const officialFiles = ['ChatGPT.exe', 'chrome.dll', 'resources/app.asar']
const fingerprint = async () =>
  Object.fromEntries(
    await Promise.all(
      officialFiles.map(async (file) => [
        file,
        await hashFile(path.join(application.directory, file)),
      ]),
    ),
  )
const before = await fingerprint()
const code = await readFile('dist/page.js', 'utf8')
const repositoryFile = path.join(root, 'profile/codexracker/metrics.json')
const resetsAt = Math.floor(Date.now() / 1000) + 7 * 86400
const report = {
  testedAt: new Date().toISOString(),
  result: 'failed',
  checks: [],
  realModelRequestsSent: false,
  officialFilesModified: false,
  firewallSettingsChangedByTracker: false,
  applicationVersion: application.version,
}
let session
let settingsWrites = 0
const launch = () =>
  openSignedSession(application.directory, path.join(root, 'profile'), code, (broadcast) => {
    const controller = createController(repositoryFile, broadcast)
    return async (channel, value) => {
      if (channel === 'codexracker:snapshot') await delay(250)
      if (channel === 'codexracker:settings') {
        settingsWrites++
        await delay(120)
      }
      return controller(channel, value)
    }
  })
const evaluate = (expression) => session.evaluate(expression)
async function eventual(expression) {
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return
    await delay(100)
  }
  throw new Error('desktop-assertion-timeout')
}
const quota = (remaining) =>
  evaluate(
    `window.dispatchEvent(new MessageEvent('message',{data:{type:'mcp-notification',hostId:'local',method:'account/rateLimits/updated',params:{rateLimits:{limitId:'codex',primary:{usedPercent:10,windowDurationMins:300},secondary:{usedPercent:${100 - remaining},windowDurationMins:10080,resetsAt:${resetsAt}}}}}}))`,
  )
const text = (testid) =>
  `document.querySelector('codex-token-cache-hud').shadowRoot.querySelector('[data-testid="${testid}"]')?.textContent.trim()`
const click = (label) =>
  evaluate(
    `document.querySelector('codex-token-cache-hud').shadowRoot.querySelector('button[aria-label="${label}"]').click()`,
  )
const hud = `document.querySelector('codex-token-cache-hud').shadowRoot`
const rectangle = (selector = '.hud') =>
  evaluate(
    `(()=>{const r=${hud}.querySelector('${selector}').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`,
  )
const samePoint = (actual, expected) => {
  assert.ok(
    Math.abs(actual.x - expected.x) < 0.5 && Math.abs(actual.y - expected.y) < 0.5,
    `Unexpected floating position: ${JSON.stringify({ actual, expected })}`,
  )
}
const mouse = (type, point) =>
  session.pipe.call(
    'Input.dispatchMouseEvent',
    {
      type,
      ...point,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      ...(type === 'mouseMoved' ? {} : { clickCount: 1 }),
    },
    [...session.pages.keys()][0],
  )
try {
  session = await launch()
  await eventual(
    `Boolean(window.codexracker && document.querySelector('codex-token-cache-hud')?.shadowRoot?.querySelector('.hud'))`,
  )
  await quota(97)
  await eventual(`${text('daily-target')} === '13.86%／天'`)
  await evaluate(`(()=>{
    const receive=data=>window.dispatchEvent(new MessageEvent('message',{data}));
    const note=(method,params)=>receive({type:'mcp-notification',hostId:'local',method,params});
    const reply=(id,result)=>receive({type:'mcp-response',hostId:'local',message:{id,result}});
    reply('resume',{thread:{id:'fixture-thread'},model:'other-model',modelProvider:'openai'});
    const channel=new MessageChannel();
    channel.port1.postMessage({type:'mcp-request',hostId:'local',request:{id:'start',method:'turn/start',params:{threadId:'fixture-thread',model:'gpt-6.1-sol'}}});
    channel.port1.close();channel.port2.close();reply('start',{turn:{id:'fixture-turn'}});
    note('turn/started',{threadId:'fixture-thread',turn:{id:'fixture-turn',status:'inProgress'}});
    const usage=(i,o,c)=>note('thread/tokenUsage/updated',{threadId:'fixture-thread',turnId:'fixture-turn',tokenUsage:{total:{inputTokens:i,outputTokens:o,cachedInputTokens:c,totalTokens:i+o},last:{inputTokens:100,outputTokens:20,cachedInputTokens:80}},prompt:'PRIVATE_SENTINEL'});
    usage(100,20,80);
    note('item/agentMessage/delta',{threadId:'fixture-thread',turnId:'fixture-turn',delta:'alpha😀'});
    usage(200,40,160);
    note('turn/completed',{threadId:'fixture-thread',turn:{id:'fixture-turn',status:'completed'}});
  })()`)
  await eventual(`${text('total-tokens')} === '120' && ${text('today-tokens')} === '120'`)
  let values = await evaluate(
    `(async()=>({snapshot:await window.codexracker.snapshot(),live:await window.codexracker.liveSnapshot()}))()`,
  )
  assert.equal(values.live.run.model, 'gpt-6.1-sol')
  assert.equal(values.live.run.outputCharacters, 6)
  assert.equal(values.live.run.status, 'completed')
  await quota(95)
  await eventual(`${text('daily-used')} === '2%' && ${text('daily-target')} === '13.86%／天'`)
  report.checks.push(
    'official-signed-renderer-model-stream-total-and-today-tokens-fixed-daily-mission',
  )

  await click('管理設定')
  await evaluate(
    `(()=>{const root=document.querySelector('codex-token-cache-hud').shadowRoot;const input=root.querySelector('input');input.value='0.97';input.dispatchEvent(new Event('input',{bubbles:true}));root.querySelector('form').requestSubmit()})()`,
  )
  await eventual(`(async()=> (await window.codexracker.snapshot()).settings.opacity===.97)()`)
  await click('本機紀錄')
  assert.equal(
    await evaluate(
      `document.querySelector('codex-token-cache-hud').shadowRoot.querySelectorAll('article').length`,
    ),
    1,
  )
  await click('本機紀錄')
  const header = await evaluate(
    `(()=>{const r=document.querySelector('codex-token-cache-hud').shadowRoot.querySelector('header').getBoundingClientRect();return {x:r.x+120,y:r.y+20}})()`,
  )
  const pageSession = [...session.pages.keys()][0]
  await session.pipe.call(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', ...header, button: 'left', buttons: 1, clickCount: 1 },
    pageSession,
  )
  await session.pipe.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: header.x + 50, y: header.y + 30, button: 'left', buttons: 1 },
    pageSession,
  )
  await session.pipe.call(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseReleased',
      x: header.x + 50,
      y: header.y + 30,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    },
    pageSession,
  )
  await eventual(`(async()=> (await window.codexracker.snapshot()).settings.position.x>16)()`)
  const bounds = await evaluate(
    `(()=>{const e=document.querySelector('codex-token-cache-hud').shadowRoot.querySelector('.hud');const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`,
  )
  const shot = await session.pipe.call(
    'Page.captureScreenshot',
    { format: 'png', clip: { ...bounds, scale: 1 } },
    pageSession,
  )
  await writeFile('signed-overlay-hud.png', Buffer.from(shot.data, 'base64'))
  await click('最小化')
  await eventual(`${text('bubble-remaining')} === '95%'`)
  await eventual(`(async()=> (await window.codexracker.snapshot()).settings.minimized)()`)
  samePoint(await rectangle(), bounds)
  const stableWrites = settingsWrites
  const stablePositions = await evaluate(
    `(async()=>{const positions=[];for(let i=0;i<45;i++){await new Promise(requestAnimationFrame);const r=${hud}.querySelector('.hud').getBoundingClientRect();positions.push({x:r.x,y:r.y})}return positions})()`,
  )
  for (const point of stablePositions) samePoint(point, bounds)
  await quota(95)
  await evaluate(`window.dispatchEvent(new Event('resize'))`)
  await delay(250)
  samePoint(await rectangle(), bounds)
  assert.equal(settingsWrites, stableWrites, 'Usage/resize must not write floating position')

  const ball = await rectangle('.restore')
  const viewport = await evaluate('({width:innerWidth,height:innerHeight})')
  const destination = {
    x: Math.min(ball.x + 170, viewport.width - 100),
    y: Math.min(ball.y + 90, viewport.height - 100),
  }
  const grip = { x: ball.x + 44, y: ball.y + 44 }
  await mouse('mousePressed', grip)
  for (let i = 1; i <= 12; i++) {
    await mouse('mouseMoved', {
      x: grip.x + ((destination.x - ball.x) * i) / 12,
      y: grip.y + ((destination.y - ball.y) * i) / 12,
    })
    if (i === 6) await quota(95)
    await evaluate('new Promise(requestAnimationFrame)')
  }
  await evaluate('new Promise(requestAnimationFrame)')
  assert.equal(settingsWrites, stableWrites, 'Dragging must stay local until release')
  samePoint(await rectangle(), destination)
  await mouse('mouseReleased', { x: destination.x + 44, y: destination.y + 44 })
  await eventual(
    `(async()=>{const s=await window.codexracker.snapshot();return s.settings.minimized&&Math.abs(s.settings.position.x-${destination.x})<.5&&Math.abs(s.settings.position.y-${destination.y})<.5})()`,
  )
  assert.equal(settingsWrites, stableWrites + 1, 'A completed drag must persist once')
  samePoint(await rectangle(), destination)
  assert.equal(await evaluate(`${hud}.querySelector('.hud').classList.contains('minimized')`), true)

  await evaluate(
    `${hud}.querySelector('.restore').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`,
  )
  const keyboardPosition = { ...destination, y: destination.y + 10 }
  await eventual(
    `(async()=> (await window.codexracker.snapshot()).settings.position.y===${keyboardPosition.y})()`,
  )
  await delay(450)
  samePoint(await rectangle(), keyboardPosition)

  await session.pipe.call(
    'Emulation.setTouchEmulationEnabled',
    { enabled: true, maxTouchPoints: 2 },
    pageSession,
  )
  const touchGrip = { x: keyboardPosition.x + 44, y: keyboardPosition.y + 44, id: 1 }
  await session.pipe.call(
    'Input.dispatchTouchEvent',
    { type: 'touchStart', touchPoints: [touchGrip] },
    pageSession,
  )
  await session.pipe.call(
    'Input.dispatchTouchEvent',
    {
      type: 'touchMove',
      touchPoints: [{ ...touchGrip, x: touchGrip.x + 40, y: touchGrip.y - 20 }],
    },
    pageSession,
  )
  await evaluate('new Promise(requestAnimationFrame)')
  await session.pipe.call(
    'Input.dispatchTouchEvent',
    { type: 'touchEnd', touchPoints: [] },
    pageSession,
  )
  const touchPosition = { x: keyboardPosition.x + 40, y: keyboardPosition.y - 20 }
  await eventual(
    `(async()=>{const s=await window.codexracker.snapshot();return s.settings.minimized&&Math.abs(s.settings.position.x-${touchPosition.x})<.5&&Math.abs(s.settings.position.y-${touchPosition.y})<.5})()`,
  )
  samePoint(await rectangle(), touchPosition)
  await session.pipe.call('Emulation.setTouchEmulationEnabled', { enabled: false }, pageSession)

  for (let i = 0; i < 3; i++) {
    await click('展開用量追蹤')
    await eventual(`Boolean(${hud}.querySelector('header'))`)
    await click('最小化')
    await eventual(`Boolean(${hud}.querySelector('.restore'))`)
  }
  await eventual(`(async()=> (await window.codexracker.snapshot()).settings.minimized)()`)
  await delay(650)
  samePoint(await rectangle(), touchPosition)
  report.motion = {
    stableFrames: stablePositions.length,
    mouseDragWrites: 1,
    mouse: true,
    touch: true,
    keyboard: true,
    rapidToggleCycles: 3,
  }
  report.checks.push(
    'stable-collapse-mouse-and-touch-drag-keyboard-click-suppression-and-rapid-toggles',
  )
  const bubble = await session.pipe.call(
    'Page.captureScreenshot',
    {
      format: 'png',
      clip: {
        ...(await evaluate(
          `(()=>{const r=document.querySelector('codex-token-cache-hud').shadowRoot.querySelector('.hud').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`,
        )),
        scale: 1,
      },
    },
    pageSession,
  )
  await writeFile('signed-overlay-bubble.png', Buffer.from(bubble.data, 'base64'))
  assert.match(
    await evaluate(
      `getComputedStyle(document.querySelector('codex-token-cache-hud').shadowRoot.querySelector('.jelly')).animationName`,
    ),
    /jelly-breathe/,
  )
  await session.pipe.call(
    'Emulation.setEmulatedMedia',
    { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] },
    pageSession,
  )
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('codex-token-cache-hud').shadowRoot.querySelector('.jelly')).animationName`,
    ),
    'none',
  )
  report.checks.push('settings-history-drag-jelly-bubble-and-reduced-motion')

  const protection = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$ErrorActionPreference='Stop';Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop;$ids=@([int]$env:TT_VERIFY_PID);$p=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId);for($n=0;$n -lt 6;$n++){$ids=@($ids+@($p | Where-Object {$ids -contains $_.ParentProcessId} | ForEach-Object {$_.ProcessId}) | Select-Object -Unique)};$tcp=@(Get-NetTCPConnection -State Listen | Where-Object {$ids -contains $_.OwningProcess} | Select-Object LocalAddress,LocalPort);[pscustomobject]@{signature=(Get-AuthenticodeSignature -FilePath $env:TT_VERIFY_EXE).Status.ToString();tcp=$tcp}|ConvertTo-Json -Compress -Depth 4`,
    ],
    {
      windowsHide: true,
      encoding: 'utf8',
      env: {
        ...process.env,
        TT_VERIFY_PID: String(session.child.pid),
        TT_VERIFY_EXE: path.join(application.directory, 'ChatGPT.exe'),
      },
    },
  )
  const observed = JSON.parse(protection)
  assert.equal(observed.signature, 'Valid')
  assert.ok(observed.tcp.every((item) => ['127.0.0.1', '::1'].includes(item.LocalAddress)))
  report.signature = observed.signature
  report.observedTcpListeners = observed.tcp
  report.checks.push('valid-official-signature-and-no-lan-tcp-listeners')
  await session.close()
  session = null

  session = await launch()
  await eventual(
    `Boolean(document.querySelector('codex-token-cache-hud').shadowRoot.querySelector('.restore'))`,
  )
  await click('展開用量追蹤')
  await eventual(`${text('total-tokens')} === '120' && ${text('today-tokens')} === '120'`)
  values = await evaluate(`window.codexracker.snapshot()`)
  assert.equal(values.settings.opacity, 0.97)
  await quota(95)
  await eventual(`${text('daily-target')} === '13.86%／天' && ${text('daily-used')} === '2%'`)
  await evaluate(
    `window.dispatchEvent(new MessageEvent('message',{data:{type:'mcp-notification',hostId:'local',method:'thread/tokenUsage/updated',params:{threadId:'fixture-thread',turnId:'fixture-turn',tokenUsage:{total:{inputTokens:200,outputTokens:40,cachedInputTokens:160,totalTokens:240}}}}}))`,
  )
  await delay(150)
  assert.equal((await evaluate('window.codexracker.snapshot()')).total.totalTokens, 120)
  const restoredPage = [...session.pages.keys()][0]
  await session.pipe.call(
    'Emulation.setDeviceMetricsOverride',
    { width: 360, height: 640, deviceScaleFactor: 1, mobile: false },
    restoredPage,
  )
  await eventual(
    `(()=>{const e=document.querySelector('codex-token-cache-hud').shadowRoot.querySelector('.hud');const r=e.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&e.scrollWidth===e.clientWidth})()`,
  )
  report.checks.push(
    'restart-preserves-tokens-daily-baseline-settings-without-history-recount-and-fits-narrow-window',
  )
  const stored = await readFile(repositoryFile, 'utf8')
  assert.ok(!/PRIVATE_SENTINEL|alpha|fixture-thread|outputCharacters/.test(stored))
  assert.deepEqual(await fingerprint(), before)
  report.officialFileSha256 = before
  report.checks.push('numeric-only-persistence-and-official-exe-dll-asar-byte-for-byte-unchanged')
  report.result = 'passed'
} catch (error) {
  report.failure = error.message
  report.observedSettings = await evaluate(
    'window.codexracker.snapshot().then(s=>s.settings)',
  ).catch(() => null)
  report.form = await evaluate(
    `(()=>{const r=document.querySelector('codex-token-cache-hud')?.shadowRoot;return {input:r?.querySelector('input')?.value,form:r?.querySelector('form')?.textContent}})()`,
  ).catch(() => null)
  throw error
} finally {
  if (session) await session.close()
  await writeFile('signed-overlay-evidence.json', JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report, null, 2))
