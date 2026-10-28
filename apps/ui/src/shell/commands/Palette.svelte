<script lang="ts">
  // The command palette (spec 7.7, `Ctrl+K`): fuzzy search over command titles; each result shows its key.
  import * as text from '../../kit/text.ts';
  import { role } from '../../theme/index.ts';
  import Overlay from './Overlay.svelte';
  import type { CommandRegistry } from './registry.ts';

  type Props = {
    registry: CommandRegistry;
    /** Key to command id. */
    bindings: ReadonlyMap<string, string>;
    onClose?: () => void;
  };
  let { registry, bindings, onClose = () => {} }: Props = $props();

  let query = $state('');
  let selected = $state(0);

  /** True when the letters of `needle` appear in `title` in order, ignoring case. */
  const fuzzy = (needle: string, title: string): boolean => {
    const hay = title.toLowerCase();
    let at = 0;
    for (const ch of needle.toLowerCase().replaceAll(' ', '')) {
      at = hay.indexOf(ch, at);
      if (at < 0) return false;
      at += 1;
    }
    return true;
  };

  const keyOf = $derived(new Map([...bindings].map(([key, id]) => [id, key] as const).reverse()));
  // Titles that contain the query as typed come first.
  const results = $derived.by(() => {
    const matching = registry.list().filter((c) => fuzzy(query, c.title));
    const q = query.trim().toLowerCase();
    return q === '' ? matching : [...matching.filter((c) => c.title.toLowerCase().includes(q)), ...matching.filter((c) => !c.title.toLowerCase().includes(q))];
  });

  const run = (id: string): void => {
    onClose();
    registry.run(id);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') selected = Math.min(selected + 1, results.length - 1);
    else if (e.key === 'ArrowUp') selected = Math.max(selected - 1, 0);
    else if (e.key === 'Enter') {
      const command = results[selected];
      if (command !== undefined) run(command.id);
    }
    else return;
    e.preventDefault();
  };
</script>

<Overlay onClose={onClose}>
  <!-- svelte-ignore a11y_autofocus -->
  <input
    type="text"
    autofocus
    spellcheck="false"
    placeholder={text.palettePlaceholder}
    bind:value={query}
    oninput={() => (selected = 0)}
    onkeydown={onKey}
    style:color={role('text')}
  />
  <ul>
    {#each results as command, i (command.id)}
      <li>
        <button type="button" class:selected={i === selected} onclick={() => run(command.id)}>
          <span class="title">{command.title}</span>
          {#if keyOf.get(command.id) !== undefined}<kbd style:color={role('textDim')}>{keyOf.get(command.id)}</kbd>{/if}
        </button>
      </li>
    {:else}
      <li style:color={role('textFaint')}>{text.noCommands}</li>
    {/each}
  </ul>
</Overlay>

<style>
  input {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--pw-font);
    font-size: inherit;
    background: none;
    border: none;
    outline: none;
    padding: 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  button {
    display: flex;
    justify-content: space-between;
    width: 100%;
    font-family: var(--pw-font);
    font-size: inherit;
    color: inherit;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }
  button.selected {
    background: var(--pw-bgBand);
  }
  kbd {
    font-family: var(--pw-font);
    font-size: inherit;
  }
</style>
