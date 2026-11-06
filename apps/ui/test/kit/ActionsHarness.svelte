<script lang="ts">
  // Test-only stand-in for the panel's part in UI actions: hands the panel's `send` and the widget's declared action
  // kinds to `setUiActions` (as Panel.svelte does with `widget.decl.actions`), then renders the widget below it.
  import type { UiAction } from '@pitwall/contracts';
  import type { Component } from 'svelte';
  import { setUiActions } from '../../src/kit/actions.ts';

  type Props = {
    send: (action: UiAction) => void;
    actions: readonly UiAction['kind'][];
    component: Component<Record<string, unknown>>;
    widgetProps: Record<string, unknown>;
  };
  let { send, actions, component: View, widgetProps }: Props = $props();

  // svelte-ignore state_referenced_locally
  setUiActions(send, actions);
</script>

<View {...widgetProps} />
