import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { registeredApplication } from '../../companion/application.mjs'
import { openSignedSession } from '../../companion/session.mjs'
import { createController } from './controller'
import { acquireLease } from '../../companion/manager.mjs'
export { createController } from './controller'

async function main() {
  const [root, readyFile] = process.argv.slice(2)
  if (
    !root ||
    !readyFile ||
    !path.isAbsolute(root) ||
    path.dirname(readyFile) !== root ||
    !/^launch-[\w-]+\.json$/.test(path.basename(readyFile))
  )
    throw new Error('invalid-startup-paths')
  const release = await acquireLease(root)
  try {
    const application = registeredApplication()
    const code = await readFile(path.join(__dirname, 'page.js'), 'utf8')
    const session = await openSignedSession(
      application.directory,
      path.join(root, 'profile'),
      code,
      (broadcast: (channel: string, value: unknown) => void) =>
        createController(path.join(root, 'profile', 'codexracker', 'metrics.json'), broadcast),
    )
    await writeFile(
      readyFile,
      JSON.stringify({ status: 'started', version: application.version }),
      { flag: 'wx' },
    )
    await session.closed
  } finally {
    await release()
  }
}
if (require.main === module)
  void main().catch(async () => {
    const [root, readyFile] = process.argv.slice(2)
    if (
      root &&
      readyFile &&
      path.dirname(readyFile) === root &&
      /^launch-[\w-]+\.json$/.test(path.basename(readyFile))
    )
      await writeFile(readyFile, JSON.stringify({ status: 'failed' }), { flag: 'wx' }).catch(
        () => {},
      )
    process.exitCode = 1
  })
