import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkGroup, ServerMessage, TopicName, Workbook, WorkbookWindow } from '@pitwall/contracts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { UiState } from '../../src/ui-state/ui-state.ts';

const WORKBOOKS = 'ui.workbooks' as TopicName, LINKS = 'ui.linkGroups' as TopicName;
const ALERTS = 'ui.alerts' as TopicName, SETTINGS = 'ui.settings' as TopicName;

const opened: UiState[] = [];
afterEach(() => { for (const s of opened.splice(0)) s.close(); });

const win = (id: string, widget = 'feed-status'): WorkbookWindow => ({
  id, layout: { split: id }, panels: { main: { widget, options: { n: 1 }, linkGroup: 1 } },
});
const defaultLink: LinkGroup = { id: 1, primary: 'player', compare: [], window: { kind: 'live' } };

/** A temp data dir's `ui` folder, a hub, one persistent subscription per ui topic, and the warnings logged. */
function setup(dir = mkdtempSync(join(tmpdir(), 'ui-state-')), before?: (ui: string) => void) {
  const ui = join(dir, 'ui');
  if (before) { mkdirSync(join(ui, 'workbooks'), { recursive: true }); before(ui); }
  const hub = new TopicHub({ now: () => performance.now() });
  const sent: ServerMessage[] = [];
  hub.addClient('c1', { send: (m) => { sent.push(m); }, bufferedAmount: () => 0 });
  const warnings: string[] = [];
  const log = createLogger({ level: 'warn', destination: { write: (s: string) => { warnings.push(s); } } });
  const state = UiState.open(ui, hub, log);
  opened.push(state);
  let n = 0;
  /** The current value of a topic, from a fresh subscription's snapshot. */
  const read = <T = any>(topic: TopicName): T => {
    const id = `r${n++}`;
    hub.subscribe({ clientId: 'c1', id, topic, params: {}, feedId: undefined });
    const m = sent.filter((x) => 'id' in x && x.id === id).find((x) => x.type === 'snapshot');
    hub.unsubscribe('c1', id);
    return (m as { value: T }).value;
  };
  /** Number of messages carrying a new `ui.workbooks` value to a persistent subscriber. */
  hub.subscribe({ clientId: 'c1', id: 'wb', topic: WORKBOOKS, params: {}, feedId: undefined });
  const workbookUpdates = () => { hub.tick(); return sent.filter((m) => m.type === 'update' && m.id === 'wb').length; };
  return { ui, hub, state, read, warnings, workbookUpdates };
}
const file = (ui: string, ...p: string[]) => join(ui, ...p);
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WAIT = { timeout: 3000, interval: 20 };

describe('UiState first start', () => {
  it('creates default.json with one window main and one feed-status panel on link group 1', () => {
    const { ui, read } = setup();
    const onDisk = readJson(file(ui, 'workbooks', 'default.json'));
    expect(onDisk).toMatchObject({ name: 'default', windows: [{ id: 'main', panels: { main: { widget: 'feed-status', options: {}, linkGroup: 1 } } }] });
    expect(onDisk.windows).toHaveLength(1);
    expect(read(WORKBOOKS)).toEqual({ names: ['default'], active: onDisk });
  });
  it('sets link group 1 to the default and publishes settings and alerts defaults', () => {
    const { read, state } = setup();
    expect(read(LINKS)).toEqual([defaultLink]);
    expect(read(ALERTS)).toEqual({ acknowledged: [], muted: [] });
    expect(read(SETTINGS)).toEqual({ realismNextSession: false, keys: {} });
    expect(state.realismNextSession()).toBe(false);
  });
  it('restores saved state after a restart on the same directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ui-state-'));
    const a = setup(dir);
    a.state.apply({ kind: 'alertGroup.mute', category: 'tyres', muted: true });
    a.state.apply({ kind: 'linkGroup.set', group: { ...defaultLink, primary: 'teammate' } });
    a.state.apply({ kind: 'realism.set', enabled: true });
    a.state.apply({ kind: 'workbook.saveAs', name: 'race' });
    await vi.waitFor(() => expect(readJson(file(a.ui, 'state.json')).activeWorkbook).toBe('race'), WAIT);
    a.state.close();
    const b = setup(dir);
    expect(b.read(ALERTS).muted).toEqual(['tyres']);
    expect(b.read(LINKS)).toEqual([{ ...defaultLink, primary: 'teammate' }]);
    expect(b.read(SETTINGS).realismNextSession).toBe(true);
    expect(b.read(WORKBOOKS).active.name).toBe('race');
    expect(b.read(WORKBOOKS).names).toEqual(['default', 'race']);
  });
});

describe('workbook actions', () => {
  it('updateWindow adds a window, then replaces it by id', async () => {
    const { ui, state, read } = setup();
    expect(state.apply({ kind: 'workbook.updateWindow', window: win('a') })).toEqual({ ok: true });
    expect(state.apply({ kind: 'workbook.updateWindow', window: { ...win('a', 'laps'), fontPx: 16 } })).toEqual({ ok: true });
    const windows = read(WORKBOOKS).active.windows as WorkbookWindow[];
    expect(windows.map((w) => w.id)).toEqual(['main', 'a']);
    expect(windows[1]).toEqual({ ...win('a', 'laps'), fontPx: 16 });
    await vi.waitFor(() => expect(readJson(file(ui, 'workbooks', 'default.json')).windows[1]).toEqual(windows[1]), WAIT);
  });
  it('keeps layout as given, whatever it is', () => {
    const { state, read } = setup();
    const layout = { any: ['thing', 1, null, { deep: true }] };
    state.apply({ kind: 'workbook.updateWindow', window: { ...win('a'), layout } });
    expect(read(WORKBOOKS).active.windows[1].layout).toEqual(layout);
  });
  it('two updateWindow actions for a and b within 10 ms both end up in the file after the debounce', async () => {
    const { ui, state } = setup();
    const path = file(ui, 'workbooks', 'default.json');
    const before = readFileSync(path, 'utf8');
    state.apply({ kind: 'workbook.updateWindow', window: win('a') });
    await settle(5);
    state.apply({ kind: 'workbook.updateWindow', window: win('b', 'laps') });
    expect(readFileSync(path, 'utf8')).toBe(before); // debounced, not written synchronously
    await vi.waitFor(() => expect((readJson(path).windows as WorkbookWindow[]).map((w) => w.id)).toEqual(['main', 'a', 'b']), WAIT);
    expect(readJson(path).windows[2].panels.main.widget).toBe('laps');
  });
  it('writes atomically: no temp file is left behind in the workbooks folder', async () => {
    const { ui, state } = setup();
    state.apply({ kind: 'workbook.updateWindow', window: win('a') });
    await vi.waitFor(() => expect(readJson(file(ui, 'workbooks', 'default.json')).windows).toHaveLength(2), WAIT);
    await settle(50);
    expect(readdirSync(file(ui, 'workbooks'))).toEqual(['default.json']);
  });
  it('saveAs copies the active workbook under a new name and makes it active; open switches back', async () => {
    const { ui, state, read } = setup();
    state.apply({ kind: 'workbook.updateWindow', window: win('a') });
    expect(state.apply({ kind: 'workbook.saveAs', name: 'race' })).toEqual({ ok: true });
    const v = read(WORKBOOKS);
    expect(v.names).toEqual(['default', 'race']);
    expect(v.active.name).toBe('race');
    expect(v.active.windows.map((w: WorkbookWindow) => w.id)).toEqual(['main', 'a']);
    await vi.waitFor(() => expect(readJson(file(ui, 'workbooks', 'race.json')).name).toBe('race'), WAIT);
    expect(state.apply({ kind: 'workbook.open', name: 'default' })).toEqual({ ok: true });
    expect(read(WORKBOOKS).active.name).toBe('default');
    await vi.waitFor(() => expect(readJson(file(ui, 'state.json')).activeWorkbook).toBe('default'), WAIT);
  });
  it('rejects open of an unknown workbook and unsafe saveAs names as invalid, changing nothing', () => {
    const { state, read } = setup();
    const before = read(WORKBOOKS);
    expect(state.apply({ kind: 'workbook.open', name: 'nope' })).toEqual({ ok: false, reason: 'invalid' });
    for (const name of ['', '../evil', 'a/b']) expect(state.apply({ kind: 'workbook.saveAs', name })).toEqual({ ok: false, reason: 'invalid' });
    expect(read(WORKBOOKS)).toEqual(before);
  });
  it('rejects a structurally invalid window as invalid (options not an object)', () => {
    const { state, read } = setup();
    const bad = { id: 'a', layout: {}, panels: { p: { widget: 'w', options: 'x', linkGroup: 1 } } } as unknown as WorkbookWindow;
    expect(state.apply({ kind: 'workbook.updateWindow', window: bad })).toEqual({ ok: false, reason: 'invalid' });
    expect(read(WORKBOOKS).active.windows).toHaveLength(1);
  });
});

describe('hand edits', () => {
  it('a hand edit of the active workbook (different hash) publishes the new active', async () => {
    const { ui, read } = setup();
    const edited: Workbook = { name: 'default', windows: [win('hand', 'laps')] };
    writeFileSync(file(ui, 'workbooks', 'default.json'), JSON.stringify(edited, null, 2));
    await vi.waitFor(() => expect(read(WORKBOOKS).active).toEqual(edited), WAIT);
    expect(read(WORKBOOKS).error).toBeUndefined();
  });
  it('a hand edit of another workbook file updates the list of names but not active', async () => {
    const { ui, read } = setup();
    writeFileSync(file(ui, 'workbooks', 'extra.json'), JSON.stringify({ name: 'extra', windows: [] }));
    await vi.waitFor(() => expect(read(WORKBOOKS).names).toEqual(['default', 'extra']), WAIT);
    expect(read(WORKBOOKS).active.name).toBe('default');
  });
  it('the bridge\'s own write does not trigger a re-publish', async () => {
    const { ui, state, workbookUpdates } = setup();
    state.apply({ kind: 'workbook.updateWindow', window: win('a') });
    const afterApply = workbookUpdates();
    const path = file(ui, 'workbooks', 'default.json');
    await vi.waitFor(() => expect(readJson(path).windows).toHaveLength(2), WAIT);
    await settle(500); // let fs.watch deliver its event for our own rename
    expect(workbookUpdates()).toBe(afterApply);
  });
  it('rewriting a file with identical content (same hash) does not re-publish', async () => {
    const { ui, workbookUpdates } = setup();
    const path = file(ui, 'workbooks', 'default.json');
    const text = readFileSync(path, 'utf8');
    const before = workbookUpdates();
    writeFileSync(path, text);
    await settle(500);
    expect(workbookUpdates()).toBe(before);
  });
  it('an invalid-JSON hand edit sets error, keeps active, and a following updateWindow does not overwrite the file; valid JSON clears error', async () => {
    const { ui, state, read } = setup();
    const path = file(ui, 'workbooks', 'default.json');
    const good = read(WORKBOOKS).active;
    writeFileSync(path, '{ not json');
    await vi.waitFor(() => expect(typeof read(WORKBOOKS).error).toBe('string'), WAIT);
    expect(read(WORKBOOKS).error.length).toBeGreaterThan(0);
    expect(read(WORKBOOKS).active).toEqual(good);
    expect(state.apply({ kind: 'workbook.updateWindow', window: win('a') })).toEqual({ ok: true });
    await settle(700); // well past the 300 ms debounce
    expect(readFileSync(path, 'utf8')).toBe('{ not json');
    const fixed: Workbook = { name: 'default', windows: [win('fixed')] };
    writeFileSync(path, JSON.stringify(fixed));
    await vi.waitFor(() => expect(read(WORKBOOKS).error).toBeUndefined(), WAIT);
    expect(read(WORKBOOKS).active).toEqual(fixed);
  });
  it('a file of the wrong shape counts as invalid too', async () => {
    const { ui, read } = setup();
    const good = read(WORKBOOKS).active;
    writeFileSync(file(ui, 'workbooks', 'default.json'), JSON.stringify({ name: 'default', windows: 'many' }));
    await vi.waitFor(() => expect(typeof read(WORKBOOKS).error).toBe('string'), WAIT);
    expect(read(WORKBOOKS).active).toEqual(good);
  });
  it('autosave resumes after the file is valid again', async () => {
    const { ui, state, read } = setup();
    const path = file(ui, 'workbooks', 'default.json');
    writeFileSync(path, 'garbage');
    await vi.waitFor(() => expect(typeof read(WORKBOOKS).error).toBe('string'), WAIT);
    writeFileSync(path, JSON.stringify({ name: 'default', windows: [win('fixed')] }));
    await vi.waitFor(() => expect(read(WORKBOOKS).error).toBeUndefined(), WAIT);
    state.apply({ kind: 'workbook.updateWindow', window: win('b') });
    await vi.waitFor(() => expect((readJson(path).windows as WorkbookWindow[]).map((w) => w.id)).toEqual(['fixed', 'b']), WAIT);
  });
});

describe('link groups, alerts and settings', () => {
  it('linkGroup.set replaces a group by id or adds it, and persists it in state.json', async () => {
    const { ui, state, read } = setup();
    const g2: LinkGroup = { id: 2, feedId: 'f1' as never, primary: 3 as never, compare: ['teammate', 5 as never], window: { kind: 'range', from: 1000, to: 2000 } };
    expect(state.apply({ kind: 'linkGroup.set', group: g2 })).toEqual({ ok: true });
    expect(state.apply({ kind: 'linkGroup.set', group: { ...defaultLink, window: { kind: 'lap', lap: 4 } } })).toEqual({ ok: true });
    const groups = read<LinkGroup[]>(LINKS);
    expect(groups.find((g) => g.id === 1)).toEqual({ ...defaultLink, window: { kind: 'lap', lap: 4 } });
    expect(groups.find((g) => g.id === 2)).toEqual(g2);
    expect(groups).toHaveLength(2);
    await vi.waitFor(() => expect(readJson(file(ui, 'state.json')).linkGroups).toEqual(groups), WAIT);
  });
  it('linkGroup.set rejects a group with a missing or malformed field', () => {
    const { state, read } = setup();
    const bad = [{ id: 2, compare: [], window: { kind: 'live' } }, { ...defaultLink, window: { kind: 'lap' } }, { ...defaultLink, compare: 'x' }];
    for (const group of bad) expect(state.apply({ kind: 'linkGroup.set', group: group as never })).toEqual({ ok: false, reason: 'invalid' });
    expect(read(LINKS)).toEqual([defaultLink]);
  });
  it('alert.ackAll with [a] while b is active acknowledges only a', async () => {
    const { ui, state, read } = setup();
    expect(state.apply({ kind: 'alert.ackAll', keys: ['a'] })).toEqual({ ok: true });
    expect(read(ALERTS).acknowledged).toEqual(['a']);
    await vi.waitFor(() => expect(readJson(file(ui, 'state.json')).acknowledged).toEqual(['a']), WAIT);
  });
  it('alert.ack adds a key once; ackAll merges without duplicates', () => {
    const { state, read } = setup();
    state.apply({ kind: 'alert.ack', key: 'a' });
    state.apply({ kind: 'alert.ack', key: 'a' });
    state.apply({ kind: 'alert.ackAll', keys: ['a', 'c'] });
    expect([...read(ALERTS).acknowledged].sort()).toEqual(['a', 'c']);
  });
  it('alertGroup.mute adds and removes a category', async () => {
    const { ui, state, read } = setup();
    state.apply({ kind: 'alertGroup.mute', category: 'tyres', muted: true });
    state.apply({ kind: 'alertGroup.mute', category: 'tyres', muted: true });
    state.apply({ kind: 'alertGroup.mute', category: 'energy', muted: true });
    expect([...read(ALERTS).muted].sort()).toEqual(['energy', 'tyres']);
    state.apply({ kind: 'alertGroup.mute', category: 'tyres', muted: false });
    expect(read(ALERTS).muted).toEqual(['energy']);
    await vi.waitFor(() => expect(readJson(file(ui, 'state.json')).muted).toEqual(['energy']), WAIT);
  });
  it('realism.set changes ui.settings and state.json, nothing else', async () => {
    const { ui, state, read } = setup();
    const links = read(LINKS), alerts = read(ALERTS), workbooks = read(WORKBOOKS);
    expect(state.apply({ kind: 'realism.set', enabled: true })).toEqual({ ok: true });
    expect(read(SETTINGS)).toEqual({ realismNextSession: true, keys: {} });
    expect(state.realismNextSession()).toBe(true);
    await vi.waitFor(() => expect(readJson(file(ui, 'state.json')).realism).toBe(true), WAIT);
    expect([read(LINKS), read(ALERTS), read(WORKBOOKS)]).toEqual([links, alerts, workbooks]);
    state.apply({ kind: 'realism.set', enabled: false });
    expect(state.realismNextSession()).toBe(false);
  });
  it('state.json has the five documented fields', async () => {
    const { ui } = setup();
    await vi.waitFor(() => expect(existsSync(file(ui, 'state.json'))).toBe(true), WAIT);
    expect(Object.keys(readJson(file(ui, 'state.json'))).sort()).toEqual(['acknowledged', 'activeWorkbook', 'linkGroups', 'muted', 'realism']);
  });
});

describe('keys.json', () => {
  it('ui.settings.keys is {} when keys.json is missing', () => {
    expect(setup().read(SETTINGS).keys).toEqual({});
  });
  it('is keys.json parsed as an object', () => {
    const { read } = setup(undefined, (ui) => writeFileSync(file(ui, 'keys.json'), JSON.stringify({ 'ctrl+k': 'palette', odd: 5 })));
    expect(read(SETTINGS).keys).toEqual({ 'ctrl+k': 'palette', odd: 5 });
  });
  it('invalid JSON gives {} and logs a warning', () => {
    const { read, warnings } = setup(undefined, (ui) => writeFileSync(file(ui, 'keys.json'), '{ nope'));
    expect(read(SETTINGS).keys).toEqual({});
    expect(warnings.length).toBeGreaterThan(0);
  });
  it('a hand edit of keys.json is watched and published; the bridge never writes the file', async () => {
    const { ui, read } = setup();
    expect(existsSync(file(ui, 'keys.json'))).toBe(false);
    writeFileSync(file(ui, 'keys.json'), JSON.stringify({ a: 1 }));
    await vi.waitFor(() => expect(read(SETTINGS).keys).toEqual({ a: 1 }), WAIT);
  });
});

describe('autosave never overwrites a hand edit', () => {
  it('a valid hand edit made while a save is pending wins over the pending save', async () => {
    const { ui, state, read } = setup();
    const path = file(ui, 'workbooks', 'default.json');
    const edited: Workbook = { name: 'default', windows: [win('hand', 'laps')] };
    const text = JSON.stringify(edited, null, 2);
    state.apply({ kind: 'workbook.updateWindow', window: win('a') });
    await settle(10);
    writeFileSync(path, text);
    await settle(700); // past the debounce and the watcher
    expect(readFileSync(path, 'utf8')).toBe(text);
    await vi.waitFor(() => expect(read(WORKBOOKS).active).toEqual(edited), WAIT);
    expect(read(WORKBOOKS).error).toBeUndefined();
  });
  it('an invalid hand edit made while a save is pending keeps its text, sets error and keeps active', async () => {
    const { ui, state, read } = setup();
    const path = file(ui, 'workbooks', 'default.json');
    const good = read(WORKBOOKS).active;
    state.apply({ kind: 'workbook.updateWindow', window: win('a') });
    await settle(10);
    writeFileSync(path, '{ not json');
    await settle(700);
    expect(readFileSync(path, 'utf8')).toBe('{ not json');
    await vi.waitFor(() => expect(typeof read(WORKBOOKS).error).toBe('string'), WAIT);
    expect(read(WORKBOOKS).active.windows.map((w: WorkbookWindow) => w.id)).toEqual(['main', 'a']);
    expect(good.windows).toHaveLength(1);
  });
  it('workbook.open right after a pending updateWindow does not overwrite a hand edit made in between', async () => {
    const { ui, state, read } = setup();
    const path = file(ui, 'workbooks', 'default.json');
    state.apply({ kind: 'workbook.saveAs', name: 'other' });
    state.apply({ kind: 'workbook.open', name: 'default' });
    await vi.waitFor(() => expect(readJson(file(ui, 'workbooks', 'other.json')).name).toBe('other'), WAIT);
    await settle(400);
    state.apply({ kind: 'workbook.updateWindow', window: win('a') });
    const text = JSON.stringify({ name: 'default', windows: [win('hand')] }, null, 2);
    await settle(10);
    writeFileSync(path, text);
    state.apply({ kind: 'workbook.open', name: 'other' });
    await settle(700);
    expect(readFileSync(path, 'utf8')).toBe(text);
    state.apply({ kind: 'workbook.open', name: 'default' });
    expect(read(WORKBOOKS).active.windows.map((w: WorkbookWindow) => w.id)).toEqual(['hand']);
  });
});
