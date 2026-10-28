// Svelte action: publishes a theme variant as CSS variables on one element, so a gallery cell is themed on its own.
import { applyTheme, type ThemeVariant } from '../theme/index.ts';

export function themed(node: HTMLElement, theme: ThemeVariant) {
  applyTheme(theme, node);
  return {
    update(next: ThemeVariant) {
      applyTheme(next, node);
    },
  };
}
