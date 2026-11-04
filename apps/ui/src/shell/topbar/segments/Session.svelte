<script lang="ts">
  // Session name (by the weekend phase), track, the player's lap and the session clock, grey: nothing here is a warning.
  import * as text from '../../../kit/text.ts';
  import { formatCount, formatSessionClock, formatSessionKind, formatTrack } from '../../../kit/values/format.ts';
  import { role } from '../../../theme/index.ts';
  import type { TopBarModel } from '../model.svelte.ts';
  import { sessionOf } from '../session-presentation.ts';

  let { bar }: { bar: TopBarModel } = $props();
  const s = $derived(bar.session?.session);
  const lap = $derived(bar.playerLap);
  const shown = $derived(sessionOf(bar.weekendPhase));
  // A session without a time limit (weekend phase `none`) counts up; every other session shows the time left (mockup 9),
  // also while the phase is pending.
  const clockMs = $derived(s === undefined ? undefined : shown?.clock === 'countsUp' ? s.updatedAt : s.timeLeftMs);
</script>

{#if s !== undefined}
  {#if shown?.name !== undefined}<span style:color={role('text')}>{formatSessionKind(shown.name)}</span>{/if}
  <span>{formatTrack(s.trackId)}</span>
  {#if lap === undefined}
    <span>{text.topBar.laps(formatCount(s.totalLaps))}</span>
  {:else}
    <span>{text.topBar.lapOf(formatCount(lap), s.totalLaps > 0 ? formatCount(s.totalLaps) : undefined)}</span>
  {/if}
  {#if clockMs !== undefined}<span>{formatSessionClock(clockMs)}</span>{/if}
{/if}
