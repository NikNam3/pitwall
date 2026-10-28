// Every fixed text of the dev inspector (spec 8.2): the one place its wording changes.

export const title = (widget: string): string => `inspect ${widget}`;
export const close = 'close';
export const topicsHeading = 'topics';
export const calculatorsHeading = 'calculators';
export const filesHeading = 'files';
export const unknownWidget = (widget: string): string => `${widget} is not in the catalogue; run pnpm gen`;
export const rate = (maxHz: number | null): string => (maxHz === null ? 'unlimited' : `${maxHz} Hz`);
export const binding = (kind: string, source: string): string => `${kind} ${source}`;
export const noBinding = 'not bound';
export const never = 'never';
export const reads = (names: readonly string[]): string => `reads ${names.join(', ')}`;
export const computeTime = (last: number, mean: number, runs: number): string => `${last} ms (mean ${mean} ms, ${runs} runs)`;
export const notRun = 'not run';
