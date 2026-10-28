// The UI state of every window: workbooks, link groups, alert state and settings (spec 7.2). It lives here, not in the
// windows, is saved under `ui/` and changes only through `apply(uiAction)` (ADR 0013).
import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { InsightCategory } from '@pitwall/domain';
import {
  decodeUiAction, decodeWorkbook,
  type AlertsState, type LinkGroup, type UiAction, type UiSettings, type Workbook, type WorkbooksState,
} from '@pitwall/contracts';
import type { TopicHub } from '../hub/topic-hub.ts';
import type { Logger } from '../log.ts';
import { ensureDir, parseJson, readText, sha256, workbookNames, workbookPath, writeAtomic } from './ui-files.ts';

const SAVE_DEBOUNCE_MS = 300;
/** Waits for an editor to finish a non-atomic write before the file is read. */
const RESCAN_DELAY_MS = 50;
const DEFAULT_NAME = 'default';

const defaultWorkbook = (): Workbook => ({
  name: DEFAULT_NAME,
  windows: [{ id: 'main', layout: {}, panels: { main: { widget: 'feed-status', options: {}, linkGroup: 1 } } }],
});
const defaultLinkGroup = (): LinkGroup => ({ id: 1, primary: 'player', compare: [], window: { kind: 'live' } });

type SavedState = { activeWorkbook: string; linkGroups: LinkGroup[]; acknowledged: string[]; muted: InsightCategory[]; realism: boolean };

export type ApplyResult = { ok: true } | { ok: false; reason: 'invalid' };
const OK: ApplyResult = { ok: true };
const INVALID: ApplyResult = { ok: false, reason: 'invalid' };

export class UiState {
  private readonly ui: string;
  private readonly hub: TopicHub;
  private readonly log: Logger;
  /** SHA-256 of what was last written or read, per file path. */
  private readonly hashes = new Map<string, string>();
  private readonly watchers: FSWatcher[] = [];
  private saveTimer: NodeJS.Timeout | undefined;
  private scanTimer: NodeJS.Timeout | undefined;

  private active: Workbook = defaultWorkbook();
  private names: string[] = [];
  /** Why the active file is unusable; while set, autosave of that file is paused. */
  private error: string | undefined;
  private workbookDirty = false;
  private stateDirty = false;
  private linkGroups: LinkGroup[] = [defaultLinkGroup()];
  private acknowledged: string[] = [];
  private muted: InsightCategory[] = [];
  private realism = false;
  private keys: Record<string, unknown> = {};

  private constructor(ui: string, hub: TopicHub, log: Logger) {
    this.ui = ui;
    this.hub = hub;
    this.log = log;
  }

  /** Loads (or, on a first start, creates) the state in `ui`, publishes it and starts watching the files. */
  static open(ui: string, hub: TopicHub, log: Logger): UiState {
    const state = new UiState(ui, hub, log);
    state.load();
    state.publishAll();
    state.startWatching();
    return state;
  }

  /** Applies one action; the only way the state changes. `invalid` leaves it untouched. */
  apply(raw: UiAction): ApplyResult {
    const action = decodeUiAction(raw);
    if (action === undefined) return INVALID;
    switch (action.kind) {
      case 'workbook.open': return this.openWorkbook(action.name);
      case 'workbook.saveAs': return this.saveAs(action.name);
      case 'workbook.updateWindow': {
        const windows = this.active.windows;
        const at = windows.findIndex((window) => window.id === action.window.id);
        this.active = { ...this.active, windows: at < 0 ? [...windows, action.window] : windows.with(at, action.window) };
        this.changedWorkbook();
        return OK;
      }
      case 'linkGroup.set': {
        const at = this.linkGroups.findIndex((group) => group.id === action.group.id);
        this.linkGroups = at < 0 ? [...this.linkGroups, action.group] : this.linkGroups.with(at, action.group);
        this.stateDirty = true;
        this.hub.publishGlobal('ui.linkGroups', () => this.linkGroups);
        this.scheduleSave();
        return OK;
      }
      case 'alert.ack': return this.acknowledge([action.key]);
      case 'alert.ackAll': return this.acknowledge(action.keys);
      case 'alertGroup.mute': {
        const others = this.muted.filter((category) => category !== action.category);
        this.muted = action.muted ? [...others, action.category] : others;
        return this.changedAlerts();
      }
      case 'realism.set':
        // Only the saved preference changes; the running session is untouched (spec 7.9).
        this.realism = action.enabled;
        this.stateDirty = true;
        this.hub.publishGlobal('ui.settings', () => this.settings());
        this.scheduleSave();
        return OK;
    }
  }

  /** Whether realism mode is on for the next session. */
  realismNextSession(): boolean {
    return this.realism;
  }

  /** Writes what is pending and stops watching. */
  close(): void {
    this.flush();
    clearTimeout(this.scanTimer);
    for (const watcher of this.watchers.splice(0)) watcher.close();
  }

  private openWorkbook(name: string): ApplyResult {
    if (!this.names.includes(name)) return INVALID;
    const text = readText(workbookPath(this.ui, name));
    const parsed = text === undefined ? undefined : this.parseWorkbook(name, text);
    if (text === undefined || parsed === undefined || !parsed.ok) return INVALID;
    this.flush();
    this.hashes.set(workbookPath(this.ui, name), sha256(text));
    this.active = parsed.workbook;
    this.error = undefined;
    this.stateDirty = true;
    this.publishWorkbooks();
    this.scheduleSave();
    return OK;
  }

  private saveAs(name: string): ApplyResult {
    if (name === '' || name.includes('/') || name.includes('\\') || name.includes('..') || name.startsWith('.')) return INVALID;
    this.flush();
    this.active = { ...this.active, name };
    this.error = undefined;
    this.writeWorkbook();
    this.names = workbookNames(join(this.ui, 'workbooks'));
    this.stateDirty = true;
    this.publishWorkbooks();
    this.scheduleSave();
    return OK;
  }

  private acknowledge(keys: string[]): ApplyResult {
    this.acknowledged = [...new Set([...this.acknowledged, ...keys])];
    return this.changedAlerts();
  }

  private changedAlerts(): ApplyResult {
    this.stateDirty = true;
    this.hub.publishGlobal('ui.alerts', () => this.alerts());
    this.scheduleSave();
    return OK;
  }

  private changedWorkbook(): void {
    this.workbookDirty = true;
    this.publishWorkbooks();
    this.scheduleSave();
  }

  // --- loading ---

  private load(): void {
    ensureDir(join(this.ui, 'workbooks'));
    const saved = this.readSavedState();
    if (saved) Object.assign(this, { linkGroups: saved.linkGroups, acknowledged: saved.acknowledged, muted: saved.muted, realism: saved.realism });
    else this.stateDirty = true;
    this.names = workbookNames(join(this.ui, 'workbooks'));
    if (this.names.length === 0) {
      this.active = defaultWorkbook();
      this.writeWorkbook();
      this.names = [DEFAULT_NAME];
    }
    const wanted = this.pickActive(saved?.activeWorkbook);
    this.active = { ...defaultWorkbook(), name: wanted };
    this.readWorkbookFile(wanted);
    if (saved?.activeWorkbook !== wanted) this.stateDirty = true;
    this.readKeys();
    if (this.stateDirty) this.writeState();
  }

  /** The saved active workbook if it still exists, else `default`, else the first one. */
  private pickActive(saved: string | undefined): string {
    if (saved !== undefined && this.names.includes(saved)) return saved;
    return this.names.includes(DEFAULT_NAME) ? DEFAULT_NAME : (this.names[0] ?? DEFAULT_NAME);
  }

  private readSavedState(): SavedState | undefined {
    const text = readText(join(this.ui, 'state.json'));
    if (text === undefined) return undefined;
    const parsed = parseJson(text);
    if (!parsed.ok) {
      this.log.warn({ file: 'state.json', message: parsed.message }, 'ui state file is not valid JSON; using defaults');
      return undefined;
    }
    this.hashes.set(join(this.ui, 'state.json'), sha256(text));
    const raw = parsed.value as Partial<Record<keyof SavedState, unknown>> | null;
    if (typeof raw !== 'object' || raw === null) return undefined;
    const groups = Array.isArray(raw.linkGroups) ? raw.linkGroups.map((g) => decodeUiAction({ kind: 'linkGroup.set', group: g })) : [];
    const linkGroups = groups.flatMap((a) => (a?.kind === 'linkGroup.set' ? [a.group] : []));
    const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
    const muted = strings(raw.muted).flatMap((category) => {
      const action = decodeUiAction({ kind: 'alertGroup.mute', category, muted: true });
      return action?.kind === 'alertGroup.mute' ? [action.category] : [];
    });
    return {
      activeWorkbook: typeof raw.activeWorkbook === 'string' ? raw.activeWorkbook : DEFAULT_NAME,
      linkGroups: linkGroups.length > 0 ? linkGroups : [defaultLinkGroup()],
      acknowledged: strings(raw.acknowledged),
      muted,
      realism: raw.realism === true,
    };
  }

  private parseWorkbook(name: string, text: string): { ok: true; workbook: Workbook } | { ok: false; message: string } {
    const parsed = parseJson(text);
    if (!parsed.ok) return parsed;
    const workbook = decodeWorkbook(parsed.value);
    return workbook === undefined
      ? { ok: false, message: `${name}.json is not a workbook: expected { name, windows } with valid panels` }
      : { ok: true, workbook: { ...workbook, name } };
  }

  /** Reads a workbook file; when it is the active one, takes it over or records why it cannot be used. Returns whether the shown state changed. */
  private readWorkbookFile(name: string): boolean {
    const path = workbookPath(this.ui, name);
    const text = readText(path);
    if (text === undefined) return false;
    const hash = sha256(text);
    if (this.hashes.get(path) === hash) return false;
    this.hashes.set(path, hash);
    if (name !== this.active.name) return false;
    const result = this.parseWorkbook(name, text);
    if (result.ok) {
      this.active = result.workbook;
      this.error = undefined;
      this.workbookDirty = false;
    } else {
      this.error = result.message;
      this.workbookDirty = false;
    }
    return true;
  }

  private readKeys(): boolean {
    const path = join(this.ui, 'keys.json');
    const text = readText(path);
    const hash = text === undefined ? '' : sha256(text);
    if ((this.hashes.get(path) ?? '') === hash) return false;
    this.hashes.set(path, hash);
    let keys: Record<string, unknown> = {};
    if (text !== undefined) {
      const parsed = parseJson(text);
      if (parsed.ok && typeof parsed.value === 'object' && parsed.value !== null && !Array.isArray(parsed.value)) keys = parsed.value as Record<string, unknown>;
      else this.log.warn({ file: 'keys.json', message: parsed.ok ? 'not an object' : parsed.message }, 'keys.json is not a JSON object; using no key bindings');
    }
    this.keys = keys;
    return true;
  }

  // --- watching ---

  private startWatching(): void {
    for (const dir of [join(this.ui, 'workbooks'), this.ui]) {
      try {
        const watcher = watch(dir, () => this.scheduleScan());
        watcher.on('error', (error) => this.log.warn({ err: error, dir }, 'watching the ui folder failed'));
        this.watchers.push(watcher);
      } catch (error) {
        this.log.warn({ err: error, dir }, 'cannot watch the ui folder; hand edits are not picked up');
      }
    }
  }

  private scheduleScan(): void {
    clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => this.scan(), RESCAN_DELAY_MS);
  }

  /** Re-reads every file whose content hash differs from what the bridge last wrote or read. */
  private scan(): void {
    const names = workbookNames(join(this.ui, 'workbooks'));
    let workbooks = names.join('\n') !== this.names.join('\n');
    this.names = names;
    for (const name of names) workbooks = this.readWorkbookFile(name) || workbooks;
    if (workbooks) this.publishWorkbooks();
    if (this.readKeys()) this.hub.publishGlobal('ui.settings', () => this.settings());
  }

  // --- writing ---

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }

  /** Writes what changed. A broken active file is not overwritten until it is valid again. */
  private flush(): void {
    clearTimeout(this.saveTimer);
    if (this.workbookDirty && this.error === undefined) this.writeWorkbook();
    this.workbookDirty = false;
    if (this.stateDirty) this.writeState();
  }

  private writeWorkbook(): void {
    this.write(workbookPath(this.ui, this.active.name), this.active);
    this.workbookDirty = false;
  }

  private writeState(): void {
    const saved: SavedState = {
      activeWorkbook: this.active.name, linkGroups: this.linkGroups, acknowledged: this.acknowledged, muted: this.muted, realism: this.realism,
    };
    this.write(join(this.ui, 'state.json'), saved);
    this.stateDirty = false;
  }

  private write(path: string, value: unknown): void {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    this.hashes.set(path, sha256(text));
    try {
      writeAtomic(path, text);
    } catch (error) {
      this.log.error({ err: error, path }, 'cannot save the ui state');
    }
  }

  // --- publishing ---

  private alerts(): AlertsState {
    return { acknowledged: this.acknowledged, muted: this.muted };
  }

  private settings(): UiSettings {
    return { realismNextSession: this.realism, keys: this.keys };
  }

  private workbooks(): WorkbooksState {
    return { names: this.names, active: this.active, ...(this.error !== undefined && { error: this.error }) };
  }

  private publishWorkbooks(): void {
    this.hub.publishGlobal('ui.workbooks', () => this.workbooks());
  }

  private publishAll(): void {
    this.publishWorkbooks();
    this.hub.publishGlobal('ui.linkGroups', () => this.linkGroups);
    this.hub.publishGlobal('ui.alerts', () => this.alerts());
    this.hub.publishGlobal('ui.settings', () => this.settings());
  }
}
