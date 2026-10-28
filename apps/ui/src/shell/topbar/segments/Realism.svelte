<script lang="ts">
  // Realism mode of this session (fixed from its start) and, when it differs, the value for the next session.
  // A click sets the next session's value.
  import * as text from '../../../kit/text.ts';
  import { role } from '../../../theme/index.ts';
  import type { TopBarModel } from '../model.svelte.ts';

  let { bar }: { bar: TopBarModel } = $props();
  const current = $derived(bar.session?.realism);
  const next = $derived(bar.settings?.realismNextSession);
  const pending = $derived(current !== undefined && next !== undefined && next !== current);
</script>

{#if current !== undefined}
  <button
    type="button"
    class="pw-button"
    data-testid="realism"
    style:color={role('textFaint')}
    onclick={() => bar.send({ kind: 'realism.set', enabled: !(next ?? current) })}
  >{current ? text.topBar.realismOn : text.topBar.realismOff}{#if pending && next !== undefined}<span style:color={role('text')}> {text.topBar.realismNext(next)}</span>{/if}</button>
{/if}
