<script lang="ts">
  // Test-only component: a button invokes the declared `plans.race.set` with 52 laps, sets carried, and shows the outcome; another
  // invokes the undeclared `plan.accept` and shows what happened.
  import { getWidgetCommands } from '../../../../src/kit/commands.ts';
  import type { WidgetProps } from '../../../../src/kit/types.ts';
  import type { widget } from './widget.ts';

  let { link }: WidgetProps<typeof widget> = $props();
  const commands = getWidgetCommands();
  let outcome = $state('');
  const laps = async (): Promise<void> => {
    const result = await commands.invoke('plans.race.set', { feedId: link.feedId, race: { laps: 52, sets: 'carried', conditions: { kind: 'imported' } } });
    outcome = result.ok ? 'ok' : result.reason;
  };
  const undeclared = async (): Promise<void> => {
    try {
      const result = await commands.invoke('plan.accept', { feedId: link.feedId, carId: link.primary, slot: 'A', policy: { stops: [] } });
      outcome = result.ok ? 'ok' : result.reason;
    } catch {
      outcome = 'thrown';
    }
  };
</script>

<button type="button" data-testid="laps" onclick={laps}>laps</button>
<button type="button" data-testid="undeclared" onclick={undeclared}>undeclared</button>
<span data-testid="outcome">{outcome}</span>
