<script lang="ts">
  // Tier-1 alerts (spec 7.7): at most three in red until acknowledged, then `+N`, which opens the mute list.
  import { ackToken } from '@pitwall/contracts';
  import { useOverlayStack } from '../../commands/overlay-stack.ts';
  import * as text from '../../../kit/text.ts';
  import { role } from '../../../theme/index.ts';
  import InsightLine from '../../../kit/insight/InsightLine.svelte';
  import { INSIGHT_CATEGORIES } from '../alerts.ts';
  import type { TopBarModel } from '../model.svelte.ts';

  let { bar }: { bar: TopBarModel } = $props();
  let open = $state(false);
  // The list is an overlay of the window: the shell's single key listener closes the newest one on Escape.
  const stack = useOverlayStack();
  $effect(() => {
    if (!open || stack === undefined) return;
    return stack.add(() => (open = false));
  });
  // Without a shell (no stack) the list handles Escape itself, on the element only.
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || stack !== undefined) return;
    open = false;
  };
  // The list is reachable while alerts are hidden, and while a group is muted (it is where a mute is undone).
  const listed = $derived(bar.hidden > 0 || bar.muted.length > 0);
</script>

{#each bar.shown as alert (alert.key)}
  <span class="alert" style:color={role('critical')}>
    <span data-testid="alert-{alert.key}">{text.topBar.alertMark} <InsightLine insight={alert} acknowledged={false} /></span>
    <button
      type="button"
      class="pw-button"
      data-testid="alert-ack-{alert.key}"
      aria-label={text.topBar.acknowledge}
      style:color={role('textFaint')}
      onclick={() => bar.send({ kind: 'alert.ack', key: ackToken(alert) })}
    >{text.topBar.ack}</button>
  </span>
{/each}
{#if listed}
  <button type="button" class="pw-button" data-testid="alerts-more" style:color={role('textDim')} onclick={() => (open = !open)}
    >{bar.hidden > 0 ? text.topBar.moreAlerts(bar.hidden) : text.topBar.mutedGroups(bar.muted.length)}</button
  >
{/if}
{#if open && listed}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <ul class="mute" style:background={role('bgBand')} onkeydown={onKeydown}>
    {#each INSIGHT_CATEGORIES as category (category)}
      {@const muted = bar.muted.includes(category)}
      <li>
        <button
          type="button"
          class="pw-button"
          data-testid="mute-{category}"
          style:color={role(muted ? 'textFaint' : 'text')}
          onclick={() => bar.send({ kind: 'alertGroup.mute', category, muted: !muted })}
        >{text.alertGroups.category[category]}{text.separator}{muted ? text.alertGroups.unmute : text.alertGroups.mute}</button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .alert {
    display: inline-flex;
    gap: var(--pw-header-pad);
  }
  .mute {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 1;
    list-style: none;
    margin: 0;
    padding: 0 var(--pw-header-pad);
  }
</style>
