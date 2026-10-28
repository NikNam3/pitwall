// Checks for what a page sends over IPC; a page is untrusted input to the main process.
import path from 'node:path';

/** The most windows one workbook may ask for. */
export const MAX_WINDOWS = 16;

export type WindowRequest = {
  id: string;
  geometry?: { screen: number; x: number; y: number; width: number; height: number };
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isGeometry = (v: unknown): v is NonNullable<WindowRequest['geometry']> => {
  if (typeof v !== 'object' || v === null) return false;
  const g = v as Record<string, unknown>;
  return (
    finite(g['screen']) && finite(g['x']) && finite(g['y']) && finite(g['width']) && finite(g['height']) &&
    g['width'] > 0 && g['height'] > 0
  );
};

/** The `ensureWindows` request when well formed (distinct non-empty ids, at most MAX_WINDOWS), else undefined. */
export function parseEnsureWindows(raw: unknown): WindowRequest[] | undefined {
  if (!Array.isArray(raw) || raw.length > MAX_WINDOWS) return undefined;
  const ids = new Set<string>();
  for (const el of raw as unknown[]) {
    if (typeof el !== 'object' || el === null) return undefined;
    const { id, geometry } = el as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || ids.has(id)) return undefined;
    if (geometry !== undefined && !isGeometry(geometry)) return undefined;
    ids.add(id);
  }
  return raw as WindowRequest[];
}

/** The window id of a `focusWindow` request when it is a non-empty string, else undefined. */
export function parseFocusWindow(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

/** True when `openPath` may open `file`: only in `--dev`, only an absolute path inside the repository. */
export function isAllowedOpenPath(repoRoot: string, file: unknown, dev: boolean): file is string {
  if (!dev || typeof file !== 'string' || !path.isAbsolute(file)) return false;
  const relative = path.relative(repoRoot, path.resolve(file));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
