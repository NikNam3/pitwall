<script lang="ts" module>
  /** Each picker's radio groups get their own names: several pickers (the gallery's cells) never share a group. */
  let pickers = 0;
</script>

<script lang="ts">
  // The picker of `basis.pick` (SP4.3e spec §4.2, SP4.3f spec §4.4): in a session the basis and plan picker
  // (`SessionPicker`), between sessions the planning-round picker (`PlanningPicker`). Between sessions is the window's
  // feed without `session.info` (its topic has no data) or with `feed.status.betweenSessions` (C64: both through the store).
  import type { ActionOutcome, FeedStatus, UiAction } from '@pitwall/contracts';
  import type { FeedId } from '@pitwall/domain';
  import { onDestroy } from 'svelte';
  import type { TopicStore } from '../../connection/topic-store.svelte.ts';
  import PlanningPicker from './PlanningPicker.svelte';
  import SessionPicker from './SessionPicker.svelte';

  type Props = {
    store: TopicStore;
    feedId: FeedId;
    send: (action: UiAction) => Promise<ActionOutcome>;
    onClose: () => void;
  };
  let { store, feedId, send, onClose }: Props = $props();

  pickers += 1;
  const name = `basis-picker-${pickers}`;

  // The feed is fixed while the picker is open: the shell opens a new one for another feed.
  // svelte-ignore state_referenced_locally
  const held = [store.acquire({ topic: 'session.info', params: {}, feedId }), store.acquire({ topic: 'feed.status', params: {}, feedId })] as const;
  onDestroy(() => held.forEach((h) => h.release()));
  const [sessionEntry, statusEntry] = held;

  const status = $derived<FeedStatus | undefined>(statusEntry.state.status === 'ok' ? statusEntry.state.value : undefined);
  const between = $derived(sessionEntry.state.status === 'noData' || status?.betweenSessions === true);
</script>

{#if between}
  <PlanningPicker {store} {feedId} {name} {send} {onClose} />
{:else}
  <SessionPicker {store} {feedId} {name} {send} {onClose} />
{/if}
