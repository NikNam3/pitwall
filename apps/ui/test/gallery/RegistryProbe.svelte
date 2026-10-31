<script lang="ts">
  // Test-only component: what a registered widget's loader gives, told apart from the widget's real component by its
  // text (gallery-cell.test.ts). It takes the fuel gauge's props and shows none of them.
  import type { WidgetProps } from '../../src/kit/types.ts';
  import type { widget } from '../../src/widgets/fuel-gauge/widget.ts';

  let { data }: WidgetProps<typeof widget> = $props();
</script>

<span data-testid="registry-probe" data-fuel={data.fuel === undefined ? 'none' : 'in'}>from the registry's loader</span>
