// The UI's pure helpers: the coach's grading and the log's wording.

import { describe, expect, it } from 'vitest';
import type { MoveStat, SearchResult } from '../../src/ai/ismcts';
import { actionKey } from '../../src/ai/keys';
import type { Action } from '../../src/classic/types';
import { judge } from '../../src/ui/coach';
import { describeAction, narrate } from '../../src/ui/narrate';
import { handUid, scenario } from '../classic/helpers';

const s = scenario({ me: { hand: ['realms.ves', 'neutral.decoy', 'neutral.horn'], board: { close: ['realms.siegfried'] } } });
const ves: Action = { type: 'play', uid: handUid(s, 0, 'realms.ves'), row: 'close' };
const pass: Action = { type: 'pass' };

function result(moves: [Action, number, number][]): SearchResult {
  const stats: MoveStat[] = moves.map(([action, visits, win]) => ({ action, visits, win, key: actionKey(s, action) }));
  return { action: stats[0]!.action, moves: stats, iterations: 1000, win: stats[0]!.win };
}

describe('coach grading', () => {
  it('calls the top move best', () => {
    expect(judge({ state: s, action: ves }, result([[ves, 600, 0.6], [pass, 300, 0.4]]), actionKey)?.kind).toBe('best');
  });

  it('flags a well-explored move that gives up 12+ points as a mistake', () => {
    const v = judge({ state: s, action: pass }, result([[ves, 600, 0.62], [pass, 300, 0.45]]), actionKey);
    expect(v?.kind).toBe('mistake');
    expect(v?.loss).toBeCloseTo(0.17);
  });

  it('calls a smaller gap a slip, and a tiny one fine', () => {
    expect(judge({ state: s, action: pass }, result([[ves, 600, 0.6], [pass, 300, 0.52]]), actionKey)?.kind).toBe('inaccuracy');
    expect(judge({ state: s, action: pass }, result([[ves, 600, 0.6], [pass, 300, 0.57]]), actionKey)?.kind).toBe('fine');
  });

  it('does not trust an estimate from a handful of visits', () => {
    expect(judge({ state: s, action: pass }, result([[ves, 900, 0.7], [pass, 10, 0.2]]), actionKey)?.kind).toBe('fine');
  });
});

describe('action descriptions', () => {
  it('names cards, rows and decoy targets', () => {
    expect(describeAction(s, ves)).toBe('Ves');
    expect(describeAction(s, pass)).toBe('Pass');
    expect(describeAction(s, { type: 'play', uid: handUid(s, 0, 'neutral.horn'), row: 'siege' })).toBe("Commander's Horn → siege");
    const siegfried = s.players[0].rows.close.units[0]!.uid;
    expect(describeAction(s, { type: 'play', uid: handUid(s, 0, 'neutral.decoy'), target: siegfried })).toBe('Decoy → take back Siegfried of Denesle');
  });
});

describe('log lines', () => {
  it("speak from the player's side and hide the opponent's draws", () => {
    const card = s.players[0].hand[0]!;
    expect(narrate({ type: 'play', player: 0, card, side: 0, row: 'close' }, 0, 'Bot')?.text).toBe('You played Ves (close combat).');
    expect(narrate({ type: 'play', player: 1, card, side: 1, row: 'close' }, 0, 'Bot')?.text).toBe('Bot played Ves (close combat).');
    expect(narrate({ type: 'draw', player: 1, cards: [{ uid: 0, id: '?' }, { uid: 0, id: '?' }], reason: 'spy' }, 0, 'Bot')?.text).toBe('Bot drew 2 cards.');
    expect(narrate({ type: 'roundEnd', round: 1, scores: [30, 25], winner: 0, lives: [2, 1] }, 0, 'Bot')?.text).toBe('Round 1: You win the round, 30–25.');
  });
});
