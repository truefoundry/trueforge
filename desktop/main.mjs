/**
 * Starts the built standalone TrueForge server and opens its bundled UI in Electron.
 * This is the same single-process topology used by `npx @truefoundry/trueforge`:
 * Hono API + static frontend + SQLite, all on localhost.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, dialog } from 'electron';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDirectory = app.isPackaged
  ? path.join(process.resourcesPath, 'harness')
  : path.join(repoRoot, 'packages/trueforge');
const serverEntry = path.join(serverDirectory, 'dist/main.js');
const envFile = app.isPackaged ? undefined : path.join(serverDirectory, '.env');
const bundledNodeExecutable = path.join(process.resourcesPath, 'node/bin/node');
const defaultPort = 8790;
const healthTimeoutMs = 60_000;

let serverProcess;
let ownsServerProcess = false;
let quitting = false;

function resolvePort() {
  const rawPort = process.env['PORT'];
  if (rawPort === undefined || rawPort.trim() === '') {
    return defaultPort;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${rawPort}"`);
  }
  return port;
}

function serverOrigin(port) {
  return `http://127.0.0.1:${String(port)}`;
}

async function isHealthy(port) {
  try {
    const response = await fetch(`${serverOrigin(port)}/healthz`);
    return response.ok;
  } catch {
    return false;
  }
}

function delay(milliseconds) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + healthTimeoutMs;
  while (Date.now() < deadline) {
    if (serverProcess?.exitCode !== null && serverProcess?.exitCode !== undefined) {
      throw new Error(`TrueForge server exited with code ${String(serverProcess.exitCode)} before becoming ready`);
    }
    if (await isHealthy(port)) {
      return;
    }
    await delay(200);
  }

  throw new Error(
    `TrueForge did not become ready at ${serverOrigin(port)}/healthz within ${String(healthTimeoutMs / 1000)} seconds`,
  );
}

function startServer(port) {
  if (!existsSync(serverEntry)) {
    throw new Error(
      app.isPackaged
        ? `The app is missing its bundled TrueForge server at ${serverEntry}`
        : `Missing ${serverEntry}. Run \`pnpm desktop:build\` first.`,
    );
  }

  const nodeExecutable = app.isPackaged ? bundledNodeExecutable : (process.env['npm_node_execpath'] ?? 'node');
  if (!existsSync(nodeExecutable) && app.isPackaged) {
    throw new Error(`Missing bundled Node executable at ${nodeExecutable}`);
  }
  const nodeArgs = envFile !== undefined && existsSync(envFile) ? ['--env-file=.env', serverEntry] : [serverEntry];
  const child = spawn(nodeExecutable, nodeArgs, {
    cwd: serverDirectory,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      PORT: String(port),
      STANDALONE: 'true',
    },
    stdio: 'inherit',
  });

  child.on('error', error => {
    console.error('Failed to start the TrueForge server', error);
  });
  child.on('exit', (code, signal) => {
    if (quitting) {
      return;
    }
    console.error(
      signal === null
        ? `TrueForge server exited with code ${String(code)}`
        : `TrueForge server exited after signal ${signal}`,
    );
  });

  return child;
}

function stopServer() {
  if (!ownsServerProcess || serverProcess === undefined || serverProcess.killed) {
    return;
  }
  serverProcess.kill('SIGTERM');
}

function createWindow(port) {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'TrueForge',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void window.loadURL(serverOrigin(port));
}

async function boot() {
  const port = resolvePort();
  if (await isHealthy(port)) {
    console.log(`Using the TrueForge server already running at ${serverOrigin(port)}`);
  } else {
    serverProcess = startServer(port);
    ownsServerProcess = true;
    await waitForServer(port);
  }
  createWindow(port);
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  stopServer();
});

function handleStartupError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  dialog.showErrorBox('TrueForge failed to start', message);
  stopServer();
  app.exit(1);
}

void app.whenReady().then(boot).catch(handleStartupError);
