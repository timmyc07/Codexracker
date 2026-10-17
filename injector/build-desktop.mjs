import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { workspaceRoot } from './copy-runtime.mjs'

async function bundle(entry, name, node = false) {
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
  return output.find((item) => item.type === 'chunk').code
}

export async function buildDesktopExtensions() {
  const renderer = await bundle('src/overlay/entry.ts', 'CodexrackerOverlay')
  const preload = await bundle('injector/desktop-preload.ts', 'CodexrackerPreload', true)
  const main = await bundle('injector/desktop-main.ts', 'CodexrackerMain', true)
  return {
    preload: `\n;(() => {const exports={};\n${preload}\n;exports.installDesktopPreload(require('electron').ipcRenderer,require('electron').contextBridge)})();\n`,
    main: `\n;(() => {const exports={};\n${main}\n;exports.installDesktopMain(require('electron'),${JSON.stringify(renderer)})})();\n`,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const extensions = await buildDesktopExtensions()
  const output = path.join(workspaceRoot, 'dist')
  await mkdir(output, { recursive: true })
  await writeFile(path.join(output, 'desktop-main.cjs'), extensions.main)
  await writeFile(path.join(output, 'desktop-preload.cjs'), extensions.preload)
  console.log('Built desktop Main and Preload bundles')
}
