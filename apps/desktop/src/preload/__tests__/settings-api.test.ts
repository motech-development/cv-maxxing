import { expect, test, vi } from 'vitest';

import { SETTINGS_IPC_CHANNELS } from '../../shared/ipc.js';
import { SETTINGS_RESET_CONFIRMATION_PHRASE } from '../../shared/settings.js';
import { createDesktopApi } from '../create-desktop-api.js';

test('preload exposes settings queries and destructive controls over typed IPC', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValueOnce({
      appVersion: '1.0.0',
      workerCommand: 'codex',
      workerProvider: 'codex',
    })
    .mockImplementationOnce(() => Promise.resolve())
    .mockImplementationOnce(() => Promise.resolve());
  const desktopApi = createDesktopApi({
    invoke,
  });

  await expect(desktopApi.settings.getSettingsSnapshot()).resolves.toEqual({
    appVersion: '1.0.0',
    workerCommand: 'codex',
    workerProvider: 'codex',
  });
  await expect(desktopApi.settings.clearJobSiteBrowserData()).resolves.toBeUndefined();
  await expect(
    desktopApi.settings.resetLocalAppData({
      confirmationPhrase: SETTINGS_RESET_CONFIRMATION_PHRASE,
    }),
  ).resolves.toBeUndefined();

  expect(invoke).toHaveBeenNthCalledWith(1, SETTINGS_IPC_CHANNELS.getSnapshot);
  expect(invoke).toHaveBeenNthCalledWith(2, SETTINGS_IPC_CHANNELS.clearJobSiteBrowserData);
  expect(invoke).toHaveBeenNthCalledWith(3, SETTINGS_IPC_CHANNELS.resetLocalAppData, {
    confirmationPhrase: SETTINGS_RESET_CONFIRMATION_PHRASE,
  });
});
