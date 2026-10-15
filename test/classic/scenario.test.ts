import { describe, expect, it } from 'vitest';
import { determinize } from '../../src/ai/determinize';
import { STARTER_DECKS } from '../../src/classic/cards';
import { apply, legalActions, toAct } from '../../src/classic/engine';
import { decodeScenario, emptySide, encodeScenario, fromScenario, scenarioErrors, type Scenario } from '../../src/classic/scenario';
import { totalScore } from '../../src/classic/score';
import { view } from '../../src/classic/view';
import { Rng } from '../../src/core/rng';
import { ids, playout } from './helpers';

type ScenarioSideLike = { horns: string[]; hand: string[] };
const realms = STARTER_DECKS.find((d) => d.faction === 'realms')!;
const nilf = STARTER_DECKS.find((d) => d.faction === 'nilfgaard')!;

function base(): Scenario {
  const me = emptySide(realms);
  const op = emptySide(nilf);
  me.hand = ['realms.ves', 'realms.dijkstra', 'neutral.decoy'];
  me.board.close = ['realms.vernon', 'nilfgaard.stefan'];
  me.horns = ['siege'];
  me.board.siege = ['realms.catapult_1'];
  me.discard = ['realms.banner_nurse'];
  op.hand = ['nilfgaard.cahir'];
  op.randomHand = 3;
  op.board.ranged = ['nilfgaard.black_archer'];
  return { name: 'Test', sides: [me, op], weather: ['frost'], round: 2, toMove: 0 };
}

describe('scenarios', () => {
  it('builds the described position', () => {
    const sc = base();
    sc.sides[1].lives = 1;
    const s = fromScenario(sc, 1);
    expect(s.phase).toBe('play');
    expect(toAct(s)).toBe(0);
    expect(ids(s.players[0].hand)).toEqual(['realms.ves', 'realms.dijkstra', 'neutral.decoy']);
    expect(s.players[1].hand).toHaveLength(4);
    expect(ids(s.players[0].rows.close.units)).toEqual(['realms.vernon', 'nilfgaard.stefan']);
    expect(s.players[0].rows.siege.special?.id).toBe('neutral.horn');
    expect(s.weather.map((w) => w.card.id)).toEqual(['neutral.frost']);
    // Vernon 10 (hero) + Stefan spy under frost 1 = 11; Catapult 8 × 2 horn = 16.
    expect(totalScore(s, 0)).toBe(27);
    expect(s.rounds).toEqual([{ scores: [0, 0], winner: 0 }]);
  });

  it('removes placed cards from the remaining decks and keeps every card in its owner’s range', () => {
    const sc = base();
    sc.sides[1].lives = 1;
    const s = fromScenario(sc, 1);
    const deckSize = (d: typeof realms) => d.cards.reduce((t, [, n]) => t + n, 0);
    // Realms: Ves, Dijkstra, Vernon, Catapult, Banner Nurse, Decoy, Horn, Frost may or may not be in the list;
    // whatever was, is no longer in the deck.
    const meAll = [...s.players[0].deck, ...s.players[0].hand, ...s.players[0].discard];
    expect(meAll.length).toBeLessThanOrEqual(deckSize(realms));
    const [b0, b1, b2] = s.uidBounds;
    const stefan = s.players[0].rows.close.units.find((c) => c.id === 'nilfgaard.stefan')!;
    expect(stefan.uid).toBeGreaterThanOrEqual(b1);
    expect(stefan.uid).toBeLessThan(b2);
    for (const c of s.players[0].hand) expect(c.uid).toBeGreaterThanOrEqual(b0);
  });

  it('plays out to the end and the AI can reason about it', () => {
    const sc = base();
    sc.sides[1].lives = 1;
    let s = fromScenario(sc, 7);
    const d = determinize(view(s, 1), 1, realms, new Rng(3));
    expect(legalActions(d).length).toBeGreaterThan(0);
    let seed = 5;
    const { state } = playout(s, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
    expect(state.phase).toBe('over');
    s = apply(s, { type: 'pass' }).state;
    expect(s.players[0].passed).toBe(true);
  });

  it('rejects impossible positions with readable reasons', () => {
    const sc = base();
    expect(scenarioErrors(sc)).toContain('By round 2 someone has lost a life.');
    sc.round = 1;
    sc.sides[0].board.siege.push('realms.ves');
    expect(scenarioErrors(sc).join(' ')).toMatch(/can't stand in the siege row/);
    sc.sides[0].board.siege.pop();
    sc.sides[0].passed = true;
    expect(scenarioErrors(sc)).toContain('The player to move has already passed.');
  });

  it('rejects malformed codes instead of crashing', () => {
    const sc = base();
    sc.sides[1].lives = 1;
    const tamper = (f: (x: Record<string, unknown>) => void) => {
      const x = structuredClone(sc) as unknown as Record<string, unknown>;
      f(x);
      return encodeScenario(x as unknown as Scenario);
    };
    expect(() => decodeScenario(tamper((x) => (x.round = 7)))).toThrow(/round/);
    expect(() => decodeScenario(tamper((x) => (x.toMove = 'me')))).toThrow(/turn/);
    expect(() => decodeScenario(tamper((x) => (x.weather = ['lava'])))).toThrow(/weather/);
    expect(() => decodeScenario(tamper((x) => ((x.sides as ScenarioSideLike[])[0]!.horns = ['roof'])))).toThrow(/horn/);
    expect(() => decodeScenario(tamper((x) => ((x.sides as ScenarioSideLike[])[0]!.hand = [42 as unknown as string])))).toThrow(/malformed/);
  });

  it('round-trips through a share code', () => {
    const sc = base();
    sc.sides[1].lives = 1;
    expect(decodeScenario(encodeScenario(sc))).toEqual(sc);
    expect(() => decodeScenario('nope')).toThrow(/scenario code/);
  });
});
