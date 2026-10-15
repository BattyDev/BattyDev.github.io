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

function hornSources(row: RowState): number {
  let n = row.leaderHorn ? 1 : 0;
  if (row.special) {
    const d = def(row.special.id);
    if (d.type === 'special' && d.effect === 'horn') n++;
  }
  for (const c of row.units) {
    const d = def(c.id);
    if (d.type === 'unit' && d.abilities.includes('horn')) n++;
  }
  return n;
}

/** Current strength of one card on a row. */
export function cardStrength(state: GameState, side: PlayerId, row: Row, card: Card): number {
  const d = def(card.id);
  if (d.type !== 'unit') return 0; // decoy
  if (d.hero) return d.strength;
  const r = state.players[side].rows[row];
  let s = d.strength;

  if (weatherOn(state, row)) {
    s = leaderActive(state, side, 'king_bran') ? Math.floor(s / 2) : Math.min(s, 1);
  }
  if (state.doubleSpies && d.abilities.includes('spy')) s *= 2;

  if (d.abilities.includes('bond')) {
    let n = 0;
    for (const c of r.units) {
      const o = def(c.id);
      if (o.type === 'unit' && o.name === d.name && o.abilities.includes('bond')) n++;
    }
    if (n > 1) s *= n;
  }

  let morale = 0;
  for (const c of r.units) {
    const o = def(c.id);
    if (o.type === 'unit' && o.abilities.includes('morale')) morale++;
  }
  if (d.abilities.includes('morale')) morale--;
  s += morale;

  const horns = hornSources(r) - (d.abilities.includes('horn') ? 1 : 0);
  if (horns > 0) s *= 2;
  return s;
}

export function rowScore(state: GameState, side: PlayerId, row: Row): number {
  let total = 0;
  for (const c of state.players[side].rows[row].units) total += cardStrength(state, side, row, c);
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
