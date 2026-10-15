import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout } from 'node:timers/promises'
import { copyFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const workspaceRoot = fileURLToPath(new URL('../', import.meta.url))
export const experimentRoot = path.join(workspaceRoot, '.local-runtime', 'owl-probe')

export async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function copyWhenUnlocked(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try {
      await copyFile(source, destination)
      return
    } catch (error) {
      if (error.code !== 'EBUSY' || attempt === 31) throw error
      await setTimeout(250)
    }
  }
}

export async function copyRuntime(sourceApp) {
  const source = path.resolve(sourceApp)
  if (!/[/\\]WindowsApps[/\\]OpenAI\.Codex_[^/\\]+[/\\]app$/i.test(source)) {
    throw new Error('Source must be the installed OpenAI.Codex WindowsApps app directory')
  }
  const destination = path.join(experimentRoot, 'app')
  await mkdir(experimentRoot, { recursive: true })
  await mkdir(destination)
  const files = []
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(source, relative), { withFileTypes: true })) {
      const item = path.join(relative, entry.name)
      const target = path.join(destination, item)
      if (entry.isSymbolicLink()) throw new Error(`Refusing source link: ${item}`)
      if (entry.isDirectory()) {
        await mkdir(target)
        await visit(item)
      } else if (entry.isFile()) {
        const input = path.join(source, item)
        const before = await stat(input)
        const hash = createHash('sha256')
        await pipeline(
          createReadStream(input),
          new Transform({
            transform(chunk, encoding, callback) {
              hash.update(chunk)
              callback(null, chunk)
            },
          }),
          createWriteStream(target, { flags: 'wx' }),
        )
        const sha256 = hash.digest('hex')
        const after = await stat(input)
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
          throw new Error(`Source updated while copying: ${item}`)
        }
        if ((await hashFile(target)) !== sha256) throw new Error(`Copy hash mismatch: ${item}`)
        files.push({ path: item.replaceAll('\\', '/'), sizeBytes: before.size, sha256 })
      } else {
        throw new Error(`Unsupported source entry: ${item}`)
      }
    }
  }
  await visit()
  const manifest = { source, destination, copiedAt: new Date().toISOString(), files }
  await writeFile(
    path.join(experimentRoot, 'copy-manifest.json'),
    JSON.stringify(manifest, null, 2),
    {
      flag: 'wx',
    },
  )
  return {
    destination,
    fileCount: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3)
      throw new Error('Usage: node injector/copy-runtime.mjs <installed-app-directory>')
    console.log(JSON.stringify(await copyRuntime(process.argv[2]), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
