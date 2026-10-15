// Runs bots and the coach off the main thread so search never freezes the board.

import { runBatch, type BatchRequest } from './batch';
import { botMove, type BotRequest } from './bots';
import { search, type SearchOptions } from './ismcts';
import type { GameState, PlayerId } from '../classic/types';

export interface AnalyseRequest extends SearchOptions {
  view: GameState;
  me: PlayerId;
}

type Envelope =
  | { id: number; kind: 'move'; req: BotRequest }
  | { id: number; kind: 'analyse'; req: AnalyseRequest }
  | { id: number; kind: 'batch'; req: BatchRequest };

self.onmessage = (e: MessageEvent<Envelope>) => {
  const msg = e.data;
  try {
    if (msg.kind === 'move') self.postMessage({ id: msg.id, value: botMove(msg.req) });
    else if (msg.kind === 'batch') self.postMessage({ id: msg.id, value: runBatch(msg.req) });
    else self.postMessage({ id: msg.id, value: search(msg.req.view, msg.req.me, msg.req) });
  } catch (err) {
    self.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
};
