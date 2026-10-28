<script lang="ts">
  // Session kind, track, the player's lap and the session clock, grey: nothing here is a warning.
  import * as text from '../../../kit/text.ts';
  import { formatCount, formatSessionClock, formatSessionKind, formatTrack } from '../../../kit/values/format.ts';
  import { role } from '../../../theme/index.ts';
  import type { TopBarModel } from '../model.svelte.ts';

  let { bar }: { bar: TopBarModel } = $props();
  const s = $derived(bar.session?.session);
  const lap = $derived(bar.playerLap);
  // A time trial has no time limit: its clock counts up. Every other session shows the time left (mockup 9).
  const clockMs = $derived(s === undefined ? undefined : s.kind === 'timeTrial' ? s.updatedAt : s.timeLeftMs);
</script>

{#if s !== undefined}
  <span style:color={role('text')}>{formatSessionKind(s.kind)}</span>
  <span>{formatTrack(s.trackId)}</span>
  {#if lap === undefined}
    <span>{text.topBar.laps(formatCount(s.totalLaps))}</span>
  {:else}
    <span>{text.topBar.lapOf(formatCount(lap), s.totalLaps > 0 ? formatCount(s.totalLaps) : undefined)}</span>
  {/if}
  {#if clockMs !== undefined}<span>{formatSessionClock(clockMs)}</span>{/if}
{/if}
