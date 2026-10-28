<script lang="ts" generics="T">
  // The one cell that renders any value in every state (spec 5): known, unknown, estimated, stale.
  import type { Known } from '@pitwall/domain';
  import { role } from '../../theme/index.ts';
  import { usePanelStale } from '../stale/panel-stale.ts';
  import { isStale } from '../stale/stale.ts';
  import { estimatedPrefix } from '../text.ts';
  import { CAR_FIELD_SOURCE, type CarFieldPath } from './car-sources.ts';
  import type { CarState } from '@pitwall/domain';

  type Props = {
    value: Known<T> | T;
    format: (v: T) => string;
    /** Marks the value as coming from a car field, so it dims when that field's source falls behind. */
    car?: { updatedAt: CarState['updatedAt']; field: CarFieldPath } | undefined;
    estimated?: boolean | undefined;
    /** Minimum width in character cells. */
    widthCols?: number | undefined;
    align?: 'left' | 'right' | undefined;
  };
  let { value, format, car, estimated = false, widthCols, align = 'right' }: Props = $props();

  const panel = usePanelStale();
  const id = Symbol('value');

  const isKnownWrapper = (v: Known<T> | T): v is Known<T> =>
    typeof v === 'object' && v !== null && 'known' in v && typeof (v as { known: unknown }).known === 'boolean';

  const unwrapped = $derived(isKnownWrapper(value) ? value : { known: true as const, value: value as T });
  const age = $derived.by(() => {
    const now = panel?.clock.now();
    if (!car || now === undefined) return undefined;
    const source = CAR_FIELD_SOURCE[car.field];
    const updatedAt = car.updatedAt[source];
    if (updatedAt === undefined || !isStale(updatedAt, source, now, panel?.clock.cadenceMs())) return undefined;
    return now - updatedAt;
  });
  const stale = $derived(age !== undefined);

  $effect(() => {
    panel?.reportStale(id, age);
    return () => panel?.reportStale(id, undefined);
  });

  const colour = $derived(stale ? role('textFaint') : estimated ? role('textDim') : undefined);
</script>

<span
  class="value"
  class:stale
  class:estimated
  class:left={align === 'left'}
  title={unwrapped.known ? undefined : unwrapped.reason}
  style:color={colour}
  style:min-width={widthCols === undefined ? undefined : `${widthCols}ch`}
>{#if unwrapped.known}{estimated ? estimatedPrefix : ''}{format(unwrapped.value)}{/if}</span>

<style>
  .value {
    display: inline-block;
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .left {
    text-align: left;
  }
</style>
