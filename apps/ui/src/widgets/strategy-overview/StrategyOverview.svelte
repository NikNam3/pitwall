<script lang="ts">
  // Field plans (SP4.3d spec §6.4, V06; mockup docs/design/2026-11-16-sp4.3d/strategy-overview.html): per car within
  // one pit loss of the link's car (and its teammate) a line in race order; full: code, place, gap, tyre, ², NEXT and the
  // lap lane; compact: code, gap, tyre, WINDOW, NEXT. Every lap, gap and chance is `strategy-overview`'s; rows.ts and
  // lane.ts format and place them, emphasis.ts maps them to roles (C65, C68).
  import type { CellPart } from '../../kit/grid/grid.ts';
  import type { WidgetProps } from '../../kit/types.ts';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { role } from '../../theme/index.ts';
  import { FAINT_OPACITY, MARK_ROLE, NOW_ROLE, rowEmphasis, SHADE_ROLE, SOLID_LETTER_ROLE } from './emphasis.ts';
  import type { CarId } from '@pitwall/domain';
  import { axisParts, lanesOf, type LaneScene } from './lane.ts';
  import { fieldRows, lapNow, type Cars } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  /** Cells per column (gen.mjs `oSpec`, compact `ocSpec`): one space between columns. */
  const W = { code: 3, pos: 3, gap: 5, tyre: 4, owe: 1, next: 4, window: 7 } as const;

  const full = $derived(size.mode === 'full');
  // A state topic before its first value has none: the panel frame shows its no-data state.
  const overview = $derived(data.overview as typeof data.overview | undefined);
  const cars = $derived<Cars>((data.cars as Cars | undefined) ?? []);
  const flag = $derived((data.session as typeof data.session | undefined)?.session.totalLaps);
  const now = $derived(overview === undefined ? undefined : lapNow(cars, overview.carId));
  const rows = $derived(overview === undefined ? [] : fieldRows({ overview, cars, now: now ?? 0 }));
  const lanes = $derived(overview === undefined ? new Map<CarId, LaneScene>() : lanesOf({ overview, rows, now, flag, size }));
  /** One character cell of space: Svelte trims whitespace at a block's edges, so the lines spell theirs out. */
  const SP = ' ';
  const laneOn = $derived(full && now !== undefined && flag !== undefined && flag > 0);
  const axis = $derived(flag === undefined || !laneOn ? [] : axisParts(flag));
</script>

{#snippet part(p: CellPart, width: number, align: 'left' | 'right')}<TextCell text={p.text} reason={p.reason} {width} {align} />{/snippet}

{#if overview !== undefined}
  {#if full}
    <div class="line head" style:color={role('textDim')}><TextCell text="" width={W.code} /> <TextCell text={text.headers.pos} width={W.pos} align="right" /> <TextCell
        text={text.headers.gap}
        width={W.gap}
        align="right"
      /> <TextCell text={text.headers.tyre} width={W.tyre} /> <TextCell text="" width={W.owe} /> <TextCell text={text.headers.next} width={W.next} /> <span data-testid="axis"
        >{#each axis as a, i (i)}<TextCell text={a.text} width={a.width} />{/each}</span
      ></div>
  {:else}
    <div class="line head" style:color={role('textDim')}><TextCell text="" width={W.code} /> <TextCell text={text.headers.gap} width={W.gap} align="right" /> <TextCell
        text={text.headers.tyre}
        width={W.tyre}
      /> <TextCell text={text.headers.window} width={W.window} /> <TextCell text={text.headers.next} width={W.next} /></div>
  {/if}
  {#each rows as r (r.carId)}
    {@const e = rowEmphasis(r.kind)}
    {@const scene = lanes.get(r.carId)}
    <div
      class="line"
      class:bold={e.bold}
      class:bar={e.bar}
      style:color={role(e.role)}
      data-car={r.carId}
      data-kind={r.kind}
      data-role={e.role}
      data-bold={String(e.bold)}
      data-bar={String(e.bar)}
    ><span data-testid="code">{@render part(r.code, W.code, 'left')}</span>
      {#if full}<span data-testid="pos"><TextCell text={r.pos} width={W.pos} align="right" /></span>{SP}{/if}<span data-testid="gap">{@render part(r.gap, W.gap, 'right')}</span> <span data-testid="tyre">{@render part(r.tyre, W.tyre, 'left')}</span>
      {#if full}<span data-testid="owe" title={r.owes ? text.oweHover : undefined} style:color={role('textDim')}
          ><TextCell text={r.owes ? text.oweMark : ''} width={W.owe} /></span
        >{SP}{:else}<span data-testid="window">{@render part(r.window, W.window, 'left')}</span>{SP}{/if}<span data-testid="next" title={r.nextHover} style:color={role('textDim')}>{@render part(r.next, W.next, 'left')}</span
      >{#if scene !== undefined}{SP}<svg data-testid="lane" class="lane" width={scene.width} height={scene.height}>
          {#each scene.blocks as b, i (i)}
            <g data-block data-from={b.fromLap} data-to={b.toLap} data-style={b.style}>
              {#if b.style === 'outline'}
                <rect x={b.rect.x} y={b.rect.y} width={b.rect.width} height={b.rect.height} fill="none" style:stroke={role(b.role)} />
              {:else}
                <rect
                  x={b.rect.x}
                  y={b.rect.y}
                  width={b.rect.width}
                  height={b.rect.height}
                  opacity={b.style === 'faint' ? FAINT_OPACITY : undefined}
                  style:fill={role(b.role)}
                />
              {/if}
              {#if b.letter !== ''}<text
                  class="letter"
                  x={b.letterX}
                  y={b.letterY}
                  style:fill={role(b.style === 'outline' ? b.role : SOLID_LETTER_ROLE)}>{b.letter}</text
                >{/if}
            </g>
          {/each}
          {#each scene.shades as s (s.lap)}
            <rect data-shade data-lap={s.lap} x={s.rect.x} y={s.rect.y} width={s.rect.width} height={s.rect.height} opacity={s.opacity} style:fill={role(SHADE_ROLE)} />
          {/each}
          {#if scene.planLine !== undefined}
            <line x1={scene.planLine.x1} x2={scene.planLine.x2} y1={scene.planLine.y} y2={scene.planLine.y} style:stroke={role(MARK_ROLE)} />
          {/if}
          {#each scene.marks as m (m.lap)}
            <path data-mark data-lap={m.lap} d={m.path} style:fill={role(MARK_ROLE)} />
          {/each}
          <line data-testid="now" x1={scene.nowX} x2={scene.nowX} y1="0" y2={scene.height} style:stroke={role(NOW_ROLE)} />
        </svg>{/if}</div>
  {/each}
{/if}

<style>
  .line {
    white-space: pre;
  }
  .bold {
    font-weight: var(--pw-weight-bold);
  }
  .bar {
    box-shadow: inset var(--pw-bar-px) 0 0 var(--pw-text);
  }
  .lane {
    display: inline-block;
    vertical-align: top;
  }
  .letter {
    font-size: 0.75em;
    font-weight: var(--pw-weight-bold);
  }
</style>
