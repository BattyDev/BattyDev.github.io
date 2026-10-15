// Scenarios: a mid-game position described by hand, so you can recreate a
// spot from a real match and play it out (or ask the coach) as often as you
// like. A scenario names both decks; whatever isn't on the board, in a hand or
// in a discard pile is shuffled into the remaining deck.

import { Rng } from '../core/rng';
import { def, hasCard, leaderDef } from './cards';
import { fromBase64Url, toBase64Url } from './deckcode';
import type { Card, DeckList, GameState, PlayerId, PlayerState, Row, RowState } from './types';
import { ROWS } from './types';

export type ScenarioWeather = 'frost' | 'fog' | 'rain';

export interface ScenarioSide {
  deck: DeckList;
  /** Cards in hand. For the opponent, add `randomHand` to deal more from their deck. */
  hand: string[];
  randomHand?: number;
  board: Record<Row, string[]>;
  /** Rows with a Commander's Horn card in the slot. */
  horns: Row[];
  discard: string[];
  lives: 1 | 2;
  leaderUsed: boolean;
  passed: boolean;
}

export interface Scenario {
  name: string;
  /** Index 0 is you, 1 the opponent. */
  sides: [ScenarioSide, ScenarioSide];
  weather: ScenarioWeather[];
  round: 1 | 2 | 3;
  /** Whose turn it is. */
  toMove: PlayerId;
}

export function emptySide(deck: DeckList): ScenarioSide {
  return { deck, hand: [], randomHand: 0, board: { close: [], ranged: [], siege: [] }, horns: [], discard: [], lives: 2, leaderUsed: false, passed: false };
}

const WEATHER_CARD: Record<ScenarioWeather, string> = { frost: 'neutral.frost', fog: 'neutral.fog', rain: 'neutral.rain' };
const HORN = 'neutral.horn';

const isSpy = (id: string) => {
  const d = def(id);
  return d.type === 'unit' && d.abilities.includes('spy');
};

/** Problems that make a scenario unplayable, in plain words. Empty means fine. */
export function scenarioErrors(sc: Scenario): string[] {
  const errors: string[] = [];
  const all = sc.sides.flatMap((s) => [...s.hand, ...s.discard, ...ROWS.flatMap((r) => s.board[r])]);
  for (const id of all) if (!hasCard(id)) errors.push(`Unknown card ${id}.`);
  if (errors.length) return errors;
  for (const [i, s] of sc.sides.entries()) {
    const who = i === 0 ? 'You' : 'The opponent';
    for (const row of ROWS) {
      for (const id of s.board[row]) {
        const d = def(id);
        if (d.type !== 'unit') errors.push(`${d.name} isn't a unit, so it can't go on a row.`);
        // Spies sit on the side they were played against, in their own row.
        else if (!d.rows.includes(row)) errors.push(`${d.name} can't stand in the ${row} row.`);
      }
    }
    for (const id of s.hand) if (def(id).type === 'leader') errors.push(`${who} can't hold a leader card.`);
    if (s.lives !== 1 && s.lives !== 2) errors.push(`${who} must have 1 or 2 lives.`);
  }
  if (sc.sides[0].passed && sc.sides[1].passed) errors.push('Both players have passed: the round is already over.');
  if (sc.sides[sc.toMove].passed) errors.push('The player to move has already passed.');
  const [l0, l1] = [sc.sides[0].lives, sc.sides[1].lives];
  if (sc.round === 1 && (l0 < 2 || l1 < 2)) errors.push('Nobody can have lost a life in round 1.');
  if (sc.round === 2 && l0 === 2 && l1 === 2) errors.push('By round 2 someone has lost a life.');
  if (sc.round === 3 && (l0 > 1 || l1 > 1)) errors.push('Round 3 means both players are on their last life.');
  return errors;
}

/** Builds a live game state from a scenario. Throws if scenarioErrors() isn't empty. */
export function fromScenario(sc: Scenario, seed: number): GameState {
  const errors = scenarioErrors(sc);
  if (errors.length) throw new Error(errors.join(' '));
  const rng = new Rng(seed >>> 0);
  let uid = 1;
  const make = (id: string): Card => ({ uid: uid++, id });

  // Every non-token card is created in the uid range of the deck it came
  // from: a spy on your side came from the opponent's deck.
  const starts: number[] = [];
  const built = sc.sides.map(() => ({ hand: [] as Card[], discard: [] as Card[], deck: [] as Card[], rows: {} as Record<Row, RowState> }));
  const placedOn: Card[][][] = [ROWS.map(() => []), ROWS.map(() => [])];
  const weather: { card: Card; owner: PlayerId }[] = [];
  const leaders: Card[] = [];

  for (const p of [0, 1] as const) {
    starts.push(uid);
    const side = sc.sides[p];
    const opp = sc.sides[p === 0 ? 1 : 0];
    leaders.push(make(side.deck.leader));
    // What's left of this deck list once everything already seen is removed.
    const remaining: string[] = side.deck.cards.flatMap(([id, n]) => Array<string>(n).fill(id));
    const take = (id: string) => {
      const i = remaining.indexOf(id);
      if (i >= 0) remaining.splice(i, 1);
      return make(id);
    };
    built[p]!.hand = side.hand.map(take);
    built[p]!.discard = side.discard.map(take);
    ROWS.forEach((row, ri) => {
      for (const id of side.board[row]) {
        const d = def(id);
        if (d.type === 'unit' && d.token) continue; // placed below, outside both ranges
        if (!isSpy(id)) placedOn[p]![ri]!.push(take(id));
      }
      // The opponent's spies on your rows were played from... the opponent's deck.
      for (const id of opp.board[row]) if (isSpy(id)) placedOn[p === 0 ? 1 : 0]![ri]!.push(take(id));
    });
    const hornCards = side.horns.map(() => take(HORN));
    const row = (): RowState => ({ units: [], special: null, leaderHorn: false });
    built[p]!.rows = { close: row(), ranged: row(), siege: row() };
    side.horns.forEach((row, i) => (built[p]!.rows[row].special = hornCards[i] as Card));
    if (p === 0) for (const w of sc.weather) weather.push({ card: take(WEATHER_CARD[w]), owner: 0 });
    rng.shuffle(remaining);
    const extra = Math.max(0, Math.min(side.randomHand ?? 0, remaining.length));
    for (let i = 0; i < extra; i++) built[p]!.hand.push(make(remaining.pop() as string));
    built[p]!.deck = remaining.map(make);
  }
  const end = uid;
  // Tokens (a Hemdall already summoned, say) live outside both ranges.
  for (const p of [0, 1] as const) {
    ROWS.forEach((row, ri) => {
      for (const id of sc.sides[p].board[row]) {
        const d = def(id);
        if (d.type === 'unit' && d.token) placedOn[p]![ri]!.push(make(id));
      }
    });
  }
  // Keep the order the user laid the row out in, roughly: spies last.
  for (const p of [0, 1] as const) ROWS.forEach((row, ri) => (built[p]!.rows[row].units = placedOn[p]![ri]!));

  const players = ([0, 1] as const).map((p): PlayerState => {
    const side = sc.sides[p];
    const leader = leaderDef(side.deck.leader);
    return {
      name: p === 0 ? 'You' : 'Opponent',
      faction: leader.faction,
      leader: leaders[p] as Card,
      leaderUsed: side.leaderUsed,
      leaderDisabled: false,
      deck: built[p]!.deck,
      hand: built[p]!.hand,
      discard: built[p]!.discard,
      rows: built[p]!.rows,
      lives: side.lives,
      passed: side.passed,
      redrawsLeft: 0,
      redrawDone: true,
    };
  }) as [PlayerState, PlayerState];

  const ability = (p: PlayerId) => leaderDef(players[p].leader.id).leader;
  for (const p of [0, 1] as const) players[p].leaderDisabled = ability(p === 0 ? 1 : 0) === 'emhyr_whiteflame';
  const active = (a: string) => ([0, 1] as const).some((p) => !players[p].leaderDisabled && ability(p) === a);

  // Past rounds, consistent with the lives left (checked by scenarioErrors).
  const [l0, l1] = [sc.sides[0].lives, sc.sides[1].lives];
  const rounds: GameState['rounds'] =
    sc.round === 1
      ? []
      : sc.round === 2
        ? [{ scores: [0, 0], winner: l0 === 1 && l1 === 1 ? null : l0 === 1 ? 1 : 0 }]
        : [
            { scores: [0, 0], winner: 1 },
            { scores: [0, 0], winner: 0 },
          ];

  return {
    rng: rng.state,
    nextUid: uid,
    phase: 'play',
    round: sc.round,
    current: sc.toMove,
    roundStarter: sc.toMove,
    chooser: null,
    players,
    weather,
    pending: null,
    rounds,
    randomRespawn: active('emhyr_invader'),
    doubleSpies: active('eredin_treacherous'),
    winner: null,
    turn: 0,
    uidBounds: [starts[0] as number, starts[1] as number, end],
  };
}

const PREFIX = 'GS1.';

export function encodeScenario(sc: Scenario): string {
  return PREFIX + toBase64Url(JSON.stringify(sc));
}

/** Parses a scenario code, or throws with a message fit to show the user. */
export function decodeScenario(code: string): Scenario {
  const t = code.trim();
  if (!t.startsWith(PREFIX)) throw new Error('That isn’t a scenario code (it should start with GS1.).');
  let sc: Scenario;
  try {
    sc = JSON.parse(fromBase64Url(t.slice(PREFIX.length))) as Scenario;
  } catch {
    throw new Error('That scenario code is damaged. Try copying it again.');
  }
  if (!sc || !Array.isArray(sc.sides) || sc.sides.length !== 2) throw new Error('That scenario code is damaged.');
  for (const s of sc.sides) {
    if (!s?.deck || !hasCard(s.deck.leader) || !Array.isArray(s.deck.cards)) throw new Error('The scenario names an unknown deck.');
    for (const [id] of s.deck.cards) if (!hasCard(id)) throw new Error(`Unknown card in scenario: ${id}`);
    s.board = { close: s.board?.close ?? [], ranged: s.board?.ranged ?? [], siege: s.board?.siege ?? [] };
    s.hand ??= [];
    s.discard ??= [];
    s.horns ??= [];
  }
  sc.weather ??= [];
  const errors = scenarioErrors(sc);
  if (errors.length) throw new Error(errors[0]);
  return sc;
}
