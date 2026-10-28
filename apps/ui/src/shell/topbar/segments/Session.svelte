<script lang="ts">
  // Session kind, track and laps, grey: nothing here is a warning.
  import * as text from '../../../kit/text.ts';
  import { formatCount, formatSessionKind, formatTrack } from '../../../kit/values/format.ts';
  import { role } from '../../../theme/index.ts';
  import type { TopBarModel } from '../model.svelte.ts';

  let { bar }: { bar: TopBarModel } = $props();
  const s = $derived(bar.session?.session);
</script>

{#if s !== undefined}
  <span style:color={role('text')}>{formatSessionKind(s.kind)}</span>
  <span>{formatTrack(s.trackId)}</span>
  <span>{text.topBar.laps(formatCount(s.totalLaps))}</span>
{/if}
