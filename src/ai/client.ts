// Promise wrapper around the AI worker. Falls back to running on the main
// thread if workers are unavailable, so the game still works, just less
// smoothly.

import type { Action } from '../classic/types';
import { runBatch, type BatchRequest, type BatchResult } from './batch';
import { botMove, type BotRequest } from './bots';
import { search, type SearchResult } from './ismcts';
import type { AnalyseRequest } from './worker';

type Reply = { id: number; value?: unknown; error?: string };

export class AiClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<Reply>) => {
        const w = this.waiting.get(e.data.id);
        if (!w) return;
        this.waiting.delete(e.data.id);
        if (e.data.error === undefined) w.resolve(e.data.value);
        else w.reject(new Error(e.data.error));
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

  private call<T>(kind: 'move' | 'analyse' | 'batch', req: unknown, local: () => T): Promise<T> {
    if (!this.worker) {
      return new Promise((resolve, reject) =>
        setTimeout(() => {
          try {
            resolve(local());
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        }, 0),
      );
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker?.postMessage({ id, kind, req });
    });
  }

  move(req: BotRequest): Promise<Action> {
    return this.call('move', req, () => botMove(req));
  }

  analyse(req: AnalyseRequest): Promise<SearchResult> {
    return this.call('analyse', req, () => search(req.view, req.me, req));
  }

  batch(req: BatchRequest): Promise<BatchResult> {
    return this.call('batch', req, () => runBatch(req));
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
