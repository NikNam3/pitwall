<script lang="ts">
  // One topic of the inspected widget: live status, rate, last update and binding.
  import type { EntryState } from '../../connection/topic-store.svelte.ts';
  import { formatClock, formatHz, formatShort } from '../../kit/values/format.ts';
  import { role } from '../../theme/index.ts';
  import * as text from './text.ts';

  type Props = {
    name: string;
    entry: EntryState<unknown>;
    maxHz: number | null;
    binding: string | undefined;
  };
  let { name, entry, maxHz, binding }: Props = $props();

  let updated = $state(text.never);
  $effect(() => {
    if (entry.value !== undefined) updated = formatClock(new Date());
  });
</script>

<span>{name}</span>
<span style:color={entry.status === 'errored' ? role('critical') : role('textDim')}>{entry.status}</span>
<span>{maxHz === null ? text.unlimited : formatHz(maxHz)}</span>
<span>{updated}</span>
<span>{binding ?? text.noBinding}</span>
<span>{entry.value === undefined ? text.noValue : formatShort(entry.value, text.valueMax)}</span>
