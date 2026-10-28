// Helpers shared by the Task 22 specs: data dirs, workbook files and the bridge log.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

type PanelSpec = { widget: string; options: Record<string, unknown>; linkGroup: number };
export type WindowSpec = { id: string; panels: Record<string, PanelSpec> };

/** A panel of a widget this build does not know; it shows `unknown widget <name>`, which makes it easy to find. */
export const marker = (name: string): PanelSpec => ({ widget: name, options: {}, linkGroup: 1 });
export const feedStatus: PanelSpec = { widget: 'feed-status', options: {}, linkGroup: 1 };

export const unknownWidgetText = (name: string): string => `unknown widget ${name}`;

export async function makeDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pitwall-e2e-'));
  await mkdir(path.join(dir, 'ui', 'workbooks'), { recursive: true });
  return dir;
}

export const removeDataDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true });

export const workbookFile = (dataDir: string, name: string): string => path.join(dataDir, 'ui', 'workbooks', `${name}.json`);

/** Writes `<dataDir>/ui/workbooks/<name>.json`; `layout` is left empty so the shell lays the panels out itself. */
export async function writeWorkbook(dataDir: string, name: string, windows: WindowSpec[]): Promise<void> {
  const workbook = { name, windows: windows.map((w) => ({ id: w.id, layout: {}, panels: w.panels })) };
  await writeFile(workbookFile(dataDir, name), `${JSON.stringify(workbook, null, 2)}\n`);
}

/** Hand edit of an existing workbook file (not an atomic write by the bridge: the bridge must notice and re-read it). */
export async function editWorkbook(dataDir: string, name: string, windows: WindowSpec[]): Promise<void> {
  await writeWorkbook(dataDir, name, windows);
}

export const readWorkbook = async (dataDir: string, name: string): Promise<unknown> => JSON.parse(await readFile(workbookFile(dataDir, name), 'utf8'));

/** The default workbook the specs start from: windows `main` and `side`, each with a feed-status panel. */
export const twoWindows = (): WindowSpec[] => [
  { id: 'main', panels: { feed: feedStatus } },
  { id: 'side', panels: { feed: feedStatus } },
];

export type SubscribeLine = { clientId: string; id: string; topic: string; params?: unknown; feedId?: string };

/**
 * The subscribe lines of the bridge log. Assumed format (the implementer adds it; see the report): when a client
 * subscribes the bridge logs, at info level, one pino line `{"msg":"ws subscribe","clientId":"c1","id":"s1","topic":"feed.status","params":{...},"feedId":"replay",...}`.
 * Lines that are not JSON or not a subscribe are ignored.
 */
export function subscribeLines(log: string[]): SubscribeLine[] {
  return log.flatMap((line) => {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      return entry['msg'] === 'ws subscribe' ? [entry as unknown as SubscribeLine] : [];
    } catch {
      return [];
    }
  });
}
