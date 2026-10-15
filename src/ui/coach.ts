// The coach: hints during play, the opponent's remaining cards, and a review
// of your decisions after the match. Every number here comes from the same
// search the strong opponent uses, run on what you could see at the time.

import type { MoveStat, SearchResult } from '../ai/ismcts';
import { seenFrom } from '../ai/determinize';
import { def } from '../classic/cards';
import type { Action, Card, DeckList, GameState, PlayerId } from '../classic/types';
import { tile } from './cards';
import { h } from './dom';
import { describeAction } from './narrate';

export const pct = (x: number) => `${Math.round(x * 100)}%`;

function moveRow(s: GameState, m: MoveStat, best: boolean): HTMLElement {
  return h(
    'li',
    { class: best ? 'best' : '' },
    h('span', { class: 'coach-name' }, describeAction(s, m.action)),
    h('span', { class: 'coach-bar', style: `--w:${Math.round(m.win * 100)}%` }),
    h('span', { class: 'coach-pct' }, pct(m.win)),
  );
}

/** The best move, or null while the coach is still thinking. */
export function bestMove(r: SearchResult | null): MoveStat | null {
  return r?.moves[0] ?? null;
}

export function coachPanel(s: GameState, r: SearchResult | null): HTMLElement {
  if (!r) {
    return h('section', { class: 'coach', aria: { label: 'Coach' } }, h('header', null, h('strong', null, 'Coach'), h('span', { class: 'muted' }, 'thinking…')));
  }
  const best = r.moves[0];
  const top = r.moves.slice(0, 3);
  const pass = r.moves.find((m) => m.action.type === 'pass');
  const passShown = pass && !top.includes(pass);
  return h(
    'section',
    { class: 'coach', aria: { label: 'Coach' } },
    h('header', null, h('strong', null, 'Coach'), best ? h('span', { class: 'coach-win' }, `Win chance ${pct(best.win)}`) : null),
    h('ol', { class: 'coach-moves' }, ...top.map((m, i) => moveRow(s, m, i === 0))),
    passShown && pass ? h('p', { class: 'coach-pass' }, `If you pass now: ${pct(pass.win)}`) : null,
  );
}

/** Which UI element the coach's best move points at, for a gentle highlight. */
export function hintTarget(r: SearchResult | null): { hand?: number; leader?: boolean; pass?: boolean } {
  const a = bestMove(r)?.action;
  if (!a) return {};
  if (a.type === 'play') return { hand: a.uid };
  if (a.type === 'leader') return { leader: true };
  if (a.type === 'pass') return { pass: true };
  return {};
}

/** The opponent's cards you haven't seen yet: still in their hand or deck. */
export function unseen(v: GameState, opp: PlayerId, deck: DeckList): { id: string; n: number }[] {
  const left = new Map<string, number>();
  for (const [id, n] of deck.cards) left.set(id, (left.get(id) ?? 0) + n);
  for (const id of seenFrom(v, opp)) {
    const n = left.get(id);
    if (n !== undefined) n > 1 ? left.set(id, n - 1) : left.delete(id);
  }
  return [...left].map(([id, n]) => ({ id, n })).sort((a, b) => {
    const da = def(a.id);
    const db = def(b.id);
    const sa = da.type === 'unit' ? da.strength : -1;
    const sb = db.type === 'unit' ? db.strength : -1;
    return sb - sa || a.id.localeCompare(b.id);
  });
}

export function trackerBody(v: GameState, opp: PlayerId, deck: DeckList, onHover: (c: Card) => void): Node[] {
  const list = unseen(v, opp, deck);
  const total = list.reduce((t, x) => t + x.n, 0);
  const inHand = v.players[opp].hand.length;
  return [
    h('p', null, `${total} card${total === 1 ? '' : 's'} not seen yet: ${inHand} in their hand, ${v.players[opp].deck.length} in their deck. Their deck list is known; the order and their hand are not.`),
    h(
      'div',
      { class: 'pick-grid tracker' },
      ...list.map(({ id, n }) => {
        const c: Card = { uid: -1, id };
        return h('div', { class: 'tracker-card' }, tile(c, { onHover: () => onHover(c) }), n > 1 ? h('span', { class: 'tracker-n' }, `×${n}`) : null);
      }),
    ),
  ];
}

// ---------------------------------------------------------------------------
// Post-match review

export interface Decision {
  state: GameState;
  action: Action;
}

export interface Verdict {
  decision: Decision;
  chosen: MoveStat | null;
  best: MoveStat;
  /** How much win chance the chosen move gave up, 0–1. */
  loss: number;
  kind: 'best' | 'fine' | 'inaccuracy' | 'mistake';
}

const sameAction = (a: Action, b: Action) => JSON.stringify(a) === JSON.stringify(b);

export function judge(d: Decision, r: SearchResult, keyOf: (s: GameState, a: Action) => string): Verdict | null {
  const best = r.moves[0];
  if (!best) return null;
  const k = keyOf(d.state, d.action);
  const chosen = r.moves.find((m) => m.key === k || sameAction(m.action, d.action)) ?? null;
  // Too few visits to trust a low estimate: treat as no worse than "fine".
  const trusted = chosen !== null && chosen.visits >= 25;
  const loss = chosen ? Math.max(0, best.win - chosen.win) : 0;
  const kind: Verdict['kind'] = chosen?.key === best.key ? 'best' : !trusted || loss < 0.05 ? 'fine' : loss < 0.12 ? 'inaccuracy' : 'mistake';
  return { decision: d, chosen, best, loss, kind };
}

function sparkline(points: number[]): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const w = 300;
  const hgt = 60;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Your win chance over the match');
  const mid = document.createElementNS(ns, 'line');
  mid.setAttribute('x1', '0');
  mid.setAttribute('x2', String(w));
  mid.setAttribute('y1', String(hgt / 2));
  mid.setAttribute('y2', String(hgt / 2));
  mid.setAttribute('class', 'spark-mid');
  svg.append(mid);
  if (points.length > 1) {
    const line = document.createElementNS(ns, 'polyline');
    line.setAttribute('points', points.map((p, i) => `${(i / (points.length - 1)) * w},${(1 - p) * hgt}`).join(' '));
    line.setAttribute('class', 'spark-line');
    svg.append(line);
  }
  return svg;
}

export function reviewBody(verdicts: Verdict[], onReplay: (d: Decision) => void): Node[] {
  const mistakes = verdicts.filter((v) => v.kind === 'mistake').length;
  const slips = verdicts.filter((v) => v.kind === 'inaccuracy').length;
  const summary =
    mistakes + slips === 0
      ? 'No clear mistakes: every move was close to the best the coach found.'
      : `${mistakes} mistake${mistakes === 1 ? '' : 's'} and ${slips} smaller slip${slips === 1 ? '' : 's'}.`;
  const label = { best: 'Best', fine: 'Good', inaccuracy: 'Slip', mistake: 'Mistake' } as const;
  return [
    h('p', null, summary),
    sparkline(verdicts.map((v) => v.chosen?.win ?? v.best.win)),
    h(
      'ol',
      { class: 'review' },
      ...verdicts.map((v) =>
        h(
          'li',
          { class: v.kind },
          h('span', { class: 'review-kind' }, label[v.kind]),
          h(
            'span',
            { class: 'review-text' },
            `Round ${v.decision.state.round}: ${describeAction(v.decision.state, v.decision.action)}${v.chosen ? ` (${pct(v.chosen.win)})` : ''}`,
            v.kind === 'inaccuracy' || v.kind === 'mistake' ? h('span', { class: 'muted' }, ` · better: ${describeAction(v.decision.state, v.best.action)} (${pct(v.best.win)})`) : null,
          ),
          v.kind === 'inaccuracy' || v.kind === 'mistake' ? h('button', { class: 'btn small', on: { click: () => onReplay(v.decision) } }, 'Replay from here') : null,
        ),
      ),
    ),
  ];
}
