<script lang="ts">
  // The fixed top bar (spec 7.6, 7.7, 7.9, 8.5; mockup 9-top-bar): one line, built from the segments of layout.ts.
  import type { ReplayControl, UiAction } from '@pitwall/contracts';
  import type { FeedId, Insight } from '@pitwall/domain';
  import type { Component } from 'svelte';
  import { onDestroy } from 'svelte';
  import type { TopicStore } from '../../connection/topic-store.svelte.ts';
  import { role } from '../../theme/index.ts';
  import { TOP_BAR } from './layout.ts';
  import { TopBarModel } from './model.svelte.ts';

  type Props = {
    store: TopicStore;
    feedId: FeedId;
    send: (action: UiAction) => void;
    sendReplay: (control: ReplayControl) => void;
    /** Called with the alerts shown, whenever they change. */
    onShown?: (alerts: Insight[]) => void;
    /** The open workbook's name and the way to its picker, for the `workbook` segment. */
    workbookName?: string | undefined;
    onPickWorkbook?: () => void;
  };
  let { store, feedId, send, sendReplay, onShown, workbookName, onPickWorkbook = () => {} }: Props = $props();

  // The bar is made per feed (the caller keys it); the feed and callbacks never change while it lives.
  // svelte-ignore state_referenced_locally
  const bar = new TopBarModel(store, feedId, send, sendReplay);
  onDestroy(() => bar.release());

  /** `segments/<Name>.svelte` by lower-case name: a new segment is found by convention. */
  const files = import.meta.glob<{ default: Component<{ bar: TopBarModel }> }>('./segments/*.svelte', { eager: true });
  const SEGMENTS = new Map(Object.entries(files).map(([path, module]) => [(path.split('/').pop() ?? '').replace('.svelte', '').toLowerCase(), module.default]));

  $effect(() => {
    bar.workbookName = workbookName;
    bar.pickWorkbook = onPickWorkbook;
  });
  $effect(() => {
    onShown?.(bar.shown);
  });
</script>

<div class="topbar" data-testid="topbar" style:border-color={role('border')} style:color={role('textDim')}>
  <div class="side">
    {#each TOP_BAR.left as name (name)}
      {@const Segment = SEGMENTS.get(name)}
      <span class="segment" data-testid="segment-{name}">{#if Segment}<Segment {bar} />{/if}</span>
    {/each}
  </div>
  <div class="side">
    {#each TOP_BAR.right as name (name)}
      {@const Segment = SEGMENTS.get(name)}
      <span class="segment" data-testid="segment-{name}">{#if Segment}<Segment {bar} />{/if}</span>
    {/each}
  </div>
</div>

<style>
  .topbar {
    flex: none;
    display: flex;
    justify-content: space-between;
    gap: var(--pw-panel-gap);
    padding: 0 var(--pw-header-pad);
    border-bottom: var(--pw-border-px) solid;
    white-space: nowrap;
    position: relative;
  }
  .side {
    display: flex;
    gap: var(--pw-header-pad);
    min-width: 0;
  }
  .segment {
    display: inline-flex;
    gap: var(--pw-header-pad);
  }
</style>
