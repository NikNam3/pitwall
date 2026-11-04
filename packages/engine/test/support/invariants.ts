// Spec 10.2 invariants, checked on every StepResult. Sector sums follow spec correction 4: lapTime − 2 ≤ Σ sectors ≤ lapTime.
import type { LogLengths, StepResult } from '../../src/index.ts';
import { projectionLengths, situationOf } from '../../src/index.ts';
import { carsInSessionOf } from '../../src/situations/car-status/in-session.ts';

const key = (m: { carId: number; lap: number; segment: number }) => `${m.carId}/${m.lap}/${m.segment}`;

export class InvariantChecker {
  #lengths: LogLengths | undefined;
  #laps = new Map<number, number>();
  #crossings = new Set<string>();

  check(r: StepResult): void {
    const { state, delta } = r;
    const rewound = delta.rewound !== undefined;
    const at = `frame ${state.lastFrameId}`;
    // the cars in the session: car-status's (C43), no longer `car.active` (Task 24)
    const inSession = new Set(carsInSessionOf(situationOf(state).byMachine['car-status']));
    const active = state.cars.filter((c) => inSession.has(c.id));
    const positions = active.map((c) => c.timing.position).sort((a, b) => a - b);
    if (positions.some((p, i) => p !== i + 1)) throw new Error(`positions not a permutation of 1..${active.length} at ${at}: ${positions.join(',')}`);
    for (const c of active) {
      const prev = this.#laps.get(c.id);
      if (prev !== undefined && c.timing.lap < prev && !rewound) throw new Error(`car ${c.id} lap ${prev} -> ${c.timing.lap} without a rewound step (flashback or race start) at ${at}`);
      this.#laps.set(c.id, c.timing.lap);
    }
    if (JSON.stringify(delta.after) !== JSON.stringify(projectionLengths(state.history))) throw new Error(`delta.after differs from the history lengths at ${at}`);
    if (this.#lengths && JSON.stringify(delta.before) !== JSON.stringify(this.#lengths)) throw new Error(`delta.before differs from the previous delta.after at ${at}`);
    if (!rewound)
      for (const k of Object.keys(delta.after) as Array<keyof LogLengths>)
        if ((delta.after[k] ?? 0) < (delta.before[k] ?? 0)) throw new Error(`history.${k} shrank without a rewind at ${at}`);
    this.#lengths = delta.after;
    for (const l of state.history.laps.slice(rewound ? 0 : delta.before.laps)) {
      const rest = l.lapTimeMs - l.sectorTimesMs[0] - l.sectorTimesMs[1] - l.sectorTimesMs[2];
      if (l.status === 'confirmed' && (rest < 0 || rest > 2)) throw new Error(`confirmed lap ${l.carId}/${l.lapNumber}: sectors off by ${rest} ms`);
    }
    if (rewound) this.#crossings = new Set(state.history.crossings.map(key));
    else
      for (const m of state.history.crossings.slice(delta.before.crossings)) {
        if (this.#crossings.has(key(m))) throw new Error(`mini-sector ${key(m)} emitted twice at ${at}`);
        this.#crossings.add(key(m));
      }
  }
}
