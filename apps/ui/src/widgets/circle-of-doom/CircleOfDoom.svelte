<script lang="ts">
  // The circle of doom (SP4.3d spec §6.5, V01; mockup docs/design/2026-11-16-sp4.3d/circle-of-doom.html): the field as one
  // lap around one of our cars, ours at the top, clockwise = behind us; our teammate a white ring; the ghosts of a stop now
  // (G, V, S), the current condition's white with its rejoin place and the gaps around it. Where a car, a label or a ghost
  // sits is the kit's (`polarOf`, `placeCircleLabels`), the sizes are `layout.ts`'s; the display draws them (C65).
  import type { CarId, CircleCar, CircleGhost, UnknownReason } from '@pitwall/domain';
  import { carCodeById } from '../../kit/car/car-label.ts';
  import { placeCircleLabels, polarOf, type CarLabel, type Point } from '../../kit/circle/index.ts';
  import { knownPart, type CellPart } from '../../kit/grid/grid.ts';
  import { formatPosition, formatSeconds } from '../../kit/values/format.ts';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { unknownShown } from '../../kit/values/unknown-mark.ts';
  import type { WidgetProps } from '../../kit/types.ts';
  import { DEFAULT_THEME, role } from '../../theme/index.ts';
  import { carRole, ghostFillRole, ghostRole, gapsRole, ownRole, ringRole, type CarKind } from './emphasis.ts';
  import { circleLayout, MARKS } from './layout.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  type DrawnCar = { carId: CarId; code: string; kind: CarKind; at: Point };
  type DrawnGhost = { ghost: CircleGhost; on: boolean; at: Point };

  const l = $derived(circleLayout(size.px, size.mode, DEFAULT_THEME.fontPx));
  const circ = $derived(data.circle);
  /** A car's code from its identity; an unknown identity shows its mark. */
  const codeOf = (id: CarId): string => {
    const part = carCodeById(data.cars, id);
    return part.reason === undefined ? part.text : unknownShown(part.reason).text;
  };
  /** Our car of the session that is not this circle's. */
  const teammate = $derived.by((): CarId | undefined => {
    const { playerCar, teammateCar } = data.session;
    if (playerCar === circ.carId) return teammateCar;
    return teammateCar === circ.carId ? playerCar : undefined;
  });
  /** The turn of the circle and the field, or the reason they are not there (our first lap). */
  const field = $derived.by((): { lapMs: number; cars: CircleCar[] } | { reason: UnknownReason } => {
    if (!circ.lapMs.known) return { reason: circ.lapMs.reason };
    if (!circ.cars.known) return { reason: circ.cars.reason };
    return { lapMs: circ.lapMs.value, cars: circ.cars.value };
  });
  const cars = $derived.by((): DrawnCar[] => {
    if ('reason' in field) return [];
    const { lapMs } = field;
    return field.cars.map((c) => ({
      carId: c.carId,
      code: codeOf(c.carId),
      kind: c.carId === teammate ? 'mate' : 'rival',
      at: polarOf(c.behindMs, lapMs, l.radius),
    }));
  });
  const labels = $derived.by((): CarLabel[] => {
    if ('reason' in field || !l.codes) return [];
    return placeCircleLabels(
      field.cars.map((c) => ({ carId: c.carId, code: codeOf(c.carId), behindMs: c.behindMs })),
      {
        lapMs: field.lapMs, innerRadius: l.innerRadius, outerRadius: l.outerRadius, labelWidth: l.labelWidth,
        ourCar: circ.carId, teammate,
      },
    );
  });
  const kindOf = (id: CarId): CarKind => (id === teammate ? 'mate' : 'rival');
  const ghosts = $derived.by((): DrawnGhost[] => {
    if ('reason' in field) return [];
    const { lapMs } = field;
    return circ.ghosts.flatMap((g) =>
      g.behindMs.known ? [{ ghost: g, on: g.condition === circ.current, at: polarOf(g.behindMs.value, lapMs, l.radius) }] : [],
    );
  });
  /** The current ghost's rejoin place and its gaps, where it is drawn. */
  const current = $derived.by(() => {
    if ('reason' in field) return undefined;
    const g = circ.ghosts.find((x) => x.condition === circ.current);
    if (g === undefined || !g.behindMs.known) return undefined;
    return {
      at: polarOf(g.behindMs.value, field.lapMs, l.ghostTextRadius),
      place: knownPart(g.rejoinPosition, formatPosition),
      ahead: knownPart(g.aheadMs, (ms) => formatSeconds(ms, 1)),
      behind: knownPart(g.behindCarMs, (ms) => formatSeconds(ms, 1)),
    };
  });
  const own = $derived(role(ownRole()));
  /** Between the drawing's texts, so its text reads word by word (copied, read aloud). */
  const SEP = ' ';
</script>

{#snippet gap(arrow: string, part: CellPart)}<tspan>{arrow}{#if part.reason === undefined}{part.text}{:else}<tspan
        fill={unknownShown(part.reason).colour}
        >{unknownShown(part.reason).text}<title>{unknownShown(part.reason).title}</title></tspan
      >{/if}</tspan
  >{/snippet}

{#snippet placeText(part: CellPart)}{#if part.reason === undefined}{part.text}{:else}<tspan fill={unknownShown(part.reason).colour}
      >{unknownShown(part.reason).text}<title>{unknownShown(part.reason).title}</title></tspan
    >{/if}{/snippet}

<div class="circle">
  <svg data-testid="circle" width={l.size} height={l.size} viewBox="0 0 {l.size} {l.size}">
    <g data-testid="field" transform="translate({l.centre.x} {l.centre.y})" font-family="monospace">
      <circle data-testid="ring" cx="0" cy="0" r={l.radius} fill="none" stroke={role(ringRole())} />
      <circle data-testid="own-dot" cx={l.own.dot.x} cy={l.own.dot.y} r={MARKS.ownDot} fill={own} />
      <text
        data-testid="own-code"
        x={l.own.label.x}
        y={l.own.label.y}
        text-anchor="middle"
        font-size={l.boldFontPx}
        font-weight="700"
        fill={own}>{codeOf(circ.carId)}</text
      >{SEP}
      {#each cars as c (c.carId)}
        {#if c.kind === 'mate'}
          <circle
            data-car={c.carId}
            data-kind={c.kind}
            cx={c.at.x}
            cy={c.at.y}
            r={MARKS.mateRing}
            fill="none"
            stroke={role(carRole(c.kind))}
            stroke-width={MARKS.mateStroke}><title>{c.code}</title></circle
          >
        {:else}
          <circle data-car={c.carId} data-kind={c.kind} cx={c.at.x} cy={c.at.y} r={MARKS.rivalDot} fill={role(carRole(c.kind))}
            ><title>{c.code}</title></circle
          >
        {/if}
      {/each}
      {#each labels as p (p.carId)}
        {#if p.label !== null}
          <text
            data-label={p.carId}
            data-ring={p.ring}
            x={p.label.x}
            y={p.label.y}
            text-anchor="middle"
            dominant-baseline="central"
            font-size={l.codeFontPx}
            fill={role(carRole(kindOf(p.carId)))}>{p.code}</text
          >{SEP}
        {/if}
      {/each}
      {#each ghosts as g (g.ghost.condition)}
        <g data-ghost={g.ghost.condition} data-on={String(g.on)} transform="translate({g.at.x} {g.at.y})">
          <rect
            x={-MARKS.ghostHalf}
            y={-MARKS.ghostHalf}
            width={2 * MARKS.ghostHalf}
            height={2 * MARKS.ghostHalf}
            fill={role(ghostFillRole())}
            stroke={role(ghostRole(g.on))}
            stroke-width={g.on ? MARKS.ghostStrokeOn : MARKS.ghostStrokeOff}
            transform="rotate({MARKS.ghostTurnDeg})"
          />
          <text text-anchor="middle" dominant-baseline="central" font-size={l.ghostFontPx} fill={role(ghostRole(g.on))}
            >{text.ghostLetters[g.ghost.condition]}</text
          >
        </g>{SEP}
      {/each}
      {#if current !== undefined}
        <text
          data-testid="ghost-place"
          x={current.at.x}
          y={current.at.y}
          text-anchor="middle"
          font-size={l.boldFontPx}
          font-weight="700"
          fill={own}>{@render placeText(current.place)}</text
        >{SEP}
        {#if l.gaps}
          <text
            data-testid="ghost-gaps"
            x={current.at.x}
            y={current.at.y + l.gapsDy}
            text-anchor="middle"
            font-size={l.codeFontPx}
            fill={role(gapsRole())}
            >{@render gap(text.arrows.ahead, current.ahead)}{SEP}{@render gap(text.arrows.behind, current.behind)}</text
          >
        {/if}
      {/if}
    </g>
  </svg>
  {#if 'reason' in field}
    <div class="unknown" data-testid="unknown"><TextCell text="" reason={field.reason} /></div>
  {/if}
</div>

<style>
  .circle {
    position: relative;
    width: fit-content;
  }
  svg {
    display: block;
  }
  .unknown {
    position: absolute;
    top: 0;
    left: 0;
  }
</style>
