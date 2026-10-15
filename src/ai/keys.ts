// Names an action by what it does rather than which physical copy it uses,
// so "play a Decoy on Ves" means the same thing across guesses at the hidden
// cards, and two identical cards in hand don't split the search.

import type { Action, Card, GameState } from '../classic/types';
import { ROWS } from '../classic/types';

function idOf(s: GameState, uid: number): string {
  const find = (cards: readonly Card[]) => cards.find((c) => c.uid === uid)?.id;
  for (const P of s.players) {
    const id = find(P.hand) ?? find(P.discard) ?? find(P.deck);
    if (id) return id;
    for (const row of ROWS) {
      const u = find(P.rows[row].units);
      if (u) return u;
    }
  }
  return `#${uid}`;
}

export function actionKey(s: GameState, a: Action): string {
  switch (a.type) {
    case 'play':
      return `play:${idOf(s, a.uid)}:${a.row ?? ''}:${a.target === undefined ? '' : idOf(s, a.target)}`;
    case 'choose':
      return `choose:${idOf(s, a.uid)}:${a.row ?? ''}`;
    case 'redraw':
      return `redraw:${idOf(s, a.uid)}`;
    case 'chooseFirst':
      return `first:${a.first}`;
    default:
      return a.type;
  }
}
