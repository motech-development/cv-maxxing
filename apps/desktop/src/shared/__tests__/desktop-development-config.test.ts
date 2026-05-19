import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, test, vi } from 'vitest';

const currentDirectoryPath = path.dirname(fileURLToPath(import.meta.url));
const desktopPackageJsonPath = path.resolve(currentDirectoryPath, '../../../package.json');
const desktopDevelopmentLauncherPath = path.resolve(
  currentDirectoryPath,
  '../../../scripts/development.mjs',
);

interface DesktopPackageManifest {
  scripts: Record<string, string>;
}

interface DevelopmentLauncherHandle {
  shutdown: (exitCode?: number) => void;
}

interface DevelopmentLauncherDependencies {
  environment: Record<string, string | undefined>;
  setExitCode: (exitCode: number) => void;
  signalTarget: {
    on: (signal: 'SIGINT' | 'SIGTERM', handler: () => void) => void;
  };
  spawnProcess: SpawnProcess;
  stderr: WritableDouble;
  stdout: WritableDouble;
}

interface DevelopmentLauncherModule {
  runDevelopmentLauncher: (
    dependencies: DevelopmentLauncherDependencies,
  ) => Promise<DevelopmentLauncherHandle>;
}

interface SpawnOptions {
  env?: Record<string, string | undefined>;
  stdio?: string[];
}

interface SpawnCall {
  args: string[];
  command: string;
  options: SpawnOptions;
}

interface WritableDouble {
  write: (text: string) => void;
}

type DataHandler = (data: Buffer) => void;
type ErrorHandler = (error: Error) => void;
type ExitHandler = (code: number | null, signal: NodeJS.Signals | null) => void;
type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcessDouble;

interface ChildProcessDouble {
  kill: (signal: NodeJS.Signals) => void;
  on: (event: 'error' | 'exit', handler: ErrorHandler | ExitHandler) => ChildProcessDouble;
  stderr: {
    on: (event: 'data', handler: DataHandler) => ChildProcessDouble;
  };
  stdout: {
    on: (event: 'data', handler: DataHandler) => ChildProcessDouble;
  };
}

const readDesktopPackageManifest = (): DesktopPackageManifest =>
  JSON.parse(readFileSync(desktopPackageJsonPath, 'utf8')) as DesktopPackageManifest;

function createChildProcessDouble() {
  const stdoutDataHandlers: DataHandler[] = [];
  const stderrDataHandlers: DataHandler[] = [];
  const exitHandlers: ExitHandler[] = [];
  const errorHandlers: ErrorHandler[] = [];
  const childProcess: ChildProcessDouble = {
    kill: vi.fn(),
    on: (event, handler) => {
      if (event === 'exit') {
        exitHandlers.push(handler as ExitHandler);

        return childProcess;
      }

      errorHandlers.push(handler as ErrorHandler);

      return childProcess;
    },
    stderr: {
      on: (_event, handler) => {
        stderrDataHandlers.push(handler);

        return childProcess;
      },
    },
    stdout: {
      on: (_event, handler) => {
        stdoutDataHandlers.push(handler);

        return childProcess;
      },
    },
  };

  return {
    childProcess,
    emitExit: (code: number | null, signal: NodeJS.Signals | null = null) => {
      for (const handler of exitHandlers) {
        handler(code, signal);
      }
    },
    emitStderr: (text: string) => {
      for (const handler of stderrDataHandlers) {
        handler(Buffer.from(text));
      }
    },
    emitStdout: (text: string) => {
      for (const handler of stdoutDataHandlers) {
        handler(Buffer.from(text));
      }
    },
    emitError: (error: Error) => {
      for (const handler of errorHandlers) {
        handler(error);
      }
    },
  };
}

describe('desktop development workflow', () => {
  test('runs the Electron app through the Vite-backed development launcher', () => {
    const packageManifest = readDesktopPackageManifest();

    expect(packageManifest.scripts.dev).toBe('node scripts/development.mjs');
  });

  test('launches Electron against a Vite dev server URL for renderer HMR', async () => {
    const developmentLauncher = (await import(
      pathToFileURL(desktopDevelopmentLauncherPath).href
    )) as DevelopmentLauncherModule;
    const spawnedProcesses: ReturnType<typeof createChildProcessDouble>[] = [];
    const spawnCalls: SpawnCall[] = [];
    const environment = {
      CV_MAXXING_MAIN_WINDOW_SHOW: 'false',
      PATH: '/usr/bin',
    };
    const exitCodes: number[] = [];
    const signalHandlers = new Map<'SIGINT' | 'SIGTERM', () => void>();
    const spawnProcess: SpawnProcess = (command, args, options) => {
      const processDouble = createChildProcessDouble();

      spawnedProcesses.push(processDouble);
      spawnCalls.push({
        args,
        command,
        options,
      });

      return processDouble.childProcess;
    };
    const signalTarget = {
      on: (signal: 'SIGINT' | 'SIGTERM', handler: () => void) => {
        signalHandlers.set(signal, handler);
      },
    };
    const launcherPromise = developmentLauncher.runDevelopmentLauncher({
      environment,
      setExitCode: (exitCode) => {
        exitCodes.push(exitCode);
      },
      signalTarget,
      spawnProcess,
      stderr: {
        write: vi.fn(),
      },
      stdout: {
        write: vi.fn(),
      },
    });

    expect(spawnCalls[0]).toEqual({
      args: ['build:main'],
      command: 'pnpm',
      options: {
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    });

    spawnedProcesses[0]?.emitExit(0);

    await Promise.resolve();

    expect(spawnCalls[1]).toEqual({
      args: ['build:main', '--watch', '--preserveWatchOutput'],
      command: 'pnpm',
      options: {
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    });
    expect(spawnCalls[2]).toEqual({
      args: ['exec', 'vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
      command: 'pnpm',
      options: {
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    });

    spawnedProcesses[2]?.emitStdout('Local: http://127.0.0.1:5173/\n');

    const launcherHandle = await launcherPromise;

    expect(spawnCalls[3]).toEqual({
      args: ['.'],
      command: 'electron',
      options: {
        env: {
          ...environment,
          CV_MAXXING_RENDERER_URL: 'http://127.0.0.1:5173',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    });
    expect(signalHandlers.has('SIGINT')).toBe(true);
    expect(signalHandlers.has('SIGTERM')).toBe(true);

    launcherHandle.shutdown(0);

    expect(spawnedProcesses[1]?.childProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawnedProcesses[2]?.childProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawnedProcesses[3]?.childProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(exitCodes).toEqual([0]);
  });
});
