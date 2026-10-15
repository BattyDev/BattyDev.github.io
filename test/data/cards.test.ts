// The card data is the foundation; these checks run on every build.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARDS, def, FACTIONS, LEADER_TEXT, STARTER_DECKS } from '../../src/classic/cards';
import { validateDeck } from '../../src/classic/deck';

const art = (size: string, name: string) => resolve(import.meta.dirname, '../../public/art', size, `${name}.webp`);

describe('card data', () => {
  it('has unique ids', () => {
    const ids = CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has art at both sizes for every card', () => {
    const missing = CARDS.flatMap((c) => [art('sm', c.art), art('lg', c.art)]).filter((f) => !existsSync(f));
    expect(missing).toEqual([]);
  });

  it('has five leaders per faction, two for Skellige', () => {
    for (const f of FACTIONS) {
      const n = CARDS.filter((c) => c.type === 'leader' && c.faction === f).length;
      expect(n, f).toBe(f === 'skellige' ? 2 : 5);
    }
  });

  it('describes every leader ability', () => {
    for (const c of CARDS) if (c.type === 'leader') expect(LEADER_TEXT[c.leader], c.id).toBeDefined();
  });

  it('gives every Muster card a group that exists in a deck', () => {
    for (const c of CARDS) {
      if (c.type !== 'unit' || !c.abilities.includes('muster')) continue;
      expect(c.musterPulls, c.id).toBeTruthy();
      const members = CARDS.filter((m) => m.type === 'unit' && m.group === c.musterPulls && !m.token);
      expect(members.length, c.id).toBeGreaterThan(0);
    }
  });

  it('points every summon at a token unit', () => {
    for (const c of CARDS) {
      if (c.type !== 'unit' || !c.summons) continue;
      const t = def(c.summons);
      expect(t.type === 'unit' && t.token, c.id).toBe(true);
    }
  });

  it('keeps tokens out of decks', () => {
    for (const c of CARDS) if (c.type === 'unit' && c.token) expect(c.copies, c.id).toBe(0);
  });

  it('gives units sensible rows and strength', () => {
    for (const c of CARDS) {
      if (c.type !== 'unit') continue;
      expect(c.rows.length, c.id).toBeGreaterThanOrEqual(1);
      expect(c.rows.length === 2 ? c.rows : ['ok']).toEqual(c.rows.length === 2 ? ['close', 'ranged'] : ['ok']);
      expect(c.strength, c.id).toBeGreaterThanOrEqual(0);
      expect(c.strength, c.id).toBeLessThanOrEqual(15);
    }
  });
});

describe('starter decks', () => {
  it('cover every faction', () => {
    expect(new Set(STARTER_DECKS.map((d) => d.faction))).toEqual(new Set(FACTIONS));
  });

  it.each(STARTER_DECKS.map((d, i) => [i, d] as const))('deck %i is legal', (_i, d) => {
    expect(validateDeck(d)).toEqual([]);
  });
});
