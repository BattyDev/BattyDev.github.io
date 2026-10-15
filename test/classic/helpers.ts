// Builds mid-game positions directly, so a test can say "this board, this
// hand" without playing its way there.

import { def } from '../../src/classic/cards';
import { apply, legalActions } from '../../src/classic/engine';
import type { Action, Card, GameEvent, GameState, PlayerId, PlayerState, Row } from '../../src/classic/types';
import { ROWS } from '../../src/classic/types';

export interface SideSpec {
  leader?: string;
  hand?: string[];
  deck?: string[];
  discard?: string[];
  board?: Partial<Record<Row, string[]>>;
  /** Commander's Horn / Mardroeme already on a row. */
  specials?: Partial<Record<Row, string>>;
  leaderHorn?: Row[];
  leaderUsed?: boolean;
  lives?: number;
  passed?: boolean;
}

export interface ScenarioSpec {
  me?: SideSpec;
  op?: SideSpec;
  /** Weather card ids in play, owned by player 0. */
  weather?: string[];
  current?: PlayerId;
  round?: number;
  seed?: number;
}

const DEFAULT_LEADERS = ['realms.foltest_gold', 'nilfgaard.emhyr_copper'];

export function scenario(spec: ScenarioSpec): GameState {
  let uid = 1;
  const card = (id: string): Card => {
    def(id); // throws on typos
    return { uid: uid++, id };
  };
  const side = (s: SideSpec | undefined, i: number): PlayerState => {
    const leader = card(s?.leader ?? (DEFAULT_LEADERS[i] as string));
    const ld = def(leader.id);
    if (ld.type !== 'leader') throw new Error(`${leader.id} is not a leader`);
    const rows = {} as PlayerState['rows'];
    for (const row of ROWS) {
      rows[row] = {
        units: (s?.board?.[row] ?? []).map(card),
        special: s?.specials?.[row] ? card(s.specials[row] as string) : null,
        leaderHorn: s?.leaderHorn?.includes(row) ?? false,
      };
    }
    return {
      name: i === 0 ? 'Me' : 'Opponent',
      faction: ld.faction,
      leader,
      leaderUsed: s?.leaderUsed ?? false,
      leaderDisabled: false,
      deck: (s?.deck ?? []).map(card),
      hand: (s?.hand ?? []).map(card),
      discard: (s?.discard ?? []).map(card),
      rows,
      lives: s?.lives ?? 2,
      passed: s?.passed ?? false,
      redrawsLeft: 0,
      redrawDone: true,
    };
  };
  const p0 = side(spec.me, 0);
  const split = uid;
  const p1 = side(spec.op, 1);
  const players: [PlayerState, PlayerState] = [p0, p1];
  const state: GameState = {
    rng: spec.seed ?? 12345,
    nextUid: 0,
    phase: 'play',
    round: spec.round ?? 1,
    current: spec.current ?? 0,
    roundStarter: spec.current ?? 0,
    chooser: null,
    players,
    weather: (spec.weather ?? []).map((id) => ({ card: card(id), owner: 0 as PlayerId })),
    pending: null,
    rounds: [],
    randomRespawn: false,
    doubleSpies: false,
    winner: null,
    turn: 0,
    uidBounds: [1, split, 0],
  };
  for (const p of [0, 1] as const) {
    const opp = p === 0 ? 1 : 0;
    const l = def(players[opp].leader.id);
    players[p].leaderDisabled = l.type === 'leader' && l.leader === 'emhyr_whiteflame';
  }
  const active = (ability: string) =>
    players.some((P) => {
      const l = def(P.leader.id);
      return !P.leaderDisabled && l.type === 'leader' && l.leader === ability;
    });
  state.randomRespawn = active('emhyr_invader');
  state.doubleSpies = active('eredin_treacherous');
  state.nextUid = uid;
  state.uidBounds[2] = uid;
  return state;
}

/** The uid of the first card with this id in a zone. */
export function uidIn(cards: readonly Card[], id: string): number {
  const c = cards.find((x) => x.id === id);
  if (!c) throw new Error(`${id} not found in [${cards.map((x) => x.id).join(', ')}]`);
  return c.uid;
}

export function handUid(s: GameState, p: PlayerId, id: string): number {
  return uidIn(s.players[p].hand, id);
}

export function boardUid(s: GameState, p: PlayerId, id: string): number {
  return uidIn(
    ROWS.flatMap((r) => s.players[p].rows[r].units),
    id,
  );
}

/** Play a card from the acting player's hand by id. */
export function play(s: GameState, id: string, extra: { row?: Row; target?: string } = {}) {
  const p = (s.pending?.player ?? s.current) as PlayerId;
  const action: Action = { type: 'play', uid: handUid(s, p, id) };
  if (extra.row) action.row = extra.row;
  if (extra.target) action.target = boardUid(s, p, extra.target);
  return apply(s, action);
}

export function ids(cards: readonly Card[]): string[] {
  return cards.map((c) => c.id);
}

export function rowIds(s: GameState, p: PlayerId, row: Row): string[] {
  return ids(s.players[p].rows[row].units);
}

export function eventsOf<T extends GameEvent['type']>(events: GameEvent[], type: T) {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** Plays random legal actions to the end of the game. */
export function playout(s: GameState, rnd: () => number, maxSteps = 2000): { state: GameState; steps: number } {
  let steps = 0;
  while (s.phase !== 'over') {
    const acts = legalActions(s);
    if (!acts.length) throw new Error('no legal actions in a live game');
    const a = acts[Math.floor(rnd() * acts.length)] as Action;
    s = apply(s, a).state;
    if (++steps > maxSteps) throw new Error('game did not finish');
  }
  return { state: s, steps };
}
