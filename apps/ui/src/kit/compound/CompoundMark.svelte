<script lang="ts">
  // The compound as a letter, the age directly after it (spec 8.4, A.4). The theme variant decides whether the
  // compound roles are grey or coloured.
  import type { VisualCompound } from '@pitwall/domain';
  import { role } from '../../theme/index.ts';
  import { COMPOUND_MARK } from './compound-mark.ts';

  type Props = { compound: VisualCompound; age?: number | undefined };
  let { compound, age }: Props = $props();

  const mark = $derived(COMPOUND_MARK[compound]);
</script>

<span class="compound" style:color={role(mark.role)}>{mark.letter}{age ?? ''}</span>
