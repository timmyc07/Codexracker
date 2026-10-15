import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { extractFile, listPackage } from '@electron/asar'
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses'

function archivePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) {
    throw new Error('Archive main must be a non-empty relative path')
  }
  const normalized = value.replaceAll('\\', '/')
  if (path.posix.isAbsolute(normalized) || normalized.includes(':')) {
    throw new Error('Archive main must be a relative path')
  }
  if (normalized.split('/').includes('..')) {
    throw new Error('Archive main cannot traverse parent directories')
  }
  return path.normalize(normalized)
}

export function inspectArchive(archive) {
  const metadata = JSON.parse(extractFile(archive, 'package.json').toString('utf8'))
  const main = archivePath(metadata.main)
  const entry = extractFile(archive, main)
  const candidates = listPackage(archive)
    .map((file) => file.replaceAll('\\', '/').replace(/^\//, ''))
    .filter((file) => /^\.vite\/build\/[^/]*preload[^/]*\.js$/.test(file))
  return {
    packageName: metadata.name,
    packageVersion: metadata.version,
    main: main.replaceAll('\\', '/'),
    mainSizeBytes: entry.length,
    preloadCandidates: candidates,
    injectionVerified: false,
  }
}

async function fingerprint(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function inspectFuses(executable) {
  try {
    const wire = await getCurrentFuseWire(executable)
    const describe = (option) => {
      const state = wire[option]
      if (state === FuseState.ENABLE) return 'enabled'
      if (state === FuseState.DISABLE) return 'disabled'
      return 'unknown'
    }
    return {
      status: 'read',
      embeddedAsarIntegrity: describe(FuseV1Options.EnableEmbeddedAsarIntegrityValidation),
      onlyLoadAppFromAsar: describe(FuseV1Options.OnlyLoadAppFromAsar),
      runAsNode: describe(FuseV1Options.RunAsNode),
    }
  } catch (error) {
    return {
      status: 'unverified',
      embeddedAsarIntegrity: 'unknown',
      reason: error.message,
    }
  }
}

export async function inspectInstallation(packageRoot) {
  const root = await realpath(packageRoot)
  const app = path.join(root, 'app')
  const archive = path.join(app, 'resources', 'app.asar')
  const executable = path.join(app, 'ChatGPT.exe')
  const runtime = JSON.parse(
    await readFile(path.join(app, 'resources', 'owl-electron-app.json'), 'utf8'),
  )
  const before = await fingerprint(archive)
  const structure = inspectArchive(archive)
  const fuses = await inspectFuses(executable)
  const after = await fingerprint(archive)
  if (before !== after)
    throw new Error('ASAR changed during inspection; rerun after update completes')
  return {
    schemaVersion: 1,
    inspectedAt: new Date().toISOString(),
    result: 'blocked',
    packageRoot: root,
    executable,
    runtimeName: runtime.runtimeName,
    archive: {
      path: archive,
      sizeBytes: (await stat(archive)).size,
      sha256: after,
      fingerprintUnchangedDuringInspection: true,
      ...structure,
    },
    fuses,
    blockers: [
      'Installation write permission has not been verified by this read-only tool; consult the ACL evidence',
      ...(fuses.embeddedAsarIntegrity !== 'disabled'
        ? ['ASAR integrity configuration is enabled or unknown; patching is blocked']
        : []),
      'Preload-to-renderer injection and backup/restore acceptance have not passed',
    ],
    applicationFilesModified: false,
    applicationLaunched: false,
    realRequestsSent: false,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) {
      throw new Error('Usage: pnpm inspect:installation <WindowsApps-package-root>')
    }
    console.log(JSON.stringify(await inspectInstallation(process.argv[2]), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ result: 'inspection-failed', reason: error.message }))
    process.exitCode = 1
  }
}
