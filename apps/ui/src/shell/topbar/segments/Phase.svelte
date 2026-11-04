<script lang="ts">
  // The session phase (formation, start, SC/VSC with its stage, red, finished, paused); hidden while racing.
  import * as text from '../../../kit/text.ts';
  import { role } from '../../../theme/index.ts';
  import type { TopBarModel } from '../model.svelte.ts';

  let { bar }: { bar: TopBarModel } = $props();
  const shown = $derived(bar.phase);
</script>

{#if shown !== undefined}
  <span data-testid="phase" style:color={role(shown.role ?? 'textFaint')}>{shown.label}{#if shown.stage !== undefined} {text.topBar.phaseStage[shown.stage]}{/if}</span>
{/if}
