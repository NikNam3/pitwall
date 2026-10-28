import type { Role } from '../../theme/index.ts';
import type { Cell } from '../size/size.ts';

/** What `draw` gets next to the context. Coordinates are CSS px. */
export type DrawApi = {
  /** The resolved colour of a role (canvas cannot use `var(...)`). */
  role(r: Role): string;
  /** A mark with an optional label; `fresh: false` draws it in `textFaint`. */
  mark(x: number, y: number, opts: { role?: Role | undefined; fresh?: boolean | undefined; label?: string | undefined }): void;
  cell: Cell;
};
