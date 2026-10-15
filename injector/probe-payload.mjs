// These payloads observe only our nonce and DOM marker, never application content.
export function mainProbe(nonce, { playwright = false } = {}) {
  return `;(() => {
    const { app, ipcMain } = require('electron')
    const fs = require('node:fs')
    const path = require('node:path')
    const expected = ${JSON.stringify(nonce)}
    const output = process.env.CODEXRACKER_PROBE_OUTPUT
    const profile = process.env.CODEXRACKER_PROBE_PROFILE
    if (!output || !profile) throw new Error('Missing isolated probe paths')
    if (path.resolve(app.getPath('userData')).toLowerCase() !== path.resolve(profile).toLowerCase()) {
      fs.writeFileSync(output, JSON.stringify({result:'profile-isolation-failed'}))
      app.exit(2)
      throw new Error('Probe refuses to use a shared application profile')
    }
    console.log('[Codexracker] main probe installed')
    ipcMain.on('codexracker:probe-stop', (event, value) => {
      if (${playwright} && value === expected) app.exit(0)
    })
    ipcMain.on('codexracker:probe-ready', async (event, value) => {
      if (value !== expected) return
      try {
        const renderer = await event.sender.executeJavaScript(
          '({nonce:window.codexrackerProbe?.nonce,dom:document.documentElement.dataset.codexrackerProbe})'
        )
        const result = {
          result: renderer.nonce === expected && renderer.dom === expected ? 'passed' : 'failed',
          nonce: expected,
          preloadReachedRenderer: renderer.nonce === expected,
          domMarkerVisible: renderer.dom === expected,
          isolatedProfile: true,
          pageProtocol: new URL(event.sender.getURL()).protocol,
          runtimeVersions: {electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node}
        }
        if (${playwright}) {
          try {
            const updater = require(path.join(process.resourcesPath, 'native', 'windows-updater.node'))
            result.windowsUpdater = {currentPackageFamily:updater.getCurrentPackageFamily() ?? null}
          } catch (error) {
            result.windowsUpdater = {readError:error.message}
          }
        }
        fs.writeFileSync(output, JSON.stringify(result, null, 2))
        console.log('[Codexracker] preload-to-renderer probe ' + result.result)
        if (!${playwright} || result.result !== 'passed') app.exit(result.result === 'passed' ? 0 : 1)
      } catch (error) {
        fs.writeFileSync(output, JSON.stringify({result:'failed',reason:error.message}))
        app.exit(1)
      }
    })
  })();\n`
}

export function preloadProbe(nonce, { playwright = false } = {}) {
  return `\n;(() => {
    const { contextBridge, ipcRenderer } = require('electron')
    const nonce = ${JSON.stringify(nonce)}
    contextBridge.exposeInMainWorld('codexrackerProbe', {
      nonce,
      ...(${playwright} ? {finish:() => ipcRenderer.send('codexracker:probe-stop',nonce)} : {})
    })
    const ready = () => {
      document.documentElement.dataset.codexrackerProbe = nonce
      console.log('[Codexracker] preload probe ready')
      ipcRenderer.send('codexracker:probe-ready', nonce)
    }
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', ready, {once:true})
    else ready()
  })();\n`
}
