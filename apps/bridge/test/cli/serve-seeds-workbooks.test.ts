// `serve` seeds the shipped workbooks into its UI dir before it opens the UI state, so every start path (live,
// replay, and dev and the desktop app through them) has them, and an edited workbook is never overwritten.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage, WorkbooksState } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import { serve } from '../../src/cli/serve.ts';
import { ManualSource } from '../helpers/manual-source.ts';
import { WsClient } from '../../src/ws/client.ts';

/** Serves a live-like source with `uiDir` and returns the workbook names `ui.workbooks` lists. */
async function workbookNamesServed(uiDir: string): Promise<string[]> {
  const out: string[] = [];
  const abort = new AbortController();
  const done = serve({
    source: new ManualSource(feedId('live')),
    feed: { kind: 'udp', label: 'test' },
    wsPort: 0,
    dumpsDir: join(uiDir, '..', 'dumps'),
    uiDir,
    io: { out: (line) => out.push(line), err: () => {}, env: {}, signal: abort.signal },
  });
  try {
    await vi.waitFor(() => expect(out.join('\n')).toMatch(/listening ws:\/\/127\.0\.0\.1:\d+/), { timeout: 10_000 });
    const port = /127\.0\.0\.1:(\d+)/.exec(out.join('\n'))?.[1];
    const client = WsClient.connect(`ws://127.0.0.1:${port}`, { reconnectMs: 50 });
    try {
      const got: WorkbooksState[] = [];
      client.subscribe('ui.workbooks', {}, (m: ServerMessage) => {
        if ((m.type === 'snapshot' || m.type === 'update') && 'value' in m) got.push(m.value as WorkbooksState);
      });
      await vi.waitFor(() => expect(got.length).toBeGreaterThan(0), { timeout: 5_000 });
      return [...(got.at(-1)?.names ?? [])].sort();
    } finally {
      client.close();
    }
  } finally {
    abort.abort();
    await done;
  }
}

describe('serve seeds the default workbooks', { timeout: 20_000 }, () => {
  it('a fresh UI dir lists the shipped car, quali and race, not the fallback the UI state writes when it finds none', async () => {
    const uiDir = join(mkdtempSync(join(tmpdir(), 'serve-seed-')), 'ui');
    expect(await workbookNamesServed(uiDir)).toEqual(['car', 'quali', 'race']);
  });

  it('an edited workbook in the UI dir is kept as it is', async () => {
    const uiDir = join(mkdtempSync(join(tmpdir(), 'serve-seed-')), 'ui');
    mkdirSync(join(uiDir, 'workbooks'), { recursive: true });
    const mine = '{"name":"car","windows":[],"edited":"by hand"}\n';
    writeFileSync(join(uiDir, 'workbooks', 'car.json'), mine);
    expect(await workbookNamesServed(uiDir)).toEqual(['car', 'quali', 'race']);
    expect(readFileSync(join(uiDir, 'workbooks', 'car.json'), 'utf8')).toBe(mine);
  });
});
