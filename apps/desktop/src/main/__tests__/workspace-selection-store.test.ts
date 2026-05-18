import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { createLocalAppDataPaths, openLocalAppData } from '../local-app-data-service.js';
import { createWorkspaceSelectionStore } from '../workspace-selection-store.js';

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

test('persists the selected top-level section alongside jobs and original-CV nested selections', async () => {
  const rootDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-workspace-selection-store-'),
  );

  temporaryDirectories.push(rootDirectoryPath);

  const paths = createLocalAppDataPaths(rootDirectoryPath);
  const firstStore = await openLocalAppData({
    keychain: {
      clearAppDataKey: vi.fn(() => Promise.resolve()),
      getOrCreateAppDataKey: vi.fn(() => Promise.resolve(Buffer.alloc(32, 9))),
    },
    paths,
  });
  const firstWorkspaceSelectionStore = createWorkspaceSelectionStore({
    localAppData: firstStore,
  });

  await firstWorkspaceSelectionStore.setSelection({
    jobs: {
      kind: 'tailored_application',
      tailoredApplicationId: 'tailored-application-123',
    },
    originalCv: {
      kind: 'active_original_cv',
      originalCvId: 'original-cv-123',
    },
    topLevelSection: 'original_cv',
  });
  await firstStore.close();

  const secondStore = await openLocalAppData({
    keychain: {
      clearAppDataKey: vi.fn(() => Promise.resolve()),
      getOrCreateAppDataKey: vi.fn(() => Promise.resolve(Buffer.alloc(32, 9))),
    },
    paths,
  });
  const secondWorkspaceSelectionStore = createWorkspaceSelectionStore({
    localAppData: secondStore,
  });

  await expect(secondWorkspaceSelectionStore.getSelection()).resolves.toEqual({
    jobs: {
      kind: 'tailored_application',
      tailoredApplicationId: 'tailored-application-123',
    },
    originalCv: {
      kind: 'active_original_cv',
      originalCvId: 'original-cv-123',
    },
    topLevelSection: 'original_cv',
  });

  await secondStore.close();
});

test('normalizes legacy jobs-only persisted selection into the generalized workspace contract', async () => {
  const rootDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-workspace-selection-store-'),
  );

  temporaryDirectories.push(rootDirectoryPath);

  const paths = createLocalAppDataPaths(rootDirectoryPath);
  const store = await openLocalAppData({
    keychain: {
      clearAppDataKey: vi.fn(() => Promise.resolve()),
      getOrCreateAppDataKey: vi.fn(() => Promise.resolve(Buffer.alloc(32, 9))),
    },
    paths,
  });

  await store.metadata.put({
    id: 'current',
    scope: 'workspace-selection',
    value: {
      kind: 'tailored_application',
      tailoredApplicationId: 'tailored-application-legacy',
    },
  });

  const workspaceSelectionStore = createWorkspaceSelectionStore({
    localAppData: store,
  });

  await expect(workspaceSelectionStore.getSelection()).resolves.toEqual({
    jobs: {
      kind: 'tailored_application',
      tailoredApplicationId: 'tailored-application-legacy',
    },
    originalCv: {
      kind: 'none',
    },
    topLevelSection: 'job_vacancies',
  });

  await store.close();
});

test('normalizes legacy original-CV selections that predate originalCvId persistence', async () => {
  const rootDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-workspace-selection-store-'),
  );

  temporaryDirectories.push(rootDirectoryPath);

  const paths = createLocalAppDataPaths(rootDirectoryPath);
  const store = await openLocalAppData({
    keychain: {
      clearAppDataKey: vi.fn(() => Promise.resolve()),
      getOrCreateAppDataKey: vi.fn(() => Promise.resolve(Buffer.alloc(32, 9))),
    },
    paths,
  });

  await store.metadata.put({
    id: 'current',
    scope: 'workspace-selection',
    value: {
      jobs: {
        kind: 'none',
      },
      originalCv: {
        kind: 'active_original_cv',
      },
      topLevelSection: 'original_cv',
    },
  });

  const workspaceSelectionStore = createWorkspaceSelectionStore({
    localAppData: store,
  });

  await expect(workspaceSelectionStore.getSelection()).resolves.toEqual({
    jobs: {
      kind: 'none',
    },
    originalCv: {
      kind: 'active_original_cv',
      originalCvId: null,
    },
    topLevelSection: 'original_cv',
  });

  await store.close();
});
