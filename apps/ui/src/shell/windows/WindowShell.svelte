<script lang="ts">
  // One window (spec 7.1-7.3): the active workbook's panels for this window, in a dock, saved back to the bridge.
  import type { LinkGroup, PanelSpec, ReplayControl, SessionInfo, UiAction, UiSettings } from '@pitwall/contracts';
  import type { FeedId } from '@pitwall/domain';
  import { getAllContexts, mount, onDestroy, unmount, untrack } from 'svelte';
  import type { EntryState, TopicStore } from '../../connection/topic-store.svelte.ts';
  import * as text from '../../kit/text.ts';
  import type { RegisteredWidget, ResolvedLink } from '../../kit/types.ts';
  import { DEFAULT_THEME, role } from '../../theme/index.ts';
  import { WIDGETS } from '../../widgets/index.generated.ts';
  import { defaultCommands, DEFAULT_KEYS, windowCommands, type CommandContext, type ShellOverlay } from '../commands/default-commands.ts';
  import { eventKey, parseKeys } from '../commands/keys.ts';
  import KeyOverview from '../commands/KeyOverview.svelte';
  import { OverlayStack, provideOverlayStack } from '../commands/overlay-stack.ts';
  import Palette from '../commands/Palette.svelte';
  import { CommandRegistry } from '../commands/registry.ts';
  import { mountDock, type DockHandle, type PanelView } from '../docking/index.ts';
  import type { Host } from '../host/host.ts';
  import GroupPicker from '../link-groups/GroupPicker.svelte';
  import { resolveLink, sameLink } from '../link-groups/resolve.ts';
  import Panel from '../panel/Panel.svelte';
  import { provideWindowFont } from '../panel/window-font.ts';
  import { defaultPanel } from '../workbooks/default-panel.ts';
  import { normaliseWorkbook } from '../workbooks/normalise.ts';
  import WorkbookPicker from '../workbooks/WorkbookPicker.svelte';
  import WorkbookSaveAs from '../workbooks/WorkbookSaveAs.svelte';
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
  // svelte-ignore state_referenced_locally
  const linkGroups = store.acquire({ topic: 'ui.linkGroups', params: {} });
  // svelte-ignore state_referenced_locally
  const uiSettings = store.acquire({ topic: 'ui.settings', params: {} });
  let actions = 0;
  const nextId = (): string => {
    actions += 1;
    return `${windowId}.${actions}`;
  };
  const sync = new WindowSync({
    windowId,
    delayMs: SAVE_DEBOUNCE_MS,
    send: (window) => {
      // The connection drops what it cannot send; the sync owes it instead.
      if (store.connection !== 'open') return false;
      store.send({ type: 'uiAction', id: nextId(), action: { kind: 'workbook.updateWindow', window } });
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
  // A size set here shows at once; the bridge's copy takes over when it echoes it.
  let pendingFontPx = $state<number | undefined>();
  const fontPx = $derived(pendingFontPx ?? thisWindow?.fontPx ?? DEFAULT_THEME.fontPx);
  $effect(() => {
    if (pendingFontPx !== undefined && thisWindow?.fontPx === pendingFontPx) pendingFontPx = undefined;
  });
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

  const sessionInfo = $derived(session?.status === 'ok' ? session.value : undefined);
  const groups = $derived(linkGroups.state.status === 'ok' ? (linkGroups.state.value ?? []) : undefined);
  const settings = $derived<UiSettings | undefined>(uiSettings.state.status === 'ok' ? uiSettings.state.value : undefined);
  /** Until the bridge publishes the groups (or when one is missing there), a group follows the player live. */
  const groupOf = (id: number): LinkGroup => groups?.find((g) => g.id === id) ?? { id, primary: 'player', compare: [], window: { kind: 'live' } };

  // The panels' specs as the window holds them now: option changes made here reach the panels before the bridge echoes.
  let panelSpecs = $state.raw<Record<string, PanelSpec>>({});
  const sameSpec = (a: PanelSpec, b: PanelSpec): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);
  /** The id of the panel with this spec in the window's panels. */
  const panelIdOf = (spec: PanelSpec, all: Record<string, PanelSpec>): string | undefined => {
    const entries = Object.entries(all);
    return (entries.find(([, s]) => s === spec) ?? entries.find(([, s]) => sameSpec(s, spec)))?.[0];
  };
  /** Option changes made here, by panel id: the spec the dock still holds and the one that replaces it. */
  let overrides: Record<string, { dock: PanelSpec; spec: PanelSpec }> = {};
  const setOptions = (spec: PanelSpec, options: Record<string, unknown>): void => {
    const { layout, panels } = sync.content;
    const id = panelIdOf(spec, panels);
    if (id === undefined) return;
    const before = panels[id] as PanelSpec;
    const after = { ...before, options };
    overrides = { ...overrides, [id]: { dock: overrides[id]?.dock ?? before, spec: after } };
    const next = { ...panels, [id]: after };
    panelSpecs = next;
    sync.dockChanged({ layout, panels: next });
  };

  const send = (action: UiAction): void => store.send({ type: 'uiAction', id: nextId(), action });
  const sendReplay = (control: ReplayControl): void => store.send({ type: 'replayControl', id: nextId(), control });

  // Commands and keys (spec 7.7). Only this component listens to keys.
  const registry = new CommandRegistry();
  const stack = new OverlayStack();
  provideOverlayStack(stack);
  let overlay = $state<ShellOverlay | undefined>();
  const closeOverlay = (): void => {
    overlay = undefined;
  };
  $effect(() => {
    if (overlay === undefined) return;
    return stack.add(closeOverlay);
  });
  const commandContext: CommandContext = {
    send,
    sendReplay,
    open: (next) => (overlay = next),
    workbookNames: () => (value?.names ?? []),
    groups: () => groups ?? [],
    settings: () => settings,
    fontPx: () => fontPx,
    setFontPx: (px) => {
      pendingFontPx = px;
      sync.fontChanged(px);
    },
    focusWindow: (id) => {
      if (id === windowId) globalThis.focus();
    },
    // TODO(alerts task): the keys of the tier-1 alerts shown in the top bar.
    alertKeys: () => [],
  };
  const baseCommands = defaultCommands(commandContext);
  const commands = $derived([...baseCommands, ...windowCommands((read?.workbook.windows ?? []).map((w) => w.id), commandContext)]);
  $effect(() => {
    const offs = commands.map((c) => registry.register(c));
    return () => offs.forEach((off) => off());
  });
  const keys = $derived(parseKeys(settings?.keys ?? {}, new Set(commands.map((c) => c.id)), DEFAULT_KEYS));

  /** True when typing goes to the target: only Escape is handled there. */
  const isTextTarget = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  const onKeydown = (e: KeyboardEvent): void => {
    const key = eventKey(e);
    if (key !== 'Escape' && isTextTarget(e.target)) return;
    // Space on a focused button is its click.
    if (key === 'Space' && e.target instanceof HTMLButtonElement) return;
    if (key === 'Escape' && stack.closeTop()) {
      e.preventDefault();
      return;
    }
    const id = keys.bindings.get(key);
    if (id !== undefined && registry.run(id)) e.preventDefault();
  };
  $effect(() => {
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });

  // Panels are mounted by the dock, outside this component's tree: they get the window's contexts explicitly.
  const contexts = getAllContexts();
  const view: PanelView = {
    title: (spec) => byName.get(spec.widget)?.decl.title ?? spec.widget,
    render(content, tab, first: PanelSpec) {
      // The panel's id is found by its spec once the window holds it; the spec then follows option changes made here.
      let id: string | undefined;
      const current = (): PanelSpec => {
        id ??= panelIdOf(first, panelSpecs);
        return (id === undefined ? undefined : panelSpecs[id]) ?? first;
      };
      // The same link object while its resolved values stay the same, so widgets are not re-derived per session update.
      let link: ResolvedLink | undefined;
      const instance = mount(Panel, {
        target: content,
        context: contexts,
        props: {
          store,
          headerTarget: tab,
          defaultFeed,
          send,
          onOptions: (options: Record<string, unknown>) => setOptions(current(), options),
          get spec() {
            return current();
          },
          get widget() {
            return byName.get(current().widget);
          },
          get group() {
            return groupOf(current().linkGroup);
          },
          get link() {
            const next = resolveLink(groupOf(current().linkGroup), sessionInfo, defaultFeed);
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
      panelSpecs = panels;
      overrides = {};
      dock = mountDock(
        el,
        layout,
        panels,
        (nextLayout, nextPanels) => {
          empty = Object.keys(nextPanels).length === 0;
          // The dock keeps the specs it was mounted with: an option changed here wins over them.
          const merged = Object.fromEntries(
            Object.entries(nextPanels).map(([id, spec]) => {
              const changed = overrides[id];
              return [id, changed !== undefined && sameSpec(changed.dock, spec) ? changed.spec : spec];
            }),
          );
          panelSpecs = merged;
          sync.dockChanged({ layout: nextLayout, panels: merged });
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
    linkGroups.release();
    uiSettings.release();
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
  {#if overlay?.kind === 'palette'}
    <Palette {registry} bindings={keys.bindings} onClose={closeOverlay} />
  {:else if overlay?.kind === 'keys'}
    <KeyOverview {registry} bindings={keys.bindings} notes={keys.notes} onClose={closeOverlay} />
  {:else if overlay?.kind === 'workbooks'}
    <WorkbookPicker
      names={value?.names ?? []}
      active={value?.active.name}
      onPick={(name) => {
        closeOverlay();
        send({ kind: 'workbook.open', name });
      }}
      onClose={closeOverlay}
    />
  {:else if overlay?.kind === 'saveAs'}
    <WorkbookSaveAs
      onSave={(name) => {
        closeOverlay();
        send({ kind: 'workbook.saveAs', name });
      }}
      onClose={closeOverlay}
    />
  {:else if overlay?.kind === 'picker'}
    {@const picked = groupOf(overlay.group)}
    <GroupPicker {store} group={picked} feedId={picked.feedId ?? defaultFeed} {send} onClose={closeOverlay} />
  {/if}
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
