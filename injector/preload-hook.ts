import { installIpcUsageInterceptor } from '../src/interceptor/proxy'
import type { IpcUsageSource, MetricsObserver } from '../src/interceptor/proxy'

/** Observe the verified desktop IPC channel and forward only normalized deltas. */
export function installPreloadHook(
  ipcRenderer: IpcUsageSource,
  observer: MetricsObserver,
): () => void {
  return installIpcUsageInterceptor(ipcRenderer, observer)
}
