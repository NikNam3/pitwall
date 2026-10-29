<script lang="ts">
  // The race moment (spec 3.4, 7): its name only, from `raceMoment.current`; nothing while it is unknown or not published.
  import * as text from '../../../kit/text.ts';
  import { role } from '../../../theme/index.ts';
  import type { TopBarModel } from '../model.svelte.ts';

  let { bar }: { bar: TopBarModel } = $props();
  const moment = $derived(bar.moment);
</script>

{#if moment !== undefined}
  <span data-testid="moment" style:color={role('text')}>{text.topBar.moment[moment]}</span>
{/if}
