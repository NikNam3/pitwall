// The gallery declaration of a widget (spec 9.1): recorded moments, synthetic cases and fit expectations.
import type { AnyDataDecl, DataValues } from './types.ts';

/** What the gallery shows of widget `W`. Moments are plain strings until the moment catalogue exists. */
export type GalleryEntry<W extends { data: Record<string, AnyDataDecl> }> = {
  moments: string[];
  cases?: Record<string, Partial<DataValues<W>>>;
  /** Per case, the panel options it is drawn with over the declaration's defaults (e.g. a chart's chosen rivals). */
  caseOptions?: Record<string, Record<string, unknown>>;
  fit?: Array<{ mode: string; cols: number; rows: number }>;
};
