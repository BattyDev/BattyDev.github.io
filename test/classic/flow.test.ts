import { describe, expect, it } from 'vitest';
import { STARTER_DECKS } from '../../src/classic/cards';
import { apply, legalActions, newGame, toAct } from '../../src/classic/engine';
import type { DeckList, Faction } from '../../src/classic/types';
import { eventsOf, ids, play, rowIds, scenario } from './helpers';

const deckOf = (f: Faction): DeckList => STARTER_DECKS.find((d) => d.faction === f)!;
const game = (a: Faction, b: Faction, seed = 7) =>
  newGame({
    seed,
    players: [
      { name: 'A', deck: deckOf(a) },
      { name: 'B', deck: deckOf(b) },
    ],
  });

describe('setup', () => {
  it('deals 10 each and starts in the redraw phase after a coin flip', () => {
    const { state, events } = game('realms', 'nilfgaard');
    expect(state.phase).toBe('redraw');
    expect(state.players.map((p) => p.hand.length)).toEqual([10, 10]);
    expect(eventsOf(events, 'coin')).toHaveLength(1);
  });

  it("lets a lone Scoia'tael player choose who goes first", () => {
    const { state } = game('realms', 'scoiatael');
    expect(state.phase).toBe('chooseFirst');
    expect(toAct(state)).toBe(1);
    const next = apply(state, { type: 'chooseFirst', first: 0 }).state;
    expect(next.phase).toBe('redraw');
    expect(next.roundStarter).toBe(0);
  });

  it('flips a coin when both players are Scoia\'tael', () => {
    expect(game('scoiatael', 'scoiatael').state.phase).toBe('redraw');
  });

  it('allows up to two redraws each, keeping the hand size', () => {
    let { state } = game('realms', 'monsters');
    const deckBefore = state.players[0].deck.length;
    state = apply(state, { type: 'redraw', uid: state.players[0].hand[0]!.uid }).state;
    state = apply(state, { type: 'redraw', uid: state.players[0].hand[3]!.uid }).state;
    expect(state.players[0].hand).toHaveLength(10);
    expect(state.players[0].deck).toHaveLength(deckBefore);
    expect(state.players[0].redrawDone).toBe(true);
    expect(toAct(state)).toBe(1);
    state = apply(state, { type: 'endRedraw' }).state;
    expect(state.phase).toBe('play');
    expect(state.round).toBe(1);
  });
});

describe('rounds', () => {
  it('the higher total wins the round and the loser loses a life', () => {
    const s = scenario({
      me: { hand: ['realms.ves', 'realms.keira'], board: { close: ['realms.vernon'] } },
      op: { hand: ['nilfgaard.cahir', 'nilfgaard.cahir'], board: { close: ['nilfgaard.rainfarn'] }, passed: true },
    });
    const { state, events } = apply(s, { type: 'pass' });
    expect(eventsOf(events, 'roundEnd')[0]).toMatchObject({ scores: [10, 4], winner: 0, lives: [2, 1] });
    expect(state.round).toBe(2);
    expect(state.roundStarter).toBe(0);
    expect(rowIds(state, 0, 'close')).toEqual([]);
    expect(ids(state.players[0].discard)).toEqual(['realms.vernon']);
  });

  it('a draw costs both players a life', () => {
    const s = scenario({
      me: { leader: 'realms.foltest_gold', hand: ['realms.ves'], board: { close: ['realms.siegfried'] } },
      op: { leader: 'monsters.eredin_silver', hand: ['monsters.fiend'], board: { close: ['monsters.forktail'] }, passed: true },
    });
    const { events } = apply(s, { type: 'pass' });
    expect(eventsOf(events, 'roundEnd')[0]).toMatchObject({ winner: null, lives: [1, 1] });
  });

  it('Nilfgaard wins a drawn round', () => {
    const s = scenario({
      me: { hand: ['realms.ves'], board: { close: ['realms.siegfried'] } },
      op: { hand: ['nilfgaard.cahir'], board: { close: ['nilfgaard.renuald'] }, passed: true },
    });
    const { events } = apply(s, { type: 'pass' });
    expect(eventsOf(events, 'roundEnd')[0]).toMatchObject({ winner: 1, lives: [1, 2] });
  });

  it('after passing, the other player keeps playing until they pass too', () => {
    const s = scenario({ me: { hand: ['realms.ves', 'realms.keira'] }, op: { hand: ['nilfgaard.cahir', 'nilfgaard.cahir', 'nilfgaard.cahir'] } });
    let { state } = apply(s, { type: 'pass' });
    expect(state.current).toBe(1);
    state = play(state, 'nilfgaard.cahir').state;
    expect(state.current).toBe(1);
    state = play(state, 'nilfgaard.cahir').state;
    state = apply(state, { type: 'pass' }).state;
    expect(state.round).toBe(2);
  });

  it('a player with no playable cards passes automatically when their turn comes', () => {
    const s = scenario({ me: { hand: ['realms.ves'] }, op: { hand: ['nilfgaard.cahir', 'nilfgaard.cahir'] } });
    let { state, events } = play(s, 'realms.ves');
    expect(eventsOf(events, 'pass')).toEqual([]);
    ({ state, events } = play(state, 'nilfgaard.cahir'));
    expect(eventsOf(events, 'pass')).toEqual([{ type: 'pass', player: 0, auto: true }]);
    expect(state.current).toBe(1);
  });

  it('the game ends when a player runs out of lives', () => {
    const s = scenario({
      me: { hand: ['realms.ves'], board: { close: ['realms.vernon'] }, lives: 1 },
      op: { hand: ['nilfgaard.cahir'], board: { close: ['nilfgaard.rainfarn'] }, lives: 1, passed: true },
    });
    const { state, events } = apply(s, { type: 'pass' });
    expect(state.phase).toBe('over');
    expect(state.winner).toBe(0);
    expect(eventsOf(events, 'gameOver')).toHaveLength(1);
    expect(legalActions(state)).toEqual([]);
    expect(toAct(state)).toBeNull();
  });

  it('both losing their last life is a draw', () => {
    const s = scenario({
      me: { hand: ['realms.ves'], board: { close: ['realms.siegfried'] }, lives: 1 },
      op: { leader: 'monsters.eredin_silver', hand: ['monsters.fiend'], board: { close: ['monsters.forktail'] }, lives: 1, passed: true },
    });
    expect(apply(s, { type: 'pass' }).state.winner).toBe('draw');
  });

  it('weather is cleared at the end of the round', () => {
    const s = scenario({ me: { hand: ['realms.ves'] }, op: { hand: ['nilfgaard.cahir'], passed: true }, weather: ['neutral.frost'] });
    const { state } = apply(s, { type: 'pass' });
    expect(state.weather).toEqual([]);
    expect(ids(state.players[0].discard)).toEqual(['neutral.frost']);
  });
});

describe('faction perks', () => {
  it('Northern Realms draw a card after winning a round', () => {
    const s = scenario({
      me: { hand: ['realms.ves'], deck: ['realms.keira'], board: { close: ['realms.vernon'] } },
      op: { hand: ['nilfgaard.cahir'], passed: true },
    });
    const { state, events } = apply(s, { type: 'pass' });
    expect(ids(state.players[0].hand)).toEqual(['realms.ves', 'realms.keira']);
    expect(eventsOf(events, 'perk')[0]).toMatchObject({ player: 0, faction: 'realms' });
  });

  it('Monsters keep one random non-hero unit after a round', () => {
    const s = scenario({
      me: { hand: ['realms.ves'] },
      op: { leader: 'monsters.eredin_silver', hand: ['monsters.fiend'], board: { close: ['monsters.draug', 'monsters.forktail'] }, passed: true },
    });
    const { state } = apply(s, { type: 'pass' });
    expect(rowIds(state, 1, 'close')).toEqual(['monsters.forktail']);
    expect(ids(state.players[1].discard)).toEqual(['monsters.draug']);
  });

  it('Skellige bring back two random units at the start of round 3', () => {
    const s = scenario({
      me: { hand: ['realms.ves'] },
      op: {
        leader: 'skellige.crach_an_craite',
        hand: ['skellige.udalryk'],
        discard: ['skellige.donar', 'skellige.svanrige', 'skellige.hjalmar'],
        board: { close: ['skellige.madmad_lugos'] },
        lives: 1,
        passed: true,
      },
      round: 2,
    });
    const { state, events } = apply(s, { type: 'pass' });
    expect(state.round).toBe(3);
    const perk = eventsOf(events, 'perk').find((e) => e.faction === 'skellige');
    expect(perk?.cards).toHaveLength(2);
    expect(perk?.cards.map((c) => c.id)).not.toContain('skellige.hjalmar');
    expect(rowIds(state, 1, 'close')).toHaveLength(2);
  });
});
