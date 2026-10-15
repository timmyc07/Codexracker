const preloadOption = /(\bpreload\s*:\s*)(['"`])([^'"`]+)\2/

/** Replaces the existing preload path in one known Electron entry source. */
export function patchPreloadPath(source: string, injectedPreloadPath: string): string {
  if (!preloadOption.test(source)) {
    throw new Error('Could not find an Electron webPreferences.preload option.')
  }

  return source.replace(preloadOption, `$1"${injectedPreloadPath}"`)
}
