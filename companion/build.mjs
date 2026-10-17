import { build } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const workspaceRoot = fileURLToPath(new URL('../', import.meta.url))

export async function buildCompanion() {
  await mkdir(path.join(workspaceRoot, 'dist'), { recursive: true })
  for (const [entry, name, node] of [
    ['src/companion/page.ts', 'TokenTrackerPage', false],
    ['src/companion/main.ts', 'TokenTrackerCompanion', true],
  ]) {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: node ? [] : [svelte({ compilerOptions: { css: 'injected' } })],
      resolve: { conditions: node ? ['node'] : ['browser'] },
      build: {
        write: false,
        target: 'es2022',
        minify: false,
        lib: { entry: path.join(workspaceRoot, entry), name, formats: [node ? 'cjs' : 'iife'] },
        rollupOptions: { external: (id) => id.startsWith('node:') },
      },
    })
    const output = Array.isArray(result) ? result[0].output : result.output
    await writeFile(
      path.join(workspaceRoot, 'dist', node ? 'companion.cjs' : 'page.js'),
      output.find((item) => item.type === 'chunk').code,
    )
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await buildCompanion()
