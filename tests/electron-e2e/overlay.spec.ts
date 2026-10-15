import { test as base } from '@playwright/test';
import { _electron as electron } from 'playwright';

const test = base.extend<{ codexApp: Awaited<ReturnType<typeof electron.launch>> }>({
  codexApp: async ({}, use) => {
    const entry = process.env.CODEX_APP_ENTRY;
    if (!entry) {
      throw new Error('Set CODEX_APP_ENTRY to run the Codex Electron E2E test.');
    }

    const app = await electron.launch({ args: [entry] });
    await use(app);
    await app.close();
  },
});

test('mounts the token cache overlay', async ({ codexApp }) => {
  const window = await codexApp.firstWindow();
  await window.waitForSelector('codex-token-cache-hud');
});
