<script lang="ts">
  // The distribution strip (SP4.3b2; docs/design/2026-11-12-sp4.3b gen.mjs `DIST`): one text cell per bin, one line high.
  // places: P1 … Pn, our place a white underline (Q3 A); gain: signed bins around a white zero, between bins (a full
  // line) or under a bin (a tick), with an optional dotted mark. Bars share the caller's scale so rows compare (Q2 A).
  import { role } from '../../theme/index.ts';
  import { gainBars, placeBars, type GainZero } from './dist.ts';

  type Props =
    | { form: 'places'; pmf: readonly number[]; scale: number; lit?: boolean; ourPlace?: number | undefined }
    | { form: 'gain'; bins: readonly number[]; scale: number; zero: GainZero; lit?: boolean; markAtBin?: number | undefined };
  let props: Props = $props();

  /** One cell in viewBox units, and the strip's height: the mockup's 8.6 × 18 px cell, its bars from 2 to 15. */
  const CELL = 8;
  const H = 18;
  const TOP = 2;
  const BASE = H - 3;
  const n = $derived(props.form === 'places' ? props.pmf.length : props.bins.length);
  const W = $derived(n * CELL);
  const box = $derived({ w: W, h: BASE - TOP });
  const bars = $derived(
    props.form === 'places'
      ? placeBars(props.pmf, props.scale, box, props.lit ?? false)
      : gainBars(props.bins, props.scale, box, props.zero, props.lit ?? false),
  );
</script>

<svg
  class="dist-strip"
  data-form={props.form}
  data-cells={n}
  viewBox="0 0 {W} {H}"
  preserveAspectRatio="none"
  style:width="{n}ch"
  aria-hidden="true"
>
  <line class="base" x1="0" x2={W} y1={BASE + 0.5} y2={BASE + 0.5} stroke={role('border')} vector-effect="non-scaling-stroke" />
  {#each bars as bar, i (i)}
    <rect class="bar" x={bar.x} y={BASE - bar.h} width={bar.w} height={bar.h} fill={role(bar.role)} />
  {/each}
  {#if props.form === 'places'}
    {#if props.ourPlace !== undefined}
      <rect class="our-place" x={(props.ourPlace - 1) * CELL} y={BASE} width={CELL} height="2" fill={role('text')} />
    {/if}
  {:else}
    {#if 'between' in props.zero}
      {@const x = props.zero.between * CELL}
      <line class="zero" data-zero="between" x1={x} x2={x} y1="1" y2={H - 1} stroke={role('text')} vector-effect="non-scaling-stroke" />
    {:else}
      {@const x = (props.zero.underBin + 0.5) * CELL}
      <line class="zero" data-zero="under" x1={x} x2={x} y1={BASE} y2={H} stroke={role('text')} vector-effect="non-scaling-stroke" />
    {/if}
    {#if props.markAtBin !== undefined}
      {@const x = props.markAtBin * CELL}
      <line
        class="mark"
        x1={x}
        x2={x}
        y1="1"
        y2={H - 1}
        stroke={role('textDim')}
        stroke-dasharray="1.5 2"
        vector-effect="non-scaling-stroke"
      />
    {/if}
  {/if}
</svg>

<style>
  .dist-strip {
    display: inline-block;
    height: 1lh;
    vertical-align: top;
  }
</style>
