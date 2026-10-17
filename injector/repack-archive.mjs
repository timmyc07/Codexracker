import path from 'node:path'
import { Readable } from 'node:stream'
import { createPackageFromStreams, extractFile, getRawHeader } from '@electron/asar'

/** Preserve unpacked files and executable flags; reject unsupported links. */
export async function repackArchive(source, destination, replacements) {
  const streams = []
  function visit(entries, parent = '') {
    for (const [name, entry] of Object.entries(entries)) {
      const file = path.join(parent, name)
      if (entry.link) throw new Error('Unsupported ASAR link')
      if (entry.files) {
        streams.push({ path: file, type: 'directory', unpacked: !!entry.unpacked })
        visit(entry.files, file)
      } else {
        streams.push({
          path: file,
          type: 'file',
          unpacked: !!entry.unpacked,
          stat: {
            size: replacements.get(file)?.length ?? entry.size,
            mode: entry.executable ? 0o100755 : 0o100644,
          },
          streamGenerator: () =>
            Readable.from([replacements.get(file) ?? extractFile(source, file)]),
        })
      }
    }
  }
  visit(getRawHeader(source).header.files)
  await createPackageFromStreams(destination, streams)
  for (const [file, bytes] of replacements) {
    if (!extractFile(destination, file).equals(bytes)) throw new Error('Repacked content mismatch')
  }
}
