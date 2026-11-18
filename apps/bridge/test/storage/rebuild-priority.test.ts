// SP4.3e Task 7d (C61, C62d; spec §4.3 item 3a, user 2026-11-18; plan Review focus 4): the rebuild service's one queue
// runs one job at a time by `RebuildPriority`, highest first: a confirmed basis of a running session (`runningBasis`), a
// planning replay (`planning`), any other first read (`firstRead`). A job in progress finishes first; then the highest
// priority queued goes next, whatever the order it was queued in.
//
// The running job is a `firstRead` rebuild; the others are queued from the writer probe's first call of that rebuild
// (`rebuild-fixtures.ts`), so they are queued while it runs. Every data dir is a temporary one (C84); the sessions are
// committed segments an earlier bridge stored under another rules version.
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionKey } from '../../src/storage/db.ts';
import { createRebuildService } from '../../src/storage/rebuild-service.ts';
import type { RebuildService } from '../../src/storage/rebuild-service-types.ts';
import { NEW, newPlace, OLD, probe, sameKey, silent, storeSegment } from './rebuild-fixtures.ts';

const services: RebuildService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
});

/** Each job's writes (`<name>:part`, `<name>:swap`) and its end (`<name> done`), in the order they happened. */
async function runQueue(queued: (q: { service: RebuildService; keys: Record<string, SessionKey>; planning: string; done: (name: string) => () => void }) => Array<Promise<unknown>>) {
  const place = newPlace();
  const stored = {
    running: await storeSegment(place, 'race-zandvoort-pit-exit.pwrec.gz', OLD),
    read: await storeSegment(place, 'race-singapore-end.pwrec.gz', OLD),
    basis: await storeSegment(place, 'race-drive-through.pwrec.gz', OLD),
  };
  const qualifying = await storeSegment(place, 'qualifying-singapore-end.pwrec.gz', NEW);
  const keys = Object.fromEntries(Object.entries(stored).map(([name, s]) => [name, s.key]));
  const nameOf = (key: SessionKey) => Object.entries(keys).find(([, k]) => sameKey(k, key))?.[0] ?? 'other';
  const order: string[] = [];
  const done = (name: string) => () => void order.push(`${name} done`);
  const pending: Array<Promise<unknown>> = [];
  let service: RebuildService | undefined = undefined;
  const { writeProbe } = probe((call) => {
    order.push(`${nameOf(call.session)}:${call.step}`);
    // the running rebuild has written its first part: queue the rest now
    if (pending.length === 1) pending.push(...queued({ service: service!, keys, planning: qualifying.file, done }));
  });
  const made = createRebuildService({ db: place.db, dataDir: place.dirs, rulesVersion: NEW, log: silent, writeProbe });
  service = made;
  services.push(made);
  pending.push(made.ensureCurrent([keys['running']!], { priority: 'firstRead' }).then(done('running')));
  await pending[0];
  // the probe queued the others during the running rebuild; wait for every job
  expect(pending.length).toBeGreaterThan(1);
  await Promise.all(pending);
  return order;
}

const job = (pwrecPath: string) => ({ pwrecPath, basisOverride: [], laps: 20, sets: 'carried' as const });
/** The jobs in the order they ended. */
const ends = (order: readonly string[]) => order.filter((e) => e.endsWith(' done')).map((e) => e.slice(0, -' done'.length));
/** The positions in `order` of `name`'s writes. */
const writesOf = (order: readonly string[], name: string) => order.map((e, i) => [e, i] as const).filter(([e]) => e.startsWith(`${name}:`)).map(([, i]) => i);

describe('the rebuild queue runs by priority (C61, C62d)', { timeout: 180_000 }, () => {
  it('with a firstRead rebuild running and a firstRead and a planning job queued, the planning job runs second', async () => {
    const order = await runQueue(({ service, keys, planning, done }) => [
      service.ensureCurrent([keys['read']!], { priority: 'firstRead' }).then(done('read')),
      service.replayToEnd(job(planning), 'planning').then(done('planning')),
    ]);
    expect(ends(order)).toEqual(['running', 'planning', 'read']);
    // the first read's rebuild starts only after the planning replay ended
    expect(Math.min(...writesOf(order, 'read'))).toBeGreaterThan(order.indexOf('planning done'));
  });

  it('a confirmed basis of a running session goes before a planning replay and a first read, whatever the order they were queued in', async () => {
    const order = await runQueue(({ service, keys, planning, done }) => [
      service.ensureCurrent([keys['read']!], { priority: 'firstRead' }).then(done('read')),
      service.replayToEnd(job(planning), 'planning').then(done('planning')),
      service.ensureCurrent([keys['basis']!], { priority: 'runningBasis' }).then(done('basis')),
    ]);
    expect(ends(order)).toEqual(['running', 'basis', 'planning', 'read']);
    expect(Math.max(...writesOf(order, 'basis'))).toBeLessThan(order.indexOf('planning done'));
  });
});
