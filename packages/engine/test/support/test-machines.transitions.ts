// The test machines' transition tables (`test-machines.ts`), as a sub-machine's table file holds its own.
import type { MachineInput } from '../../src/situations/machine.ts';
import { carMachine, PENDING_MS, probeMachine, sessionMachine, zoneMachine } from './test-machines.ts';
import { defineTransitionTable, FRAME_MS, inputs, type TransitionTable } from './transition-table.ts';

const sc = (i: MachineInput): void => {
  i.signals.session.safetyCarStatus = 'sc';
};
const green = (i: MachineInput): void => {
  i.signals.session.safetyCarStatus = 'green';
};
const scarDeployed = (i: MachineInput): void => {
  i.signals.events.push({ code: 'SCAR', car: 'SC', stage: 'deployed' });
};
const pit = (car: number) => (i: MachineInput): void => {
  i.signals.cars[car]!.pitStatus = 'pitting';
};
const track = (car: number) => (i: MachineInput): void => {
  i.signals.cars[car]!.pitStatus = 'none';
};
const zoneFlag = (flag: 'green' | 'yellow') => (i: MachineInput): void => {
  i.signals.session.marshalZones = [{ startFraction: 0, flag }];
};
/** Frames after a pending neutralisation opened on frame 1 until it is unconfirmed for longer than `PENDING_MS`. */
const UNTIL_UNCONFIRMED = Math.floor(PENDING_MS / FRAME_MS) + 1;

/** The test machines' tables. */
export const TEST_TABLES: readonly TransitionTable[] = [
  defineTransitionTable(sessionMachine, [
    { name: 'joins under green', from: 'none', to: 'green', input: inputs().frame(), join: true },
    { name: 'joins behind the safety car', from: 'none', to: 'neutralised', input: inputs().frame(sc), join: true },
    { name: 'the safety car status opens a neutralisation', from: 'green', to: 'neutralised', input: inputs().frame().frame(sc) },
    { name: 'a SCAR deployment opens a pending neutralisation', from: 'green', to: 'neutralised', input: inputs().frame().frame(scarDeployed) },
    { name: 'the green status ends a confirmed neutralisation', from: 'neutralised', to: 'green', input: inputs().frame(sc).frame(green) },
    {
      name: 'a neutralisation unconfirmed for 3 s closes and green opens',
      from: 'neutralised',
      to: 'green',
      input: inputs().frame().frame(scarDeployed).frames(UNTIL_UNCONFIRMED),
    },
  ]),
  defineTransitionTable(carMachine, [
    { name: 'joins on track', from: 'none', to: 'track', input: inputs().frame(), join: true },
    { name: 'joins in the pit lane', from: 'none', to: 'pit', input: inputs().frame(pit(0)), join: true },
    { name: 'the pit status opens a pit span', from: 'track', to: 'pit', input: inputs().frame().frame(pit(3)) },
    { name: 'the pit status back to none returns to track', from: 'pit', to: 'track', input: inputs().frame(pit(3)).frame(track(3)) },
  ]),
  defineTransitionTable(zoneMachine, [
    { name: 'joins a clear zone', from: 'none', to: 'clear', input: inputs().frame(zoneFlag('green')), join: true },
    { name: 'joins a yellow zone', from: 'none', to: 'yellow', input: inputs().frame(zoneFlag('yellow')), join: true },
    { name: 'a yellow flag opens a yellow span', from: 'clear', to: 'yellow', input: inputs().frame(zoneFlag('green')).frame(zoneFlag('yellow')) },
    { name: 'the yellow flag gone clears the zone', from: 'yellow', to: 'clear', input: inputs().frame(zoneFlag('yellow')).frame(zoneFlag('green')) },
  ]),
  defineTransitionTable(probeMachine, [
    { name: 'joins on the first frame', from: 'none', to: 'seen', input: inputs().frame(), join: true },
    { name: 'every frame opens a new span', from: 'seen', to: 'seen', input: inputs().frame().frame() },
  ]),
];
