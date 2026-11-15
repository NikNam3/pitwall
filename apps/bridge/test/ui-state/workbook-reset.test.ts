// SP4.3c Task 24 (spec §5.9, C70, C73): the uiAction `workbook.reset` replaces one workbook with its shipped default.
// Contract:
//  - `UiState.open(ui, hub, log, defaults?: { dir: string; now: () => string })`: `dir` is the shipped defaults folder,
//    `now()` the date in a backup's name. Without `defaults`, `workbook.reset` is invalid.
//  - `{ kind: 'workbook.reset', name }` for a name with a shipped `<name>.json`: the user's `<name>.json` (if any) is kept
//    as `<name>.json.bak-<now()>`, the shipped text is written in its place, and `ui.workbooks` is published: the name
//    is listed, and when it is the active workbook, `active` is the default (a pending unsaved edit does not win).
//  - A name without a shipped default, or an unsafe name, is invalid and changes nothing.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage, TopicName, Workbook } from '@pitwall/contracts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { UiState } from '../../src/ui-state/ui-state.ts';

const WORKBOOKS = 'ui.workbooks' as TopicName;
const DATE = '2026-11-15';
const WAIT = { timeout: 3000, interval: 20 };
/** Longer than the UI state's save debounce (300 ms). */
const AFTER_SAVE_MS = 450;
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

const opened: UiState[] = [];
afterEach(() => { for (const s of opened.splice(0)) s.close(); });

const book = (name: string, widget: string): Workbook => ({
  name,
  windows: [{ id: 'main', layout: {}, panels: { main: { widget, options: {}, linkGroup: 1 } } }],
});
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
/** The shipped defaults: `race` and `quali`. */
const SHIPPED_RACE = json(book('race', 'shipped-race'));
const SHIPPED_QUALI = json(book('quali', 'shipped-quali'));

/** A ui dir whose workbooks folder holds `files`, a defaults folder with race and quali, and an open UiState. */
function setup(files: Record<string, string>, withDefaults = true) {
  const ui = join(mkdtempSync(join(tmpdir(), 'wb-reset-')), 'ui');
  mkdirSync(join(ui, 'workbooks'), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(ui, 'workbooks', name), text);
  const dir = mkdtempSync(join(tmpdir(), 'wb-defaults-'));
  writeFileSync(join(dir, 'race.json'), SHIPPED_RACE);
  writeFileSync(join(dir, 'quali.json'), SHIPPED_QUALI);
  const hub = new TopicHub({ now: () => performance.now() });
  const sent: ServerMessage[] = [];
  hub.addClient('c1', { send: (m) => { sent.push(m); }, bufferedAmount: () => 0 });
  const log = createLogger({ level: 'silent' });
  const state = withDefaults ? UiState.open(ui, hub, log, { dir, now: () => DATE }) : UiState.open(ui, hub, log);
  opened.push(state);
  let n = 0;
  const read = <T = any>(topic: TopicName): T => {
    const id = `r${n++}`;
    hub.subscribe({ clientId: 'c1', id, topic, params: {}, feedId: undefined });
    const m = sent.filter((x) => 'id' in x && x.id === id).find((x) => x.type === 'snapshot');
    hub.unsubscribe('c1', id);
    return (m as { value: T }).value;
  };
  hub.subscribe({ clientId: 'c1', id: 'wb', topic: WORKBOOKS, params: {}, feedId: undefined });
  const workbookUpdates = () => { hub.tick(); return sent.filter((m) => m.type === 'update' && m.id === 'wb').length; };
  return { ui, state, read, workbookUpdates };
}
const path = (ui: string, file: string) => join(ui, 'workbooks', file);
const text = (p: string) => readFileSync(p, 'utf8');

describe('workbook.reset', () => {
  it('replaces the active workbook with its default, keeps the old file as a dated .bak and publishes the default as active', async () => {
    const mine = json(book('race', 'my-race'));
    const { ui, state, read, workbookUpdates } = setup({ 'race.json': mine });
    expect(read<{ active: Workbook }>(WORKBOOKS).active).toEqual(book('race', 'my-race'));
    const before = workbookUpdates();
    expect(state.apply({ kind: 'workbook.reset', name: 'race' })).toEqual({ ok: true });
    expect(text(path(ui, 'race.json'))).toBe(SHIPPED_RACE);
    expect(text(path(ui, `race.json.bak-${DATE}`))).toBe(mine);
    expect(read<{ names: string[]; active: Workbook }>(WORKBOOKS)).toMatchObject({ names: ['race'], active: book('race', 'shipped-race') });
    expect(workbookUpdates()).toBeGreaterThan(before);
  });

  it('a pending unsaved edit of the active workbook does not overwrite the reset', async () => {
    const { ui, state, read } = setup({ 'race.json': json(book('race', 'my-race')) });
    state.apply({ kind: 'workbook.updateWindow', window: { id: 'extra', layout: {}, panels: {} } });
    expect(state.apply({ kind: 'workbook.reset', name: 'race' })).toEqual({ ok: true });
    await settle(AFTER_SAVE_MS);
    expect(text(path(ui, 'race.json'))).toBe(SHIPPED_RACE);
    expect(read<{ active: Workbook }>(WORKBOOKS).active).toEqual(book('race', 'shipped-race'));
  });

  it('resets a workbook that is not active without switching to it', () => {
    const mine = json(book('quali', 'my-quali'));
    const { ui, state, read } = setup({ 'race.json': json(book('race', 'my-race')), 'quali.json': mine, 'default.json': json(book('default', 'x')) });
    const active = read<{ active: Workbook }>(WORKBOOKS).active;
    expect(state.apply({ kind: 'workbook.reset', name: 'quali' })).toEqual({ ok: true });
    expect(text(path(ui, 'quali.json'))).toBe(SHIPPED_QUALI);
    expect(text(path(ui, `quali.json.bak-${DATE}`))).toBe(mine);
    expect(read<{ active: Workbook }>(WORKBOOKS).active).toEqual(active);
  });

  it('brings back a deleted default, lists it, and makes no backup', async () => {
    const { ui, state, read } = setup({ 'race.json': json(book('race', 'my-race')), 'quali.json': SHIPPED_QUALI });
    rmSync(path(ui, 'quali.json'));
    await vi.waitFor(() => expect(read<{ names: string[] }>(WORKBOOKS).names).toEqual(['race']), WAIT);
    expect(state.apply({ kind: 'workbook.reset', name: 'quali' })).toEqual({ ok: true });
    expect(text(path(ui, 'quali.json'))).toBe(SHIPPED_QUALI);
    expect(readdirSync(join(ui, 'workbooks')).filter((f) => f.includes('.bak-'))).toEqual([]);
    expect(read<{ names: string[] }>(WORKBOOKS).names).toEqual(['quali', 'race']);
  });

  it('a name without a shipped default, or an unsafe name, is invalid and changes nothing', () => {
    const mine = json(book('mine', 'my-own'));
    const { ui, state } = setup({ 'mine.json': mine });
    for (const name of ['mine', 'nope', '../race', 'a/b', '', '.seeded-defaults']) {
      expect(state.apply({ kind: 'workbook.reset', name })).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(text(path(ui, 'mine.json'))).toBe(mine);
    expect(readdirSync(join(ui, 'workbooks')).filter((f) => f.includes('.bak-'))).toEqual([]);
  });

  it('without a defaults folder it is invalid', () => {
    const mine = json(book('race', 'my-race'));
    const { ui, state } = setup({ 'race.json': mine }, false);
    expect(state.apply({ kind: 'workbook.reset', name: 'race' })).toEqual({ ok: false, reason: 'invalid' });
    expect(text(path(ui, 'race.json'))).toBe(mine);
    expect(existsSync(path(ui, `race.json.bak-${DATE}`))).toBe(false);
  });
});
