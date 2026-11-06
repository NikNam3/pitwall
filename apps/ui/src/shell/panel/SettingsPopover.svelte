<script lang="ts">
  /* eslint-disable @typescript-eslint/no-explicit-any -- `any` is the wildcard of the widget contract's WidgetDecl */
  // The settings popover (spec 7.4, Task 0 overlays): one control per option the widget declares, then the link group
  // the panel follows (spec 7.5). Every option change reports the whole options object; the shell saves it with the window.
  import type { FeedId } from '@pitwall/domain';
  import { untrack } from 'svelte';
  import type { EntryState, TopicStore } from '../../connection/topic-store.svelte.ts';
  import * as text from '../../kit/text.ts';
  import type { OptionDecl, WidgetDecl } from '../../kit/types.ts';
  import { role } from '../../theme/index.ts';
  import Overlay from '../commands/Overlay.svelte';
  import type { AnchorBox } from '../commands/placement.ts';
  import { OVERLAY_COLS } from '../commands/overlay-sizes.ts';
  import { carLabel } from '../link-groups/car-label.ts';
  import { LINK_GROUP_IDS } from '../link-groups/group-ids.ts';

  type Cars = Array<{ id: number; identity: { name: string } }>;
  type Props = {
    /** Where a car option's choices come from: the feed's `cars.overview`. Without both, a car option lists no cars. */
    store?: TopicStore | undefined;
    feedId?: FeedId | undefined;
    decl: WidgetDecl<any, any>;
    /** The panel's saved option values; an option not in it has its default. */
    options: Readonly<Record<string, unknown>>;
    onChange: (options: Record<string, unknown>) => void;
    /** The link group the panel follows, and where a new choice goes. */
    linkGroup: number;
    onLinkGroup: (group: number) => void;
    onClose: () => void;
    anchor?: AnchorBox | undefined;
  };
  let { store, feedId, decl, options, onChange, linkGroup, onLinkGroup, onClose, anchor }: Props = $props();
  /** Radio group names are per popover, so the radios of two open popovers never form one group. */
  const uid = $props.id();

  const declared = $derived(Object.entries(decl.options as Record<string, OptionDecl<unknown>>));
  const hasCarOption = $derived(declared.some(([, option]) => option.kind === 'car'));

  let overview = $state.raw<EntryState<Cars> | undefined>();
  $effect(() => {
    const [topics, feed] = [store, feedId];
    if (topics === undefined || feed === undefined || !hasCarOption) {
      overview = undefined;
      return;
    }
    const held = untrack(() => topics.acquire({ topic: 'cars.overview', params: {}, feedId: feed }));
    overview = held.state as EntryState<Cars>;
    return () => held.release();
  });
  /** The session's cars by id; undefined while `cars.overview` has no value. */
  const cars = $derived(overview?.status === 'ok' && overview.value !== undefined ? [...overview.value].sort((a, b) => a.id - b.id) : undefined);
  const valueOf = (name: string, option: OptionDecl<unknown>): unknown => (name in options ? options[name] : option.default);
  const change = (name: string, value: unknown): void => {
    const { [name]: _replaced, ...rest } = options;
    onChange(value === undefined ? rest : { ...rest, [name]: value });
  };
  const clamp = (v: number, range: { min: number; max: number }): number => Math.min(range.max, Math.max(range.min, v));
  /** The value of the unset choice; the shown text is `text.followLink` or `text.noCar` by the option's `unset`. */
  const UNSET = '';
</script>

<Overlay title={text.settingsTitle(decl.title)} {onClose} {anchor} cols={OVERLAY_COLS.narrow}>
  {#each declared as [name, option] (name)}
    {@const current = valueOf(name, option)}
    {#if option.kind === 'bool'}
      <label><input type="checkbox" checked={current === true} onchange={(e) => change(name, e.currentTarget.checked)} />{option.label}</label>
    {:else if option.kind === 'choice'}
      <div role="radiogroup" aria-label={option.label}>
        <span style:color={role('textDim')}>{option.label}</span>
        {#each option.choices as choice (choice)}
          <label><input type="radio" name="{uid}.{name}" checked={current === choice} onchange={() => change(name, choice)} />{choice}</label>
        {/each}
      </div>
    {:else if option.kind === 'number'}
      <label
        ><span style:color={role('textDim')}>{option.label}</span>
        <input
          type="number"
          class="pw-input"
          aria-label={option.label}
          min={option.range.min}
          max={option.range.max}
          step={option.range.step}
          value={typeof current === 'number' ? current : option.default}
          onchange={(e) => {
            const v = e.currentTarget.valueAsNumber;
            if (Number.isFinite(v)) change(name, clamp(v, option.range));
          }}
        /></label
      >
    {:else}
      <label
        ><span style:color={role('textDim')}>{option.label}</span>
        <select
          class="pw-input"
          aria-label={option.label}
          value={current === undefined ? UNSET : String(current)}
          onchange={(e) => change(name, e.currentTarget.value === UNSET ? undefined : /^\d+$/.test(e.currentTarget.value) ? Number(e.currentTarget.value) : e.currentTarget.value)}
        >
          <option value={UNSET}>{option.unset === 'none' ? text.noCar : text.followLink}</option>
          <option value="player">{text.picker.player}</option>
          <option value="teammate">{text.picker.teammate}</option>
          {#each cars ?? [] as car (car.id)}<option value={String(car.id)}>{carLabel(car.identity.name)}</option>{/each}
          {#if typeof current === 'number' && !cars?.some((car) => car.id === current)}<option value={String(current)}>{current}</option>{/if}
        </select></label
      >
    {/if}
  {:else}
    <div style:color={role('textFaint')}>{text.noSettings}</div>
  {/each}
  <div role="radiogroup" aria-label={text.linkGroup}>
    <span style:color={role('textDim')}>{text.linkGroup}</span>
    {#each LINK_GROUP_IDS as id (id)}
      <label><input type="radio" name="{uid}-link-group" checked={linkGroup === id} onchange={() => onLinkGroup(id)} />{id}</label>
    {/each}
  </div>
  <div style:color={role('textFaint')}>{text.settingsSaved}</div>
</Overlay>

<style>
  label {
    display: inline-flex;
    gap: var(--pw-col-gap);
    margin-right: var(--pw-col-gap);
  }
  div[role='radiogroup'] {
    display: flex;
    gap: var(--pw-col-gap);
  }
</style>
