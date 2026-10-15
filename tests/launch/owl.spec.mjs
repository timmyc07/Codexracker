import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { workspaceRoot } from '../../injector/copy-runtime.mjs'
import { prepareProbe, restoreCopy } from '../../injector/probe-copy.mjs'
import { verifyPlaywrightCopy } from '../../injector/playwright-copy.mjs'
import { verifyRestoration } from '../../injector/verify-restoration.mjs'

let prepared = false

test.beforeAll(async () => {
  await prepareProbe('playwright')
  prepared = true
})

test.afterAll(async () => {
  if (!prepared) return
  await restoreCopy()
  const restoration = await verifyRestoration()
  await writeFile(
    path.join(workspaceRoot, 'restoration-verification.json'),
    JSON.stringify(restoration, null, 2) + '\n',
  )
})

test('controls the real Owl App renderer with Playwright CDP', async () => {
  const result = await verifyPlaywrightCopy()
  await writeFile(
    path.join(workspaceRoot, 'playwright-cdp-launch.json'),
    JSON.stringify(result, null, 2) + '\n',
  )
  expect(result.result).toBe('passed')
  expect(result.pageProtocol).toBe('app:')
  expect(result.preloadMarkerVerified).toBe(true)
  expect(result.domMarkerVerified).toBe(true)
  expect(result.playwrightClickVerified).toBe(true)
  expect(result.probeProof.isolatedProfile).toBe(true)
  expect(result.probeProof.windowsUpdater.currentPackageFamily).toBe(null)
  expect(result.realModelRequestsSent).toBe(false)
})
