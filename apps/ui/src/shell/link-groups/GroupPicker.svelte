<script lang="ts">
  // The group picker (spec 7.5): primary car, compare cars and time window of one link group. Every choice goes to the
  // bridge as `linkGroup.set`; the panels follow the group the bridge publishes, nothing changes here.
  import type { CarRef, LinkGroup, TimeWindow, UiAction } from '@pitwall/contracts';
  import type { FeedId } from '@pitwall/domain';
  import { untrack } from 'svelte';
  import type { EntryState, TopicStore } from '../../connection/topic-store.svelte.ts';
  import * as text from '../../kit/text.ts';
  import { role } from '../../theme/index.ts';
  import Overlay from '../commands/Overlay.svelte';

  type Cars = Array<{ id: number; identity: { name: string } }>;
  type Props = {
    store: TopicStore;
    group: LinkGroup;
    /** The group's own feed, else the window's default one. */
    feedId: FeedId | undefined;
    send: (action: UiAction) => void;
    onClose: () => void;
    anchor?: { x: number; y: number } | undefined;
  };
  let { store, group, feedId, send, onClose, anchor }: Props = $props();

  let overview = $state.raw<EntryState<Cars> | undefined>();
  $effect(() => {
    const feed = feedId;
    if (feed === undefined) {
      overview = undefined;
      return;
    }
    const held = untrack(() => store.acquire({ topic: 'cars.overview', params: {}, feedId: feed }));
    overview = held.state as EntryState<Cars>;
    return () => held.release();
  });
  const cars = $derived([...(overview?.status === 'ok' ? (overview.value ?? []) : [])].sort((a, b) => a.id - b.id));

  const set = (change: Partial<LinkGroup>): void => send({ kind: 'linkGroup.set', group: { ...group, ...change } });
  const setPrimary = (primary: CarRef): void => {
    set({ primary });
    onClose();
  };
  const toggleCompare = (ref: CarRef): void => set({ compare: group.compare.includes(ref) ? group.compare.filter((c) => c !== ref) : [...group.compare, ref] });

  const live: TimeWindow = { kind: 'live' };
  const lapOf = (w: TimeWindow): number => (w.kind === 'lap' ? w.lap : w.kind === 'range' ? w.from : 1);
  const toOf = (w: TimeWindow): number => (w.kind === 'range' ? w.to : lapOf(w));
  const numberFrom = (e: Event): number => Math.max(1, Math.round((e.currentTarget as HTMLInputElement).valueAsNumber) || 1);
</script>

<Overlay title="{text.linkMarker} {group.id}" {onClose} {anchor} cols={40}>
  <div class="head" style:color={role('textDim')}>{text.picker.primary}</div>
  <div class="list">
    <button type="button" class:on={group.primary === 'player'} onclick={() => setPrimary('player')}>{text.picker.player}</button>
    <button type="button" class:on={group.primary === 'teammate'} onclick={() => setPrimary('teammate')}>{text.picker.teammate}</button>
    {#each cars as car (car.id)}
      <button type="button" class:on={group.primary === car.id} onclick={() => setPrimary(car.id as CarRef)}>{car.identity.name}</button>
    {/each}
  </div>
  {#if feedId === undefined}
    <div style:color={role('textFaint')}>{text.picker.noFeed}</div>
  {:else if cars.length === 0}
    <div style:color={role('textFaint')}>{text.picker.noCars}</div>
  {/if}

  <div class="head" style:color={role('textDim')}>{text.picker.compare}</div>
  <div class="list">
    {#each [{ ref: 'player' as CarRef, label: text.picker.player }, { ref: 'teammate' as CarRef, label: text.picker.teammate }, ...cars.map((c) => ({ ref: c.id as CarRef, label: c.identity.name }))] as item (item.ref)}
      <label><input type="checkbox" checked={group.compare.includes(item.ref)} onchange={() => toggleCompare(item.ref)} />{item.label}</label>
    {/each}
  </div>

  <div class="head" style:color={role('textDim')}>{text.picker.window}</div>
  <div class="list">
    <button type="button" class:on={group.window.kind === 'live'} onclick={() => set({ window: live })}>{text.picker.live}</button>
    <button type="button" class:on={group.window.kind === 'lap'} onclick={() => set({ window: { kind: 'lap', lap: lapOf(group.window) } })}>{text.picker.lap}</button>
    <button type="button" class:on={group.window.kind === 'range'} onclick={() => set({ window: { kind: 'range', from: lapOf(group.window), to: toOf(group.window) } })}
      >{text.picker.range}</button
    >
  </div>
  {#if group.window.kind === 'lap'}
    <label><input type="number" min="1" value={group.window.lap} onchange={(e) => set({ window: { kind: 'lap', lap: numberFrom(e) } })} />{text.picker.lap}</label>
  {:else if group.window.kind === 'range'}
    {@const range = group.window}
    <label><input type="number" min="1" value={range.from} onchange={(e) => set({ window: { ...range, from: numberFrom(e) } })} />{text.picker.from}</label>
    <label><input type="number" min="1" value={range.to} onchange={(e) => set({ window: { ...range, to: numberFrom(e) } })} />{text.picker.to}</label>
  {/if}
</Overlay>

<style>
  .list {
    display: flex;
    flex-wrap: wrap;
    column-gap: var(--pw-col-gap);
  }
  button {
    font-family: var(--pw-font);
    font-size: inherit;
    color: inherit;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  button.on {
    color: var(--pw-ownCar);
    font-weight: var(--pw-weight-bold);
  }
  label {
    display: inline-flex;
    gap: 1ch;
  }
  input[type='number'] {
    font-family: var(--pw-font);
    font-size: inherit;
    color: inherit;
    background: none;
    border: var(--pw-border-px) solid var(--pw-border);
    width: 5ch;
  }
</style>
