// The analysis package's units as its generic tests see them (contract C44, C87): every calculator and analysis the
// package exports for the features to register, and each unit folder's `index.ts` with its behaviour table.
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type { Calculator, Job, QuickCalculator } from '@pitwall/engine/readers';
import * as analysis from '../src/index.ts';
import type { BehaviourTable } from '../src/shared/behaviour.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

const isCalculator = (value: unknown): value is Calculator =>
  typeof value === 'object' && value !== null && 'kind' in value && (value.kind === 'quick' || value.kind === 'incremental');

/** Every calculator and analysis the package exports (`src/index.ts`), the ones the bridge's features register, by id. */
export const CALCULATORS: readonly Calculator[] = [...new Map((Object.values(analysis) as unknown[]).filter(isCalculator).map((calc) => [calc.id, calc])).values()].sort(
  (a, b) => a.id.localeCompare(b.id),
);

const isJob = (value: unknown): value is Job<unknown, unknown> => typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'job';

/** Every job the package exports (`src/index.ts`), by id: an analysis's expensive work (C51). */
export const JOBS: readonly Job<unknown, unknown>[] = [...new Map((Object.values(analysis) as unknown[]).filter(isJob).map((job) => [job.id, job])).values()].sort((a, b) =>
  a.id.localeCompare(b.id),
);

/**
 * Every job as the unit the generic tests check (C41, C44, SP4.3b 4.3b2 precondition 7): a quick calculator with the
 * job's id, its `reads`, its trigger as cadence and its `prepare` as `compute`, as the bridge turns a job into its trigger
 * calculator (`FeedJobs`), named by the job's id so its unit folder's behaviour table is found.
 */
export const JOB_UNITS: readonly QuickCalculator<unknown>[] = JOBS.map((job) => ({ kind: 'quick', id: job.id, reads: job.reads, cadence: job.trigger, compute: (view) => job.prepare(view) }));

/**
 * The job ids whose `prepare` is still a contract-first stub (SP4.3b2 plan N2): the guarded-view test skips their
 * `prepare` row, and nothing else does; each task that implements a `prepare` removes its id, and the behaviour test
 * fails on an id that names no exported job.
 */
export const PENDING_JOBS: readonly string[] = [];

/** The name of a unit's behaviour table export: `<UNIT>_BEHAVIOUR`, the unit's kebab-case name in upper snake case. */
export const behaviourExport = (unit: string): string => `${unit.toUpperCase().replaceAll('-', '_')}_BEHAVIOUR`;

/** A unit folder (`src/<unit>/`, `shared/` is none) and the behaviour table its `index.ts` exports, if any. */
export type UnitFolder = { unit: string; table: BehaviourTable<unknown> | undefined };

/** Every unit folder of the package, by name. */
export const loadUnitFolders = async (): Promise<UnitFolder[]> => {
  const units = readdirSync(SRC, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'shared')
    .map((entry) => entry.name)
    .sort();
  return Promise.all(
    units.map(async (unit) => {
      const index = (await import(pathToFileURL(join(SRC, unit, 'index.ts')).href)) as Record<string, unknown>;
      return { unit, table: index[behaviourExport(unit)] as BehaviourTable<unknown> | undefined };
    }),
  );
};
