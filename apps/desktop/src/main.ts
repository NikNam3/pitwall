// Electron main: one BrowserWindow per workbook window, the bridge attached or started, browser shortcuts blocked.
// Start: `electron . [--dev] [-- <bridge command>]`, e.g. `-- pitwall replay x.pwrec --realtime`.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import type { Rectangle } from 'electron';
import { ensureBridge } from './bridge-process.ts';
import type { BridgeHandle } from './bridge-process.ts';
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
const spawnBridge = (command: string, args: string[]): { kill(): void } =>
  command === 'pitwall'
    ? spawn('pnpm', ['-s', 'pitwall', ...args], { cwd: repoRoot, stdio: 'inherit' })
    : spawn(command, args, { cwd: repoRoot, stdio: 'inherit' });

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

const pageUrl = (id: WindowId): string => {
  const query = `?window=${encodeURIComponent(id)}&ws=${WS_PORT}`;
  return dev
    ? `http://localhost:${UI_PORT}/${query}`
    : `file://${path.join(repoRoot, 'apps/ui/dist/index.html')}${query}`;
};

const openWindow = (id: WindowId, bounds: Rectangle): void => {
  const win = new BrowserWindow({
    ...bounds,
    autoHideMenuBar: true,
    webPreferences: {
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

ipcMain.on('ensureWindows', (_event, desired: unknown) => {
  if (Array.isArray(desired)) ensureWindows(desired as Array<{ id: WindowId; geometry?: Geometry }>);
});
ipcMain.on('openPath', (_event, file: unknown) => {
  if (typeof file === 'string') void shell.openPath(file);
});

void app.whenReady().then(async () => {
  bridge = await ensureBridge({ port: WS_PORT, probe, spawn: spawnBridge, args: bridgeArgs });
  ensureWindows([{ id: FIRST_WINDOW }]);
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => bridge?.stop());
