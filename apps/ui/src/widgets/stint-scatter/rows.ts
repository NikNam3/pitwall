// The stint scatter's marks and compounds table (spec 6; C65, C68): `stintAnalysis.car` mapped to what the component
// draws, formatting and mapping only. The fit and its band, every lap's use and every source's kind are the analysis's
// (C43); nothing here computes a value.
import type { CompoundPrior, EstimateSource, FitPoint, Known, Ms, StintFit, StintLap } from '@pitwall/domain';
import type { ChartMark, ChartSeries } from '../../kit/chart/data.ts';
import { COMPOUND_MARK } from '../../kit/compound/compound-mark.ts';
import { knownPart, type CellPart } from '../../kit/grid/grid.ts';
import { formatSeconds, formatSignedSeconds } from '../../kit/values/format.ts';
import { role, type Role } from '../../theme/index.ts';
import { compoundRole, lapRole, stintRole } from './emphasis.ts';
import { stintLabel } from './text.ts';

/** One lap as the scatter draws it: at its tyre age and (fuel-corrected) time, in its shape and role. */
export type ScatterMark = { lapNumber: number; tyreAge: number; ms: Ms; shape: ChartMark['shape']; role: Role; pinned: boolean };

/** One stint's plot: its fit label, its role, its laps' marks and the fit with its band as the analysis gives it. */
export type StintPlot = { stint: number; label: string; role: Role; marks: ScatterMark[]; fit: Known<FitPoint[]> };

/** The time a lap is plotted at: the fuel-corrected time of a corrected stint (none while unknown), else the raw one. */
const plottedMs = (s: StintFit, l: StintLap): Ms | undefined =>
  s.fuelCorrected ? (l.correctedMs.known ? l.correctedMs.value : undefined) : l.lapTimeMs;

/** A used lap is a dot, a down-weighted one a dotted ring, an excluded one a ring pinned to the edge when off-scale. */
function markOf(s: StintFit, l: StintLap, stint: Role): ScatterMark[] {
  const ms = plottedMs(s, l);
  if (ms === undefined) return [];
  const excluded = typeof l.use === 'object';
  const shape = excluded ? 'ring' : l.use === 'downWeighted' ? 'dottedRing' : 'dot';
  return [{ lapNumber: l.lapNumber, tyreAge: l.tyreAge, ms, shape, role: lapRole(l.use, stint), pinned: excluded }];
}

/** The plot of one stint; `current` is the car's last stint, open-ended in its label. */
function plotOf(s: StintFit, current: boolean, labelled: boolean): StintPlot {
  const r = stintRole(current);
  return {
    stint: s.stint,
    label: labelled ? stintLabel(COMPOUND_MARK[s.visual].letter, s.firstLap, current ? undefined : s.lastLap) : '',
    role: r,
    marks: s.laps.flatMap((l) => markOf(s, l, r)),
    fit: s.fitLine,
  };
}

/** Full: one plot per stint in stint order. Compact: the current (last) stint only, without its fit label. */
export function stintPlots(stints: readonly StintFit[], mode: 'compact' | 'full'): StintPlot[] {
  const last = stints.length - 1;
  if (mode === 'compact') return stints.slice(last < 0 ? 0 : last).map((s) => plotOf(s, true, false));
  return stints.map((s, i) => plotOf(s, i === last, true));
}

/** The kit chart's input: each plot's known fit as a line with its band in its role, and every plot's marks. */
export function chartOf(plots: readonly StintPlot[]): { series: ChartSeries[]; marks: ChartMark[] } {
  const series = plots.flatMap((p): ChartSeries[] =>
    p.fit.known
      ? [
          {
            label: p.label,
            points: p.fit.value.map((f): [number, number] => [f.tyreAge, f.ms]),
            band: p.fit.value.map((f) => ({ x: f.tyreAge, y: f.ms, sd: f.sdMs })),
            colour: { colour: role(p.role), dashed: false, ownCar: p.role === 'ownCar' },
          },
        ]
      : [],
  );
  const marks = plots.flatMap((p) => p.marks.map((m): ChartMark => ({ x: m.tyreAge, y: m.ms, shape: m.shape, role: m.role, pinned: m.pinned })));
  return { series, marks };
}

/** One line of the compounds table: the prior a compound started from, with its source for the kit badge. */
export type CompoundRow = { compound: string; toSoft: CellPart; degPerLap: CellPart; sd: CellPart; source: EstimateSource; role: Role | undefined };

/** Signed seconds to three decimals, `412` -> `+0.412`. */
const signed3 = (ms: number): string => formatSignedSeconds(ms, 3);
/** Seconds to three decimals, `9` -> `0.009`. */
const plain3 = (ms: number): string => formatSeconds(ms, 3);

/** One row per compound in the analysis's order. */
export function compoundRows(compounds: readonly CompoundPrior[]): CompoundRow[] {
  return compounds.map((c) => ({
    compound: COMPOUND_MARK[c.visual].letter,
    toSoft: knownPart(c.alphaOffsetMs, signed3),
    degPerLap: knownPart(c.nuMsPerLap, signed3),
    sd: knownPart(c.nuSdMs, plain3),
    source: c.source,
    role: compoundRole(c.source.kind),
  }));
}
