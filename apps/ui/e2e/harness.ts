// The Task 22 harness (contract in harness-contract.ts): the gallery in Electron, a replaying bridge, the desktop app.
// Everything runs from the builds `pnpm test:ui` makes first; every Electron window stays hidden (`PITWALL_E2E=1`).
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { preview } from 'vite';
import type { BridgeHandle, GalleryHandle, LaunchPitwallOptions, PitwallApp, StartBridgeOptions } from './harness-contract.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const UI_DIR = path.join(REPO_ROOT, 'apps/ui');
const DESKTOP_DIR = path.join(REPO_ROOT, 'apps/desktop');
const BRIDGE_CLI = path.join(REPO_ROOT, 'apps/bridge/src/cli/pitwall.ts');
const GALLERY_MAIN = path.join(import.meta.dirname, 'gallery-main.cjs');
/** The Electron binary of the desktop app (the `electron` package exports its path). */
const ELECTRON = createRequire(path.join(DESKTOP_DIR, 'package.json'))('electron') as string;
const HOST = '127.0.0.1';

/** The gallery window; wide enough for the widest cell, its height only decides how much is laid out at once. */
const GALLERY_WINDOW = { width: 1600, height: 1000 };
/** How long a bridge, a window or a port may take. */
const START_TIMEOUT_MS = 30_000;
const POLL_MS = 100;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A TCP port nothing listens on right now. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, HOST, resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('no free port');
  return address.port;
}

/** The environment of a child: Playwright's own Node options (its loaders) stay with Playwright. */
function childEnv(extra: Record<string, string>): Record<string, string> {
  const inherited = Object.entries(process.env).filter((entry): entry is [string, string] => entry[0] !== 'NODE_OPTIONS' && entry[1] !== undefined);
  return { ...Object.fromEntries(inherited), ...extra };
}

/** Electron with the given app, every window hidden, one CSS pixel per device pixel (screenshots do not depend on the display). */
const launchElectron = (app: string, env: Record<string, string>): Promise<ElectronApplication> =>
  electron.launch({ executablePath: ELECTRON, args: ['--force-device-scale-factor=1', app], cwd: REPO_ROOT, env: childEnv({ PITWALL_E2E: '1', ...env }) });

/** The gallery of the build in `apps/ui/dist`, served by Vite's preview server (the gallery needs the path `/gallery`). */
export async function openGallery(): Promise<GalleryHandle> {
  const port = await freePort();
  const server = await preview({ root: UI_DIR, configFile: false, logLevel: 'warn', preview: { host: HOST, port, strictPort: true } });
  const app = await launchElectron(GALLERY_MAIN, {});
  const close = async (): Promise<void> => {
    await app.close();
    await server.close();
  };
  try {
    const opened = app.waitForEvent('window');
    // Offscreen rendering: a hidden window draws no frames, so Playwright's stability check before a screenshot
    // (which waits for animation frames) never finishes; an offscreen window draws them and is never shown.
    await app.evaluate(
      ({ BrowserWindow }, { url, size }) => {
        const win = new BrowserWindow({ ...size, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
        void win.loadURL(url);
      },
      { url: `http://${HOST}:${port}/gallery`, size: GALLERY_WINDOW },
    );
    const page = await opened;
    await page.waitForSelector('[data-gallery-id]');
    return { page, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** A recording by fixture name: a committed segment (`fixtures/segments/<name>.pwrec.gz`) or a full recording's id in `PITWALL_FIXTURES_DIR`. */
function recordingPath(name: string): string {
  const index = JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures/index.json'), 'utf8')) as {
    recordings: Array<{ id: string; file: string }>;
    segments: Array<{ file: string }>;
  };
  const segment = index.segments.find((s) => s.file === `${name}.pwrec.gz`);
  if (segment !== undefined) return path.join(REPO_ROOT, 'fixtures/segments', segment.file);
  const recording = index.recordings.find((r) => r.id === name);
  const dir = process.env['PITWALL_FIXTURES_DIR'] ?? path.join(REPO_ROOT, 'recordings');
  const file = recording === undefined ? undefined : path.join(dir, recording.file);
  if (file === undefined || !existsSync(file)) throw new Error(`no fixture "${name}" (fixtures/index.json, ${dir})`);
  return file;
}

/** `pitwall replay <recording> --paused`; resolves once it prints `listening`. Its stdout and stderr lines go to `lines`. */
function spawnBridge(file: string, env: Record<string, string>, lines: string[]): Promise<ChildProcess> {
  const child = spawn(process.execPath, [BRIDGE_CLI, 'replay', file, '--paused'], { cwd: REPO_ROOT, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`the bridge did not start in ${START_TIMEOUT_MS} ms:\n${lines.join('\n')}`));
    }, START_TIMEOUT_MS);
    const onExit = (code: number | null): void => {
      clearTimeout(timer);
      reject(new Error(`the bridge exited (${code}) before listening:\n${lines.join('\n')}`));
    };
    child.once('exit', onExit);
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on('line', (line) => {
        lines.push(line);
        if (line.startsWith('listening ws://')) {
          clearTimeout(timer);
          child.off('exit', onExit);
          resolve(child);
        }
      });
    }
  });
}

/** Stops the bridge with SIGTERM; resolves once it has exited (its port is free by then). */
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await exited;
}

/**
 * A bridge replaying `recording` paused, on a free `PITWALL_WS_PORT`. `log()` holds its stdout and stderr lines:
 * the pino lines (`ws subscribe` among them) go to stderr, `listening` to stdout.
 */
export async function startBridge(options: StartBridgeOptions): Promise<BridgeHandle> {
  const file = recordingPath(options.recording);
  const wsPort = await freePort();
  const env: Record<string, string> = {
    PITWALL_WS_PORT: String(wsPort),
    PITWALL_DATA_DIR: options.dataDir,
    ...(options.insight !== undefined && { PITWALL_E2E_INSIGHT: options.insight }),
  };
  let lines: string[] = [];
  let child = await spawnBridge(file, env, lines);
  return {
    wsPort,
    stop: () => stopChild(child),
    restart: async () => {
      await stopChild(child);
      lines = [];
      child = await spawnBridge(file, env, lines);
    },
    log: () => [...lines],
  };
}

/** The built desktop app (not `--dev`); it finds the running bridge by its probe, so no bridge command is passed. */
export async function launchPitwall(options: LaunchPitwallOptions): Promise<PitwallApp> {
  const app = await launchElectron(DESKTOP_DIR, { PITWALL_WS_PORT: String(options.wsPort), PITWALL_DATA_DIR: options.dataDir });
  const isWindow = (page: Page, id: string): boolean => {
    const url = page.url();
    return url.includes('?') && new URLSearchParams(url.slice(url.indexOf('?'))).get('window') === id;
  };
  return {
    window: async (id) => {
      for (const deadline = Date.now() + START_TIMEOUT_MS; Date.now() < deadline; await sleep(POLL_MS)) {
        const page = app.windows().find((p) => isWindow(p, id));
        if (page !== undefined) {
          await page.waitForLoadState('load');
          return page;
        }
      }
      throw new Error(`no window "${id}" within ${START_TIMEOUT_MS} ms (open: ${app.windows().map((p) => p.url()).join(', ')})`);
    },
    close: () => app.close(),
  };
}
