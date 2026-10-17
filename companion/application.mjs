import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'

export async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export function registeredApplication() {
  const command = `$ErrorActionPreference='Stop';$p=@(Get-AppxPackage -Name OpenAI.Codex);if($p.Count -ne 1 -or $p[0].PackageFamilyName -ne 'OpenAI.Codex_2p2nqsd0c76g0' -or $p[0].Status -ne 'Ok'){throw 'Codex package unavailable'};$p[0] | Select-Object InstallLocation,Version,PackageFamilyName | ConvertTo-Json -Compress`
  const app = JSON.parse(
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
      encoding: 'utf8',
    }),
  )
  if (typeof app.InstallLocation !== 'string' || !path.isAbsolute(app.InstallLocation))
    throw new Error('invalid-package-path')
  return {
    directory: path.join(app.InstallLocation, 'app'),
    version: String(app.Version),
    family: app.PackageFamilyName,
  }
}
