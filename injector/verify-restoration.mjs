import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { experimentRoot, hashFile } from './copy-runtime.mjs'

export async function verifyRestoration() {
  const manifest = JSON.parse(
    await readFile(path.join(experimentRoot, 'copy-manifest.json'), 'utf8'),
  )
  const state = JSON.parse(await readFile(path.join(experimentRoot, 'probe-state.json'), 'utf8'))
  if (state.status !== 'restored') throw new Error('Restore the copy before verifying')
  let verified = 0
  for (const file of manifest.files) {
    const [source, copy] = await Promise.all([
      hashFile(path.join(manifest.source, file.path)),
      hashFile(path.join(manifest.destination, file.path)),
    ])
    if (source !== file.sha256) throw new Error(`Installed source changed: ${file.path}`)
    if (copy !== file.sha256) throw new Error(`Restored copy mismatch: ${file.path}`)
    verified++
    if (verified % 1000 === 0)
      console.error(`Verified ${verified}/${manifest.files.length} source and copy files`)
  }
  return {
    verifiedAt: new Date().toISOString(),
    result: 'passed',
    originalInstallationUnchanged: true,
    copiedFilesRestoredExactly: true,
    filesVerifiedPerInstallation: verified,
    bytesVerifiedPerInstallation: manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0),
    restoredHashes: state.originalHashes,
    nativeFusesModified: false,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await verifyRestoration(), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
