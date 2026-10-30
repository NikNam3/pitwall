<script lang="ts" generics="T">
  // The one cell that renders any value in every state (spec 5): known, unknown, estimated, stale.
  import type { Known } from '@pitwall/domain';
  import { roleOrUndefined } from '../../theme/index.ts';
  import { useStaleCarFields } from '../stale/panel-stale.ts';
  import { staleRole } from '../stale/stale.ts';
  import { estimatedPrefix } from '../text.ts';
  import type { CarFieldPath } from './car-sources.ts';
  import { unknownShown } from './unknown-mark.ts';
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

  const isKnownWrapper = (v: Known<T> | T): v is Known<T> =>
    typeof v === 'object' && v !== null && 'known' in v && typeof (v as { known: unknown }).known === 'boolean';

  const unwrapped = $derived(isKnownWrapper(value) ? value : { known: true as const, value: value as T });
  const carStale = useStaleCarFields(() => (car === undefined ? undefined : { updatedAt: car.updatedAt, fields: [car.field] }));
  const stale = $derived(car !== undefined && carStale.isStale(car.field));

  const shownUnknown = $derived(unwrapped.known ? undefined : unknownShown(unwrapped.reason));
  // An unknown is its reason's faint mark, whatever else holds; a known value dims when estimated, fainter when stale.
  const colour = $derived(shownUnknown?.colour ?? roleOrUndefined(staleRole(estimated ? 'textDim' : undefined, stale)));
</script>

<span
  class="value"
  class:stale
  class:estimated
  class:left={align === 'left'}
  title={shownUnknown?.title}
  style:color={colour}
  style:min-width={widthCols === undefined ? undefined : `${widthCols}ch`}
>{#if unwrapped.known}{estimated ? estimatedPrefix : ''}{format(unwrapped.value)}{:else}{shownUnknown?.text}{/if}</span>

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
