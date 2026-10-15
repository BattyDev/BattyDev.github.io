// Strength is always derived, never stored: a card's strength is a function
// of the board around it. The order of operations matters and is pinned down
// by test/classic/score.test.ts:
//
//   base → weather → spy doubling (Eredin, the Treacherous) → Tight Bond
//        → Morale Boost → Commander's Horn
//
// Heroes ignore all of it. Decoys are worth 0.

import { def } from './cards';
import type { Card, GameState, PlayerId, Row, RowState, UnitDef } from './types';
import { ROWS } from './types';

export function weatherOn(state: GameState, row: Row): boolean {
  for (const w of state.weather) {
    const effect = (def(w.card.id) as { effect?: string }).effect;
    if (row === 'close' && effect === 'frost') return true;
    if (row === 'ranged' && (effect === 'fog' || effect === 'storm')) return true;
    if (row === 'siege' && (effect === 'rain' || effect === 'storm')) return true;
  }
  return false;
}

export function leaderActive(state: GameState, player: PlayerId, ability: string): boolean {
  const p = state.players[player];
  if (p.leaderDisabled) return false;
  const d = def(p.leader.id);
  return d.type === 'leader' && d.leader === ability;
}

/**
 * Every card's strength on one row, in row order, in a single pass: the
 * row-wide effects (weather, horns, morale, bond counts) are worked out once
 * rather than once per card. Search calls this constantly.
 */
export function rowStrengths(state: GameState, side: PlayerId, row: Row): number[] {
  const r: RowState = state.players[side].rows[row];
  const n = r.units.length;
  const out = new Array<number>(n);
  if (n === 0) return out;

  const defs = new Array<UnitDef | null>(n);
  let horns = r.leaderHorn ? 1 : 0;
  if (r.special) {
    const sd = def(r.special.id);
    if (sd.type === 'special' && sd.effect === 'horn') horns++;
  }
  let morale = 0;
  let bonds: Map<string, number> | null = null;
  for (let i = 0; i < n; i++) {
    const d = def((r.units[i] as Card).id);
    if (d.type !== 'unit') {
      defs[i] = null;
      continue;
    }
    defs[i] = d;
    const ab = d.abilities;
    if (ab.length) {
      if (ab.includes('horn')) horns++;
      if (ab.includes('morale')) morale++;
      if (ab.includes('bond')) {
        bonds ??= new Map();
        bonds.set(d.name, (bonds.get(d.name) ?? 0) + 1);
      }
    }
  }

  const weather = weatherOn(state, row);
  const bran = weather && leaderActive(state, side, 'king_bran');
  const doubleSpies = state.doubleSpies;
  for (let i = 0; i < n; i++) {
    const d = defs[i];
    if (!d) {
      out[i] = 0; // decoy
      continue;
    }
    if (d.hero) {
      out[i] = d.strength;
      continue;
    }
    const ab = d.abilities;
    let st = d.strength;
    if (weather) st = bran ? Math.floor(st / 2) : Math.min(st, 1);
    if (doubleSpies && ab.includes('spy')) st *= 2;
    if (bonds && ab.includes('bond')) {
      const k = bonds.get(d.name) ?? 0;
      if (k > 1) st *= k;
    }
    st += ab.includes('morale') ? morale - 1 : morale;
    if (horns - (ab.includes('horn') ? 1 : 0) > 0) st *= 2;
    out[i] = st;
  }
  return out;
}

/** Current strength of one card on a row. */
export function cardStrength(state: GameState, side: PlayerId, row: Row, card: Card): number {
  const i = state.players[side].rows[row].units.indexOf(card);
  const idx = i >= 0 ? i : state.players[side].rows[row].units.findIndex((c) => c.uid === card.uid);
  return idx >= 0 ? (rowStrengths(state, side, row)[idx] as number) : 0;
}

export function rowScore(state: GameState, side: PlayerId, row: Row): number {
  let total = 0;
  for (const v of rowStrengths(state, side, row)) total += v;
  return total;
}

export function totalScore(state: GameState, side: PlayerId): number {
  let total = 0;
  for (const row of ROWS) total += rowScore(state, side, row);
  return total;
}

export function scores(state: GameState): [number, number] {
  return [totalScore(state, 0), totalScore(state, 1)];
}

/** Non-hero units: the only ones Scorch, Decoy and Medic can touch. */
export function isNormalUnit(d: ReturnType<typeof def>): d is UnitDef {
  return d.type === 'unit' && !d.hero;
}
