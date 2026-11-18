<script lang="ts" module>
  /** Each prompt's radio group gets its own name: several prompts (the gallery's cells) never share a group. */
  let prompts = 0;
</script>

<script lang="ts">
  // The name prompt "Save plan" (`plans.save.pick`, SP4.3f spec §4.4; the user's layout of 2026-11-18): saves the open
  // planning round of the window's feed (`plans.prepared`, through the store, C64) as a saved plan. The draft is
  // window-local (C73): the name, prefilled `<track> <day> <hh:mm>` of the window's clock when the prompt opened, and
  // the saved plan of the team on the track to overwrite, none at first. Save sends one `plans.save` (an empty name
  // sends none: the bridge names it); the prompt closes on the bridge's ok and shows its rejection. cancel closes it.
  import type { ActionOutcome, PlanningRoundState, UiAction } from '@pitwall/contracts';
  import type { FeedId } from '@pitwall/domain';
  import { onDestroy } from 'svelte';
  import type { TopicStore } from '../../connection/topic-store.svelte.ts';
  import * as text from '../../kit/text.ts';
  import { formatDayTime, formatTrack } from '../../kit/values/format.ts';
  import { role } from '../../theme/index.ts';
  import { planOptions } from '../basis/candidates.ts';
  import Overlay from '../commands/Overlay.svelte';
  import { OVERLAY_COLS } from '../commands/overlay-sizes.ts';

  type Props = {
    store: TopicStore;
    feedId: FeedId;
    send: (action: UiAction) => Promise<ActionOutcome>;
    onClose: () => void;
  };
  let { store, feedId, send, onClose }: Props = $props();

  prompts += 1;
  const group = `plan-save-${prompts}`;
  /** The window's clock when the prompt opened: the prefilled name's day and time. */
  const openedAt = new Date();

  // The feed is fixed while the prompt is open: the shell opens a new one for another feed.
  // svelte-ignore state_referenced_locally
  const held = store.acquire({ topic: 'plans.prepared', params: {}, feedId });
  onDestroy(() => held.release());
  const round = $derived.by(() => {
    const value: PlanningRoundState | undefined = held.state.status === 'ok' ? held.state.value : undefined;
    return value?.open === true ? value : undefined;
  });
  const saved = $derived(round === undefined ? [] : planOptions(round.saved, undefined));
  const prefill = $derived(round === undefined ? '' : text.planSave.prefill(formatTrack(round.trackId), formatDayTime(openedAt)));

  let typed = $state<string | undefined>();
  const name = $derived(typed ?? prefill);
  let replaces = $state<string | undefined>();
  let sending = $state(false);
  let error = $state<string | undefined>();

  async function save(): Promise<void> {
    if (round === undefined || sending) return;
    const trimmed = name.trim();
    const action: UiAction = {
      kind: 'plans.save',
      feedId,
      ...(trimmed !== '' && { name: trimmed }),
      ...(replaces !== undefined && { replaces }),
    };
    sending = true;
    error = undefined;
    const outcome = await send(action);
    sending = false;
    if (outcome.ok) onClose();
    else error = outcome.message ?? text.planSave.rejected;
  }
</script>

<!-- The prompt with its title: the overlay's band is part of it. -->
<div class="prompt" data-testid="plan-save-picker">
  <Overlay title={text.planSave.title} {onClose} cols={OVERLAY_COLS.narrow}>
    <label class="name"
      ><span style:color={role('textDim')}>{text.planSave.name}</span><input
        type="text"
        class="pw-input"
        spellcheck="false"
        data-testid="plan-save-name"
        value={name}
        oninput={(e) => {
          typed = e.currentTarget.value;
          error = undefined;
        }}
      /></label
    >
    <div class="list">
      {#each saved as plan (plan.id)}
        <label
          ><input
            type="radio"
            name={group}
            data-testid="plan-save-replaces-{plan.id}"
            checked={replaces === plan.id}
            onchange={() => {
              replaces = plan.id;
              error = undefined;
            }}
          /><span style:color={role('textDim')}>{text.planSave.overwrite}</span> <span>{plan.name}</span></label
        >
      {/each}
    </div>
    {#if error !== undefined}
      <div data-testid="plan-save-error" style:color={role('warning')}>{error}</div>
    {/if}
    <div class="actions">
      <button type="button" class="pw-button" data-testid="plan-save-cancel" onclick={onClose}>{text.planSave.cancel}</button>
      <button type="button" class="pw-button" data-testid="plan-save-confirm" disabled={round === undefined || sending} onclick={() => void save()}
        >{text.planSave.confirm}</button
      >
    </div>
  </Overlay>
</div>

<style>
  .prompt {
    display: contents;
  }
  .list {
    display: flex;
    flex-direction: column;
  }
  label {
    display: inline-flex;
    gap: var(--pw-col-gap);
  }
  .name {
    display: flex;
  }
  .name input {
    flex: 1;
    min-width: 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--pw-col-gap);
  }
</style>
