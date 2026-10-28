<script lang="ts">
  // One window (spec 7.1-7.3): the active workbook's panels for this window, in a dock, saved back to the bridge.
  import type { PanelSpec, SessionInfo } from '@pitwall/contracts';
  import type { FeedId } from '@pitwall/domain';
  import { getAllContexts, mount, onDestroy, unmount, untrack } from 'svelte';
  import type { EntryState, TopicStore } from '../../connection/topic-store.svelte.ts';
  import * as text from '../../kit/text.ts';
  import type { RegisteredWidget, ResolvedLink } from '../../kit/types.ts';
  import { DEFAULT_THEME, role } from '../../theme/index.ts';
  import { WIDGETS } from '../../widgets/index.generated.ts';
  import { mountDock, type DockHandle, type PanelView } from '../docking/index.ts';
  import type { Host } from '../host/host.ts';
  import Panel from '../panel/Panel.svelte';
  import { provideWindowFont } from '../panel/window-font.ts';
  import { defaultPanel } from '../workbooks/default-panel.ts';
  import { normaliseWorkbook } from '../workbooks/normalise.ts';
  import { provisionalLink, sameLink } from './provisional-link.ts';
  import WidgetPicker from './WidgetPicker.svelte';
  import { WindowSync } from './window-sync.ts';

  type Props = {
    store: TopicStore;
    host: Host;
    /** The widgets of this build; tests pass their own. */
    widgets?: RegisteredWidget[];
    /** The feed panels follow until link groups name one: the first feed of the bridge's `hello`. */
    defaultFeed?: FeedId | undefined;
  };
  let { store, host, widgets = WIDGETS, defaultFeed }: Props = $props();

  /** Dock and geometry changes are collected this long into one save (spec 7.2). */
  const SAVE_DEBOUNCE_MS = 250;

  // Store and host belong to the page: they never change while the window lives.
  // svelte-ignore state_referenced_locally
  const windowId = host.windowId();
  // svelte-ignore state_referenced_locally
  const workbooks = store.acquire({ topic: 'ui.workbooks', params: {} });
  let actions = 0;
  const sync = new WindowSync({
    windowId,
    delayMs: SAVE_DEBOUNCE_MS,
    send: (window) => {
      // The connection drops what it cannot send; the sync owes it instead.
      if (store.connection !== 'open') return false;
      actions += 1;
      store.send({ type: 'uiAction', id: `${windowId}.${actions}`, action: { kind: 'workbook.updateWindow', window } });
      return true;
    },
  });
  $effect(() => {
    if (store.connection !== 'open') untrack(() => sync.connectionLost());
  });

  const byName = $derived(new Map(widgets.map((w) => [w.decl.name, w])));
  const decls = $derived(new Map(widgets.map((w) => [w.decl.name, w.decl])));
  const value = $derived(workbooks.state.status === 'ok' ? workbooks.state.value : undefined);
  const read = $derived(value === undefined ? undefined : normaliseWorkbook(value.active, decls));
  const thisWindow = $derived(read?.workbook.windows.find((w) => w.id === windowId));
  const fontPx = $derived(thisWindow?.fontPx ?? DEFAULT_THEME.fontPx);
  // Unknown widgets say so in their panel; ignored options are listed on one line.
  const notes = $derived(
    (read?.notes ?? []).flatMap((n) => (n.windowId === windowId && n.kind !== 'unknownWidget' ? [text.optionIgnored(n.panelId, n.option)] : [])),
  );

  provideWindowFont({
    get fontPx() {
      return fontPx;
    },
    lineHeight: DEFAULT_THEME.density.lineHeight,
  });

  let session = $state.raw<EntryState<SessionInfo> | undefined>();
  $effect(() => {
    const feed = defaultFeed;
    if (feed === undefined) {
      session = undefined;
      return;
    }
    const held = untrack(() => store.acquire({ topic: 'session.info', params: {}, feedId: feed }));
    session = held.state;
    return () => held.release();
  });

  // Panels are mounted by the dock, outside this component's tree: they get the window's contexts explicitly.
  const contexts = getAllContexts();
  const view: PanelView = {
    title: (spec) => byName.get(spec.widget)?.decl.title ?? spec.widget,
    render(content, tab, spec: PanelSpec) {
      // The same link object while its resolved values stay the same, so widgets are not re-derived per session update.
      let link: ResolvedLink | undefined;
      const instance = mount(Panel, {
        target: content,
        context: contexts,
        props: {
          store,
          spec,
          headerTarget: tab,
          get widget() {
            return byName.get(spec.widget);
          },
          get link() {
            const next = provisionalLink(spec, defaultFeed, session?.status === 'ok' ? session.value : undefined);
            if (!sameLink(link, next)) link = next;
            return link;
          },
        },
      });
      return { destroy: () => void unmount(instance) };
    },
  };

  let dockEl = $state<HTMLElement>();
  let dock: DockHandle | undefined;
  let empty = $state(true);
  let picking = $state(false);

  $effect(() => {
    const window = thisWindow;
    const el = dockEl;
    if (read === undefined || el === undefined) return;
    untrack(() => {
      if (!sync.fromBridge(window) && dock !== undefined) return;
      dock?.destroy();
      const { layout, panels } = sync.content;
      empty = Object.keys(panels).length === 0;
      dock = mountDock(
        el,
        layout,
        panels,
        (nextLayout, nextPanels) => {
          empty = Object.keys(nextPanels).length === 0;
          sync.dockChanged({ layout: nextLayout, panels: nextPanels });
        },
        view,
      );
    });
  });

  // The workbook's first window opens and places the others (spec 7.1): again when the workbook or its windows change.
  let announced: string | undefined;
  $effect(() => {
    const book = read?.workbook;
    if (book === undefined || book.windows[0]?.id !== windowId) return;
    const key = JSON.stringify([book.name, book.windows.map((w) => w.id)]);
    if (key === announced) return;
    announced = key;
    untrack(() => host.ensureWindows(book.windows.map((w) => ({ id: w.id, geometry: w.geometry }))));
  });

  // svelte-ignore state_referenced_locally
  const offGeometry = host.onGeometryChange((g) => sync.geometryChanged(g));
  onDestroy(() => {
    offGeometry();
    sync.dispose();
    dock?.destroy();
    workbooks.release();
  });

  const pick = (widget: RegisteredWidget): void => {
    picking = false;
    dock?.addPanel(defaultPanel(widget.decl));
  };
</script>

<div class="window" style:--pw-font-px="{fontPx}px">
  {#if value?.error !== undefined}
    <div class="notice" style:color={role('critical')}>{value.error}</div>
  {/if}
  {#if notes.length > 0}
    <div class="notice" style:color={role('textDim')}>{notes.join(text.separator)}</div>
  {/if}
  <div class="area">
    <div class="dock" bind:this={dockEl}></div>
    {#if read !== undefined && empty}
      <div class="empty">
        <button type="button" style:color={role('textDim')} style:border-color={role('border')} onclick={() => (picking = !picking)}
          >{text.addWidget}</button
        >
        {#if picking}<WidgetPicker {widgets} onPick={pick} />{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .window {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-size: var(--pw-font-px);
  }
  .notice {
    flex: none;
    padding: 0 var(--pw-header-pad);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .area {
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .dock {
    position: absolute;
    inset: 0;
    /* Its own stacking context, so dockview's layers stay below the empty-window picker. */
    z-index: 0;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--pw-panel-gap);
    pointer-events: none;
  }
  .empty > :global(*) {
    pointer-events: auto;
  }
  button {
    font-family: var(--pw-font);
    font-size: inherit;
    background: none;
    border: var(--pw-border-px) solid;
    padding: 0 var(--pw-header-pad);
    cursor: pointer;
  }
</style>
