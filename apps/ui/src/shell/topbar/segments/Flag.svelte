<script lang="ts">
  // The session flag: coloured only when it is not green (a safety car is yellow).
  import { flagRole } from '../../../emphasis/index.ts';
  import * as text from '../../../kit/text.ts';
  import { role } from '../../../theme/index.ts';
  import type { TopBarModel } from '../model.svelte.ts';

  let { bar }: { bar: TopBarModel } = $props();
  const flag = $derived(bar.session?.session.flag);
  const emphasis = $derived(flag === 'sc' || flag === 'vsc' ? flagRole('yellow') : undefined);
</script>

{#if flag !== undefined}
  <span style:color={role(emphasis ?? 'textFaint')}>{text.topBar.flag[flag]}</span>
{/if}
