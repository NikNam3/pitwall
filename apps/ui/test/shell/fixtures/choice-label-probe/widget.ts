// Test-only widget: a choice option with labels for some of its values (SP4.3b2 Task 3b). `auto` has no label.
import { choiceOption } from '../../../../src/kit/options.ts';
import { declareWidget, topic } from '../../../../src/kit/define-widget.ts';

export const widget = declareWidget({
  name: 'choice-label-probe',
  title: 'Choice label probe',
  data: { status: topic('feed.status') },
  options: {
    compound: choiceOption(['auto', 'soft', 'medium', 'hard'] as const, 'auto', 'Compound', { soft: 'S', medium: 'M', hard: 'H' }),
  },
  sizes: { compact: { minCols: 10, minRows: 2 } },
});
