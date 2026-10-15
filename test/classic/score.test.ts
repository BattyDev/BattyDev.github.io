// Strength calculation. Each case is a board you can set up in the real game
// and read the numbers off; see docs/VERIFY.md for which ones have been
// confirmed in-game.

import { describe, expect, it } from 'vitest';
import { cardStrength, rowScore, totalScore } from '../../src/classic/score';
import type { Row } from '../../src/classic/types';
import { scenario } from './helpers';

function strengths(s: ReturnType<typeof scenario>, p: 0 | 1, row: Row): number[] {
  return s.players[p].rows[row].units.map((c) => cardStrength(s, p, row, c));
}

describe('base strength', () => {
  it('sums plain units', () => {
    const s = scenario({ me: { board: { close: ['realms.ves', 'realms.siegfried'], siege: ['realms.ballista'] } } });
    expect(rowScore(s, 0, 'close')).toBe(10);
    expect(totalScore(s, 0)).toBe(16);
  });
});

describe('Tight Bond', () => {
  it('multiplies by the number of same-named bond cards on the row', () => {
    const s = scenario({ me: { board: { close: ['realms.blue_stripes', 'realms.blue_stripes', 'realms.blue_stripes'] } } });
    expect(strengths(s, 0, 'close')).toEqual([12, 12, 12]);
  });

  it('bonds different art variants that share a name', () => {
    const s = scenario({ op: { board: { close: ['nilfgaard.young_emissary', 'nilfgaard.young_emissary_1'] } } });
    expect(strengths(s, 1, 'close')).toEqual([10, 10]);
  });

  it('does nothing for a lone card', () => {
    const s = scenario({ me: { board: { close: ['realms.blue_stripes'] } } });
    expect(strengths(s, 0, 'close')).toEqual([4]);
  });
});

describe('Morale Boost', () => {
  it('adds 1 to every other unit on the row', () => {
    const s = scenario({ me: { board: { close: ['neutral.olgierd', 'realms.ves'] } } });
    expect(strengths(s, 0, 'close')).toEqual([6, 6]);
  });

  it('stacks across several morale units', () => {
    const s = scenario({ me: { board: { siege: ['realms.kaedwen_siege', 'realms.kaedwen_siege_1', 'realms.kaedwen_siege_2'] } } });
    expect(strengths(s, 0, 'siege')).toEqual([3, 3, 3]);
  });

  it('is applied after Tight Bond', () => {
    // (4 × 2) + 1 = 9, not (4 + 1) × 2 = 10.
    const s = scenario({ me: { board: { close: ['realms.blue_stripes', 'realms.blue_stripes', 'neutral.olgierd'] } } });
    expect(strengths(s, 0, 'close')).toEqual([9, 9, 6]);
  });

  it('comes from heroes too, though heroes are not boosted', () => {
    const s = scenario({ op: { leader: 'scoiatael.francesca_silver', board: { close: ['scoiatael.isengrim', 'scoiatael.mahakam'] } } });
    expect(strengths(s, 1, 'close')).toEqual([10, 6]);
  });
});

describe("Commander's Horn", () => {
  it('doubles every non-hero unit on the row', () => {
    const s = scenario({ me: { board: { close: ['realms.ves', 'realms.vernon'] }, specials: { close: 'neutral.horn' } } });
    expect(strengths(s, 0, 'close')).toEqual([10, 10]);
  });

  it('is applied after Morale Boost', () => {
    const s = scenario({ me: { board: { close: ['realms.ves', 'neutral.olgierd'] }, specials: { close: 'neutral.horn' } } });
    expect(strengths(s, 0, 'close')).toEqual([12, 12]);
  });

  it('as a unit (Dandelion) does not double itself', () => {
    const s = scenario({ me: { board: { close: ['realms.blue_stripes', 'realms.blue_stripes', 'neutral.dandelion'] } } });
    expect(strengths(s, 0, 'close')).toEqual([16, 16, 2]);
  });

  it('does not stack: two horns still double once', () => {
    const s = scenario({ me: { board: { close: ['realms.ves', 'neutral.dandelion'] }, specials: { close: 'neutral.horn' } } });
    expect(strengths(s, 0, 'close')).toEqual([10, 4]);
  });

  it('leader horns double the row', () => {
    const s = scenario({ me: { board: { siege: ['realms.ballista'] }, leaderHorn: ['siege'] } });
    expect(strengths(s, 0, 'siege')).toEqual([12]);
  });
});

describe('weather', () => {
  it('sets non-hero units on its row to 1 for both players', () => {
    const s = scenario({
      me: { board: { close: ['realms.ves', 'realms.vernon'] } },
      op: { board: { close: ['nilfgaard.cahir'], ranged: ['nilfgaard.assire'] } },
      weather: ['neutral.frost'],
    });
    expect(strengths(s, 0, 'close')).toEqual([1, 10]);
    expect(strengths(s, 1, 'close')).toEqual([1]);
    expect(strengths(s, 1, 'ranged')).toEqual([6]);
  });

  it('leaves 0-strength units at 0', () => {
    const s = scenario({ me: { board: { ranged: ['neutral.cow'] } }, weather: ['neutral.fog'] });
    expect(strengths(s, 0, 'ranged')).toEqual([0]);
  });

  it('applies before bond, morale and horn', () => {
    const s = scenario({
      me: { board: { close: ['realms.blue_stripes', 'realms.blue_stripes', 'neutral.olgierd'] }, specials: { close: 'neutral.horn' } },
      weather: ['neutral.frost'],
    });
    // Blue Stripes: 1 → ×2 bond = 2 → +1 morale = 3 → ×2 horn = 6. Olgierd: 1 ×2 = 2.
    expect(strengths(s, 0, 'close')).toEqual([6, 6, 2]);
  });

  it('Skellige Storm hits ranged and siege, not close', () => {
    const s = scenario({ me: { board: { close: ['realms.ves'], ranged: ['realms.keira'], siege: ['realms.ballista'] } }, weather: ['neutral.storm'] });
    expect([rowScore(s, 0, 'close'), rowScore(s, 0, 'ranged'), rowScore(s, 0, 'siege')]).toEqual([5, 1, 1]);
  });

  it('King Bran halves (rounding down) instead, for his side only', () => {
    const s = scenario({
      me: { leader: 'skellige.king_bran', board: { close: ['skellige.craite_warrior', 'skellige.craite_warrior', 'skellige.madmad_lugos'] } },
      op: { board: { close: ['nilfgaard.cahir'] } },
      weather: ['neutral.frost'],
    });
    expect(strengths(s, 0, 'close')).toEqual([6, 6, 3]);
    expect(strengths(s, 1, 'close')).toEqual([1]);
  });
});

describe('heroes and decoys', () => {
  it('heroes ignore weather, horn and morale', () => {
    const s = scenario({
      me: { board: { close: ['neutral.geralt', 'neutral.olgierd'] }, specials: { close: 'neutral.horn' } },
      weather: ['neutral.frost'],
    });
    expect(strengths(s, 0, 'close')).toEqual([15, 2]);
  });

  it('a decoy on the board is worth 0', () => {
    const s = scenario({ me: { board: { close: ['neutral.decoy', 'realms.ves'] } } });
    expect(strengths(s, 0, 'close')).toEqual([0, 5]);
  });
});

describe('Eredin, the Treacherous', () => {
  it('doubles spies for both players', () => {
    const s = scenario({
      me: { leader: 'monsters.eredin_the_treacherous' },
      op: { board: { close: ['realms.stennis', 'realms.ves'] } },
    });
    expect(strengths(s, 1, 'close')).toEqual([10, 5]);
  });

  it('is off when cancelled by the White Flame', () => {
    const s = scenario({
      me: { leader: 'monsters.eredin_the_treacherous' },
      op: { leader: 'nilfgaard.emhyr_bronze', board: { close: ['realms.stennis'] } },
    });
    expect(strengths(s, 1, 'close')).toEqual([5]);
  });
});
