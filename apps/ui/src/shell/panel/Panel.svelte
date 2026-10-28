<script lang="ts">
  // The panel frame (spec 4.3, 7.4; Task 0 option B): a header band in bgBand with the title, the one state and the
  // gear, then the widget body measured in character cells. The only place widget-level states are handled.
  import type { LinkGroup, PanelSpec, UiAction } from '@pitwall/contracts';
  import type { FeedId } from '@pitwall/domain';
  import { onDestroy, untrack, type Component } from 'svelte';
  import type { TopicStore } from '../../connection/topic-store.svelte.ts';
  import Gear from '../../kit/icons/Gear.svelte';
  import { measure, type Measured } from '../../kit/size/measure.ts';
  import { cellBox, pickMode, toCells } from '../../kit/size/size.ts';
  import { providePanelStale } from '../../kit/stale/panel-stale.ts';
  import * as text from '../../kit/text.ts';
  import type { RegisteredWidget, ResolvedLink, WidgetSize } from '../../kit/types.ts';
  import { role } from '../../theme/index.ts';
  import { useOverlayStack } from '../commands/overlay-stack.ts';
  import GroupPicker from '../link-groups/GroupPicker.svelte';
  import LinkMarker from '../link-groups/LinkMarker.svelte';
  import { computedLap, headerState, type DataStatus } from './header-state.ts';
  import { Holdings } from './holdings.svelte.ts';
  import { portal } from './portal.ts';
  import { dataRequests, frameRequests, type DataRequest } from './requests.ts';
  import SettingsPopover from './SettingsPopover.svelte';
  import { useWindowFont } from './window-font.ts';

  type Props = {
    store: TopicStore;
    spec: PanelSpec;
    /** Undefined when the spec names a widget this build does not have. */
    widget: RegisteredWidget | undefined;
    /** Undefined until the link group resolves (no feed or no session yet): the panel then shows `no data yet`. */
    link: ResolvedLink | undefined;
    /** Where the header band goes instead of above the body: the dock's tab, which is also the drag handle. */
    headerTarget?: HTMLElement | undefined;
    /** The panel's link group as the bridge published it; undefined until then. */
    group?: LinkGroup | undefined;
    /** The feed a group without its own feed follows. */
    defaultFeed?: FeedId | undefined;
    /** Sends a UI action to the bridge. */
    send?: (action: UiAction) => void;
    /** Saves new option values for this panel with its window. */
    onOptions?: (options: Record<string, unknown>) => void;
  };
  let { store, spec, widget, link, headerTarget, group, defaultFeed, send = () => {}, onOptions = () => {} }: Props = $props();

  // The picker and the settings popover open next to their buttons; Escape closes them (the shell owns the keys).
  const stack = useOverlayStack();
  let popover = $state<{ kind: 'picker' | 'settings'; anchor: { x: number; y: number } } | undefined>();
  const openAt = (kind: 'picker' | 'settings', button: HTMLElement): void => {
    const box = button.getBoundingClientRect();
    popover = { kind, anchor: { x: box.left, y: box.bottom } };
  };
  const close = (): void => {
    popover = undefined;
  };
  $effect(() => {
    if (popover === undefined || stack === undefined) return;
    return stack.add(close);
  });

  const font = useWindowFont();
  // The store is the window's for the panel's whole life.
  // svelte-ignore state_referenced_locally
  const frame = new Holdings(store);
  // svelte-ignore state_referenced_locally
  const data = new Holdings(store);

  const feedId = $derived(link?.feedId);
  const frameKeys = $derived(widget === undefined || feedId === undefined ? undefined : frameRequests(feedId));
  // Equal requests keep the previous array, so nothing downstream recomputes when an equal link is resolved again.
  let lastRequests: DataRequest[] = [];
  const requests = $derived.by(() => {
    const next = widget === undefined || link === undefined ? [] : dataRequests(widget.decl, link, spec.options);
    if (next.length === lastRequests.length && next.every((r, i) => r.id === lastRequests[i]?.id)) return lastRequests;
    lastRequests = next;
    return next;
  });

  $effect(() => {
    const keys = frameKeys;
    untrack(() => frame.hold(keys === undefined ? [] : [keys.session, keys.feed]));
  });
  $effect(() => {
    const next = requests;
    untrack(() => data.hold(next));
  });
  onDestroy(() => {
    data.release();
    frame.release();
  });

  const feed = $derived.by(() => {
    const state = frameKeys === undefined ? undefined : frame.states[frameKeys.feed.name];
    return state?.status === 'ok' ? (state.value as { stale?: boolean; cadenceMs?: number } | undefined) : undefined;
  });

  const panelStale = providePanelStale({
    now: () => (feedId === undefined ? undefined : store.now(feedId)),
    cadenceMs: () => feed?.cadenceMs,
  });

  const status = $derived.by((): DataStatus => {
    if (link === undefined) return 'waiting';
    const required = requests.filter((r) => !r.optional).map((r) => data.states[r.name]?.status);
    if (required.includes('errored')) return 'errored';
    return required.every((s) => s === 'ok') ? 'ok' : 'waiting';
  });
  const failedTopic = $derived(requests.find((r) => !r.optional && data.states[r.name]?.status === 'errored')?.key.topic);

  const values = $derived.by(() => {
    const out: Record<string, unknown> = {};
    for (const r of requests) {
      const state = data.states[r.name];
      out[r.name] = state?.status === 'ok' ? state.value : undefined;
    }
    return out;
  });

  const header = $derived(
    headerState({
      known: widget !== undefined,
      data: status,
      feedStale: store.connection !== 'open' || feed?.stale === true,
      staleForMs: panelStale.staleForMs,
      computedLaps: Object.values(values).flatMap((v) => computedLap(v) ?? []),
    }),
  );
  const dim = $derived(store.connection !== 'open' || feed?.stale === true);

  let measured = $state.raw<Measured | undefined>();
  /** The size the component gets; null when no size mode fits, undefined before the first measurement. */
  const size = $derived.by((): WidgetSize | null | undefined => {
    if (measured === undefined || widget === undefined) return undefined;
    const cells = toCells(measured.px, cellBox(font.fontPx, font.lineHeight));
    const mode = pickMode(widget.decl.sizes, cells.cols, cells.rows);
    return mode === undefined ? null : { mode, ...cells, px: measured.px, dpr: measured.dpr };
  });

  let View = $state.raw<Component<Record<string, unknown>> | undefined>();
  $effect(() => {
    const current = widget;
    let live = true;
    View = undefined;
    void current?.component().then((m) => {
      if (live) View = m.default;
    });
    return () => {
      live = false;
    };
  });
</script>

<div class="panel">
  <header use:portal={headerTarget} style:background={role('bgBand')}>
    <span class="title" style:color={role('textDim')}>{widget?.decl.title ?? spec.widget}</span>
    <LinkMarker {store} groupId={spec.linkGroup} {group} {link} onOpen={(button) => openAt('picker', button)} />
    <span class="fill"></span>
    {#if header !== undefined}<span class="state" style:color={role(header.role)}>{header.text}</span>{/if}
    <button type="button" class="pw-button" style:color={role('textFaint')} onclick={(e) => openAt('settings', e.currentTarget)}
      ><Gear label={text.settings} /></button
    >
  </header>
  <!-- Popovers sit on the page, not in the (clipped) panel. -->
  <div use:portal={document.body}>
    {#if popover?.kind === 'picker' && group !== undefined}
      <GroupPicker {store} {group} feedId={group.feedId ?? link?.feedId ?? defaultFeed} {send} onClose={close} anchor={popover.anchor} />
    {:else if popover?.kind === 'settings' && widget !== undefined}
      <SettingsPopover decl={widget.decl} options={spec.options} onChange={onOptions} onClose={close} anchor={popover.anchor} />
    {/if}
  </div>
  <div class="body" use:measure={(m: Measured) => (measured = m)} style:color={dim ? role('textFaint') : undefined}>
    {#if widget === undefined}
      <span style:color={role('textDim')}>{text.unknownWidget(spec.widget)}</span>
    {:else if status === 'errored'}
      <span style:color={role('textDim')}
        ><span style:color={role('critical')}>{text.noResult}</span> {text.topicErrored(failedTopic ?? spec.widget)}</span
      >
    {:else if status === 'ok' && size === null}
      <span style:color={role('textFaint')}>{text.tooSmall}</span>
    {:else if status === 'ok' && size !== undefined && View !== undefined && link !== undefined}
      <View data={values} options={spec.options} {size} {link} />
    {/if}
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  header {
    display: flex;
    gap: var(--pw-col-gap);
    padding: 0 var(--pw-header-pad);
    white-space: nowrap;
    overflow: hidden;
    flex: none;
    width: 100%;
    box-sizing: border-box;
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fill {
    flex: 1;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 0 var(--pw-header-pad);
  }
</style>
