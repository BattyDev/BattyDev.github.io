// Information Set Monte Carlo Tree Search (single-observer variant, after
// Cowling, Powley & Whitehouse, 2012).
//
// Each iteration deals a fresh guess at the hidden cards (determinize), walks
// one shared tree of actions keyed by *what* is played rather than which
// copy, then finishes the game with a quick playout policy and credits the
// result back up the path. Actions that weren't available in a given guess
// aren't penalised for it: selection divides by how often an action was
// available, not by how often its parent was visited.
//
// The tree's root statistics double as the coach's numbers: visits say how
// much the search trusted a move, reward/visits estimates its win chance.

import { applyUnchecked, legalActions, toAct } from '../classic/engine';
import type { Action, DeckList, GameState, PlayerId } from '../classic/types';
import { Rng } from '../core/rng';
import { determinize } from './determinize';
import { actionKey } from './keys';
import { playoutPolicy, type PlayoutStyle } from './playout';

export interface SearchOptions {
  /** Hard cap on iterations. */
  iterations: number;
  /** Soft cap on wall time, checked every few iterations. */
  timeMs?: number;
  exploration?: number;
  opponentDeck: DeckList | null;
  seed: number;
  /** How games are finished: quick guesses, or a one-move lookahead (slower, wiser). */
  playout?: PlayoutStyle;
}

export interface MoveStat {
  key: string;
  action: Action;
  visits: number;
  /** Estimated chance of winning the match after this move, 0–1. */
  win: number;
}

export interface SearchResult {
  action: Action;
  moves: MoveStat[];
  iterations: number;
  /** Win chance of the position, from the root's point of view. */
  win: number;
}

interface Node {
  /** Player whose move led here (the root's is the searcher). */
  player: PlayerId;
  parent: Node | null;
  children: Map<string, Node>;
  visits: number;
  reward: number;
  avail: number;
}

const node = (player: PlayerId, parent: Node | null): Node => ({ player, parent, children: new Map(), visits: 0, reward: 0, avail: 0 });

function rewardFor(s: GameState, p: PlayerId): number {
  if (s.winner === 'draw') return 0.5;
  return s.winner === p ? 1 : 0;
}

/** Plays a game out to the end with the quick policy. */
export function playout(s: GameState, rng: Rng, style: PlayoutStyle = 'fast'): GameState {
  let guard = 0;
  while (s.phase !== 'over' && guard++ < 400) s = applyUnchecked(s, playoutPolicy(s, rng, style)).state;
  return s;
}

function keyed(s: GameState): Map<string, Action> {
  const out = new Map<string, Action>();
  for (const a of legalActions(s)) {
    const k = actionKey(s, a);
    if (!out.has(k)) out.set(k, a);
  }
  return out;
}

export function search(view: GameState, me: PlayerId, opts: SearchOptions): SearchResult {
  const rng = new Rng(opts.seed);
  const c = opts.exploration ?? 0.7;
  const root = node(me, null);
  const rootActions = keyed(view);
  const deadline = opts.timeMs ? performance.now() + opts.timeMs : Infinity;

  let it = 0;
  for (; it < opts.iterations; it++) {
    if ((it & 15) === 0 && performance.now() > deadline) break;
    let s = determinize(view, me, opts.opponentDeck, rng);
    let n = root;

    // Select and expand.
    while (s.phase !== 'over') {
      const actor = toAct(s) as PlayerId;
      const acts = keyed(s);
      const untried: string[] = [];
      for (const k of acts.keys()) {
        const child = n.children.get(k);
        if (child) child.avail++;
        else untried.push(k);
      }
      if (untried.length) {
        const k = untried[rng.int(untried.length)] as string;
        const child = node(actor, n);
        child.avail = 1;
        n.children.set(k, child);
        s = applyUnchecked(s, acts.get(k) as Action).state;
        n = child;
        break;
      }
      let best: Node | null = null;
      let bestKey = '';
      let bestScore = -Infinity;
      for (const [k, child] of n.children) {
        if (!acts.has(k)) continue;
        const score = child.reward / child.visits + c * Math.sqrt(Math.log(child.avail) / child.visits);
        if (score > bestScore) {
          bestScore = score;
          best = child;
          bestKey = k;
        }
      }
      if (!best) break;
      s = applyUnchecked(s, acts.get(bestKey) as Action).state;
      n = best;
    }

    // Simulate, then back up.
    const end = playout(s, rng, opts.playout);
    for (let m: Node | null = n; m; m = m.parent) {
      m.visits++;
      m.reward += rewardFor(end, m.player);
    }
  }

  const moves: MoveStat[] = [];
  for (const [k, child] of root.children) {
    const action = rootActions.get(k);
    if (!action || child.visits === 0) continue;
    moves.push({ key: k, action, visits: child.visits, win: child.reward / child.visits });
  }
  moves.sort((a, b) => b.visits - a.visits || b.win - a.win);
  const fallback = rootActions.values().next().value as Action;
  return {
    action: moves[0]?.action ?? fallback,
    moves,
    iterations: it,
    win: root.visits ? root.reward / root.visits : 0.5,
  };
}
