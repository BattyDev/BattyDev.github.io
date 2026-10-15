// What one player is allowed to know. The AI only ever sees a view, which is
// what makes "the AI does not cheat" true by construction rather than by
// promise.

import type { Card, GameEvent, GameState, PlayerId } from './types';

export const HIDDEN = '?';

const hidden = (): Card => ({ uid: 0, id: HIDDEN });

/**
 * The state as `viewer` sees it: the opponent's hand and deck are face down,
 * your own deck is known as a set but not an order, and the RNG is withheld
 * so the future can't be read off it.
 */
export function view(s: GameState, viewer: PlayerId): GameState {
  const opp = viewer === 0 ? 1 : 0;
  const players = s.players.map((P, i) => {
    if (i === viewer) {
      return { ...P, deck: P.deck.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.uid - b.uid)) };
    }
    return { ...P, hand: P.hand.map(hidden), deck: P.deck.map(hidden) };
  }) as GameState['players'];
  const pending = s.pending && s.pending.player === opp ? { ...s.pending, options: [] } : s.pending;
  return { ...s, rng: 0, players, pending };
}

/** An event as `viewer` sees it, or null when they shouldn't see it at all. */
export function redactEvent(e: GameEvent, viewer: PlayerId): GameEvent | null {
  switch (e.type) {
    case 'draw':
      return e.player === viewer ? e : { ...e, cards: e.cards.map(hidden) };
    case 'redraw':
      return e.player === viewer ? e : { ...e, out: hidden(), in: e.in ? hidden() : null };
    case 'reveal':
      return e.player === viewer ? e : { ...e, cards: e.cards.map(hidden) };
    case 'toHand':
      return e.player === viewer || e.from !== 'deck' ? e : { ...e, card: hidden() };
    default:
      return e;
  }
}
