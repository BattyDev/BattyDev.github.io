import { describe, expect, it } from 'vitest';
import { STARTER_DECKS } from '../../src/classic/cards';
import { decodeDeck, encodeDeck } from '../../src/classic/deckcode';

describe('deck codes', () => {
  it('round-trip every starter deck', () => {
    for (const d of STARTER_DECKS) {
      const named = { ...d, name: 'Test – ünïcode' };
      const back = decodeDeck(encodeDeck(named));
      expect(back).toEqual(named);
    }
  });

  it('survive surrounding whitespace', () => {
    const code = encodeDeck({ ...STARTER_DECKS[0]!, name: 'x' });
    expect(decodeDeck(`  ${code}\n`).leader).toBe(STARTER_DECKS[0]!.leader);
  });

  it('reject junk with a readable message', () => {
    expect(() => decodeDeck('hello')).toThrow(/deck code/);
    expect(() => decodeDeck('GW1.!!!')).toThrow(/damaged/);
  });

  it('reject unknown cards', () => {
    const bad = 'GW1.' + btoa(JSON.stringify({ n: 'x', f: 'realms', l: 'realms.foltest_gold', c: ['realms.nope'] })).replace(/=+$/, '');
    expect(() => decodeDeck(bad)).toThrow(/Unknown card/);
  });
});
