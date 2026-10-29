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
/** The gallery-enabled build `pnpm test:ui` makes next to the plain `dist` (which the desktop app loads). */
const GALLERY_DIST = 'dist-e2e';
const DESKTOP_DIR = path.join(REPO_ROOT, 'apps/desktop');
const BRIDGE_CLI = path.join(REPO_ROOT, 'apps/bridge/src/cli/pitwall.ts');
const GALLERY_MAIN = path.join(import.meta.dirname, 'gallery-main.cjs');
/** The Electron binary of the desktop app (the `electron` package exports its path). */
const ELECTRON = createRequire(path.join(DESKTOP_DIR, 'package.json'))('electron') as string;
const HOST = '127.0.0.1';

/** The gallery window; wide enough for the widest cell, its height only decides how much is laid out at once. */
const GALLERY_WINDOW = { width: 1600, height: 1000 };
/** How long a bridge, a window, a port or the gallery's lazy parts may take. */
const START_TIMEOUT_MS = 30_000;
/** How long a bridge has to exit after SIGTERM before it gets SIGKILL. */
const STOP_TIMEOUT_MS = 5_000;
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

/** Electron with the given app and Chromium `flags`, every window hidden, one CSS pixel per device pixel (screenshots do not depend on the display). */
const launchElectron = (app: string, env: Record<string, string>, flags: string[] = []): Promise<ElectronApplication> =>
  electron.launch({ executablePath: ELECTRON, args: ['--force-device-scale-factor=1', ...flags, app], cwd: REPO_ROOT, env: childEnv({ PITWALL_E2E: '1', ...env }) });

/**
 * The gallery of the build in `apps/ui/dist-e2e`, served by Vite's preview server (the gallery needs the path
 * `/gallery`). The page is handed over once every cell is `data-ready`, i.e. its lazily loaded parts have rendered.
 */
export async function openGallery(): Promise<GalleryHandle> {
  const port = await freePort();
  const server = await preview({ root: UI_DIR, configFile: false, logLevel: 'warn', build: { outDir: GALLERY_DIST }, preview: { host: HOST, port, strictPort: true } });
  // No GPU: an offscreen window's screenshot leaves out GPU-drawn canvases (the kit chart came out empty). The app's
  // hidden windows need the GPU, though: without it they never lay out their panels.
  const app = await launchElectron(GALLERY_MAIN, {}, ['--disable-gpu']);
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
    await page.waitForFunction(() => [...document.querySelectorAll('[data-gallery-id]')].every((cell) => cell.hasAttribute('data-ready')), undefined, {
      timeout: START_TIMEOUT_MS,
    });
    return { page, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** A recording by fixture name: a committed segment (`fixtures/segments/<name>.pwrec.gz`) or a full recording's id in `PITWALL_FIXTURES_DIR`. */
function recordingPath(name: string): string {
  const index = JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures/index.json'), 'utf8')) as {
    fixtures: Array<{ id: string; file: string }>;
    segments: Array<{ file: string }>;
  };
  const segment = index.segments.find((s) => s.file === `${name}.pwrec.gz`);
  if (segment !== undefined) return path.join(REPO_ROOT, 'fixtures/segments', segment.file);
  const recording = index.fixtures.find((r) => r.id === name);
  const dir = process.env['PITWALL_FIXTURES_DIR'] ?? path.join(REPO_ROOT, 'recordings');
  const file = recording === undefined ? undefined : path.join(dir, recording.file);
  if (file === undefined || !existsSync(file)) throw new Error(`no fixture "${name}" (fixtures/index.json, ${dir})`);
  return file;
}

/** Every bridge still running; killed when the test process exits, so a failing spec leaves no `pitwall replay` behind. */
const bridges = new Set<ChildProcess>();
process.once('exit', () => {
  for (const child of bridges) child.kill('SIGKILL');
});

/**
 * `pitwall replay <recording> --paused`, with the WebSocket server's log at debug (its `ws subscribe` lines carry
 * `params` only there); resolves once it prints `listening`. Its stdout and stderr lines go to `lines`.
 */
function spawnBridge(file: string, env: Record<string, string>, lines: string[]): Promise<ChildProcess> {
  const child = spawn(process.execPath, [BRIDGE_CLI, 'replay', file, '--paused'], {
    cwd: REPO_ROOT,
    env: childEnv({ PITWALL_WS_LOG_LEVEL: 'debug', ...env }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridges.add(child);
  child.once('exit', () => bridges.delete(child));
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

/** Stops the bridge with SIGTERM, SIGKILL after STOP_TIMEOUT_MS; resolves once it has exited (its port is free by then). */
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
  await exited;
  clearTimeout(timer);
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
