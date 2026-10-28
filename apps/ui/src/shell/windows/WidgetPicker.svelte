<script lang="ts">
  // The widget picker of an empty window (spec 7.1): every widget of this build, by title.
  import type { RegisteredWidget } from '../../kit/types.ts';
  import { role } from '../../theme/index.ts';

  type Props = { widgets: readonly RegisteredWidget[]; onPick: (widget: RegisteredWidget) => void };
  let { widgets, onPick }: Props = $props();

  const sorted = $derived([...widgets].sort((a, b) => a.decl.title.localeCompare(b.decl.title)));
</script>

<ul class="picker" style:background={role('bgBand')}>
  {#each sorted as widget (widget.decl.name)}
    <li><button type="button" class="pw-button" style:color={role('text')} onclick={() => onPick(widget)}>{widget.decl.title}</button></li>
  {/each}
</ul>

<style>
  .picker {
    list-style: none;
    margin: 0;
    padding: 0 var(--pw-header-pad);
  }
  button {
    width: 100%;
  }
</style>
