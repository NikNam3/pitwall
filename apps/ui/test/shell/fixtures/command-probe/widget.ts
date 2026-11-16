// Test-only widget: declares the command `plans.prepare.laps` (C72, C74), and invokes it and an undeclared one. Not a real widget.
import { declareWidget, topic } from '../../../../src/kit/define-widget.ts';

export const widget = declareWidget({
  name: 'command-probe',
  title: 'Command probe',
  data: { status: topic('feed.status') },
  sizes: { compact: { minCols: 10, minRows: 2 } },
  commands: ['plans.prepare.laps'],
});
