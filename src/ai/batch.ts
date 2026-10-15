// Plays a deck against an opponent many times with the quick bot on both
// sides: a rough read on a deck before taking it into the real game.

import { applyUnchecked, newGame, toAct } from '../classic/engine';
import type { DeckList, PlayerId } from '../classic/types';
import { view } from '../classic/view';
import { simpleMove } from './simple';

export interface BatchRequest {
  deck: DeckList;
  opponent: DeckList;
  games: number;
  seed: number;
}

export interface BatchResult {
  wins: number;
  losses: number;
  draws: number;
}

export function runBatch(req: BatchRequest): BatchResult {
  const r: BatchResult = { wins: 0, losses: 0, draws: 0 };
  for (let g = 0; g < req.games; g++) {
    // Alternate seats so going first or second evens out.
    const mine: PlayerId = g % 2 === 0 ? 0 : 1;
    const decks = mine === 0 ? [req.deck, req.opponent] : [req.opponent, req.deck];
    let s = newGame({
      seed: req.seed + g,
      players: [
        { name: 'A', deck: decks[0] as DeckList },
        { name: 'B', deck: decks[1] as DeckList },
      ],
    }).state;
    let i = 0;
    while (s.phase !== 'over' && i < 400) {
      const p = toAct(s) as PlayerId;
      const a = simpleMove({ view: view(s, p), me: p, opponentDeck: decks[p === 0 ? 1 : 0] as DeckList, seed: req.seed * 7 + g * 1000 + i++ });
      s = applyUnchecked(s, a).state;
    }
    if (s.winner === 'draw') r.draws++;
    else if (s.winner === mine) r.wins++;
    else r.losses++;
  }
  return r;
}
