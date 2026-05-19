#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rendererHost = '127.0.0.1';
const rendererPort = '5173';
const rendererUrl = `http://${rendererHost}:${rendererPort}`;

export async function runDevelopmentLauncher(dependencies = {}) {
  const {
    clearTimer = clearTimeout,
    environment = process.env,
    setExitCode = (exitCode) => {
      process.exitCode = exitCode;
    },
    setTimer = setTimeout,
    signalTarget = process,
    spawnProcess = spawn,
    stderr = process.stderr,
    stdout = process.stdout,
  } = dependencies;
  const managedProcesses = new Set();

  let isShuttingDown = false;

  function prefixOutput(label, data) {
    const text = data.toString();

    for (const line of text.split(/\r?\n/u)) {
      if (line.length > 0) {
        stdout.write(`[${label}] ${line}\n`);
      }
    }
  }

  function shutdown(exitCode = 0) {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;

    for (const childProcess of managedProcesses) {
      childProcess.kill('SIGTERM');
    }

    setExitCode(exitCode);
  }

  function spawnManaged(label, command, args, options = {}) {
    const childProcess = spawnProcess(command, args, {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });

    managedProcesses.add(childProcess);
    childProcess.stdout?.on('data', (data) => {
      prefixOutput(label, data);
    });
    childProcess.stderr?.on('data', (data) => {
      prefixOutput(label, data);
    });
    childProcess.on('exit', (code, signal) => {
      managedProcesses.delete(childProcess);

      if (!isShuttingDown && code !== 0) {
        stderr.write(`[${label}] exited with ${signal ?? `code ${code}`}\n`);
        shutdown(code ?? 1);
      }
    });

    return childProcess;
  }

  function runOnce(label, command, args) {
    return new Promise((resolve, reject) => {
      const childProcess = spawnProcess(command, args, {
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      childProcess.stdout?.on('data', (data) => {
        prefixOutput(label, data);
      });
      childProcess.stderr?.on('data', (data) => {
        prefixOutput(label, data);
      });
      childProcess.on('error', reject);
      childProcess.on('exit', (code, signal) => {
        if (code === 0) {
          resolve();

          return;
        }

        reject(new Error(`${label} exited with ${signal ?? `code ${code}`}.`));
      });
    });
  }

  function waitForOutput(childProcess, expectedText) {
    return new Promise((resolve, reject) => {
      const timeout = setTimer(() => {
        reject(new Error(`Timed out waiting for ${expectedText}.`));
      }, 30_000);

      const inspectOutput = (data) => {
        if (data.toString().includes(expectedText)) {
          clearTimer(timeout);
          resolve();
        }
      };

      childProcess.stdout?.on('data', inspectOutput);
      childProcess.stderr?.on('data', inspectOutput);
      childProcess.on('exit', (code, signal) => {
        clearTimer(timeout);
        reject(new Error(`Vite exited before becoming ready: ${signal ?? `code ${code}`}.`));
      });
    });
  }

  const handleShutdownSignal = () => {
    shutdown(0);
  };

  signalTarget.on('SIGINT', handleShutdownSignal);
  signalTarget.on('SIGTERM', handleShutdownSignal);

  try {
    await runOnce('main', 'pnpm', ['build:main']);

    spawnManaged('main', 'pnpm', ['build:main', '--watch', '--preserveWatchOutput']);

    const viteProcess = spawnManaged('renderer', 'pnpm', [
      'exec',
      'vite',
      '--host',
      rendererHost,
      '--port',
      rendererPort,
      '--strictPort',
    ]);

    await waitForOutput(viteProcess, rendererUrl);

    spawnManaged('electron', 'electron', ['.'], {
      env: {
        ...environment,
        CV_MAXXING_RENDERER_URL: rendererUrl,
      },
    });
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    shutdown(1);
  }

  return {
    shutdown,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runDevelopmentLauncher();
}
