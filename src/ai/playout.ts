// The quick policy search uses to finish games. It has to be fast (it runs
// thousands of times per move) and roughly sensible (a silly playout teaches
// the search silly lessons), so it guesses a card's worth from the board
// without simulating, except for the one decision that most decides Gwent
// games: whether a round can still be won once the opponent has passed.

import { def } from '../classic/cards';
import { applyUnchecked, legalActions, other, toAct } from '../classic/engine';
import { totalScore } from '../classic/score';
import type { Action, Card, GameState, PlayerId, Row } from '../classic/types';
import { ROWS } from '../classic/types';
import type { Rng } from '../core/rng';

function margin(s: GameState, p: PlayerId): number {
  return totalScore(s, p) - totalScore(s, other(p));
}

function ahead(s: GameState, p: PlayerId): boolean {
  const m = margin(s, p);
  if (m !== 0) return m > 0;
  return s.players[p].faction === 'nilfgaard' && s.players[other(p)].faction !== 'nilfgaard';
}

function find(s: GameState, uid: number): Card | undefined {
  for (const P of s.players) {
    const c = P.hand.find((x) => x.uid === uid) ?? P.discard.find((x) => x.uid === uid) ?? P.deck.find((x) => x.uid === uid);
    if (c) return c;
    for (const row of ROWS) {
      const u = P.rows[row].units.find((x) => x.uid === uid);
      if (u) return u;
    }
  }
  return undefined;
}

function baseRowStrength(s: GameState, p: PlayerId, row: Row): number {
  let t = 0;
  for (const c of s.players[p].rows[row].units) {
    const d = def(c.id);
    if (d.type === 'unit' && !d.hero) t += d.strength;
  }
  return t;
}

/** Rough worth of an action in points, without simulating it. */
export function quickValue(s: GameState, p: PlayerId, a: Action): number {
  const P = s.players[p];
  // Spies are worth a lot until the last round, when the points they give away matter more.
  const decisive = P.lives === 1 && s.players[other(p)].lives === 1;
  if (a.type === 'leader') return 4;
  if (a.type === 'choose') {
    const c = find(s, a.uid);
    if (!c) return 1;
    const d = def(c.id);
    if (d.type !== 'unit') return 3;
    return d.strength + (d.abilities.includes('spy') ? (decisive ? -4 : 6) : 0) + (d.abilities.includes('medic') ? 5 : 0);
  }
  if (a.type !== 'play') return 0;
  const c = find(s, a.uid);
  if (!c) return 0;
  const d = def(c.id);
  switch (d.type) {
    case 'unit': {
      if (d.abilities.includes('spy')) return decisive ? 0.5 : 9;
      const row = a.row ?? (d.rows[0] as Row);
      let v = d.strength;
      if (d.abilities.includes('medic')) v += P.discard.length ? 6 : 0;
      if (d.abilities.includes('muster') && d.musterPulls) {
        const pulled = P.deck.filter((x) => {
          const o = def(x.id);
          return o.type === 'unit' && o.group === d.musterPulls;
        });
        for (const x of pulled) {
          const o = def(x.id);
          if (o.type === 'unit') v += o.strength;
        }
      }
      if (d.abilities.includes('bond')) {
        const mates = P.rows[row].units.filter((x) => def(x.id).name === d.name).length;
        v += d.strength * mates * 2;
      }
      if (d.abilities.includes('morale')) v += P.rows[row].units.length;
      if (d.abilities.includes('horn')) v += baseRowStrength(s, p, row);
      if (d.abilities.includes('scorch_close') || d.abilities.includes('scorch_ranged') || d.abilities.includes('scorch_siege')) v += 3;
      if (P.rows[row].special || P.rows[row].leaderHorn) v *= 1.6;
      return v;
    }
    case 'weather': {
      if (d.effect === 'clear') return 2 + (s.weather.length ? 3 : -2);
      const rows: Row[] = d.effect === 'frost' ? ['close'] : d.effect === 'fog' ? ['ranged'] : d.effect === 'rain' ? ['siege'] : ['ranged', 'siege'];
      let v = 0;
      for (const r of rows) v += baseRowStrength(s, other(p), r) - baseRowStrength(s, p, r);
      return v * 0.8;
    }
    case 'special':
      if (d.effect === 'horn') return a.row ? baseRowStrength(s, p, a.row) : 0;
      if (d.effect === 'decoy') {
        const t = a.target === undefined ? undefined : find(s, a.target);
        const td = t && def(t.id);
        return td && td.type === 'unit' && td.abilities.includes('spy') ? 7 : 2;
      }
      if (d.effect === 'mardroeme') return 3;
      return 3; // scorch
    default:
      return 0;
  }
}

function weighted(rng: Rng, acts: Action[], weights: number[]): Action {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng.next() * total;
  for (let i = 0; i < acts.length; i++) {
    r -= weights[i] as number;
    if (r <= 0) return acts[i] as Action;
  }
  return acts[acts.length - 1] as Action;
}

/** Cards in hand are worth this many points, depending on what's left to play for. */
function cardWorth(s: GameState, p: PlayerId): number {
  const final = s.players[p].lives === 1 && s.players[other(p)].lives === 1;
  return final ? 1 : s.round === 1 ? 6 : 4;
}

/** Tries every play and weighs score gained against cards spent. */
function greedyChoice(s: GameState, p: PlayerId, plays: Action[], rng: Rng): Action {
  const before = margin(s, p);
  const hand = s.players[p].hand.length;
  const worth = cardWorth(s, p);
  const values: number[] = [];
  let best = -Infinity;
  for (const a of plays) {
    let next = applyUnchecked(s, a).state;
    // Settle our own follow-up choices (Medic and friends) with the quick rule.
    let guard = 0;
    while (next.pending && next.pending.player === p && guard++ < 6) next = applyUnchecked(next, playoutPolicy(next, rng, 'fast')).state;
    const sameRound = next.round === s.round;
    const gain = sameRound ? margin(next, p) - before : 0;
    let v = gain + worth * (next.players[p].hand.length - hand + 1);
    if (a.type === 'leader') v -= 3;
    values.push(v);
    if (v > best) best = v;
  }
  // Mostly the best move, sometimes a near miss: playouts need some variety.
  const weights = values.map((v) => Math.exp((v - best) / 2.5));
  return weighted(rng, plays, weights);
}

export type PlayoutStyle = 'fast' | 'greedy';

export function playoutPolicy(s: GameState, rng: Rng, style: PlayoutStyle = 'fast'): Action {
  const p = toAct(s) as PlayerId;
  if (s.phase === 'chooseFirst') return { type: 'chooseFirst', first: other(p) };
  if (s.phase === 'redraw') return { type: 'endRedraw' };
  const acts = legalActions(s);

  if (s.pending) {
    const discarding = s.pending.kind === 'destroyerDiscard';
    let best = acts[0] as Action;
    let bestV = discarding ? Infinity : -Infinity;
    for (const a of acts) {
      const v = quickValue(s, p, a);
      if (discarding ? v < bestV : v > bestV) {
        bestV = v;
        best = a;
      }
    }
    return best;
  }

  const plays = acts.filter((a) => a.type !== 'pass');
  const pass: Action = { type: 'pass' };
  if (!plays.length) return pass;
  const P = s.players[p];
  const O = s.players[other(p)];
  const m = margin(s, p);
  // Three situations: the final round (everything goes), a round I must win
  // but should win cheaply (I'm on my last life, they aren't), and a round I
  // can afford to lose.
  const final = P.lives === 1 && O.lives === 1;
  const mustWin = P.lives === 1;

  if (O.passed) {
    if (ahead(s, p)) return pass;
    // Find the cheapest card that takes the round, by actually trying a few.
    const tries = plays.length > 8 ? rng.sample(plays, 8) : plays;
    let win: { a: Action; over: number } | null = null;
    let bestGain = -Infinity;
    let bestPlay = tries[0] as Action;
    for (const a of tries) {
      const next = applyUnchecked(s, a).state;
      if (next.round !== s.round) continue;
      const after = margin(next, p);
      const winning = after > 0 || (after === 0 && ahead(next, p));
      if (winning && (!win || after < win.over)) win = { a, over: after };
      if (after - m > bestGain) {
        bestGain = after - m;
        bestPlay = a;
      }
    }
    if (win) return win.a;
    if (mustWin) return bestPlay;
    // Chase only small deficits with a card lead to spare.
    return -m <= bestGain * 1.5 && P.hand.length > O.hand.length ? bestPlay : pass;
  }

  if (final) {
    if (m > 0 && O.hand.length === 0) return pass;
  } else if (mustWin) {
    // Get ahead, then make them spend to catch up.
    if (ahead(s, p) && rng.next() < 0.7) return pass;
  } else {
    if (ahead(s, p) && P.hand.length <= O.hand.length + 1 && rng.next() < 0.7) return pass;
    // Concede a lost cause rather than throw cards after it.
    if (m < -15 && P.hand.length <= O.hand.length + (O.lives === 1 ? 2 : 0) && rng.next() < 0.6) return pass;
  }

  if (style === 'greedy') return greedyChoice(s, p, plays, rng);
  const weights = plays.map((a) => Math.max(0.3, quickValue(s, p, a)) ** 2);
  return weighted(rng, plays, weights);
}
