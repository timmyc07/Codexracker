import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { registeredApplication, hashFile } from '../../companion/application.mjs'

const root = path.resolve('.local-runtime', `signed-package-${randomUUID()}`)
await mkdir(root, { recursive: true })
const release = JSON.parse(await readFile('release/latest.json', 'utf8'))
assert.equal(await hashFile(release.archive), release.sha256)
assert.equal(release.unsignedExecutable, false)
const env = { ...process.env, CODEX_HOME: path.join(root, 'home') }
delete env.OPENAI_API_KEY
for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) delete env[name]
const run = (exe, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      env,
      windowsHide: true,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    if (input !== undefined) child.stdin.end(input)
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`package-process-failed:${code}`)),
    )
  })
const powershell = (code, extra = {}) =>
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], {
    env: { ...env, ...extra },
    windowsHide: true,
    encoding: 'utf8',
  })
async function eventual(check) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(100)
  }
  throw new Error('package-assertion-timeout')
}
const report = {
  testedAt: new Date().toISOString(),
  result: 'failed',
  releaseSha256: release.sha256,
  checks: [],
  realModelRequestsSent: false,
  officialFilesModified: false,
}
let ownedApplication
let ownedController
let ownedProfile
const stopOwnedApplication = () =>
  powershell(
    "$ErrorActionPreference='Stop';$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:TT_OWNED_APP_PID);if(-not $p){exit 0};if($p.Name -ne 'ChatGPT.exe' -or $p.ParentProcessId -ne [int]$env:TT_OWNED_CONTROLLER_PID -or -not $p.CommandLine.Contains('--user-data-dir='+$env:TT_OWNED_PROFILE)){throw 'Refusing unrelated process'};Stop-Process -Id $p.ProcessId -ErrorAction Stop",
    {
      TT_OWNED_APP_PID: String(ownedApplication),
      TT_OWNED_CONTROLLER_PID: String(ownedController),
      TT_OWNED_PROFILE: ownedProfile,
    },
  )
try {
  const payload = path.join(root, 'program', release.sha256.slice(0, 24))
  powershell(
    "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::ExtractToDirectory($env:TT_ARCHIVE,$env:TT_EXTRACT_DIR)",
    {
      TT_ARCHIVE: release.archive,
      TT_EXTRACT_DIR: payload,
    },
  )
  const manifest = JSON.parse(await readFile(path.join(payload, 'manifest.json'), 'utf8'))
  for (const file of manifest.files)
    assert.equal(await hashFile(path.join(payload, file.path)), file.sha256)
  assert.deepEqual(
    manifest.files.filter((file) => /\.(exe|dll)$/i.test(file.path)).map((file) => file.path),
    ['node.exe'],
  )
  assert.equal(await hashFile(path.join(payload, 'node.exe')), release.nodeSha256)
  const signature = powershell(
    "Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1');(Get-AuthenticodeSignature -FilePath $env:TT_NODE_FILE).Status.ToString()",
    { TT_NODE_FILE: path.join(payload, 'node.exe') },
  ).trim()
  assert.equal(signature, 'Valid')
  report.nodeSignature = signature
  const program = path.join(payload, 'app')
  const appFiles = await readdir(program)
  assert.deepEqual(appFiles.sort(), ['companion', 'dist', 'launcher', 'package.json'])
  report.checks.push('portable-zip-integrity-with-officially-signed-node-as-only-executable')
  const data = path.join(root, 'data')
  const metrics = path.join(data, 'profile/codexracker/metrics.json')
  await mkdir(path.dirname(metrics), { recursive: true })
  const seed = {
    records: [
      {
        recordedAt: new Date().toISOString(),
        inputTokens: 100,
        outputTokens: 20,
      },
    ],
    settings: { position: { x: 0, y: 16 }, minimized: true, opacity: 0.97 },
  }
  await writeFile(metrics, JSON.stringify(seed, null, 2))
  const seedHash = await hashFile(metrics)
  const node = path.join(payload, 'node.exe')
  const worker = path.join(program, 'launcher/worker.mjs')
  const action = async (name) =>
    (await run(node, [worker, name, data])).trim().split(/\r?\n/).map(JSON.parse).at(-1)
  assert.equal((await action('diagnose')).status, 'package-verified')
  assert.equal((await action('launch')).status, 'started')
  const lease = JSON.parse(await readFile(path.join(data, 'tracker.lock'), 'utf8'))
  const official = registeredApplication()
  const child = JSON.parse(
    powershell(
      "$ErrorActionPreference='Stop';$p=@(Get-CimInstance Win32_Process | Where-Object {$_.ParentProcessId -eq [int]$env:TT_CONTROLLER_PID -and $_.Name -eq 'ChatGPT.exe'});if($p.Count -ne 1){throw 'Unexpected app children'};$p | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
      { TT_CONTROLLER_PID: String(lease.pid) },
    ),
  )
  assert.equal(
    child.ExecutablePath.toLowerCase(),
    path.join(official.directory, 'ChatGPT.exe').toLowerCase(),
  )
  assert.ok(child.CommandLine.includes(`--user-data-dir=${path.join(data, 'profile')}`))
  ownedController = lease.pid
  ownedProfile = path.join(data, 'profile')
  ownedApplication = child.ProcessId
  await eventual(
    () =>
      Number(
        powershell('(Get-Process -Id ([int]$env:TT_OWNED_APP_PID)).MainWindowHandle.ToInt64()', {
          TT_OWNED_APP_PID: String(ownedApplication),
        }).trim(),
      ) !== 0,
  )
  assert.ok(child.CommandLine.includes('--remote-debugging-pipe'))
  assert.ok(!child.CommandLine.includes('--remote-debugging-port'))
  assert.equal((await action('launch')).status, 'already-running')
  const menu = await run(node, [path.join(program, 'launcher/start.mjs'), data], '5\n')
  assert.ok(menu.includes('已在執行') && menu.includes('回復上一版') && menu.includes('開啟資料夾'))
  const checked = await action('sync')
  assert.equal(checked.running, true)
  assert.equal(checked.modifiedOfficialFiles, false)
  await delay(500)
  assert.equal(await hashFile(metrics), seedHash)
  report.checks.push(
    'bundled-node-starts-visible-signed-app-with-mounted-overlay-and-single-instance',
  )
  report.checks.push('existing-history-and-settings-byte-for-byte-preserved')
  report.checks.push('launcher-menu-retains-actions-and-closes-without-stopping-codex')
  stopOwnedApplication()
  ownedApplication = null
  await eventual(async () => {
    try {
      await readFile(path.join(data, 'tracker.lock'))
      return false
    } catch (error) {
      if (error.code === 'ENOENT') return true
      throw error
    }
  })
  await eventual(() => {
    try {
      process.kill(lease.pid, 0)
      return false
    } catch (error) {
      if (error.code === 'ESRCH') return true
      throw error
    }
  })
  assert.equal((await action('sync')).running, false)
  assert.equal(await hashFile(metrics), seedHash)
  report.checks.push('official-app-exit-releases-lock-and-exits-companion')
  const blocks = Number(
    powershell(
      "$ErrorActionPreference='Stop';Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Diagnostics/Microsoft.PowerShell.Diagnostics.psd1');$cutoff=[DateTimeOffset]::Parse($env:TT_TEST_TIME);try{$all=@(Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-CodeIntegrity/Operational';Id=3033,3077;StartTime=$cutoff.LocalDateTime} -ErrorAction Stop)}catch{if($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*'){throw};$all=@()};@($all | Where-Object {$_.TimeCreated.ToUniversalTime() -ge $cutoff.UtcDateTime -and $_.Message.Contains($env:TT_TEST_DIR)}).Count",
      {
        TT_TEST_TIME: report.testedAt,
        TT_TEST_DIR: root.replace(/^.:/, ''),
      },
    ).trim(),
  )
  assert.equal(blocks, 0)
  report.codeIntegrityBlockEvents = blocks
  report.result = 'passed'
} catch (error) {
  report.failure = error.message
  throw error
} finally {
  if (ownedApplication) stopOwnedApplication()
  await writeFile('signed-package-evidence.json', JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report, null, 2))
