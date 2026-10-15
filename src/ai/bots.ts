// The opponents on offer. Each takes what its player may know and returns an
// action; none of them can see hidden cards.

import type { Action } from '../classic/types';
import { search } from './ismcts';
import { simpleMove, type MoveRequest } from './simple';

export type BotLevel = 'simple' | 'strong' | 'expert';

/** Search for play-phase decisions; the quick rules for redraws and coin calls. */
function searchMove(iterations: number, timeMs: number) {
  return (req: MoveRequest): Action => {
    if (req.view.phase !== 'play') return simpleMove(req);
    return search(req.view, req.me, { iterations, timeMs, opponentDeck: req.opponentDeck, seed: req.seed }).action;
  };
}

export const BOTS: Record<BotLevel, { name: string; blurb: string; move: (req: MoveRequest) => Action }> = {
  simple: {
    name: 'Tavern regular',
    blurb: 'Plays the best card in front of it and passes when ahead, much like the game’s own AI.',
    move: simpleMove,
  },
  strong: {
    name: 'Seasoned player',
    blurb: 'Thinks a few thousand games ahead each turn. Stronger than anyone in the game.',
    move: searchMove(4000, 1500),
  },
  expert: {
    name: 'Gaunter O’Dimm',
    blurb: 'Takes its time and rarely wastes a card. For when the others feel easy.',
    move: searchMove(16000, 5000),
  },
};

export interface BotRequest extends MoveRequest {
  level: BotLevel;
}

export function botMove(req: BotRequest): Action {
  return BOTS[req.level].move(req);
}
