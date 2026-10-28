// Electron main: one BrowserWindow per workbook window, the bridge attached or started, browser shortcuts blocked.
// Start: `electron . [--dev] [-- <bridge command>]`, e.g. `-- pitwall replay x.pwrec --realtime`.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import type { Rectangle } from 'electron';
import { ensureBridge } from './bridge-process.ts';
import type { BridgeHandle } from './bridge-process.ts';
import { isAllowedOpenPath, parseEnsureWindows } from './ipc-validate.ts';
import { planWindows } from './window-manager.ts';
import type { Display, Geometry, WindowId } from './window-manager.ts';

const WS_PORT = Number(process.env['PITWALL_WS_PORT'] ?? '4777');
const UI_PORT = Number(process.env['PITWALL_UI_PORT'] ?? '5173');
/** At most one geometry report per window in this time. */
const GEOMETRY_INTERVAL_MS = 500;
/** The window shown first, before the workbook says which windows it wants. */
const FIRST_WINDOW: WindowId = 'main';
/** Key combinations a browser would act on; blocked outside `--dev`. */
const BLOCKED_KEYS: ReadonlyArray<{ key: string; control?: boolean; shift?: boolean; alt?: boolean }> = [
  { key: 'w', control: true },
  { key: 'r', control: true },
  { key: 'F5' },
  { key: 'ArrowLeft', alt: true },
  { key: 'ArrowRight', alt: true },
  { key: 'i', control: true, shift: true },
];

const argv = process.argv.slice(2);
const separator = argv.indexOf('--');
const ownArgs = separator < 0 ? argv : argv.slice(0, separator);
/** The bridge command after `--`, command first; empty means `pitwall live`. */
const bridgeArgs = separator < 0 ? [] : argv.slice(separator + 1);
const dev = ownArgs.includes('--dev');
/** Test aid for the Playwright specs: `PITWALL_E2E=1` keeps every window hidden (still rendering), so a test run never shows windows on the desktop. */
const e2e = process.env['PITWALL_E2E'] === '1';
/** The repository root (this file is bundled to apps/desktop/dist/main.cjs). */
const repoRoot = path.resolve(__dirname, '../../..');

const windows = new Map<WindowId, BrowserWindow>();
let bridge: BridgeHandle | undefined;

/** True when a bridge accepts a WebSocket connection at `url` within `timeoutMs`. */
const probe = (url: string, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = new WebSocket(url);
    const done = (answered: boolean): void => {
      clearTimeout(timer);
      socket.close();
      resolve(answered);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.addEventListener('open', () => done(true));
    socket.addEventListener('error', () => done(false));
  });

/** `pitwall` is the bridge's bin; in this repository it runs as the root script `pnpm pitwall` (generates, then runs). */
const spawnBridge = (command: string, args: string[]): ChildProcess => {
  const [file, fileArgs] = command === 'pitwall' ? ['pnpm', ['-s', 'pitwall', ...args]] : [command, args];
  // Detached: the child leads a process group, so `killTree` also stops pnpm's node child.
  const child = spawn(file as string, fileArgs as string[], { cwd: repoRoot, stdio: 'inherit', detached: true });
  child.on('error', (error) => console.error(`bridge process: ${error.message}`));
  child.on('exit', (code, signal) => console.error(`bridge process exited (${signal ?? code})`));
  return child;
};

/** Stops a bridge started by `spawnBridge` and its children. */
const killTree = (pid: number): void => {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // already gone
  }
};

const displays = (): Display[] => {
  const primary = screen.getPrimaryDisplay();
  return [primary, ...screen.getAllDisplays().filter((d) => d.id !== primary.id)].map((d) => ({
    id: d.id,
    bounds: d.bounds,
    workArea: d.workArea,
  }));
};

const geometryOf = (win: BrowserWindow): Geometry => {
  const bounds = win.getBounds();
  return { screen: screen.getDisplayMatching(bounds).id, ...bounds };
};

const blockBrowserShortcuts = (win: BrowserWindow): void => {
  win.webContents.on('before-input-event', (event, input) => {
    if (dev || input.type !== 'keyDown') return;
    const blocked = BLOCKED_KEYS.some(
      (k) =>
        k.key.toLowerCase() === input.key.toLowerCase() &&
        (k.control ?? false) === input.control &&
        (k.shift ?? false) === input.shift &&
        (k.alt ?? false) === input.alt,
    );
    if (blocked) event.preventDefault();
  });
};

/** Sends the window's geometry to its page, at most every GEOMETRY_INTERVAL_MS (the last change always follows). */
const reportGeometry = (win: BrowserWindow): void => {
  let timer: NodeJS.Timeout | undefined;
  let last = 0;
  const send = (): void => {
    timer = undefined;
    last = Date.now();
    if (!win.isDestroyed()) win.webContents.send('geometry', geometryOf(win));
  };
  const onChange = (): void => {
    if (timer !== undefined) return;
    timer = setTimeout(send, Math.max(0, GEOMETRY_INTERVAL_MS - (Date.now() - last)));
  };
  win.on('move', onChange);
  win.on('resize', onChange);
  win.on('closed', () => clearTimeout(timer));
};

/** The page the app shows, without the query. */
const pageBase = (): string =>
  dev ? `http://localhost:${UI_PORT}/` : pathToFileURL(path.join(repoRoot, 'apps/ui/dist/index.html')).href;

const pageUrl = (id: WindowId): string => `${pageBase()}?window=${encodeURIComponent(id)}&ws=${WS_PORT}`;

/** A page may not open windows and may not leave the app's own page. */
const lockNavigation = (win: BrowserWindow): void => {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(pageBase())) event.preventDefault();
  });
};

const openWindow = (id: WindowId, bounds: Rectangle): void => {
  const win = new BrowserWindow({
    ...bounds,
    autoHideMenuBar: true,
    ...(e2e && { show: false, paintWhenInitiallyHidden: true }),
    webPreferences: {
      ...(e2e && { backgroundThrottling: false }),
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: [`--pitwall-window=${id}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windows.set(id, win);
  win.on('closed', () => windows.delete(id));
  blockBrowserShortcuts(win);
  lockNavigation(win);
  reportGeometry(win);
  void win.loadURL(pageUrl(id));
};

const ensureWindows = (desired: ReadonlyArray<{ id: WindowId; geometry?: Geometry | undefined }>): void => {
  const open = [...windows].map(([id, win]) => ({ id, geometry: geometryOf(win) }));
  const plan = planWindows(desired, open, displays());
  for (const { id, bounds } of plan.open) openWindow(id, bounds);
  for (const id of plan.close) windows.get(id)?.close();
  for (const { id, bounds } of plan.move) windows.get(id)?.setBounds(bounds);
};

let warnedInvalid = false;
ipcMain.on('ensureWindows', (_event, raw: unknown) => {
  const desired = parseEnsureWindows(raw);
  if (desired !== undefined) ensureWindows(desired);
  else if (!warnedInvalid) {
    warnedInvalid = true;
    console.error('ignored an invalid ensureWindows request');
  }
});
ipcMain.on('openPath', (_event, file: unknown) => {
  if (isAllowedOpenPath(repoRoot, file, dev)) void shell.openPath(file);
});

void app.whenReady().then(async () => {
  try {
    bridge = await ensureBridge({ port: WS_PORT, probe, spawn: spawnBridge, killTree, args: bridgeArgs });
  } catch (error) {
    // The windows still open and show the connection state; the engineer can start the bridge by hand.
    console.error(error instanceof Error ? error.message : error);
  }
  ensureWindows([{ id: FIRST_WINDOW }]);
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => bridge?.stop());
