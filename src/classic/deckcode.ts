// Shareable deck codes: "GW1." followed by base64url JSON. Readable enough to
// survive copy and paste through chat apps, and validated on the way in.

import { hasCard } from './cards';
import type { DeckList, Faction } from './types';

const PREFIX = 'GW1.';

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export interface NamedDeck extends DeckList {
  name: string;
}

export function encodeDeck(deck: NamedDeck): string {
  const body = { n: deck.name, f: deck.faction, l: deck.leader, c: deck.cards.map(([id, n]) => (n === 1 ? id : `${id}*${n}`)) };
  return PREFIX + toBase64Url(JSON.stringify(body));
}

const FACTIONS: Faction[] = ['realms', 'nilfgaard', 'monsters', 'scoiatael', 'skellige'];

/** Parses a deck code, or throws with a message fit to show the user. */
export function decodeDeck(code: string): NamedDeck {
  const trimmed = code.trim();
  if (!trimmed.startsWith(PREFIX)) throw new Error('That isn’t a Gwent deck code (it should start with GW1.).');
  let body: { n?: unknown; f?: unknown; l?: unknown; c?: unknown };
  try {
    body = JSON.parse(fromBase64Url(trimmed.slice(PREFIX.length)));
  } catch {
    throw new Error('That deck code is damaged. Try copying it again.');
  }
  if (typeof body.f !== 'string' || !FACTIONS.includes(body.f as Faction)) throw new Error('The deck code names an unknown faction.');
  if (typeof body.l !== 'string' || !hasCard(body.l)) throw new Error('The deck code names an unknown leader.');
  if (!Array.isArray(body.c)) throw new Error('The deck code has no cards.');
  const counts = new Map<string, number>();
  for (const entry of body.c) {
    if (typeof entry !== 'string') throw new Error('The deck code has a malformed card.');
    const [id, n] = entry.split('*');
    const k = n === undefined ? 1 : Number(n);
    if (!id || !hasCard(id) || !Number.isInteger(k) || k < 1) throw new Error(`Unknown card in deck code: ${id}`);
    counts.set(id, (counts.get(id) ?? 0) + k);
  }
  return {
    name: typeof body.n === 'string' && body.n.trim() ? body.n.trim().slice(0, 60) : 'Imported deck',
    faction: body.f as Faction,
    leader: body.l,
    cards: [...counts],
  };
}
