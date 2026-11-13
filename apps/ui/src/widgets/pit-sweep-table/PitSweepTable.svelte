<script lang="ts">
  // The pit-sweep table (SP4.3b spec §10, V15; mockup docs/design/2026-11-12-sp4.3b/pit-sweep-table.html; README Q2 A,
  // Q3 A, Q4 A): per stop lap from now, box onto the swept compound, then the DP's best continuation. Full: LAP, REJ,
  // TRF, E[POS], the place strip (one scale over the shown rows, our place now underlined), P(GAIN), LIFE; compact: the
  // rows that fit around the window, no traffic, no strip. Every number is `pit-sweep`'s; rows.ts formats (C65).
  import { sharedScale } from '../../kit/dist/dist.ts';
  import DistStrip from '../../kit/dist/DistStrip.svelte';
  import type { WidgetProps } from '../../kit/types.ts';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { role } from '../../theme/index.ts';
  import { compoundRole, headerRole, lifeRole } from './emphasis.ts';
  import { compoundHover, compoundLetter, placesHeader, shownRows, sweepLine, WIDTH } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  /** The header takes one line. */
  const HEAD_ROWS = 1;

  const full = $derived(size.mode === 'full');
  // The job's topic before its first result has no value: the panel frame shows its computing state.
  const sweep = $derived(data.sweep as typeof data.sweep | undefined);
  const value = $derived(sweep?.value);
  const table = $derived(value?.table.known === true ? value.table.value : undefined);
  const shown = $derived(table === undefined ? [] : full ? table.rows : shownRows(table.rows, size.rows - HEAD_ROWS));
  const lines = $derived(shown.map(sweepLine));
  const scale = $derived(sharedScale(shown.map((r) => r.positionPmf)));
  const places = $derived(shown[0]?.positionPmf.length ?? 0);
</script>

{#if value !== undefined}
  <div class="line" data-testid="head" style:color={role(headerRole)}> <span data-testid="compound"><TextCell
        text={compoundLetter(value.compound)}
        title={compoundHover(value.fromAuto)}
        role={compoundRole}
        width={table === undefined ? undefined : WIDTH.lap}
      /></span>{#if !value.table.known} <TextCell text="" reason={value.table.reason} />{:else} <TextCell
        text={text.headers.rej}
        width={WIDTH.rej}
        align="right"
      />{#if full} <TextCell text={text.headers.trf} width={WIDTH.trf} align="right" />{/if} <TextCell
        text={text.headers.ePos}
        width={WIDTH.ePos}
        align="right"
      />{#if full} {placesHeader(places)}{/if} <TextCell text={text.headers.pGain} width={WIDTH.pGain} align="right" />{#if full} <TextCell
          text={text.headers.life}
          width={WIDTH.life}
          align="right"
        />{/if}{/if}</div>
  {#each lines as l, i (i)}
    <div class="line" data-testid="row-{i}"><svelte:element this={l.bold ? 'strong' : 'span'}> <span data-testid="lap"
          ><TextCell text={l.lap} width={WIDTH.lap} /></span
        > <span data-testid="rej"><TextCell text={l.rej.text} reason={l.rej.reason} width={WIDTH.rej} align="right" /></span
        >{#if full} <span data-testid="trf"><TextCell text={l.trf.text} reason={l.trf.reason} width={WIDTH.trf} align="right" /></span
          >{/if} <span data-testid="epos"><TextCell text={l.ePos} width={WIDTH.ePos} align="right" /></span
        >{#if full} <DistStrip form="places" pmf={l.pmf} {scale} ourPlace={value.position} />{/if} <span data-testid="pgain"
          ><TextCell text={l.pGain} width={WIDTH.pGain} align="right" /></span
        > <span data-testid="life"
          ><TextCell
            text={l.life.past ? text.lifeMark : ''}
            reason={l.life.reason}
            role={l.life.past ? lifeRole : undefined}
            title={l.life.past ? text.lifeHover : undefined}
            width={full ? WIDTH.life : WIDTH.lifeCompact}
            align="right"
          /></span
        ></svelte:element
      ></div>
  {/each}
{/if}

<style>
  .line {
    white-space: pre;
  }
  strong {
    font-weight: var(--pw-weight-bold);
  }
</style>
