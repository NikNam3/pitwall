// The Box call's rows (SP4.3d spec §6.3, V18 reworked; mockup docs/design/2026-11-16-sp4.3d/sc-card.html; C65: the
// display formats and maps, it computes nothing; C68). The old SC/VSC rows (ΔPOS, P(GAIN), gain strip, REJ, LOSS,
// RANGE per condition) are gone with the old `ScCall` shape; their tests are deleted with them.
// Contract assumed of `rows.ts`:
//  - `buildBlocks(call: ScCallBlocks, out: 'sc' | 'vsc' | undefined): BlockView[]`, one per topic block in its order;
//    `out` is the presentation table's condition (`activeCondition`), not computed here;
//  - `BlockView`: `{ condition, out: boolean, label: string, rows: OptionRow[], scale: number, ourPlace: number |
//    undefined, places: number }`:
//    - `out` the block of the condition that is out; `label` the condition's name (`text.conditions`: SC, VSC, GREEN),
//      for the out block with its laps left: `SC ~4` (the block's `lapsLeft` rounded to whole laps through the kit),
//      the name alone while `lapsLeft` is unknown;
//    - `scale` the kit's `sharedScale` over the block's known pmfs, so the block's strips compare;
//    - `ourPlace` stay's rejoin position (our place now, ruling R29), `undefined` while unknown;
//    - `places` the length of the block's first known pmf (the strip's cells), 0 without one;
//  - `OptionRow`: `{ answer, label, best: boolean, noSet: boolean, ePos, dPos, pGain, rejoin: CellPart, dPosRole: Role |
//    undefined, strip: { pmf: readonly number[] } | CellPart }`, in the topic's order (stay, S, M, H, I, W):
//    - `label` `stay` or `box <compound>` (`text.ts`);
//    - `ePos` `8.03±.07` (E[pos] two decimals, its SE two decimals without the leading zero; the kit's format), E[pos]
//      alone while the SE is unknown; `dPos` ΔPOS signed, two decimals (`+0.72`, `−0.48`); `pGain` a whole percent;
//      `rejoin` `P11`; stay's `dPos` and `pGain` are empty (`{ text: '' }`), whatever the topic carries;
//    - `dPosRole` the emphasis's `deltaRole` of a known ΔPOS (warning below −1 place), `undefined` for stay or unknown;
//    - `best` on the block's known option with the lowest E[pos] (stay included; a tie keeps the first), one per block;
//    - an option the topic marks `unknown('noSet')`: `noSet` true, `ePos` the words `text.noSet` ("no set"), every other
//      cell `{ text: '' }`, no strip; any other unknown: the kit's part (`{ text: '', reason }`), a blank strip `{ text: '' }`;
//  - `buildCompact(call: ScCallBlocks, out: 'sc' | 'vsc' | undefined): CompactRow[]`, one per block:
//    `{ condition, label, out: boolean, option: string, dPos: CellPart, rejoin: CellPart, lit: boolean }`: the box
//    option (never stay) with the highest known ΔPOS (a tie keeps the first), its label, ΔPOS and REJ as in the full
//    rows; `lit` when that ΔPOS is above zero (it beats staying out); `label` and `out` as the block's. Without a known
//    box option: `option` empty, `dPos` and `rejoin` the kit's parts of the first box option's unknowns, not lit.
import { unknown } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { sharedScale } from '../../kit/dist/dist.ts';
import { block, call, cases, GREEN, OUR_PLACE, option, PLACES, SC, VSC, value } from './fixtures.ts';
import { buildBlocks, buildCompact } from './rows.ts';

const valueOf = (name: keyof typeof cases) => cases[name].call.value;
const cellsOf = (b: ReturnType<typeof buildBlocks>[number]) => b.rows.map((r) => [r.label, r.ePos, r.dPos, r.pGain, r.rejoin]);
const t = (text: string) => ({ text });
const EMPTY = t('');

describe('Box call rows', () => {
  it('green running: three blocks SC, VSC, GREEN, six answers each (stay, box S, M, H, I, W)', () => {
    const blocks = buildBlocks(valueOf('green'), undefined);
    expect(blocks.map((b) => [b.condition, b.label, b.out])).toEqual([['sc', 'SC', false], ['vsc', 'VSC', false], ['green', 'GREEN', false]]);
    expect(cellsOf(blocks[0]!)).toEqual([
      ['stay', t('8.03±.07'), EMPTY, EMPTY, t('P8')],
      ['box S', t('8.51±.07'), t('−0.48'), t('35%'), t('P11')],
      ['box M', t('no set'), EMPTY, EMPTY, EMPTY],
      ['box H', t('7.31±.07'), t('+0.72'), t('54%'), t('P10')],
      ['box I', t('12.75±.07'), t('−4.72'), t('3%'), t('P11')],
      ['box W', t('no set'), EMPTY, EMPTY, EMPTY],
    ]);
    expect(cellsOf(blocks[2]!)).toEqual([
      ['stay', t('7.94±.07'), EMPTY, EMPTY, t('P8')],
      ['box S', t('9.79±.07'), t('−1.85'), t('18%'), t('P15')],
      ['box M', t('no set'), EMPTY, EMPTY, EMPTY],
      ['box H', t('8.72±.07'), t('−0.78'), t('31%'), t('P15')],
      ['box I', t('14.52±.07'), t('−6.57'), t('2%'), t('P15')],
      ['box W', t('no set'), EMPTY, EMPTY, EMPTY],
    ]);
    for (const b of blocks) {
      expect(b.rows.map((r) => r.answer), b.condition).toEqual(['stay', 'S', 'M', 'H', 'I', 'W']);
      // the strip: every known pmf as the topic gives it, on the block's one scale, our place now under it
      const pmfs = b.rows.flatMap((r) => ('pmf' in r.strip ? [r.strip.pmf] : []));
      expect(pmfs, b.condition).toHaveLength(4);
      expect(b.scale, b.condition).toBe(sharedScale(pmfs));
      expect([b.ourPlace, b.places], b.condition).toEqual([OUR_PLACE, PLACES]);
    }
  });

  it('the best row per block: the lowest E[pos], stay included (SC and VSC box H, GREEN stay)', () => {
    const best = buildBlocks(valueOf('green'), undefined).map((b) => b.rows.filter((r) => r.best).map((r) => r.label));
    expect(best).toEqual([['box H'], ['box H'], ['stay']]);
    // a tie keeps the first
    const tie = block('sc', { ...SC, H: { ...SC.H, ePos: SC.stay.ePos } });
    expect(buildBlocks(call([tie]), undefined)[0]!.rows.filter((r) => r.best).map((r) => r.label)).toEqual(['stay']);
  });

  it('no set: the words "no set" in E[POS], every other cell empty, no strip, never best', () => {
    for (const b of buildBlocks(valueOf('green'), undefined)) {
      for (const r of b.rows.filter((x) => x.answer === 'M' || x.answer === 'W')) {
        expect(r.noSet, `${b.condition} ${r.label}`).toBe(true);
        expect([r.ePos, r.dPos, r.pGain, r.rejoin, r.strip, r.best]).toEqual([t('no set'), EMPTY, EMPTY, EMPTY, EMPTY, false]);
      }
      for (const r of b.rows.filter((x) => x.answer !== 'M' && x.answer !== 'W')) expect(r.noSet, `${b.condition} ${r.label}`).toBe(false);
    }
  });

  it('ΔPOS below −1 place in the warning role; stay and every other ΔPOS without a role', () => {
    const roles = buildBlocks(valueOf('green'), undefined).map((b) => b.rows.map((r) => r.dPosRole));
    expect(roles).toEqual([
      [undefined, undefined, undefined, undefined, 'warning', undefined],
      [undefined, undefined, undefined, undefined, 'warning', undefined],
      [undefined, 'warning', undefined, undefined, 'warning', undefined],
    ]);
  });

  it('SC out: its block alone, labelled with its laps left (SC ~4), the out block', () => {
    const blocks = buildBlocks(valueOf('scOut'), 'sc');
    expect(blocks.map((b) => [b.condition, b.label, b.out])).toEqual([['sc', 'SC ~4', true]]);
    expect(cellsOf(blocks[0]!)).toEqual(cellsOf(buildBlocks(valueOf('green'), undefined)[0]!));
    // laps left unknown: the name alone
    const noLaps = call([block('sc', SC, unknown('insufficientData'))], 'sc');
    expect(buildBlocks(noLaps, 'sc').map((b) => [b.label, b.out])).toEqual([['SC', true]]);
  });

  it('VSC out: its block alone, labelled VSC ~2', () => {
    expect(buildBlocks(valueOf('vscOut'), 'vsc').map((b) => [b.condition, b.label, b.out])).toEqual([['vsc', 'VSC ~2', true]]);
    // the label follows the presentation's condition, not a block's laps alone: nothing out, no laps
    expect(buildBlocks(valueOf('vscOut'), undefined).map((b) => [b.label, b.out])).toEqual([['VSC', false]]);
  });

  it('unknown cells: the kit\'s parts, a blank strip; E[pos] alone without its SE', () => {
    const pending = block('vsc', VSC);
    pending.options[1] = option('S', 'insufficientData');
    pending.options[3] = { ...option('H', VSC.H), se: unknown('insufficientData'), rejoinPosition: unknown('notReceived') };
    const [b] = buildBlocks(call([pending]), undefined);
    const s = b!.rows[1]!;
    const mark = { text: '', reason: 'insufficientData' };
    expect([s.ePos, s.dPos, s.pGain, s.rejoin, s.strip, s.noSet, s.dPosRole]).toEqual([mark, mark, mark, mark, EMPTY, false, undefined]);
    const h = b!.rows[3]!;
    expect([h.ePos, h.dPos, h.rejoin]).toEqual([t('7.63'), t('+0.34'), { text: '', reason: 'notReceived' }]);
    // stay's rejoin unknown: no place under the strips
    pending.options[0] = { ...option('stay', VSC.stay), rejoinPosition: unknown('notReceived') };
    expect(buildBlocks(call([pending]), undefined)[0]!.ourPlace).toBeUndefined();
  });

  it('a car the call does not apply to: no block', () => {
    expect(buildBlocks(valueOf('notApplicable'), undefined)).toEqual([]);
    expect(buildCompact(valueOf('notApplicable'), undefined)).toEqual([]);
  });
});

describe('Box call compact rows', () => {
  it('compact: per condition the best box option by ΔPOS, its ΔPOS and rejoin, lit where it beats staying out', () => {
    expect(buildCompact(valueOf('green'), undefined).map((r) => [r.label, r.option, r.dPos, r.rejoin, r.lit])).toEqual([
      ['SC', 'box H', t('+0.72'), t('P10'), true],
      ['VSC', 'box H', t('+0.34'), t('P11'), true],
      ['GREEN', 'box H', t('−0.78'), t('P15'), false],
    ]);
  });

  it('compact picks by ΔPOS, never stay, a tie keeping the first', () => {
    // S beats H by ΔPOS: S is shown, whatever the order of E[pos]
    const sFirst = block('green', { ...GREEN, S: { ...GREEN.S, dPos: 0.9 } });
    expect(buildCompact(call([sFirst]), undefined).map((r) => [r.option, r.dPos, r.lit])).toEqual([['box S', t('+0.90'), true]]);
    // a tie between S and H keeps S
    const tie = block('green', { ...GREEN, S: { ...GREEN.S, dPos: GREEN.H.dPos } });
    expect(buildCompact(call([tie]), undefined).map((r) => r.option)).toEqual(['box S']);
    // zero is no gain: not lit
    const even = block('green', { ...GREEN, H: { ...GREEN.H, dPos: 0 } });
    expect(buildCompact(call([even]), undefined).map((r) => [r.option, r.lit])).toEqual([['box H', false]]);
  });

  it('compact, SC out: the SC row alone, labelled SC ~4', () => {
    expect(buildCompact(valueOf('scOut'), 'sc').map((r) => [r.label, r.out, r.option, r.dPos, r.rejoin, r.lit])).toEqual([
      ['SC ~4', true, 'box H', t('+0.72'), t('P10'), true],
    ]);
  });

  it('compact without a known box option: no option, the first box option\'s marks, not lit', () => {
    const none = block('sc', SC);
    for (const i of [1, 3, 4]) none.options[i] = option(none.options[i]!.answer, 'notApplicable');
    const [r] = buildCompact(call([none]), undefined);
    const na = { text: '', reason: 'notApplicable' };
    expect([r!.option, r!.dPos, r!.rejoin, r!.lit]).toEqual(['', na, na, false]);
    // with stay still known, the call shows no stay in compact
    expect(none.options[0]!.ePos).toEqual(value(SC.stay.ePos));
  });
});
