// Promise wrapper around the bot worker. Falls back to running on the main
// thread if workers are unavailable, so the game still works, just less
// smoothly.

import type { Action } from '../classic/types';
import { botMove, type BotRequest } from './bots';

type Reply = { id: number; action?: Action; error?: string };

export class AiClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private waiting = new Map<number, { resolve: (a: Action) => void; reject: (e: Error) => void }>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<Reply>) => {
        const w = this.waiting.get(e.data.id);
        if (!w) return;
        this.waiting.delete(e.data.id);
        if (e.data.action) w.resolve(e.data.action);
        else w.reject(new Error(e.data.error ?? 'bot failed'));
      };
      this.worker.onerror = () => this.fallBack();
    } catch {
      this.worker = null;
    }
  }

  private fallBack(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, w] of this.waiting) w.reject(new Error('worker crashed'));
    this.waiting.clear();
  }

  move(req: BotRequest): Promise<Action> {
    if (!this.worker) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            resolve(botMove(req));
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        }, 0);
      });
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker?.postMessage({ id, req });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
