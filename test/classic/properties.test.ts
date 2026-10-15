// Invariants checked across thousands of random games. A rule bug that the
// hand-written tests miss tends to show up here as a lost card, a hero whose
// strength moved, or a game that never ends.

import { describe, expect, it } from 'vitest';
import { CARDS, def, FACTIONS, STARTER_DECKS } from '../../src/classic/cards';
import { apply, legalActions, newGame } from '../../src/classic/engine';
import { cardStrength } from '../../src/classic/score';
import type { Action, Faction, GameState } from '../../src/classic/types';
import { ROWS } from '../../src/classic/types';
import { HIDDEN, view } from '../../src/classic/view';
import { nextRandom } from '../../src/core/rng';

function rngFrom(seed: number): () => number {
  let s = seed;
  return () => {
    const [v, n] = nextRandom(s);
    s = n;
    return v;
  };
}

/** Every non-token card in the game, wherever it is. */
function physicalCards(s: GameState): number[] {
  const uids: number[] = [];
  const add = (uid: number, id: string) => {
    const d = def(id);
    if (d.type === 'unit' && d.token) return;
    uids.push(uid);
  };
  for (const P of s.players) {
    for (const zone of [P.deck, P.hand, P.discard]) for (const c of zone) add(c.uid, c.id);
    for (const row of ROWS) {
      for (const c of P.rows[row].units) add(c.uid, c.base ?? c.id);
      if (P.rows[row].special) add(P.rows[row].special!.uid, P.rows[row].special!.id);
    }
  }
  for (const w of s.weather) add(w.card.uid, w.card.id);
  return uids.sort((a, b) => a - b);
}

function checkInvariants(s: GameState, initial: number[]): void {
  expect(physicalCards(s)).toEqual(initial);
  for (const p of [0, 1] as const) {
    for (const row of ROWS) {
      for (const c of s.players[p].rows[row].units) {
        const d = def(c.id);
        if (d.type === 'unit' && d.hero) expect(cardStrength(s, p, row, c)).toBe(d.strength);
        if (d.type === 'unit') expect(d.rows.includes(row) || d.abilities.includes('spy') || !!c.base).toBe(true);
      }
    }
    expect(s.players[p].lives).toBeGreaterThanOrEqual(0);
    const v = view(s, p);
    const opp = v.players[p === 0 ? 1 : 0];
    expect(opp.hand.every((c) => c.id === HIDDEN)).toBe(true);
    expect(opp.deck.every((c) => c.id === HIDDEN)).toBe(true);
    expect(v.rng).toBe(0);
  }
}

const pairings: [Faction, Faction][] = FACTIONS.flatMap((a) => FACTIONS.map((b) => [a, b] as [Faction, Faction]));

describe('random games', () => {
  it.each(pairings)('%s vs %s: 40 games finish with every card accounted for', (a, b) => {
    const decksA = STARTER_DECKS.filter((d) => d.faction === a);
    const decksB = STARTER_DECKS.filter((d) => d.faction === b);
    // Rotate through every leader so each ability sees play.
    const leaders = (f: Faction) => CARDS.filter((c) => c.type === 'leader' && c.faction === f).map((c) => c.id);
    const [leadersA, leadersB] = [leaders(a), leaders(b)];
    for (let g = 0; g < 40; g++) {
      const rnd = rngFrom(g * 7919 + a.length * 31 + b.length);
      let s = newGame({
        seed: g + 1,
        players: [
          { name: 'A', deck: { ...decksA[g % decksA.length]!, leader: leadersA[g % leadersA.length]! } },
          { name: 'B', deck: { ...decksB[g % decksB.length]!, leader: leadersB[(g >> 1) % leadersB.length]! } },
        ],
      }).state;
      const initial = physicalCards(s);
      let steps = 0;
      while (s.phase !== 'over') {
        const acts = legalActions(s);
        expect(acts.length).toBeGreaterThan(0);
        // Bias away from passing so games are long enough to be interesting.
        const nonPass = acts.filter((x) => x.type !== 'pass');
        const pool = nonPass.length && rnd() < 0.85 ? nonPass : acts;
        s = apply(s, pool[Math.floor(rnd() * pool.length)] as Action).state;
        checkInvariants(s, initial);
        expect(++steps).toBeLessThan(500);
      }
      expect(s.winner).not.toBeNull();
      expect(s.rounds.length).toBeGreaterThanOrEqual(2);
      expect(s.rounds.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('determinism', () => {
  it('the same seed and actions give the same game', () => {
    const run = () => {
      const rnd = rngFrom(99);
      let s = newGame({
        seed: 42,
        players: [
          { name: 'A', deck: STARTER_DECKS[0]! },
          { name: 'B', deck: STARTER_DECKS[8]! },
        ],
      }).state;
      const states: string[] = [];
      while (s.phase !== 'over') {
        const acts = legalActions(s);
        s = apply(s, acts[Math.floor(rnd() * acts.length)] as Action).state;
        states.push(JSON.stringify(s));
      }
      return states;
    };
    expect(run()).toEqual(run());
  });

  it('apply does not mutate its input', () => {
    const s = newGame({
      seed: 3,
      players: [
        { name: 'A', deck: STARTER_DECKS[2]! },
        { name: 'B', deck: STARTER_DECKS[4]! },
      ],
    }).state;
    const before = JSON.stringify(s);
    let cur = s;
    const rnd = rngFrom(5);
    for (let i = 0; i < 30 && cur.phase !== 'over'; i++) {
      const snapshot = JSON.stringify(cur);
      const acts = legalActions(cur);
      const next = apply(cur, acts[Math.floor(rnd() * acts.length)] as Action).state;
      expect(JSON.stringify(cur)).toBe(snapshot);
      cur = next;
    }
    expect(JSON.stringify(s)).toBe(before);
  });
});
