<script lang="ts">
  // A car's three-letter code; our cars take the own-car role (spec A.4).
  import type { CarIdentity } from '@pitwall/domain';
  import { ourCarRole } from '../../emphasis/index.ts';
  import { role } from '../../theme/index.ts';
  import { carCode } from './car-code.ts';

  type Props = { identity: Pick<CarIdentity, 'name' | 'raceNumber'>; ours: boolean };
  let { identity, ours }: Props = $props();
  const own = $derived(ourCarRole(ours));
</script>

<span style:color={own ? role(own) : undefined}>{carCode(identity)}</span>
