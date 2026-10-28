<script lang="ts">
  // One topic of the inspected widget: live status, rate, last update and binding.
  import type { EntryState } from '../../connection/topic-store.svelte.ts';
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
    void entry.value;
    updated = new Date().toTimeString().slice(0, 8);
  });
</script>

<span>{name}</span>
<span style:color={entry.status === 'errored' ? role('critical') : role('textDim')}>{entry.status}</span>
<span>{text.rate(maxHz)}</span>
<span>{updated}</span>
<span>{binding ?? text.noBinding}</span>
