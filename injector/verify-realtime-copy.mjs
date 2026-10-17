import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect } from '@playwright/test'
import { buildDesktopExtensions } from './build-desktop.mjs'
import { desktopSession } from './desktop-session.mjs'
import { experimentRoot, workspaceRoot } from './copy-runtime.mjs'
import { prepareProbe, restoreCopy } from './probe-copy.mjs'
import { verifyRestoration } from './verify-restoration.mjs'

const report = {
  testedAt: new Date().toISOString(),
  result: 'failed',
  realModelRequestsSent: false,
  method: 'real-Owl-renderer-synthetic-stream-quota-and-tokentracker-missions',
  checks: [],
}
const run = path.join(experimentRoot, `realtime-${randomUUID()}`)
const profile = path.join(run, 'profile')
await mkdir(run)
let prepared = false
let step = 'build'
try {
  const extensions = await buildDesktopExtensions()
  const fixtureFetch = `
;globalThis.fetch=async()=>{throw new Error('unexpected-overlay-network-request')};
`
  const fixtureMain = `\n;(() => {
    const {ipcMain}=require('electron')
    const original=ipcMain.handle.bind(ipcMain)
    let used=3
    const quotas=()=>({rateLimits:{limitId:'codex',primary:{usedPercent:10,windowDurationMins:300},secondary:{usedPercent:used,windowDurationMins:10080,resetsAt:${Math.floor(Date.now() / 1000) + 7 * 86400}}}})
    const notify=(sender,method,params)=>sender.send('codex_desktop:message-for-view',{type:'mcp-notification',hostId:'local',method,params})
    const reply=(sender,id,result)=>sender.send('codex_desktop:message-for-view',{type:'mcp-response',hostId:'local',message:{id,result}})
    const usage=(sender,input,output,cached)=>notify(sender,'thread/tokenUsage/updated',{threadId:'fixture-thread',turnId:'fixture-turn',tokenUsage:{total:{inputTokens:input,outputTokens:output,cachedInputTokens:cached,totalTokens:input+output},last:{inputTokens:100,outputTokens:20,cachedInputTokens:80}},prompt:'PRIVATE_SENTINEL'})
    ipcMain.handle=(channel,handler)=>original(channel,channel==='codex_desktop:message-from-view'?async(event,value)=>{
      if(value?.type==='mcp-request' && value.request?.method==='account/rateLimits/read'){
        reply(event.sender,value.request.id,quotas());return
      }
      if(value?.request?.id==='codexracker-fixture-start'){
        reply(event.sender,'fixture-resume',{thread:{id:'fixture-thread'},model:'other-model',modelProvider:'openai',serviceTier:null})
        usage(event.sender,100,20,80)
        reply(event.sender,value.request.id,{turn:{id:'fixture-turn'}})
        notify(event.sender,'turn/started',{threadId:'fixture-thread',turn:{id:'fixture-turn',status:'inProgress'}})
        return
      }
      return handler(event,value)
    }:handler)
    ipcMain.on('codexracker:fixture-live',(event,action)=>{
      if(action==='chunk'){
        notify(event.sender,'item/agentMessage/delta',{threadId:'fixture-thread',turnId:'fixture-turn',itemId:'fixture-item',delta:'alpha😀',prompt:'PRIVATE_SENTINEL'})
        used=5
      }
      if(action==='finish'){
        usage(event.sender,200,40,160)
        notify(event.sender,'turn/completed',{threadId:'fixture-thread',turn:{id:'fixture-turn',status:'completed'}})
      }
    })
  })();\n`
  const fixturePreload = `\n;(() => {
    const {ipcRenderer,contextBridge}=require('electron')
    contextBridge.exposeInMainWorld('codexrackerRealtimeTest',{
      begin:()=>ipcRenderer.invoke('codex_desktop:message-from-view',{type:'mcp-request',hostId:'local',request:{id:'codexracker-fixture-start',method:'turn/start',params:{threadId:'fixture-thread',model:'gpt-6.1-sol',input:'PRIVATE_SENTINEL'}}}),
      chunk:()=>ipcRenderer.send('codexracker:fixture-live','chunk'),
      finish:()=>ipcRenderer.send('codexracker:fixture-live','finish')
    })
  })();\n`
  step = 'prepare'
  await prepareProbe(
    'playwright',
    extensions.preload + fixturePreload,
    fixtureFetch + extensions.main + fixtureMain,
  )
  prepared = true
  step = 'first-launch'
  await desktopSession(
    path.join(experimentRoot, 'app'),
    profile,
    path.join(run, 'home'),
    async (page) => {
      const hud = page.locator('codex-token-cache-hud')
      step = 'quota-read'
      await expect(hud.getByTestId('weekly-remaining')).toHaveText('97%')
      await expect(hud.getByTestId('daily-target')).toHaveText('13.86%／天')
      await expect(hud.getByTestId('total-tokens')).toHaveText('0')
      expect(await hud.locator('.hud').evaluate((el) => getComputedStyle(el).fontSize)).toBe('15px')
      step = 'accepted-model'
      await page.evaluate(() => window.codexrackerRealtimeTest.begin())
      await expect(hud.getByTestId('live-model')).toHaveText('gpt-6.1-sol')
      step = 'turn-start'
      await expect(hud.getByTestId('run-status')).toHaveText('思考／工具處理中')
      step = 'first-chunk'
      await page.evaluate(() => window.codexrackerRealtimeTest.chunk())
      await expect(hud.getByTestId('run-status')).toHaveText('輸出中')
      await expect(hud.getByTestId('stream-progress')).toContainText('6 字')
      await expect(hud.getByTestId('measured-output')).toContainText('待服務端回報')
      await expect(hud.getByTestId('updates')).toHaveText('0')
      report.checks.push('stream-progress-visible-before-token-usage-or-disk-write')
      await page.evaluate(() => window.codexrackerRealtimeTest.chunk())
      await expect(hud.getByTestId('stream-progress')).toContainText('12 字')
      await hud.getByRole('button', { name: '更新週額度' }).click()
      await expect(hud.getByTestId('weekly-remaining')).toHaveText('95%')
      await expect(hud.getByTestId('daily-target')).toHaveText('13.86%／天')
      await expect(hud.getByTestId('daily-used')).toHaveText('2%')
      report.checks.push('official-shape-weekly-window-and-read-only-refresh')
      await page.evaluate(() => window.codexrackerRealtimeTest.finish())
      step = 'finish-and-token-only-overlay'
      await expect(hud.getByTestId('run-status')).toHaveText('已完成')
      await expect(hud.getByTestId('measured-output')).toContainText('20')
      await expect(hud.getByTestId('total-input')).toHaveText('100')
      await expect(hud.getByTestId('total-output')).toHaveText('20')
      await expect(hud.getByTestId('total-tokens')).toHaveText('120')
      await expect(hud.getByTestId('today-tokens')).toHaveText('120')
      await expect(hud.getByTestId('total-cost')).toHaveCount(0)
      await expect(hud.locator('.hud')).not.toContainText(/USD|NT\$|匯率|費率|價格/)
      expect(await hud.locator('.hud').evaluate((el) => getComputedStyle(el).borderRadius)).toBe(
        '28px',
      )
      report.checks.push(
        'accepted-model-total-and-today-tokens-stable-daily-target-and-readable-type',
      )
      await hud.getByRole('button', { name: '管理設定' }).click()
      await expect(hud.getByRole('combobox')).toHaveCount(0)
      await hud.getByRole('spinbutton', { name: '面板不透明度' }).fill('0.97')
      await hud.getByRole('button', { name: '儲存設定' }).click()
      const header = hud.getByRole('toolbar')
      const box = await header.boundingBox()
      await page.mouse.move(box.x + 60, box.y + 20)
      await page.mouse.down()
      await page.mouse.move(box.x + 180, box.y + 110, { steps: 10 })
      await page.mouse.up()
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.codexracker.snapshot())).settings.position.x,
        )
        .toBeGreaterThan(16)
      await hud.getByRole('button', { name: '本機紀錄' }).click()
      await expect(hud.locator('article')).toHaveCount(1)
      await hud.getByRole('button', { name: '本機紀錄' }).click()
      await hud
        .locator('.hud')
        .screenshot({ path: path.join(workspaceRoot, 'tokentracker-hud.png') })
      await hud.getByRole('button', { name: '最小化' }).click()
      await expect(hud.getByRole('button', { name: '展開用量追蹤' })).toBeVisible()
      const minimized = await page.evaluate(() => window.codexracker.snapshot())
      await expect(hud.getByTestId('bubble-remaining')).toHaveText('95%')
      expect(
        await hud.locator('.jelly').evaluate((el) => getComputedStyle(el).animationName),
      ).toContain('jelly-breathe')
      await hud
        .locator('.hud')
        .screenshot({ path: path.join(workspaceRoot, 'tokentracker-bubble.png') })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      expect(await hud.locator('.jelly').evaluate((el) => getComputedStyle(el).animationName)).toBe(
        'none',
      )
      expect([0, await page.evaluate(() => innerWidth - 88)]).toContain(
        minimized.settings.position.x,
      )
      report.checks.push('display-settings-drag-history-and-minimize-edge-snap')
    },
  )
  step = 'restart'
  await desktopSession(
    path.join(experimentRoot, 'app'),
    profile,
    path.join(run, 'home'),
    async (page) => {
      const hud = page.locator('codex-token-cache-hud')
      await expect(hud.getByRole('button', { name: '展開用量追蹤' })).toBeVisible()
      await hud.getByRole('button', { name: '展開用量追蹤' }).click()
      await expect(hud.getByTestId('total-input')).toHaveText('100')
      await expect(hud.getByTestId('total-tokens')).toHaveText('120')
      await expect(hud.getByTestId('today-tokens')).toHaveText('120')
      await expect(hud.getByTestId('daily-target')).toHaveText('13.86%／天')
      expect((await page.evaluate(() => window.codexracker.snapshot())).settings.opacity).toBe(0.97)
      await expect(hud.getByTestId('run-status')).toHaveText('待機')
      await expect(hud.getByTestId('updates')).toHaveText('1')
      await page.setViewportSize({ width: 360, height: 640 })
      await expect
        .poll(async () =>
          hud.locator('.hud').evaluate((el) => {
            const rect = el.getBoundingClientRect()
            return (
              rect.left >= 0 &&
              rect.top >= 0 &&
              rect.right <= innerWidth &&
              rect.bottom <= innerHeight &&
              el.scrollWidth === el.clientWidth
            )
          }),
        )
        .toBe(true)
      await hud.getByRole('button', { name: '最小化' }).click()
      await hud.getByRole('button', { name: '展開用量追蹤' }).click()
      await expect
        .poll(async () =>
          hud.locator('.hud').evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
        )
        .toBe(true)
      report.checks.push('narrow-viewport-and-restored-panel-stay-within-window')
    },
  )
  const stored = await readFile(path.join(profile, 'codexracker/metrics.json'), 'utf8')
  expect(stored).not.toContain('PRIVATE_SENTINEL')
  const records = JSON.parse(stored).records
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({
    model: 'gpt-6.1-sol',
    provider: 'openai',
    inputTokens: 100,
    outputTokens: 20,
    promptCacheHitTokens: 80,
  })
  expect(stored).not.toMatch(/alpha|outputCharacters|weekly|fixture-thread/)
  report.checks.push('restart-preserves-tokens-and-daily-mission-baseline-without-stream-content')
  report.result = 'passed'
} catch (error) {
  console.error(error.message)
  report.failureStep = step
} finally {
  if (prepared) {
    try {
      await restoreCopy()
      const restoration = await verifyRestoration()
      report.restoration = restoration.result
      await writeFile(
        path.join(workspaceRoot, 'tokentracker-restoration.json'),
        JSON.stringify(restoration, null, 2) + '\n',
      )
      if (restoration.result !== 'passed') report.result = 'failed'
    } catch (error) {
      console.error(error.message)
      report.restoration = 'failed'
      report.result = 'failed'
    }
  }
  await writeFile(
    path.join(workspaceRoot, 'tokentracker-desktop-evidence.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
}
console.log(JSON.stringify(report, null, 2))
if (report.result !== 'passed') process.exitCode = 1
