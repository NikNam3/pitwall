// The thin adapter over dockview (spec 7.3): mounts a window's layout and panels and maps dockview's events back to
// workbook changes. Panels are rendered by the caller's `PanelView`; nothing outside this folder knows dockview.
import type { PanelSpec } from '@pitwall/contracts';
import { DEFAULT_THEME } from '../../theme/index.ts';
import {
  createDockview,
  positionToDirection,
  themeDark,
  type DockviewApi,
  type DockviewGroupPanel,
  type IContentRenderer,
  type ITabRenderer,
  type Position,
  type SerializedDockview,
} from './dockview.ts';
import { carriesPanel, readPanel, writePanel } from './transfer.ts';
import './dock.css';

/** How the shell renders one panel: its body into `content` and its header band into `tab` (the drag handle). */
export type PanelView = {
  render(content: HTMLElement, tab: HTMLElement, spec: PanelSpec): { destroy(): void };
  /** The panel's title, for places dockview draws itself (the overflow list of a crowded group). */
  title(spec: PanelSpec): string;
};

/** A mounted dock. */
export type DockHandle = {
  /** Adds a panel under a fresh id; the change reaches `onChange` like any other. */
  addPanel(spec: PanelSpec): void;
  destroy(): void;
};

const COMPONENT = 'panel';
const HOST_CLASS = 'pw-dock';

type Parts = { content: HTMLElement; tab: HTMLElement; tabTaken: boolean; rendered: { destroy(): void } | undefined };

const isSerialized = (layout: unknown): layout is SerializedDockview =>
  typeof layout === 'object' && layout !== null && 'grid' in layout && 'panels' in layout;

/**
 * Mounts a dock into `el` from a saved `layout` and the window's `panels`, and calls `onChange` with the new layout
 * and panels after every change made in the dock. A layout that does not load falls back to the default arrangement
 * of `panels`, so no panel is lost.
 */
export function mountDock(
  el: HTMLElement,
  layout: unknown,
  panels: Record<string, PanelSpec>,
  onChange: (layout: unknown, panels: Record<string, PanelSpec>) => void,
  view: PanelView,
): DockHandle {
  const specs = new Map(Object.entries(panels));
  const parts = new Map<string, Parts>();
  const partsOf = (id: string): Parts => {
    let p = parts.get(id);
    if (p === undefined) {
      p = { content: document.createElement('div'), tab: document.createElement('div'), tabTaken: false, rendered: undefined };
      p.content.className = 'pw-dock-content';
      p.tab.className = 'pw-dock-tab';
      parts.set(id, p);
    }
    return p;
  };

  el.classList.add(HOST_CLASS);
  const api: DockviewApi = createDockview(el, {
    theme: { ...themeDark, gap: DEFAULT_THEME.density.panelGapPx },
    singleTabMode: 'fullwidth',
    defaultTabComponent: COMPONENT,
    disableFloatingGroups: true,
    createComponent: ({ id }): IContentRenderer => {
      const p = partsOf(id);
      return {
        element: p.content,
        init: () => {
          const spec = specs.get(id);
          if (spec !== undefined && p.rendered === undefined) p.rendered = view.render(p.content, p.tab, spec);
        },
        dispose: () => {
          p.rendered?.destroy();
          parts.delete(id);
        },
      };
    },
    // The first tab of a panel holds its header band; any further one (the overflow list) is dockview's default tab.
    createTabComponent: ({ id }): ITabRenderer | undefined => {
      const p = partsOf(id);
      if (p.tabTaken) return undefined;
      p.tabTaken = true;
      return { element: p.tab, init: () => {} };
    },
  });

  /** The layout without panel params: a panel's spec lives in `panels` only, so the workbook stays hand-editable. */
  const serialise = (): SerializedDockview => {
    const json = api.toJSON();
    for (const panel of Object.values(json.panels)) delete panel.params;
    return json;
  };
  const currentPanels = (): Record<string, PanelSpec> => {
    const out: Record<string, PanelSpec> = {};
    for (const panel of api.panels) {
      const spec = specs.get(panel.id);
      if (spec !== undefined) out[panel.id] = spec;
    }
    return out;
  };
  const freshId = (): string => {
    let n = 1;
    while (specs.has(`p${n}`)) n += 1;
    return `p${n}`;
  };
  /** Where a panel goes: next to a drop target's group, at a layout edge, or to the right of what is there. */
  const positionOf = (at: { group?: DockviewGroupPanel; position: Position } | undefined) => {
    const direction = at === undefined ? undefined : positionToDirection(at.position);
    if (at?.group !== undefined && direction !== undefined) return { referenceGroup: at.group, direction };
    if (direction !== undefined && direction !== 'within') return { direction };
    return api.groups.length > 0 ? { direction: 'right' as const } : undefined;
  };
  const place = (id: string, spec: PanelSpec, at?: { group?: DockviewGroupPanel; position: Position }): void => {
    specs.set(id, spec);
    const position = positionOf(at);
    api.addPanel({ id, component: COMPONENT, title: view.title(spec), ...(position === undefined ? {} : { position }) });
  };
  const add = (spec: PanelSpec, at?: { group?: DockviewGroupPanel; position: Position }): void => place(freshId(), spec, at);

  let loading = true;
  try {
    if (isSerialized(layout)) api.fromJSON(layout);
  } catch {
    // A broken layout is an expected problem of hand-edited workbooks (spec 7.2): start from the default arrangement.
    api.clear();
  }
  for (const panel of api.panels) if (!specs.has(panel.id)) api.removePanel(panel);
  for (const [id, spec] of [...specs]) if (api.getPanel(id) === undefined) place(id, spec);
  loading = false;

  let last = JSON.stringify([serialise(), currentPanels()]);
  const report = (): void => {
    if (loading) return;
    const nextLayout = serialise();
    const nextPanels = currentPanels();
    const text = JSON.stringify([nextLayout, nextPanels]);
    if (text === last) return;
    last = text;
    for (const id of [...specs.keys()]) if (!(id in nextPanels)) specs.delete(id);
    onChange(nextLayout, nextPanels);
  };

  // Dragging to another window: the spec goes with the drag, and the panel leaves this dock once the other window
  // took it (a `move` that was not dropped in this document). Each window then saves its own change.
  let outgoing: { id: string; droppedHere: boolean } | undefined;
  const doc = el.ownerDocument;
  const onDrop = (): void => {
    if (outgoing !== undefined) outgoing.droppedHere = true;
  };
  const onDragEnd = (e: DragEvent): void => {
    const drag = outgoing;
    outgoing = undefined;
    if (drag === undefined || drag.droppedHere || e.dataTransfer?.dropEffect !== 'move') return;
    const panel = api.getPanel(drag.id);
    if (panel !== undefined) api.removePanel(panel);
  };
  doc.addEventListener('drop', onDrop, true);
  doc.addEventListener('dragend', onDragEnd, true);

  const subscriptions = [
    api.onDidLayoutChange(report),
    api.onWillDragPanel((e) => {
      const spec = specs.get(e.panel.id);
      if (!(e.nativeEvent instanceof DragEvent) || e.nativeEvent.dataTransfer === null || spec === undefined) return;
      writePanel(e.nativeEvent.dataTransfer, spec);
      outgoing = { id: e.panel.id, droppedHere: false };
    }),
    api.onUnhandledDragOver((e) => {
      if (!(e.nativeEvent instanceof DragEvent) || !carriesPanel(e.nativeEvent.dataTransfer)) return;
      e.accept();
      if (e.nativeEvent.dataTransfer !== null) e.nativeEvent.dataTransfer.dropEffect = 'move';
    }),
    api.onDidDrop((e) => {
      if (e.getData() !== undefined || !(e.nativeEvent instanceof DragEvent)) return;
      const spec = readPanel(e.nativeEvent.dataTransfer);
      if (spec === undefined) return;
      if (e.nativeEvent.dataTransfer !== null) e.nativeEvent.dataTransfer.dropEffect = 'move';
      add(spec, { ...(e.group === undefined ? {} : { group: e.group }), position: e.position });
    }),
  ];

  return {
    addPanel: (spec) => add(spec),
    destroy() {
      for (const s of subscriptions) s.dispose();
      doc.removeEventListener('drop', onDrop, true);
      doc.removeEventListener('dragend', onDragEnd, true);
      api.dispose();
      el.classList.remove(HOST_CLASS);
    },
  };
}
