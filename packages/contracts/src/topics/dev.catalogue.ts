import { defineTopic, type NoParams } from '../topic-def.ts';

/** One data entry of a widget, as the catalogue records it; `kind` is `state` or `folded`. */
export type CatalogueWidgetTopic = { topic: string; kind: string; optional: boolean };

/** Where a topic's value comes from; `kind` is `calculator`, `history`, `insights` or `job`. */
export type CatalogueBinding = { kind: string; source: string; feature: string };

/** The code map `scripts/gen-catalogue.ts` writes (spec 8.1): who declares, binds and reads what, and where the files are. Paths are relative to the repo root. */
export type Catalogue = {
  widgets: Array<{ name: string; folder: string; topics: CatalogueWidgetTopic[]; options: string[]; sizes: string[] }>;
  topics: Array<{
    name: string;
    owner: string;
    mode: string;
    scope: string;
    /** Null where the rate is unlimited (JSON has no infinity). */
    maxHz: number | null;
    file: string;
    binding?: CatalogueBinding;
    readers: string[];
  }>;
  features: Array<{
    name: string;
    folder: string;
    analysisFolder?: string;
    private: boolean;
    calculators: Array<{ id: string; reads: string[]; cadence: string }>;
    jobs: string[];
    config: string[];
  }>;
};

/** The catalogue as the running bridge sees it (dev mode only, spec 8.3). */
export default defineTopic<NoParams, Catalogue>({ owner: 'core', scope: 'global', mode: 'state', maxHz: 1 });
