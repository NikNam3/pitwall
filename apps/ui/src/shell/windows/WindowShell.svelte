<script lang="ts">
  // One window (spec 7.1-7.3): the active workbook's panels for this window, in a dock, saved back to the bridge.
  import { ackToken, type LinkGroup, type PanelSpec, type ReplayControl, type SessionInfo, type TopicValue, type UiAction, type UiSettings } from '@pitwall/contracts';
  import type { FeedId, Insight } from '@pitwall/domain';
  import { getAllContexts, mount, onDestroy, unmount, untrack, type Component, type ComponentProps } from 'svelte';
  import type { EntryState, TopicStore } from '../../connection/topic-store.svelte.ts';
  import * as text from '../../kit/text.ts';
  import type { RegisteredWidget, ResolvedLink } from '../../kit/types.ts';
  import { applyTheme, DEFAULT_THEME, role, type ThemeVariant } from '../../theme/index.ts';
  import '../controls.css';
  import { WIDGETS } from '../../widgets/index.generated.ts';
  import { alertCommands, defaultCommands, DEFAULT_KEYS, windowCommands, type CommandContext, type ShellOverlay } from '../commands/default-commands.ts';
  import { eventKey, parseKeys } from '../commands/keys.ts';
  import KeyOverview from '../commands/KeyOverview.svelte';
  import { OverlayStack, provideOverlayStack } from '../commands/overlay-stack.ts';
  import Palette from '../commands/Palette.svelte';
  import { CommandRegistry } from '../commands/registry.ts';
  import { mountDock, type DockHandle, type PanelView } from '../docking/index.ts';
  import { INITIAL_WINDOW, type Host } from '../host/host.ts';
  import { Inspection } from '../inspector/inspection.svelte.ts';
  import { loadInspector } from '../inspector/load.ts';
  import type { InspectTarget } from '../inspector/target.ts';
  import type Inspector from '../inspector/Inspector.svelte';
  import GroupPicker from '../link-groups/GroupPicker.svelte';
  import { resolveLink, sameLink } from '../link-groups/resolve.ts';
  import Panel from '../panel/Panel.svelte';
  import { provideWindowFont } from '../panel/window-font.ts';
  import TopBar from '../topbar/TopBar.svelte';
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
  // The theme in use: cells are counted with its line height and a font reset goes to its size.
  let theme = $state.raw<ThemeVariant>(DEFAULT_THEME);
  const fontPx = $derived(pendingFontPx ?? thisWindow?.fontPx ?? theme.fontPx);
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
    get lineHeight() {
      return theme.density.lineHeight;
    },
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
  const updatePanel = (id: string, change: Partial<PanelSpec>): void => {
    const { layout, panels } = sync.content;
    const before = panels[id];
    if (before === undefined) return;
    const after = { ...before, ...change };
    panelSpecs = { ...panels, [id]: after };
    // The dock keeps its own copy of every spec; it must hold the new one too.
    dock?.updatePanel(id, after);
    sync.dockChanged({ layout, panels: panelSpecs });
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
  /** The tier-1 alerts the top bar shows. */
  let shownAlerts = $state.raw<Insight[]>([]);
  const inspection = new Inspection();
  const commandContext: CommandContext = {
    send,
    sendReplay,
    open: (next) => (overlay = next),
    workbookNames: () => (value?.names ?? []),
    groups: () => groups ?? [],
    settings: () => settings,
    fontPx: () => fontPx,
    defaultFontPx: () => theme.fontPx,
    setTheme: (variant) => {
      theme = variant;
      applyTheme(variant, document.documentElement);
    },
    setFontPx: (px) => {
      pendingFontPx = px;
      sync.fontChanged(px);
    },
    focusWindow: (id) => host.focusWindow(id),
    alertKeys: () => shownAlerts.map(ackToken),
    inspection,
  };
  const baseCommands = defaultCommands(commandContext);
  const commands = $derived([
    ...baseCommands,
    ...alertCommands(shownAlerts, commandContext),
    ...windowCommands((read?.workbook.windows ?? []).map((w) => w.id), commandContext),
  ]);
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

  // The dev inspector (spec 8.2): its chunk is loaded when inspection is first switched on, and exists in dev builds only.
  let InspectorView = $state.raw<Component<ComponentProps<typeof Inspector>> | undefined>();
  $effect(() => {
    if (loadInspector === undefined || !inspection.on || InspectorView !== undefined) return;
    void loadInspector().then((module) => (InspectorView = module.default));
  });
  let catalogue = $state.raw<EntryState<TopicValue<'dev.catalogue'>> | undefined>();
  $effect(() => {
    if (loadInspector === undefined || inspection.widget === undefined) return;
    const held = untrack(() => store.acquire({ topic: 'dev.catalogue', params: {} }));
    catalogue = held.state;
    return () => held.release();
  });
  const inspectedCatalogue = $derived(catalogue?.status === 'ok' ? catalogue.value : undefined);
  let inspected = $state.raw<InspectTarget | undefined>();
  const inspectedLink = $derived(inspected?.link());

  // Panels are mounted by the dock, outside this component's tree: they get the window's contexts explicitly.
  const contexts = getAllContexts();
  const view: PanelView = {
    title: (spec) => byName.get(spec.widget)?.decl.title ?? spec.widget,
    render(content, tab, first: PanelSpec, panelId: string) {
      // The panel follows option changes made here, which reach it before the bridge echoes them.
      const current = (): PanelSpec => panelSpecs[panelId] ?? first;
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
          inspection,
          onInspect: (target: InspectTarget) => (inspected = target),
          onOptions: (options: Record<string, unknown>) => updatePanel(panelId, { options }),
          onLinkGroup: (linkGroup: number) => updatePanel(panelId, { linkGroup }),
          get spec() {
            return current();
          },
          get widget() {
            return byName.get(current().widget);
          },
          get group() {
            // Once the groups are known, one the bridge has not created yet has the defaults; its first set creates it.
            return groups === undefined ? undefined : groupOf(current().linkGroup);
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

  /** The gap the dock was mounted with: a theme with another gap mounts it again. */
  let mountedGapPx: number | undefined;
  $effect(() => {
    const window = thisWindow;
    const el = dockEl;
    const gapPx = theme.density.panelGapPx;
    if (read === undefined || el === undefined) return;
    untrack(() => {
      const fromBridge = sync.fromBridge(window);
      if (!fromBridge && dock !== undefined && gapPx === mountedGapPx) return;
      // A size set here and not saved belongs to the window it was set in.
      if (fromBridge) pendingFontPx = undefined;
      mountedGapPx = gapPx;
      dock?.destroy();
      const { layout, panels } = sync.content;
      empty = Object.keys(panels).length === 0;
      panelSpecs = panels;
      dock = mountDock(
        el,
        layout,
        panels,
        (nextLayout, nextPanels) => {
          empty = Object.keys(nextPanels).length === 0;
          panelSpecs = nextPanels;
          sync.dockChanged({ layout: nextLayout, panels: nextPanels });
        },
        view,
        gapPx,
      );
    });
  });

  // The workbook's first window opens and places the others (spec 7.1): again when the workbook or its windows change.
  // So does the host's initial window, which may not be in the workbook at all (startup, a switch to other window ids).
  let announced: string | undefined;
  $effect(() => {
    const book = read?.workbook;
    if (book === undefined || (book.windows[0]?.id !== windowId && windowId !== INITIAL_WINDOW)) return;
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
  {#if defaultFeed !== undefined}
    {#key defaultFeed}
      <TopBar {store} feedId={defaultFeed} {send} {sendReplay} onShown={(alerts) => (shownAlerts = alerts)} />
    {/key}
  {/if}
  <div class="area">
    <div class="dock" bind:this={dockEl}></div>
    {#if read !== undefined && empty}
      <div class="empty">
        <button type="button" class="pw-button" style:color={role('textDim')} style:border-color={role('border')} onclick={() => (picking = !picking)}
          >{text.addWidget}</button
        >
        {#if picking}<WidgetPicker {widgets} onPick={pick} />{/if}
      </div>
    {/if}
  </div>
  {#if InspectorView !== undefined && inspection.widget !== undefined && inspectedCatalogue !== undefined && inspectedLink !== undefined}
    <InspectorView {store} catalogue={inspectedCatalogue} params={(topic) => inspected?.params(topic) ?? {}} widget={inspection.widget} link={inspectedLink} {host} onClose={() => inspection.close()} />
  {/if}
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
    {@const wanted = overlay.group}
    {@const picked = groups === undefined ? undefined : groupOf(wanted)}
    {#if picked !== undefined}
      <GroupPicker {store} group={picked} feedId={picked.feedId ?? defaultFeed} {send} onClose={closeOverlay} />
    {/if}
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
    border: var(--pw-border-px) solid;
    padding: 0 var(--pw-header-pad);
  }
</style>
