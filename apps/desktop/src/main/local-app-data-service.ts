import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { and, eq } from 'drizzle-orm';
import { type AsyncRemoteCallback, drizzle } from 'drizzle-orm/sqlite-proxy';

import { metadataEntries } from './local-app-data-schema.js';

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue = JsonObject | JsonValue[] | boolean | null | number | string;

export interface LocalAppDataPaths {
  artifactsRoot: string;
  databasePath: string;
  keychainRecordPath: string;
  rootDirectoryPath: string;
}

export interface KeychainBoundary {
  clearAppDataKey: () => Promise<void>;
  getOrCreateAppDataKey: () => Promise<Buffer>;
}

export interface MetadataRecord<TValue extends JsonValue = JsonValue> {
  id: string;
  value: TValue;
}

export interface MetadataSelector {
  id: string;
  scope: string;
}

export interface MetadataPutInput<TValue extends JsonValue = JsonValue> extends MetadataSelector {
  value: TValue;
}

export interface ArtifactSelector extends MetadataSelector {
  name?: string;
}

export interface ArtifactWriteInput extends MetadataSelector {
  content: Buffer;
  name: string;
}

export interface LocalAppDataStore {
  artifacts: {
    delete: (selector: Required<ArtifactSelector>) => Promise<void>;
    list: (selector: ArtifactSelector) => Promise<string[]>;
    read: (selector: Required<ArtifactSelector>) => Promise<Buffer | null>;
    write: (input: ArtifactWriteInput) => Promise<void>;
  };
  close: () => Promise<void>;
  deleteScopedData: (selector: MetadataSelector) => Promise<void>;
  metadata: {
    delete: (selector: MetadataSelector) => Promise<void>;
    get: <TValue extends JsonValue = JsonValue>(
      selector: MetadataSelector,
    ) => Promise<TValue | null>;
    list: <TValue extends JsonValue = JsonValue>(
      scope: string,
    ) => Promise<MetadataRecord<TValue>[]>;
    put: <TValue extends JsonValue = JsonValue>(input: MetadataPutInput<TValue>) => Promise<void>;
  };
  reset: () => Promise<void>;
}

export class LocalAppDataUnlockError extends Error {
  override name = 'LocalAppDataUnlockError';
}

interface StorageContext {
  artifacts: EncryptedArtifactStore;
  database: SqlcipherDatabase;
  metadata: SqlcipherMetadataStore;
}

interface SqlcipherModule {
  Database: new (
    filename: string,
    mode: number,
    callback?: (error: Error | null) => void,
  ) => SqlcipherDatabase;
  OPEN_CREATE: number;
  OPEN_READWRITE: number;
}

interface SqlcipherDatabase {
  all: (
    sql: string,
    parameters: unknown[] | ((error: Error | null, rows: unknown[]) => void),
    callback?: (error: Error | null, rows: unknown[]) => void,
  ) => void;
  close: (callback?: (error: Error | null) => void) => void;
  get: (
    sql: string,
    parameters: unknown[] | ((error: Error | null, row?: unknown) => void),
    callback?: (error: Error | null, row?: unknown) => void,
  ) => void;
  run: (
    sql: string,
    parameters: unknown[] | ((error: Error | null) => void),
    callback?: (error: Error | null) => void,
  ) => void;
}

type DrizzleMetadataDatabase = ReturnType<typeof createDrizzleMetadataDatabase>;

const CIPHER_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_VERSION = 1;
const INITIALIZATION_VECTOR_LENGTH = 12;
const AUTHENTICATION_TAG_LENGTH = 16;
const require = createRequire(import.meta.url);
const localAppDataSchema = {
  metadataEntries,
};

export function createLocalAppDataPaths(rootDirectoryPath: string): LocalAppDataPaths {
  return {
    artifactsRoot: path.join(rootDirectoryPath, 'artifacts'),
    databasePath: path.join(rootDirectoryPath, 'app.db'),
    keychainRecordPath: path.join(rootDirectoryPath, 'app-data-key.bin'),
    rootDirectoryPath,
  };
}

export async function openLocalAppData({
  keychain,
  paths,
}: {
  keychain: KeychainBoundary;
  paths: LocalAppDataPaths;
}): Promise<LocalAppDataStore> {
  let context = await initializeStorageContext({
    keychain,
    paths,
  });

  return {
    artifacts: {
      delete: (selector) => {
        return context.artifacts.delete(selector);
      },
      list: (selector) => {
        return context.artifacts.list(selector);
      },
      read: (selector) => {
        return context.artifacts.read(selector);
      },
      write: (input) => {
        return context.artifacts.write(input);
      },
    },
    close: () => {
      return closeSqlcipherDatabase(context.database);
    },
    deleteScopedData: async (selector) => {
      await context.metadata.delete(selector);
      await context.artifacts.deleteScope(selector);
    },
    metadata: {
      delete: (selector) => {
        return context.metadata.delete(selector);
      },
      get: (selector) => {
        return context.metadata.get(selector);
      },
      list: (scope) => {
        return context.metadata.list(scope);
      },
      put: (input) => {
        return context.metadata.put(input);
      },
    },
    reset: async () => {
      await closeSqlcipherDatabase(context.database);
      await rm(paths.rootDirectoryPath, {
        force: true,
        recursive: true,
      });
      await keychain.clearAppDataKey();

      context = await initializeStorageContext({
        keychain,
        paths,
      });
    },
  };
}

async function initializeStorageContext({
  keychain,
  paths,
}: {
  keychain: KeychainBoundary;
  paths: LocalAppDataPaths;
}): Promise<StorageContext> {
  let secretKey: Buffer;

  try {
    secretKey = await keychain.getOrCreateAppDataKey();
  } catch (error) {
    throw new LocalAppDataUnlockError('Failed to unlock local app data.', {
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (secretKey.byteLength !== 32) {
    throw new LocalAppDataUnlockError('The local app-data key is invalid.');
  }

  await mkdir(paths.rootDirectoryPath, {
    recursive: true,
  });
  await mkdir(paths.artifactsRoot, {
    recursive: true,
  });

  const database = await openSqlcipherDatabase({
    databasePath: paths.databasePath,
    secretKey,
  });

  return {
    artifacts: new EncryptedArtifactStore({
      artifactsRoot: paths.artifactsRoot,
      secretKey,
    }),
    database,
    metadata: new SqlcipherMetadataStore({
      database: createDrizzleMetadataDatabase(database),
    }),
  };
}

async function openSqlcipherDatabase({
  databasePath,
  secretKey,
}: {
  databasePath: string;
  secretKey: Buffer;
}): Promise<SqlcipherDatabase> {
  const sqlcipher = require('@journeyapps/sqlcipher') as SqlcipherModule;
  const database = await new Promise<SqlcipherDatabase>((resolve, reject) => {
    const connection = new sqlcipher.Database(
      databasePath,
      sqlcipher.OPEN_READWRITE | sqlcipher.OPEN_CREATE,
      (error) => {
        if (error !== null) {
          reject(error);

          return;
        }

        resolve(connection);
      },
    );
  });

  try {
    await runSql(database, 'PRAGMA cipher_compatibility = 4');
    await runSql(database, `PRAGMA key = "x'${secretKey.toString('hex')}'"`);
    await getSql(database, 'SELECT count(*) AS entry_count FROM sqlite_master');
    await runSql(
      database,
      `
        CREATE TABLE IF NOT EXISTS metadata_entries (
          scope TEXT NOT NULL,
          entry_id TEXT NOT NULL,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (scope, entry_id)
        )
      `,
    );
  } catch (error) {
    await closeSqlcipherDatabase(database).catch(() => null);

    throw new LocalAppDataUnlockError('Failed to unlock SQLCipher metadata storage.', {
      cause: error instanceof Error ? error : undefined,
    });
  }

  return database;
}

function createDrizzleMetadataDatabase(database: SqlcipherDatabase) {
  const callback: AsyncRemoteCallback = async (sql, params, method) => {
    return (await executeDrizzleQuery(database, sql, params, method)) as never;
  };

  return drizzle(callback, {
    schema: localAppDataSchema,
  });
}

async function executeDrizzleQuery(
  database: SqlcipherDatabase,
  sql: string,
  parameters: unknown[],
  method: 'run' | 'all' | 'values' | 'get',
): Promise<{ rows: unknown }> {
  if (method === 'run') {
    await runSql(database, sql, parameters);

    return {
      rows: [],
    };
  }

  if (method === 'get') {
    const row = await getSql(database, sql, parameters);

    return {
      rows: row === undefined ? undefined : toSqliteProxyRow(row),
    };
  }

  const rawRows = await allSql(database, sql, parameters);
  const rows = rawRows.map((row) => {
    return toSqliteProxyRow(row);
  });

  if (method === 'values') {
    return {
      rows,
    };
  }

  return {
    rows,
  };
}

function closeSqlcipherDatabase(database: SqlcipherDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    database.close((error) => {
      if (error !== null) {
        reject(error);

        return;
      }

      resolve();
    });
  });
}

function runSql(
  database: SqlcipherDatabase,
  sql: string,
  parameters: unknown[] = [],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const callback = (error: Error | null) => {
      if (error !== null) {
        reject(error);

        return;
      }

      resolve();
    };

    if (parameters.length === 0) {
      database.run(sql, callback);

      return;
    }

    database.run(sql, parameters, callback);
  });
}

function getSql(
  database: SqlcipherDatabase,
  sql: string,
  parameters: unknown[] = [],
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const callback = (error: Error | null, row?: unknown) => {
      if (error !== null) {
        reject(error);

        return;
      }

      resolve(row);
    };

    if (parameters.length === 0) {
      database.get(sql, callback);

      return;
    }

    database.get(sql, parameters, callback);
  });
}

function allSql(
  database: SqlcipherDatabase,
  sql: string,
  parameters: unknown[] = [],
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const callback = (error: Error | null, rows: unknown[]) => {
      if (error !== null) {
        reject(error);

        return;
      }

      resolve(rows);
    };

    if (parameters.length === 0) {
      database.all(sql, callback);

      return;
    }

    database.all(sql, parameters, callback);
  });
}

class SqlcipherMetadataStore {
  readonly #database: DrizzleMetadataDatabase;

  constructor({ database }: { database: DrizzleMetadataDatabase }) {
    this.#database = database;
  }

  async delete({ id, scope }: MetadataSelector): Promise<void> {
    await this.#database
      .delete(metadataEntries)
      .where(and(eq(metadataEntries.scope, scope), eq(metadataEntries.entryId, id)));
  }

  async get<TValue extends JsonValue = JsonValue>({
    id,
    scope,
  }: MetadataSelector): Promise<TValue | null> {
    const [row] = await this.#database
      .select({
        valueJson: metadataEntries.valueJson,
      })
      .from(metadataEntries)
      .where(and(eq(metadataEntries.scope, scope), eq(metadataEntries.entryId, id)))
      .limit(1);

    if (row === undefined) {
      return null;
    }

    return JSON.parse(row.valueJson) as TValue;
  }

  async list<TValue extends JsonValue = JsonValue>(
    scope: string,
  ): Promise<MetadataRecord<TValue>[]> {
    const rows = await this.#database
      .select({
        entryId: metadataEntries.entryId,
        valueJson: metadataEntries.valueJson,
      })
      .from(metadataEntries)
      .where(eq(metadataEntries.scope, scope))
      .orderBy(metadataEntries.entryId);

    return rows.map((row) => {
      return {
        id: row.entryId,
        value: JSON.parse(row.valueJson) as TValue,
      };
    });
  }

  async put<TValue extends JsonValue = JsonValue>({
    id,
    scope,
    value,
  }: MetadataPutInput<TValue>): Promise<void> {
    const updatedAt = new Date().toISOString();

    await this.#database
      .insert(metadataEntries)
      .values({
        entryId: id,
        scope,
        updatedAt,
        valueJson: JSON.stringify(value),
      })
      .onConflictDoUpdate({
        set: {
          updatedAt,
          valueJson: JSON.stringify(value),
        },
        target: [metadataEntries.scope, metadataEntries.entryId],
      });
  }
}

class EncryptedArtifactStore {
  readonly #artifactsRoot: string;

  readonly #secretKey: Buffer;

  constructor({ artifactsRoot, secretKey }: { artifactsRoot: string; secretKey: Buffer }) {
    this.#artifactsRoot = artifactsRoot;
    this.#secretKey = secretKey;
  }

  async delete({ id, name, scope }: Required<ArtifactSelector>): Promise<void> {
    const filePath = this.#artifactPath({
      id,
      name,
      scope,
    });
    const names = await this.#readManifest({
      id,
      scope,
    });

    await rm(filePath, {
      force: true,
    });

    if (!names.includes(name)) {
      return;
    }

    await this.#writeManifest({
      id,
      names: names.filter((artifactName) => artifactName !== name),
      scope,
    });
  }

  async deleteScope({ id, scope }: MetadataSelector): Promise<void> {
    await rm(
      this.#scopeDirectory({
        id,
        scope,
      }),
      {
        force: true,
        recursive: true,
      },
    );
  }

  list({ id, scope }: ArtifactSelector): Promise<string[]> {
    return this.#readManifest({
      id,
      scope,
    });
  }

  async read({ id, name, scope }: Required<ArtifactSelector>): Promise<Buffer | null> {
    const filePath = this.#artifactPath({
      id,
      name,
      scope,
    });

    try {
      const encryptedBytes = await readFile(filePath);

      return decryptBytes({
        payload: encryptedBytes,
        secretKey: this.#secretKey,
      });
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }

      throw error;
    }
  }

  async write({ content, id, name, scope }: ArtifactWriteInput): Promise<void> {
    const scopeDirectoryPath = this.#scopeDirectory({
      id,
      scope,
    });

    await mkdir(scopeDirectoryPath, {
      recursive: true,
    });

    const encryptedBytes = encryptBytes({
      payload: content,
      secretKey: this.#secretKey,
    });

    await writeFile(
      this.#artifactPath({
        id,
        name,
        scope,
      }),
      encryptedBytes,
    );

    const names = await this.#readManifest({
      id,
      scope,
    });

    if (!names.includes(name)) {
      await this.#writeManifest({
        id,
        names: [...names, name].toSorted((left, right) => {
          return left.localeCompare(right);
        }),
        scope,
      });
    }
  }

  #artifactPath({ id, name, scope }: Required<ArtifactSelector>): string {
    const fileName = createHash('sha256').update(name).digest('hex');

    return path.join(
      this.#scopeDirectory({
        id,
        scope,
      }),
      `${fileName}.bin`,
    );
  }

  async #readManifest({ id, scope }: MetadataSelector): Promise<string[]> {
    const filePath = path.join(
      this.#scopeDirectory({
        id,
        scope,
      }),
      'manifest.bin',
    );

    try {
      const encryptedBytes = await readFile(filePath);
      const decryptedBytes = decryptBytes({
        payload: encryptedBytes,
        secretKey: this.#secretKey,
      });
      const names = JSON.parse(decryptedBytes.toString('utf8')) as JsonValue;

      if (!Array.isArray(names)) {
        return [];
      }

      return names.filter((value): value is string => typeof value === 'string');
    } catch (error) {
      if (isMissingPathError(error)) {
        return [];
      }

      throw error;
    }
  }

  async #writeManifest({
    id,
    names,
    scope,
  }: {
    id: string;
    names: string[];
    scope: string;
  }): Promise<void> {
    const scopeDirectoryPath = this.#scopeDirectory({
      id,
      scope,
    });

    if (names.length === 0) {
      await rm(path.join(scopeDirectoryPath, 'manifest.bin'), {
        force: true,
      });

      return;
    }

    await mkdir(scopeDirectoryPath, {
      recursive: true,
    });

    const encryptedBytes = encryptBytes({
      payload: Buffer.from(JSON.stringify(names), 'utf8'),
      secretKey: this.#secretKey,
    });

    await writeFile(path.join(scopeDirectoryPath, 'manifest.bin'), encryptedBytes);
  }

  #scopeDirectory({ id, scope }: MetadataSelector): string {
    return path.join(this.#artifactsRoot, scope, id);
  }
}

function encryptBytes({ payload, secretKey }: { payload: Buffer; secretKey: Buffer }): Buffer {
  const initializationVector = randomBytes(INITIALIZATION_VECTOR_LENGTH);
  const cipher = createCipheriv(CIPHER_ALGORITHM, secretKey, initializationVector);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();

  return Buffer.concat([
    Buffer.from([ENCRYPTION_VERSION]),
    initializationVector,
    authenticationTag,
    ciphertext,
  ]);
}

function decryptBytes({ payload, secretKey }: { payload: Buffer; secretKey: Buffer }): Buffer {
  const version = payload.subarray(0, 1).readUint8(0);

  if (version !== ENCRYPTION_VERSION) {
    throw new Error('Unsupported encrypted payload version.');
  }

  const initializationVector = payload.subarray(1, 1 + INITIALIZATION_VECTOR_LENGTH);
  const authenticationTag = payload.subarray(
    1 + INITIALIZATION_VECTOR_LENGTH,
    1 + INITIALIZATION_VECTOR_LENGTH + AUTHENTICATION_TAG_LENGTH,
  );
  const ciphertext = payload.subarray(1 + INITIALIZATION_VECTOR_LENGTH + AUTHENTICATION_TAG_LENGTH);
  const decipher = createDecipheriv(CIPHER_ALGORITHM, secretKey, initializationVector);

  decipher.setAuthTag(authenticationTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

function toSqliteProxyRow(row: unknown): unknown[] {
  if (row === null || typeof row !== 'object') {
    return [];
  }

  return Object.values(row);
}
