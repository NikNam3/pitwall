<script lang="ts">
  // The compound as a letter, the age directly after it (spec 8.4, A.4). The theme variant decides whether the
  // compound roles are grey or coloured.
  import type { VisualCompound } from '@pitwall/domain';
  import { role, type Role } from '../../theme/index.ts';

  type Props = { compound: VisualCompound; age?: number | undefined };
  let { compound, age }: Props = $props();

  const MARK: Record<VisualCompound, { letter: string; role: Role }> = {
    soft: { letter: 'S', role: 'compoundSoft' },
    medium: { letter: 'M', role: 'compoundMedium' },
    hard: { letter: 'H', role: 'compoundHard' },
    superSoft: { letter: 'SS', role: 'textFaint' },
    inter: { letter: 'I', role: 'textFaint' },
    wet: { letter: 'W', role: 'textFaint' },
    unknown: { letter: '?', role: 'textFaint' },
  };
  const mark = $derived(MARK[compound]);
</script>

<span class="compound" style:color={role(mark.role)}>{mark.letter}{age ?? ''}</span>
