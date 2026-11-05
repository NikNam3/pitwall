<script lang="ts">
  // The talk window of the player car (spec 7.4): a dot, grey while clear, amber while busy; nothing while unknown.
  import { talkRole } from '../../../emphasis/talk.ts';
  import * as text from '../../../kit/text.ts';
  import { role } from '../../../theme/index.ts';
  import type { TopBarModel } from '../model.svelte.ts';

  let { bar }: { bar: TopBarModel } = $props();
  const talk = $derived(bar.talk);
</script>

{#if talk !== undefined}
  <span data-testid="talk" title={text.topBar.talk[talk]} style:color={role(talkRole(talk))}>●</span>
{/if}
