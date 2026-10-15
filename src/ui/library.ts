// Your saved decks and card collection, kept in this browser.

import type { NamedDeck } from '../classic/deckcode';
import { load, save } from './storage';

export type DeckRole = 'mine' | 'opponent';

export interface SavedDeck extends NamedDeck {
  id: string;
  role: DeckRole;
  updated: number;
}

export function listDecks(role?: DeckRole): SavedDeck[] {
  const all = load<SavedDeck[]>('decks', []);
  return all.filter((d) => !role || d.role === role).sort((a, b) => b.updated - a.updated);
}

export function getDeck(id: string): SavedDeck | undefined {
  return listDecks().find((d) => d.id === id);
}

export function saveDeck(d: SavedDeck): void {
  const all = load<SavedDeck[]>('decks', []).filter((x) => x.id !== d.id);
  all.push({ ...d, updated: Date.now() });
  save('decks', all);
}

export function deleteDeck(id: string): void {
  save(
    'decks',
    load<SavedDeck[]>('decks', []).filter((x) => x.id !== id),
  );
}

export function newDeckId(): string {
  return `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Card ids you've marked as owned in the game. */
export function owned(): Set<string> {
  return new Set(load<string[]>('owned', []));
}

export function setOwned(id: string, has: boolean): void {
  const s = owned();
  if (has) s.add(id);
  else s.delete(id);
  save('owned', [...s]);
}
