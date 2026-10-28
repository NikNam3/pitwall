<script lang="ts">
  /* eslint-disable @typescript-eslint/no-explicit-any -- `any` is the wildcard of the widget contract's WidgetDecl */
  // The settings popover (spec 7.4, Task 0 overlays): one control per option the widget declares. Every change reports
  // the whole options object; the shell saves it with the window.
  import * as text from '../../kit/text.ts';
  import type { OptionDecl, WidgetDecl } from '../../kit/types.ts';
  import { role } from '../../theme/index.ts';
  import Overlay from '../commands/Overlay.svelte';

  type Props = {
    decl: WidgetDecl<any, any>;
    /** The panel's saved option values; an option not in it has its default. */
    options: Readonly<Record<string, unknown>>;
    onChange: (options: Record<string, unknown>) => void;
    onClose: () => void;
    anchor?: { x: number; y: number } | undefined;
  };
  let { decl, options, onChange, onClose, anchor }: Props = $props();

  const declared = $derived(Object.entries(decl.options as Record<string, OptionDecl<unknown>>));
  const valueOf = (name: string, option: OptionDecl<unknown>): unknown => (name in options ? options[name] : option.default);
  const change = (name: string, value: unknown): void => {
    const { [name]: _replaced, ...rest } = options;
    onChange(value === undefined ? rest : { ...rest, [name]: value });
  };
  const clamp = (v: number, range: { min: number; max: number }): number => Math.min(range.max, Math.max(range.min, v));
  const FOLLOW = 'follow';
</script>

<Overlay title={text.settingsTitle(decl.title)} {onClose} {anchor} cols={40}>
  {#each declared as [name, option] (name)}
    {@const current = valueOf(name, option)}
    {#if option.kind === 'bool'}
      <label><input type="checkbox" checked={current === true} onchange={(e) => change(name, e.currentTarget.checked)} />{option.label}</label>
    {:else if option.kind === 'choice'}
      <div role="radiogroup" aria-label={option.label}>
        <span style:color={role('textDim')}>{option.label}</span>
        {#each option.choices as choice (choice)}
          <label><input type="radio" name="{decl.name}.{name}" checked={current === choice} onchange={() => change(name, choice)} />{choice}</label>
        {/each}
      </div>
    {:else if option.kind === 'number'}
      <label
        ><span style:color={role('textDim')}>{option.label}</span>
        <input
          type="number"
          aria-label={option.label}
          min={option.range.min}
          max={option.range.max}
          step={option.range.step}
          value={typeof current === 'number' ? current : option.default}
          onchange={(e) => {
            const v = e.currentTarget.valueAsNumber;
            if (Number.isFinite(v)) change(name, clamp(v, option.range));
          }}
        /></label
      >
    {:else}
      <label
        ><span style:color={role('textDim')}>{option.label}</span>
        <select aria-label={option.label} onchange={(e) => change(name, e.currentTarget.value === FOLLOW ? undefined : /^\d+$/.test(e.currentTarget.value) ? Number(e.currentTarget.value) : e.currentTarget.value)}>
          <option value={FOLLOW} selected={current === undefined}>{FOLLOW}</option>
          <option value="player" selected={current === 'player'}>{text.picker.player}</option>
          <option value="teammate" selected={current === 'teammate'}>{text.picker.teammate}</option>
          {#if typeof current === 'number'}<option value={String(current)} selected>{current}</option>{/if}
        </select></label
      >
    {/if}
  {:else}
    <div style:color={role('textFaint')}>{text.noSettings}</div>
  {/each}
  <div style:color={role('textFaint')}>{text.settingsSaved}</div>
</Overlay>

<style>
  label {
    display: inline-flex;
    gap: 1ch;
    margin-right: 1ch;
  }
  div[role='radiogroup'] {
    display: flex;
    gap: 1ch;
  }
  input[type='number'],
  select {
    font-family: var(--pw-font);
    font-size: inherit;
    color: inherit;
    background: none;
    border: var(--pw-border-px) solid var(--pw-border);
  }
</style>
