import { installFetchInterceptor } from '../src/interceptor/proxy';
import { recordMetrics } from '../src/overlay/store';

/** Installs the renderer-side network hook from the injected preload bundle. */
export function installPreloadHook(): () => void {
  return installFetchInterceptor(recordMetrics);
}

