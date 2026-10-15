// Head-to-head matches between bots. Slow: run with `npm run bench`.
//   BENCH_GAMES=40 BENCH_A=2000 BENCH_B=0 npm run bench
// A and B are search iterations per move; 0 means the simple bot. A trailing
// "g" (e.g. 400g) uses greedy playouts.

import { afterAll, describe, expect, it } from 'vitest';
import { search } from '../../src/ai/ismcts';
import { simpleMove } from '../../src/ai/simple';
import { STARTER_DECKS } from '../../src/classic/cards';
import { apply, newGame, toAct } from '../../src/classic/engine';
import type { Action, DeckList, GameState, PlayerId } from '../../src/classic/types';
import { view } from '../../src/classic/view';

type Bot = (s: GameState, me: PlayerId, oppDeck: DeckList, seed: number) => Action;

const GAMES = Number(process.env.BENCH_GAMES ?? 20);
const A = process.env.BENCH_A ?? '600';
const B = process.env.BENCH_B ?? '0';

const simple: Bot = (s, me, oppDeck, seed) => simpleMove({ view: view(s, me), me, opponentDeck: oppDeck, seed });
const searcher =
  (iterations: number, playout: 'fast' | 'greedy'): Bot =>
  (s, me, oppDeck, seed) =>
    s.phase !== 'play' ? simple(s, me, oppDeck, seed) : search(view(s, me), me, { iterations, opponentDeck: oppDeck, seed, playout }).action;
const bot = (spec: string) => (spec === '0' ? simple : searcher(parseInt(spec, 10), spec.endsWith('g') ? 'greedy' : 'fast'));
const label = (spec: string) => (spec === '0' ? 'simple' : `search(${spec})`);

function play(a: Bot, b: Bot, deckA: DeckList, deckB: DeckList, seed: number): PlayerId | 'draw' {
  let s = newGame({ seed, players: [{ name: 'A', deck: deckA }, { name: 'B', deck: deckB }] }).state;
  let i = 0;
  while (s.phase !== 'over') {
    const p = toAct(s) as PlayerId;
    s = apply(s, (p === 0 ? a : b)(s, p, p === 0 ? deckB : deckA, seed * 1000 + i++)).state;
  }
  return s.winner as PlayerId | 'draw';
}

const tally = { a: 0, b: 0, draws: 0 };

describe(`${label(A)} vs ${label(B)}`, () => {
  // Each pairing twice, seats and decks swapped, so luck evens out.
  for (let g = 0; g < GAMES / 2; g++) {
    it(`pairing ${g + 1}`, () => {
      const d1 = STARTER_DECKS[g % STARTER_DECKS.length] as DeckList;
      const d2 = STARTER_DECKS[(g * 3 + 1) % STARTER_DECKS.length] as DeckList;
      for (const [first, aSeat] of [
        [play(bot(A), bot(B), d1, d2, 7000 + g), 0],
        [play(bot(B), bot(A), d1, d2, 7000 + g), 1],
      ] as const) {
        if (first === 'draw') tally.draws++;
        else if (first === aSeat) tally.a++;
        else tally.b++;
      }
    });
  }
  afterAll(() => {
    console.log(`${label(A)} ${tally.a} – ${label(B)} ${tally.b} (draws ${tally.draws})`);
    expect(tally.a + tally.b + tally.draws).toBe(GAMES - (GAMES % 2));
  });
});
