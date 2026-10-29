<script lang="ts">
  // Active insights by severity (V25): critical first, acknowledged ones stay dim, muted groups as a count. Only what
  // fits the size is drawn (fit.ts): the rows beyond it are counted on the last line, long texts are cut.
  import { getUiActions } from '../../kit/actions.ts';
  import { formatInsight } from '../../kit/insight/insight-text.ts';
  import { severityRole } from '../../emphasis/index.ts';
  import { role } from '../../theme/index.ts';
  import type { WidgetProps } from '../../kit/types.ts';
  import { fitAlarms, SEVERITY_COLS } from './fit.ts';
  import { alarmRows } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const { send } = getUiActions();
  const view = $derived(alarmRows(data.insights, data.alerts));
  const full = $derived(size.mode === 'full');
  const fitted = $derived(fitAlarms(view, size, full, formatInsight));
</script>

<div class="alarms" style:--sev-cols={SEVERITY_COLS}>
  {#each fitted.rows as row (row.insight.key)}
    <div class="row" data-testid="alarm-{row.insight.key}">
      <span class="sev" style:color={role(severityRole(row.insight.severity, row.acknowledged))}>{text.severityLabel[row.insight.severity]}</span>
      <span class="insight-line" data-severity={row.insight.severity} style:color={role(severityRole(row.insight.severity, row.acknowledged))}>{row.text}</span>
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
          onclick={() => send({ kind: 'alertGroup.mute', category: row.insight.category, muted: true })}>{text.muteGroup(row.insight.category)}</button
        >
      {/if}
    </div>
  {:else}
    {#if view.muted.length === 0}<div class="faint">{text.none}</div>{/if}
  {/each}
  {#if fitted.more > 0 || fitted.muted.length > 0}
    <div class="row faint">
      {#if fitted.more > 0}<span data-testid="alarms-more">{text.more(fitted.more)}</span>{/if}
      {#if fitted.muted.length > 0}<span>{text.mutedLabel}</span>{/if}
      {#each fitted.muted as m (m.category)}
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
    width: calc(var(--sev-cols) * 1ch);
  }
  .faint {
    color: var(--pw-textFaint);
  }
</style>
