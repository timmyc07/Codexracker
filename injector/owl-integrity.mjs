import { createHash } from 'node:crypto'
import { getRawHeader } from '@electron/asar'

export function headerHash(archive) {
  return createHash('sha256').update(getRawHeader(archive).headerString).digest('hex')
}

export function integrityRecord(hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Expected a lowercase SHA256 header hash')
  return Buffer.from(JSON.stringify([{ file: 'resources\\app.asar', alg: 'SHA256', value: hash }]))
}

export function replaceEmbeddedIntegrity(binary, originalHash, replacementHash) {
  const record = integrityRecord(originalHash)
  const replacement = integrityRecord(replacementHash)
  const offset = binary.indexOf(record)
  if (offset < 0 || binary.indexOf(record, offset + 1) !== -1) {
    throw new Error('Expected exactly one supported embedded ASAR integrity record')
  }
  const updated = Buffer.from(binary)
  replacement.copy(updated, offset)
  return { binary: updated, resourceOffset: offset }
}
