import { JSONFilePreset } from 'lowdb/node';

export interface MetricRecord {
  recordedAt: string;
  inputTokens?: number;
  outputTokens?: number;
  promptCacheHitTokens?: number;
  durationMs?: number;
}

interface MetricsData {
  records: MetricRecord[];
}

export async function openMetricsDb(path: string) {
  return JSONFilePreset<MetricsData>(path, { records: [] });
}

export async function appendMetric(path: string, record: MetricRecord): Promise<void> {
  const db = await openMetricsDb(path);
  db.data.records.push(record);
  await db.write();
}
