<script lang="ts">
  // The picker between sessions (`basis.pick`, SP4.3f spec §4.4): the track, that track's qualifying per team it is
  // stored for (the team comes with it, its cars shown) and that team's practice (several or none), from the global
  // `plans.sessions` (C64); no plan part (a round plans, a race chooses one). The draft is window-local (C73) and starts
  // at the preselection (`candidates.ts` `planningChoice`); Confirm sends one `plans.round.open` with the qualifying's
  // team, never the feed's, and no race (the bridge takes the race assumptions' defaults). The picker closes on the
  // bridge's ok and shows its rejection.
  import type { ActionOutcome, PlansSessions, UiAction } from '@pitwall/contracts';
  import type { FeedId, TrackId } from '@pitwall/domain';
  import { onDestroy } from 'svelte';
  import type { TopicStore } from '../../connection/topic-store.svelte.ts';
  import * as text from '../../kit/text.ts';
  import { formatDay, formatRaceNumber, formatTrack } from '../../kit/values/format.ts';
  import { role } from '../../theme/index.ts';
  import Overlay from '../commands/Overlay.svelte';
  import { OVERLAY_COLS } from '../commands/overlay-sizes.ts';
  import { planningChoice, practiceOptions, qualifyingKey, qualifyingOptions, sessionKey, trackOptions, type PlanningDraft } from './candidates.ts';
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

  // svelte-ignore state_referenced_locally
  const held = store.acquire({ topic: 'plans.sessions', params: {} });
  onDestroy(() => held.release());
  const sessions = $derived<PlansSessions | undefined>(held.state.status === 'ok' ? held.state.value : undefined);

  let draft = $state<PlanningDraft>({});
  const choice = $derived(sessions === undefined ? undefined : planningChoice(draft, sessions));
  const tracks = $derived(sessions === undefined ? [] : trackOptions(sessions));
  const qualifying = $derived(sessions === undefined || choice === undefined ? [] : qualifyingOptions(sessions, choice.trackId));
  const practice = $derived(sessions === undefined || choice === undefined ? [] : practiceOptions(sessions, choice.qualifying));
  const practiceKeys = $derived(new Set(choice?.practice.map((p) => sessionKey(p.ref)) ?? []));
  let sending = $state(false);
  let error = $state<string | undefined>();

  // A new track starts at its preselection, a new qualifying at its practice preselection.
  const chooseTrack = (trackId: TrackId): void => {
    draft = { trackId };
    error = undefined;
  };
  const chooseQualifying = (key: string): void => {
    if (choice === undefined) return;
    draft = { trackId: choice.trackId, qualifying: key };
    error = undefined;
  };
  const setPractice = (keys: readonly string[]): void => {
    if (choice === undefined) return;
    draft = { trackId: choice.trackId, qualifying: qualifyingKey(choice.qualifying), practice: keys };
    error = undefined;
  };
  const togglePractice = (key: string, on: boolean): void => {
    const now = [...practiceKeys].filter((k) => k !== key);
    setPractice(on ? [...now, key] : now);
  };

  const action = $derived.by((): UiAction | undefined => {
    if (choice === undefined) return undefined;
    const q = choice.qualifying;
    return { kind: 'plans.round.open', feedId, qualifying: q.ref, team: q.team, practice: choice.practice.map((p) => p.ref) };
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

<Overlay title={text.basis.planning.title} {onClose} cols={OVERLAY_COLS.narrow}>
  <div data-testid="basis-picker">
    {#if sessions !== undefined && choice === undefined}
      <div style:color={role('textFaint')}>{text.basis.planning.noQualifying}</div>
    {:else if choice !== undefined}
      <div class="head" style:color={role('textDim')}>{text.basis.planning.track}</div>
      <div class="list">
        {#each tracks as option (option.trackId)}
          <label
            ><input
              type="radio"
              name="{name}-track"
              data-testid="track-{option.trackId}"
              checked={choice.trackId === option.trackId}
              onchange={() => chooseTrack(option.trackId)}
            />{formatTrack(option.trackId)}<span style:color={role('textDim')}>{formatDay(option.newest)}</span></label
          >
        {/each}
      </div>

      <div class="head" style:color={role('textDim')}>{text.basis.qualifying}</div>
      <div class="list">
        {#each qualifying as option (qualifyingKey(option))}
          <label
            ><input
              type="radio"
              name="{name}-qualifying"
              data-testid="qualifying-{qualifyingKey(option)}"
              checked={qualifyingKey(choice.qualifying) === qualifyingKey(option)}
              onchange={() => chooseQualifying(qualifyingKey(option))}
            />{text.basis.planning.qualifying(
              formatDay(option.startedAt),
              text.teamName(option.team),
              option.cars.map((c) => formatRaceNumber(c.raceNumber)),
            )}<Marks stale={option.stale} /></label
          >
        {/each}
      </div>

      <div class="head" style:color={role('textDim')}>{text.basis.practice}</div>
      <div class="list">
        <label
          ><input
            type="checkbox"
            data-testid="practice-none"
            checked={practiceKeys.size === 0}
            onchange={(e) => {
              setPractice([]);
              e.currentTarget.checked = true;
            }}
          />{text.basis.none}</label
        >
        {#each practice as option (sessionKey(option.ref))}
          <label
            ><input
              type="checkbox"
              data-testid="practice-{sessionKey(option.ref)}"
              checked={practiceKeys.has(sessionKey(option.ref))}
              onchange={(e) => togglePractice(sessionKey(option.ref), e.currentTarget.checked)}
            />{formatDay(option.startedAt)}<Marks stale={option.stale} /></label
          >
        {/each}
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
