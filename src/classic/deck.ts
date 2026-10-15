// Deck legality, as the game enforces it: a faction leader, at least 22 unit
// cards, at most 10 special cards (weather included), and only your faction's
// cards plus neutrals.

import { def, hasCard, isSpecialCard } from './cards';
import type { DeckList } from './types';

export const MIN_UNITS = 22;
export const MAX_SPECIALS = 10;

export interface DeckStats {
  units: number;
  specials: number;
  heroes: number;
  strength: number;
  total: number;
}

export function deckStats(deck: DeckList): DeckStats {
  const st: DeckStats = { units: 0, specials: 0, heroes: 0, strength: 0, total: 0 };
  for (const [id, n] of deck.cards) {
    if (!hasCard(id)) continue;
    const d = def(id);
    st.total += n;
    if (d.type === 'unit') {
      st.units += n;
      st.strength += d.strength * n;
      if (d.hero) st.heroes += n;
    } else if (isSpecialCard(d)) {
      st.specials += n;
    }
  }
  return st;
}

/** Problems with a deck, in plain words. Empty means legal. */
export function validateDeck(deck: DeckList): string[] {
  const errors: string[] = [];
  if (!hasCard(deck.leader)) errors.push(`Unknown leader ${deck.leader}.`);
  else {
    const l = def(deck.leader);
    if (l.type !== 'leader') errors.push(`${l.name} is not a leader.`);
    else if (l.faction !== deck.faction) errors.push(`${l.name} does not lead this faction.`);
  }
  const seen = new Map<string, number>();
  for (const [id, n] of deck.cards) {
    if (!hasCard(id)) {
      errors.push(`Unknown card ${id}.`);
      continue;
    }
    const d = def(id);
    if (d.type === 'leader') errors.push(`${d.name} is a leader, not a deck card.`);
    else if (d.type === 'unit' && d.token) errors.push(`${d.name} can't be put in a deck.`);
    else if (d.faction !== 'neutral' && d.faction !== deck.faction) errors.push(`${d.name} belongs to another faction.`);
    if (!Number.isInteger(n) || n < 1) errors.push(`Bad count for ${d.name}.`);
    seen.set(id, (seen.get(id) ?? 0) + n);
  }
  for (const [id, n] of seen) {
    const d = def(id);
    if (n > d.copies) errors.push(`At most ${d.copies} × ${d.name}.`);
  }
  const st = deckStats(deck);
  if (st.units < MIN_UNITS) errors.push(`Needs at least ${MIN_UNITS} unit cards (has ${st.units}).`);
  if (st.specials > MAX_SPECIALS) errors.push(`At most ${MAX_SPECIALS} special cards (has ${st.specials}).`);
  return errors;
}
