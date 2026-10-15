// A quick, sensible opponent: one move of lookahead over a few guesses at the
// hidden cards, plus rules of thumb for the one decision that matters most in
// classic Gwent — when to pass. It plays roughly like the in-game AI; the
// search-based bots build on the same helpers.

import { def } from '../classic/cards';
import { applyUnchecked, legalActions, other } from '../classic/engine';
import { totalScore } from '../classic/score';
import type { Action, DeckList, GameState, PlayerId } from '../classic/types';
import { Rng } from '../core/rng';
import { determinize } from './determinize';
import { actionKey } from './keys';

export interface MoveRequest {
  view: GameState;
  me: PlayerId;
  opponentDeck: DeckList | null;
  seed: number;
}

const SAMPLES = 6;
const LEADER_COST = 4;

export function margin(s: GameState, me: PlayerId): number {
  return totalScore(s, me) - totalScore(s, other(me));
}

/** Is `me` winning the round as it stands (ties go to a lone Nilfgaard)? */
export function ahead(s: GameState, me: PlayerId): boolean {
  const m = margin(s, me);
  if (m !== 0) return m > 0;
  return s.players[me].faction === 'nilfgaard' && s.players[other(me)].faction !== 'nilfgaard';
}

/** What a card in hand is worth relative to points on the board, by situation. */
export function cardValue(s: GameState, me: PlayerId): number {
  const final = s.players[me].lives === 1 && s.players[other(me)].lives === 1;
  return final ? 2 : s.round === 1 ? 7 : 5;
}

export function dedupe(s: GameState, _me: PlayerId, acts: Action[]): Action[] {
  const seen = new Set<string>();
  return acts.filter((a) => {
    const k = actionKey(s, a);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Resolve our own pending choices greedily, so an action is scored with its full effect. */
export function settle(s: GameState, me: PlayerId): GameState {
  let guard = 0;
  while (s.pending && s.pending.player === me && guard++ < 10) {
    let best: GameState | null = null;
    let bestScore = -Infinity;
    for (const a of legalActions(s)) {
      const next = applyUnchecked(s, a).state;
      let sc = margin(next, me) + cardValue(next, me) * next.players[me].hand.length;
      // Destroyer of Worlds: keep strong cards, ditch weak ones.
      if (s.pending.kind === 'destroyerDiscard' || s.pending.kind === 'destroyerDraw') {
        sc = next.players[me].hand.reduce((t, c) => {
          const d = def(c.id);
          return t + (d.type === 'unit' ? d.strength : 4);
        }, 0);
      }
      if (sc > bestScore) {
        bestScore = sc;
        best = next;
      }
    }
    if (!best) break;
    s = best;
  }
  return s;
}

interface Scored {
  action: Action;
  value: number;
  marginAfter: number;
}

function score(worlds: GameState[], me: PlayerId, a: Action): Scored {
  let value = 0;
  let marginAfter = 0;
  for (const w of worlds) {
    const before = margin(w, me);
    const handBefore = w.players[me].hand.length;
    const after = settle(applyUnchecked(w, a).state, me);
    const m = after.round === w.round ? margin(after, me) : before;
    const cards = after.players[me].hand.length - handBefore + 1;
    let v = m - before + cardValue(w, me) * cards;
    if (a.type === 'leader') v -= LEADER_COST;
    value += v;
    marginAfter += m;
  }
  return { action: a, value: value / worlds.length, marginAfter: marginAfter / worlds.length };
}

function chooseRedraw(s: GameState, me: PlayerId): Action {
  const P = s.players[me];
  if (P.redrawsLeft === 0) return { type: 'endRedraw' };
  const counts = new Map<string, number>();
  for (const c of P.hand) {
    const d = def(c.id);
    const key = d.type === 'weather' ? `w:${d.effect}` : d.type === 'unit' && d.group ? `g:${d.group}` : c.id;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Dead weight: second copies of a weather card, or muster partners that
  // would sit in hand instead of being pulled from the deck.
  for (const c of P.hand) {
    const d = def(c.id);
    const key = d.type === 'weather' ? `w:${d.effect}` : d.type === 'unit' && d.group && d.abilities.includes('muster') ? `g:${d.group}` : null;
    if (key && (counts.get(key) ?? 0) > 1) return { type: 'redraw', uid: c.uid };
  }
  // Then the weakest plain unit, if it's really weak.
  const weak = P.hand
    .map((c) => ({ c, d: def(c.id) }))
    .filter(({ d }) => d.type === 'unit' && !d.hero && d.abilities.length === 0 && d.strength <= 2)
    .sort((a, b) => (a.d as { strength: number }).strength - (b.d as { strength: number }).strength);
  if (weak[0]) return { type: 'redraw', uid: weak[0].c.uid };
  return { type: 'endRedraw' };
}

export function simpleMove(req: MoveRequest): Action {
  const { view, me } = req;
  const rng = new Rng(req.seed);
  const acts = legalActions(view);
  if (acts.length === 0) throw new Error('no legal actions');
  if (acts.length === 1) return acts[0] as Action;

  if (view.phase === 'chooseFirst') return { type: 'chooseFirst', first: other(me) };
  if (view.phase === 'redraw') return chooseRedraw(view, me);

  const worlds = Array.from({ length: SAMPLES }, () => determinize(view, me, req.opponentDeck, rng));

  if (view.pending) {
    // Score each answer by the position it leads to.
    let best = acts[0] as Action;
    let bestScore = -Infinity;
    for (const a of dedupe(view, me, acts)) {
      let total = 0;
      for (const w of worlds) {
        const next = settle(applyUnchecked(w, a).state, me);
        total += margin(next, me) + cardValue(next, me) * next.players[me].hand.length;
      }
      if (total > bestScore) {
        bestScore = total;
        best = a;
      }
    }
    return best;
  }

  const plays = dedupe(view, me, acts).filter((a) => a.type !== 'pass');
  const scored = plays.map((a) => score(worlds, me, a)).sort((a, b) => b.value - a.value);
  const pass: Action = { type: 'pass' };
  const best = scored[0];
  if (!best) return pass;

  const P = view.players[me];
  const O = view.players[other(me)];
  const m = margin(view, me);
  const lastLife = P.lives === 1;

  if (O.passed) {
    if (ahead(view, me)) return pass;
    // Win as cheaply as possible: the winning move with the least overkill.
    const winners = scored.filter((x) => x.marginAfter > 0 || (x.marginAfter === 0 && P.faction === 'nilfgaard'));
    if (winners.length) return winners.sort((a, b) => a.marginAfter - b.marginAfter || b.value - a.value)[0]!.action;
    if (lastLife) return best.action;
    // Can the hand make up the gap over several moves? Roughly: sum of the best gains.
    const gains = scored.map((x) => x.marginAfter - m).filter((g) => g > 0).sort((a, b) => b - a);
    const reachable = gains.slice(0, P.hand.length).reduce((t, g) => t + g, 0) > -m;
    const cheap = -m <= 8 || P.hand.length > O.hand.length + 2;
    return reachable && cheap ? best.action : pass;
  }

  if (lastLife && O.lives === 1) {
    // Final round: play on unless the lead is out of reach of their hand.
    if (m > O.hand.length * 10 + 5) return pass;
    return best.action;
  }
  if (lastLife) {
    // Must win this round, but there's another after it: get ahead, then
    // make them spend to catch up.
    if (m > 0 && best.value < 8) return pass;
    return best.action;
  }
  // Ahead with no card disadvantage: pass and make them spend cards to win.
  if (m > 0 && P.hand.length <= O.hand.length + 1 && best.value < 8) return pass;
  // Far behind and not ahead on cards: concede the round, save the cards.
  if (m < -12 && P.hand.length <= O.hand.length + (O.lives === 1 ? 2 : 0)) return pass;
  return best.action;
}
