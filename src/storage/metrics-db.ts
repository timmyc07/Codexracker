import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { defaultSettings, sanitizeRecord, sanitizeSettings } from './schema'
import type { MetricRecord, MetricsData } from './schema'
import { dashboard } from '../overlay/summary'

export type { MetricRecord } from './schema'

/** Main process owns the single writer. Serialize operations to prevent lost updates. */
export class MetricsRepository {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private file: string) {}

  private run<T>(operation: (db: Low<MetricsData>) => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      const db = new Low<MetricsData>(new JSONFile<MetricsData>(this.file), {
        records: [],
        settings: defaultSettings(),
      })
      await db.read()
      if (!Array.isArray(db.data.records)) throw new Error('invalid-records')
      const records = db.data.records.map(sanitizeRecord)
      if (records.some((record) => !record)) throw new Error('invalid-record')
      db.data = { records: records as MetricRecord[], settings: sanitizeSettings(db.data.settings) }
      return operation(db)
    })
    this.queue = result.catch(() => {})
    return result
  }

  snapshot() {
    return this.run(async (db) => dashboard(db.data.records, db.data.settings))
  }

  append(value: unknown) {
    const record = sanitizeRecord(value)
    return this.run(async (db) => {
      if (record) {
        db.data.records.push(record)
        await db.write()
      }
      return dashboard(db.data.records, db.data.settings)
    })
  }

  saveSettings(value: unknown) {
    const settings = sanitizeSettings(value)
    return this.run(async (db) => {
      db.data.settings = settings
      await db.write()
      return dashboard(db.data.records, db.data.settings)
    })
  }
}

const repositories = new Map<string, MetricsRepository>()
export function metricsRepository(file: string): MetricsRepository {
  const key = path.resolve(file)
  let repository = repositories.get(key)
  if (!repository) {
    repository = new MetricsRepository(key)
    repositories.set(key, repository)
  }
  return repository
}

export async function appendMetric(file: string, record: MetricRecord): Promise<void> {
  await metricsRepository(file).append(record)
}
