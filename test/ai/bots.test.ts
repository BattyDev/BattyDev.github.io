import { describe, expect, it } from 'vitest';
import { determinize } from '../../src/ai/determinize';
import { simpleMove } from '../../src/ai/simple';
import { STARTER_DECKS } from '../../src/classic/cards';
import { apply, isLegal, legalActions, newGame, toAct } from '../../src/classic/engine';
import type { Action, DeckList, GameState, PlayerId } from '../../src/classic/types';
import { view } from '../../src/classic/view';
import { nextRandom, Rng } from '../../src/core/rng';

function start(a: DeckList, b: DeckList, seed: number): GameState {
  return newGame({
    seed,
    players: [
      { name: 'A', deck: a },
      { name: 'B', deck: b },
    ],
  }).state;
}

describe('determinize', () => {
  it('keeps everything the viewer can see and fills the rest plausibly', () => {
    const s = start(STARTER_DECKS[0]!, STARTER_DECKS[2]!, 11);
    const v = view(s, 0);
    const d = determinize(v, 0, STARTER_DECKS[2]!, new Rng(5));
    expect(d.players[0].hand).toEqual(s.players[0].hand);
    expect(d.players[1].hand).toHaveLength(s.players[1].hand.length);
    expect(d.players[1].deck).toHaveLength(s.players[1].deck.length);
    // Invented cards come from the opponent's real list.
    const real = [...s.players[1].hand, ...s.players[1].deck].map((c) => c.id).sort();
    const guessed = [...d.players[1].hand, ...d.players[1].deck].map((c) => c.id).sort();
    expect(guessed).toEqual(real);
    // And the result is a live game the engine can continue.
    expect(legalActions(d).length).toBeGreaterThan(0);
  });

  it('does not depend on the real hidden cards', () => {
    const a = start(STARTER_DECKS[0]!, STARTER_DECKS[2]!, 11);
    const b = structuredClone(a);
    // Swap two hidden cards: the viewer's information is unchanged.
    const h = b.players[1].hand;
    const tmp = h[0]!;
    h[0] = b.players[1].deck[0]!;
    b.players[1].deck[0] = tmp;
    const da = determinize(view(a, 0), 0, STARTER_DECKS[2]!, new Rng(9));
    const db = determinize(view(b, 0), 0, STARTER_DECKS[2]!, new Rng(9));
    expect(da.players[1].hand.map((c) => c.id)).toEqual(db.players[1].hand.map((c) => c.id));
  });
});

function playGame(a: DeckList, b: DeckList, seed: number, policy: [Policy, Policy]): GameState {
  let s = start(a, b, seed);
  let steps = 0;
  while (s.phase !== 'over') {
    const p = toAct(s) as PlayerId;
    const act = policy[p](s, p, p === 0 ? b : a, seed + steps);
    expect(isLegal(s, act)).toBe(true);
    s = apply(s, act).state;
    if (++steps > 400) throw new Error('game too long');
  }
  return s;
}

type Policy = (s: GameState, me: PlayerId, oppDeck: DeckList, seed: number) => Action;

const bot: Policy = (s, me, oppDeck, seed) => simpleMove({ view: view(s, me), me, opponentDeck: oppDeck, seed });
const random: Policy = (s, _me, _d, seed) => {
  const acts = legalActions(s);
  return acts[Math.floor(nextRandom(seed)[0] * acts.length)] as Action;
};

describe('simple bot', () => {
  it('only ever chooses legal actions, across every faction', () => {
    for (let i = 0; i < STARTER_DECKS.length; i++) {
      playGame(STARTER_DECKS[i]!, STARTER_DECKS[(i + 3) % STARTER_DECKS.length]!, 100 + i, [bot, bot]);
    }
  });

  it('beats a random player almost every time', () => {
    let wins = 0;
    const games = 20;
    for (let g = 0; g < games; g++) {
      const deck = STARTER_DECKS[g % STARTER_DECKS.length]!;
      const opp = STARTER_DECKS[(g + 5) % STARTER_DECKS.length]!;
      const s = playGame(deck, opp, 500 + g, [bot, random]);
      if (s.winner === 0) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(17);
  });
});
