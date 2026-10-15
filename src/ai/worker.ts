// Runs bots off the main thread so search never freezes the board.

import { botMove, type BotRequest } from './bots';

interface Envelope {
  id: number;
  req: BotRequest;
}

self.onmessage = (e: MessageEvent<Envelope>) => {
  const { id, req } = e.data;
  try {
    self.postMessage({ id, action: botMove(req) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
