<script lang="ts">
  // A value in text cells, with an optional limit, marker and reserve line (spec 8.4, A.4).
  import type { Known } from '@pitwall/domain';
  import { role, type Role } from '../../theme/index.ts';
  import { unknownReason } from '../text.ts';
  import { barCells } from './bar.ts';

  type Props = {
    value: Known<number>;
    min: number;
    max: number;
    cols: number;
    limit?: number | undefined;
    marker?: Known<number> | undefined;
    reserve?: number | undefined;
    role: Role;
  };
  let { role: themeRole, ...input }: Props = $props();
  const cells = $derived(barCells(input));
</script>

<span class="bar" style:color={role(themeRole)} title={cells.reason === undefined ? undefined : unknownReason[cells.reason]}>{cells.text}</span>

<style>
  .bar {
    white-space: pre;
  }
</style>
