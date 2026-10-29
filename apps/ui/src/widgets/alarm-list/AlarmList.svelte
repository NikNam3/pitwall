<script lang="ts">
  // Active insights by severity (V25): critical first, acknowledged ones stay dim, muted groups as a count.
  import { getUiActions } from '../../kit/actions.ts';
  import InsightLine from '../../kit/insight/InsightLine.svelte';
  import { role } from '../../theme/index.ts';
  import type { WidgetProps } from '../../kit/types.ts';
  import { severityRole } from './emphasis.ts';
  import { alarmRows } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const { send } = getUiActions();
  const view = $derived(alarmRows(data.insights, data.alerts));
  const full = $derived(size.mode === 'full');
  const colourOf = (severity: 'critical' | 'advisory' | 'info', acknowledged: boolean): string => {
    const r = acknowledged ? 'textFaint' : severityRole(severity);
    return r === undefined ? role('textDim') : role(r);
  };
</script>

<div class="alarms">
  {#each view.rows as row (row.insight.key)}
    <div class="row" data-testid="alarm-{row.insight.key}">
      <span class="sev" style:color={colourOf(row.insight.severity, row.acknowledged)}>{text.severityLabel[row.insight.severity]}</span>
      <InsightLine insight={row.insight} acknowledged={row.acknowledged} />
      {#if row.acknowledged}
        <span class="faint">{text.acknowledged}</span>
      {:else}
        <button type="button" class="pw-button faint" data-testid="ack-{row.insight.key}" onclick={() => send({ kind: 'alert.ack', key: row.token })}>{text.ack}</button>
      {/if}
      {#if full}
        <button
          type="button"
          class="pw-button faint"
          data-testid="mute-{row.insight.category}-{row.insight.key}"
          onclick={() => send({ kind: 'alertGroup.mute', category: row.insight.category, muted: true })}>{text.mute} {row.insight.category}</button
        >
      {/if}
    </div>
  {:else}
    {#if view.muted.length === 0}<div class="faint">{text.none}</div>{/if}
  {/each}
  {#if view.muted.length > 0}
    <div class="row faint">
      <span>{text.mutedLabel}</span>
      {#each view.muted as m (m.category)}
        <button
          type="button"
          class="pw-button faint"
          data-testid="unmute-{m.category}"
          title={text.unmute}
          onclick={() => send({ kind: 'alertGroup.mute', category: m.category, muted: false })}>{text.mutedGroup(m.category, m.count)}</button
        >
      {/each}
    </div>
  {/if}
</div>

<style>
  .alarms {
    white-space: nowrap;
  }
  .sev {
    display: inline-block;
    width: 5ch;
  }
  .faint {
    color: var(--pw-textFaint);
  }
</style>
