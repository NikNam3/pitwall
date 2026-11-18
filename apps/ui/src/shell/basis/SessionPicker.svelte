<script lang="ts">
  // The basis and plan picker in a session (`basis.pick`, SP4.3e spec §4.2, §4.3): practice (several), qualifying (one)
  // and plan (one), each with none; the candidates are the feed's `basis.active` sessions and the team's saved plans
  // (`plans.prepared`). The draft is window-local (C73) and starts at the basis in use; Confirm sends one `basis.choose`.
  // The picker closes on the bridge's ok and shows its rejection; the top bar follows what the bridge publishes.
  import type { ActionOutcome, BasisActive, PlanningRoundState, UiAction } from '@pitwall/contracts';
  import type { FeedId } from '@pitwall/domain';
  import { onDestroy } from 'svelte';
  import type { TopicStore } from '../../connection/topic-store.svelte.ts';
  import * as text from '../../kit/text.ts';
  import { formatCount, formatDay } from '../../kit/values/format.ts';
  import { role } from '../../theme/index.ts';
  import Overlay from '../commands/Overlay.svelte';
  import { OVERLAY_COLS } from '../commands/overlay-sizes.ts';
  import { chosen, planOptions, refOf, sessionOptions, type BasisDraft, type SessionOption } from './candidates.ts';
  import Marks from './Marks.svelte';

  type Props = {
    store: TopicStore;
    feedId: FeedId;
    /** The picker's radio-group prefix: several pickers (the gallery's cells) never share a group. */
    name: string;
    send: (action: UiAction) => Promise<ActionOutcome>;
    onClose: () => void;
  };
  let { store, feedId, name, send, onClose }: Props = $props();

  // The feed is fixed while the picker is open: the shell opens a new one for another feed.
  // svelte-ignore state_referenced_locally
  const held = [store.acquire({ topic: 'basis.active', params: {}, feedId }), store.acquire({ topic: 'plans.prepared', params: {}, feedId })] as const;
  onDestroy(() => held.forEach((h) => h.release()));
  const [activeEntry, preparedEntry] = held;

  const active = $derived<BasisActive | undefined>(activeEntry.state.status === 'ok' ? activeEntry.state.value : undefined);
  const prepared = $derived<PlanningRoundState | undefined>(preparedEntry.state.status === 'ok' ? preparedEntry.state.value : undefined);

  const practice = $derived(active === undefined ? [] : sessionOptions(active, 'practice'));
  const qualifying = $derived(active === undefined ? [] : sessionOptions(active, 'qualifying'));
  const plans = $derived(planOptions(prepared?.saved ?? [], active));

  let draft = $state<BasisDraft>({});
  const choice = $derived(active === undefined ? undefined : chosen(draft, active));
  let sending = $state(false);
  let error = $state<string | undefined>();

  const togglePractice = (key: string, on: boolean): void => {
    const now = choice?.practice ?? [];
    draft = { ...draft, practice: on ? [...now.filter((k) => k !== key), key] : now.filter((k) => k !== key) };
    error = undefined;
  };
  const choose = (part: 'qualifying' | 'plan', value: string | null): void => {
    draft = { ...draft, [part]: value };
    error = undefined;
  };

  const action = $derived.by((): UiAction | undefined => {
    if (choice === undefined) return undefined;
    const q = choice.qualifying === null ? null : refOf(choice.qualifying);
    return { kind: 'basis.choose', feedId, basis: { practice: choice.practice.map(refOf), qualifying: q }, plan: choice.plan };
  });

  async function confirm(): Promise<void> {
    const next = action;
    if (next === undefined || sending) return;
    sending = true;
    error = undefined;
    const outcome = await send(next);
    sending = false;
    if (outcome.ok) onClose();
    else error = outcome.message ?? text.basis.rejected;
  }
</script>

{#snippet sessionRow(kind: 'practice' | 'qualifying', option: SessionOption)}
  <label
    ><input
      type={kind === 'practice' ? 'checkbox' : 'radio'}
      name={kind === 'practice' ? undefined : `${name}-qualifying`}
      data-testid="{kind}-{option.key}"
      checked={kind === 'practice' ? (choice?.practice.includes(option.key) ?? false) : choice?.qualifying === option.key}
      onchange={(e) => (kind === 'practice' ? togglePractice(option.key, e.currentTarget.checked) : choose('qualifying', option.key))}
    />{formatDay(option.date)}<Marks lastChoice={option.lastChoice} stale={option.stale} /></label
  >
{/snippet}

<Overlay title={text.basis.title} {onClose} cols={OVERLAY_COLS.narrow}>
  <div data-testid="basis-picker">
    <div class="head" style:color={role('textDim')}>{text.basis.practice}</div>
    <div class="list">
      <label
        ><input
          type="checkbox"
          data-testid="practice-none"
          checked={(choice?.practice.length ?? 0) === 0}
          onchange={(e) => {
            draft = { ...draft, practice: [] };
            error = undefined;
            e.currentTarget.checked = true;
          }}
        />{text.basis.none}</label
      >
      {#each practice as option (option.key)}{@render sessionRow('practice', option)}{/each}
    </div>

    <div class="head" style:color={role('textDim')}>{text.basis.qualifying}</div>
    <div class="list">
      <label
        ><input
          type="radio"
          name="{name}-qualifying"
          data-testid="qualifying-none"
          checked={choice !== undefined && choice.qualifying === null}
          onchange={() => choose('qualifying', null)}
        />{text.basis.none}</label
      >
      {#each qualifying as option (option.key)}{@render sessionRow('qualifying', option)}{/each}
    </div>
    {#if active !== undefined && practice.length === 0 && qualifying.length === 0}
      <div style:color={role('textFaint')}>{text.basis.noSessions}</div>
    {/if}

    <div class="head" style:color={role('textDim')}>{text.basis.plan}</div>
    <div class="list">
      <label
        ><input type="radio" name="{name}-plan" data-testid="plan-none" checked={choice !== undefined && choice.plan === null} onchange={() => choose('plan', null)} />{text
          .basis.none}</label
      >
      {#each plans as option (option.id)}
        <label
          ><input
            type="radio"
            name="{name}-plan"
            data-testid="plan-{option.id}"
            checked={choice?.plan === option.id}
            onchange={() => choose('plan', option.id)}
          />{option.name}<Marks lastChoice={option.lastChoice} /></label
        >
      {/each}
    </div>
    {#if plans.length === 0}
      <div style:color={role('textFaint')}>{text.basis.noPlans}</div>
    {/if}

    {#if active !== undefined && active.rebuilding !== null}
      <div data-testid="basis-progress" style:color={role('textDim')}>
        {text.basis.rebuilding(formatCount(active.rebuilding.done), formatCount(active.rebuilding.total))}
      </div>
    {/if}
    {#if error !== undefined}
      <div data-testid="basis-error" style:color={role('warning')}>{error}</div>
    {/if}
    <div class="actions">
      <button type="button" class="pw-button" data-testid="basis-confirm" disabled={action === undefined || sending} onclick={() => void confirm()}
        >{text.basis.confirm}</button
      >
    </div>
  </div>
</Overlay>

<style>
  .list {
    display: flex;
    flex-direction: column;
  }
  label {
    display: inline-flex;
    gap: var(--pw-col-gap);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
