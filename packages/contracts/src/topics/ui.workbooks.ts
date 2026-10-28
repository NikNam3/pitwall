import type { Workbook } from '../ui/types.ts';
import { defineTopic, type NoParams } from '../topic-def.ts';

/** The workbook files by name, the active workbook, and why a hand edit of it was rejected (spec 7.2). */
export type WorkbooksState = { names: string[]; active: Workbook; error?: string };

export default defineTopic<NoParams, WorkbooksState>({ owner: 'core', scope: 'global', mode: 'state', maxHz: Infinity });
