// Keeps one window's dock and the bridge's copy of the window in step (spec 7.2 "saved automatically", Review Focus 4).
import type { Geometry, PanelSpec, WindowId, WorkbookWindow } from '@pitwall/contracts';

/** What a dock shows: its layout and its panels. */
export type DockContent = { layout: unknown; panels: Record<string, PanelSpec> };

/** How many sent contents are remembered while their echo from the bridge is outstanding. */
const MAX_UNCONFIRMED = 16;

/** JSON with sorted object keys, so equal contents give equal text whatever their key order. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );

/**
 * Local dock and geometry changes are collected for `delayMs` and sent as one whole window. The bridge's copy of this
 * window wins over the dock when it changed and is not the echo of something this window sent: a hand edit, a
 * workbook switch or a different state after a reconnect replaces the dock, and a change still waiting is dropped.
 * A publish caused by another window leaves this window's copy as it was, so a change waiting here survives it.
 * A change the bridge may have missed (saved while the link was down, or sent just before it went) is owed: the first
 * publish after the reconnect that leaves this window's copy as it was sends it once; one that changed it wins.
 */
export class WindowSync {
  readonly #id: WindowId;
  readonly #send: (window: WorkbookWindow) => boolean;
  readonly #delayMs: number;
  #dock: DockContent | undefined;
  #bridge: WorkbookWindow | undefined;
  #bridgeText: string | undefined;
  #geometry: Geometry | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #unconfirmed: string[] = [];
  #owed = false;

  /** `send` returns false when the link is down and the window was not sent. */
  constructor(opts: { windowId: WindowId; delayMs: number; send: (window: WorkbookWindow) => boolean }) {
    this.#id = opts.windowId;
    this.#delayMs = opts.delayMs;
    this.#send = opts.send;
  }

  /** What the dock should show. */
  get content(): DockContent {
    return this.#dock ?? { layout: undefined, panels: {} };
  }

  /** The bridge published this window (undefined when the workbook does not know it). True: remount the dock. */
  fromBridge(window: WorkbookWindow | undefined): boolean {
    this.#bridge = window;
    const content: DockContent = window === undefined ? { layout: undefined, panels: {} } : { layout: window.layout, panels: window.panels };
    const text = canonical(content);
    const unchanged = text === this.#bridgeText;
    this.#bridgeText = text;
    if (this.#dock !== undefined && (unchanged || text === canonical(this.#dock) || this.#unconfirmed.includes(text))) {
      // Nothing new for this window, or the echo of a save while the dock may have moved on: keep the dock.
      this.#confirm(text);
      if (this.#owed) {
        this.#owed = false;
        if (text !== canonical(this.#dock)) this.#schedule();
      }
      return false;
    }
    this.#cancel();
    this.#owed = false;
    this.#unconfirmed = [];
    this.#dock = content;
    return true;
  }

  /** The dock changed in this window. */
  dockChanged(content: DockContent): void {
    this.#dock = content;
    this.#schedule();
  }

  /** The host reported a new geometry for this window. */
  geometryChanged(geometry: Geometry): void {
    this.#geometry = geometry;
    this.#schedule();
  }

  /** The link to the bridge went down: saves not yet confirmed may be lost, so they are owed after the reconnect. */
  connectionLost(): void {
    if (this.#unconfirmed.length > 0) this.#owed = true;
    this.#unconfirmed = [];
  }

  /** Drops a change still waiting. */
  dispose(): void {
    this.#cancel();
  }

  #confirm(text: string): void {
    const at = this.#unconfirmed.indexOf(text);
    if (at >= 0) this.#unconfirmed.splice(0, at + 1);
  }

  #cancel(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #schedule(): void {
    this.#cancel();
    this.#timer = setTimeout(() => this.#flush(), this.#delayMs);
  }

  #flush(): void {
    this.#timer = undefined;
    const dock = this.#dock;
    // Nothing to save before the first workbook arrived; the geometry goes with the first change after it.
    if (dock === undefined) return;
    const geometry = this.#geometry ?? this.#bridge?.geometry;
    const fontPx = this.#bridge?.fontPx;
    const sent = this.#send({
      id: this.#id,
      ...(geometry === undefined ? {} : { geometry }),
      ...(fontPx === undefined ? {} : { fontPx }),
      layout: dock.layout,
      panels: dock.panels,
    });
    if (!sent) {
      this.#owed = true;
      return;
    }
    this.#unconfirmed.push(canonical(dock));
    if (this.#unconfirmed.length > MAX_UNCONFIRMED) this.#unconfirmed.shift();
  }
}
