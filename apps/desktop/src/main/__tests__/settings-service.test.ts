import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { SETTINGS_RESET_CONFIRMATION_PHRASE } from '../../shared/settings.js';
import {
  createLocalAppDataPaths,
  type KeychainBoundary,
  type LocalAppDataPaths,
  openLocalAppData,
} from '../local-app-data-service.js';
import {
  createSettingsService,
  InvalidLocalDataResetConfirmationError,
} from '../settings-service.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, {
        force: true,
        recursive: true,
      });
    }),
  );
});

async function createTestPaths(): Promise<LocalAppDataPaths> {
  const rootDirectoryPath = await mkdtemp(path.join(tmpdir(), 'cv-maxxing-settings-'));

  temporaryDirectories.push(rootDirectoryPath);

  return createLocalAppDataPaths(rootDirectoryPath);
}

function createKeychainBoundary(secret = Buffer.alloc(32, 7)): KeychainBoundary {
  return {
    clearAppDataKey: vi.fn(() => Promise.resolve()),
    getOrCreateAppDataKey: vi.fn(() => Promise.resolve(secret)),
  };
}

test('returns a provider-neutral settings snapshot with only visible settings data', async () => {
  const paths = await createTestPaths();
  const store = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  });
  const settings = createSettingsService({
    browserSessionRootPath: path.join(paths.rootDirectoryPath, 'browser-sessions'),
    getAppVersion: () => '1.2.3',
    localAppData: store,
    workerCommand: 'codex',
  });

  await expect(settings.getSettingsSnapshot()).resolves.toEqual({
    appVersion: '1.2.3',
    workerCommand: 'codex',
    workerProvider: 'codex',
  });

  await store.close();
});

test('clears only app-managed job-site browser data and keeps local workspace data intact', async () => {
  const paths = await createTestPaths();
  const store = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  });
  const browserStoragePath = path.join(
    paths.rootDirectoryPath,
    'browser-sessions',
    'vacancy-browser-session',
    'Local Storage',
    'leveldb',
    '000003.log',
  );
  const settings = createSettingsService({
    browserSessionRootPath: path.join(paths.rootDirectoryPath, 'browser-sessions'),
    getAppVersion: () => '1.0.0',
    localAppData: store,
  });

  await store.metadata.put({
    id: 'original-cv-123',
    scope: 'original-cvs',
    value: {
      originalFilename: 'ada-lovelace.pdf',
    },
  });
  await store.artifacts.write({
    content: Buffer.from('tailored artifact', 'utf8'),
    id: 'tailored-application-123',
    name: 'adapted-cv.pdf',
    scope: 'tailored-applications',
  });
  await mkdir(path.dirname(browserStoragePath), {
    recursive: true,
  });
  await writeFile(browserStoragePath, 'browser session token', 'utf8');

  await settings.clearJobSiteBrowserData();

  await expect(access(browserStoragePath)).rejects.toThrow();
  await expect(
    store.metadata.get({
      id: 'original-cv-123',
      scope: 'original-cvs',
    }),
  ).resolves.toEqual({
    originalFilename: 'ada-lovelace.pdf',
  });
  await expect(
    store.artifacts.list({
      id: 'tailored-application-123',
      scope: 'tailored-applications',
    }),
  ).resolves.toEqual(['adapted-cv.pdf']);

  await store.close();
});

test('requires an explicit destructive confirmation phrase before resetting local app data', async () => {
  const paths = await createTestPaths();
  const keychain = createKeychainBoundary();
  const store = await openLocalAppData({
    keychain,
    paths,
  });
  const closeActiveJobs = vi.fn(() => Promise.resolve());
  const restartApp = vi.fn(() => Promise.resolve());
  const settings = createSettingsService({
    browserSessionRootPath: path.join(paths.rootDirectoryPath, 'browser-sessions'),
    closeActiveJobs,
    getAppVersion: () => '1.0.0',
    localAppData: store,
    restartApp,
  });

  await expect(
    settings.resetLocalAppData({
      confirmationPhrase: 'WRONG',
    }),
  ).rejects.toBeInstanceOf(InvalidLocalDataResetConfirmationError);
  expect(closeActiveJobs).not.toHaveBeenCalled();
  expect(restartApp).not.toHaveBeenCalled();
  expect(keychain.clearAppDataKey).not.toHaveBeenCalled();

  await store.close();
});

test('resets encrypted metadata, artifacts, run workspaces, and browser session data after confirmation', async () => {
  const paths = await createTestPaths();
  const keychain = createKeychainBoundary();
  const store = await openLocalAppData({
    keychain,
    paths,
  });
  const runWorkspaceFilePath = path.join(
    paths.rootDirectoryPath,
    'runs',
    'run-123',
    'output',
    'result.json',
  );
  const browserStoragePath = path.join(
    paths.rootDirectoryPath,
    'browser-sessions',
    'vacancy-browser-session',
    'Cookies',
  );
  const closeActiveJobs = vi.fn(() => Promise.resolve());
  const restartApp = vi.fn(() => Promise.resolve());
  const settings = createSettingsService({
    browserSessionRootPath: path.join(paths.rootDirectoryPath, 'browser-sessions'),
    closeActiveJobs,
    getAppVersion: () => '1.0.0',
    localAppData: store,
    restartApp,
  });

  await store.metadata.put({
    id: 'tailored-application-123',
    scope: 'tailored-applications',
    value: {
      status: 'ready',
    },
  });
  await store.artifacts.write({
    content: Buffer.from('sensitive cover letter', 'utf8'),
    id: 'tailored-application-123',
    name: 'cover-letter.pdf',
    scope: 'tailored-applications',
  });
  await mkdir(path.dirname(runWorkspaceFilePath), {
    recursive: true,
  });
  await writeFile(runWorkspaceFilePath, '{}', 'utf8');
  await mkdir(path.dirname(browserStoragePath), {
    recursive: true,
  });
  await writeFile(browserStoragePath, 'cookie', 'utf8');

  await settings.resetLocalAppData({
    confirmationPhrase: SETTINGS_RESET_CONFIRMATION_PHRASE,
  });

  expect(closeActiveJobs).toHaveBeenCalledTimes(1);
  expect(restartApp).toHaveBeenCalledTimes(1);
  expect(keychain.clearAppDataKey).toHaveBeenCalledTimes(1);
  await expect(store.metadata.list('tailored-applications')).resolves.toEqual([]);
  await expect(
    store.artifacts.list({
      id: 'tailored-application-123',
      scope: 'tailored-applications',
    }),
  ).resolves.toEqual([]);
  await expect(access(runWorkspaceFilePath)).rejects.toThrow();
  await expect(access(browserStoragePath)).rejects.toThrow();

  await store.close();
});

test('surfaces the configured reset failure before clearing local app data', async () => {
  const closeActiveJobs = vi.fn(() => Promise.resolve());
  const localAppData = {
    reset: vi.fn(() => Promise.resolve()),
  };
  const restartApp = vi.fn(() => Promise.resolve());
  const settings = createSettingsService({
    allowResetLocalAppDataErrorMessage: true,
    browserSessionRootPath: path.join(tmpdir(), 'cv-maxxing-settings-browser-sessions'),
    closeActiveJobs,
    getAppVersion: () => '1.0.0',
    localAppData,
    resetLocalAppDataErrorMessage: "We couldn't reset your app data right now. Try again.",
    restartApp,
  });

  await expect(
    settings.resetLocalAppData({
      confirmationPhrase: SETTINGS_RESET_CONFIRMATION_PHRASE,
    }),
  ).rejects.toThrow("We couldn't reset your app data right now. Try again.");
  expect(closeActiveJobs).not.toHaveBeenCalled();
  expect(localAppData.reset).not.toHaveBeenCalled();
  expect(restartApp).not.toHaveBeenCalled();
});
