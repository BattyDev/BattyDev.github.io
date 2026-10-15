// The opponents on offer. Each takes what its player may know and returns an
// action; none of them can see hidden cards.

import type { Action } from '../classic/types';
import { simpleMove, type MoveRequest } from './simple';

export type BotLevel = 'simple';

export const BOTS: Record<BotLevel, { name: string; blurb: string; move: (req: MoveRequest) => Action }> = {
  simple: {
    name: 'Tavern regular',
    blurb: 'Plays the best card in front of it and passes when ahead, much like the game’s own AI.',
    move: simpleMove,
  },
};

export interface BotRequest extends MoveRequest {
  level: BotLevel;
}

export function botMove(req: BotRequest): Action {
  return BOTS[req.level].move(req);
}
