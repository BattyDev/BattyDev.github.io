// Witcher 3 ("classic") Gwent: card definitions, game state, actions, events.
//
// The engine is a pure function of (state, action). Everything a game needs,
// including the RNG, lives in GameState, so the same state and action always
// produce the same result. That one property is what undo, replays, the AI's
// search and the tests all lean on.

export type PlayerId = 0 | 1;
export type Row = 'close' | 'ranged' | 'siege';
export const ROWS: readonly Row[] = ['close', 'ranged', 'siege'];

export type Faction = 'realms' | 'nilfgaard' | 'monsters' | 'scoiatael' | 'skellige';
export type CardFaction = Faction | 'neutral';

export type UnitAbility =
  | 'medic'
  | 'spy'
  | 'muster'
  | 'bond'
  | 'morale'
  | 'horn'
  | 'scorch'
  | 'scorch_close'
  | 'scorch_ranged'
  | 'scorch_siege'
  | 'avenger'
  | 'berserker'
  | 'mardroeme';

export type SpecialEffect = 'decoy' | 'horn' | 'scorch' | 'mardroeme';
export type WeatherEffect = 'frost' | 'fog' | 'rain' | 'storm' | 'clear';

export type LeaderAbility =
  | 'foltest_king'
  | 'foltest_lord'
  | 'foltest_siegemaster'
  | 'foltest_steelforged'
  | 'foltest_son'
  | 'emhyr_imperial'
  | 'emhyr_emperor'
  | 'emhyr_whiteflame'
  | 'emhyr_relentless'
  | 'emhyr_invader'
  | 'eredin_commander'
  | 'eredin_bringer_of_death'
  | 'eredin_destroyer'
  | 'eredin_king'
  | 'eredin_treacherous'
  | 'francesca_queen'
  | 'francesca_beautiful'
  | 'francesca_daisy'
  | 'francesca_pureblood'
  | 'francesca_hope'
  | 'crach_an_craite'
  | 'king_bran';

interface BaseDef {
  id: string;
  name: string;
  faction: CardFaction;
  /** Most copies a deck may hold. 0 for tokens, which are never in a deck. */
  copies: number;
  /** Basename of the art under public/art/{sm,lg}. */
  art: string;
  set?: 'blood_and_wine' | 'next_gen';
}

export interface UnitDef extends BaseDef {
  type: 'unit';
  /** One row, or two for Agile units. */
  rows: Row[];
  strength: number;
  hero: boolean;
  abilities: UnitAbility[];
  /** Muster group this card belongs to. */
  group?: string;
  /** Muster group this card pulls from the deck when played. */
  musterPulls?: string;
  /** Avenger summons / Berserker transforms into this card. */
  summons?: string;
  /** Summoned or transformed; never in a deck, hand or discard pile. */
  token?: boolean;
}

export interface SpecialDef extends BaseDef {
  type: 'special';
  effect: SpecialEffect;
}

export interface WeatherDef extends BaseDef {
  type: 'weather';
  effect: WeatherEffect;
}

export interface LeaderDef extends BaseDef {
  type: 'leader';
  faction: Faction;
  leader: LeaderAbility;
}

export type CardDef = UnitDef | SpecialDef | WeatherDef | LeaderDef;

/** A physical card in a game. `id` is the definition; `uid` is this copy. */
export interface Card {
  uid: number;
  id: string;
  /** Set while transformed (Berserker → Vildkaarl): the card it reverts to. */
  base?: string;
}

export interface RowState {
  units: Card[];
  /** Commander's Horn or Mardroeme. One per row. */
  special: Card | null;
  /** A leader's horn on this row, for the rest of the round. */
  leaderHorn: boolean;
}

export interface PlayerState {
  name: string;
  faction: Faction;
  leader: Card;
  leaderUsed: boolean;
  /** Cancelled by the opponent's Emhyr, the White Flame. */
  leaderDisabled: boolean;
  /** Top of the deck is the end of the array. */
  deck: Card[];
  hand: Card[];
  discard: Card[];
  rows: Record<Row, RowState>;
  lives: number;
  passed: boolean;
  redrawsLeft: number;
  redrawDone: boolean;
}

export interface WeatherCard {
  card: Card;
  owner: PlayerId;
}

export interface RoundResult {
  scores: [number, number];
  winner: PlayerId | null;
}

/** A decision the engine is waiting on in the middle of an effect. */
export type Pending =
  | { kind: 'medic'; player: PlayerId; options: number[] }
  | { kind: 'bringer'; player: PlayerId; options: number[] }
  | { kind: 'relentless'; player: PlayerId; options: number[] }
  | { kind: 'destroyerDiscard'; player: PlayerId; remaining: number; options: number[] }
  | { kind: 'destroyerDraw'; player: PlayerId; options: number[] }
  | { kind: 'kingWeather'; player: PlayerId; options: number[] };

export type Phase = 'chooseFirst' | 'redraw' | 'play' | 'over';

export interface GameState {
  /** mulberry32 state. */
  rng: number;
  nextUid: number;
  phase: Phase;
  round: number;
  /** Whose turn it is during the play phase. */
  current: PlayerId;
  /** Who started (or will start) the current round. */
  roundStarter: PlayerId;
  /** Who chooses the first player (Scoia'tael perk) during chooseFirst. */
  chooser: PlayerId | null;
  players: [PlayerState, PlayerState];
  weather: WeatherCard[];
  pending: Pending | null;
  rounds: RoundResult[];
  /** Emhyr, Invader of the North: revivals pick at random, for both players. */
  randomRespawn: boolean;
  /** Eredin, the Treacherous: spies are worth double, for both players. */
  doubleSpies: boolean;
  winner: PlayerId | 'draw' | null;
  /** Count of actions taken, for logs and the AI's move budget. */
  turn: number;
  /**
   * Which player's deck each card started in: player 0's cards have uids in
   * [b0, b1), player 1's in [b1, b2). Tokens are summoned with uids ≥ b2.
   * The AI uses this to work out which of the opponent's cards it hasn't seen.
   */
  uidBounds: [number, number, number];
}

export type Action =
  | { type: 'chooseFirst'; first: PlayerId }
  | { type: 'redraw'; uid: number }
  | { type: 'endRedraw' }
  /** row: target row for agile units, horns and Mardroeme. target: Decoy's swap. */
  | { type: 'play'; uid: number; row?: Row; target?: number }
  | { type: 'leader' }
  | { type: 'pass' }
  /** Answers state.pending. row is required when a revived unit is Agile. */
  | { type: 'choose'; uid: number; row?: Row };

export type GameEvent =
  | { type: 'coin'; first: PlayerId; chosen: boolean }
  | { type: 'redraw'; player: PlayerId; out: Card; in: Card | null }
  | { type: 'roundStart'; round: number; first: PlayerId }
  | { type: 'play'; player: PlayerId; card: Card; side: PlayerId; row: Row | null }
  | { type: 'decoy'; player: PlayerId; card: Card; returned: Card; row: Row }
  | { type: 'leader'; player: PlayerId; ability: LeaderAbility }
  | { type: 'pass'; player: PlayerId; auto: boolean }
  | { type: 'draw'; player: PlayerId; cards: Card[]; reason: string }
  | { type: 'muster'; player: PlayerId; cards: Card[] }
  | { type: 'revive'; player: PlayerId; card: Card; side: PlayerId; row: Row; reason: string }
  | { type: 'destroy'; side: PlayerId; card: Card; row: Row; reason: string }
  | { type: 'summon'; side: PlayerId; card: Card; row: Row }
  | { type: 'transform'; side: PlayerId; from: Card; to: Card; row: Row }
  | { type: 'weather'; player: PlayerId; effect: WeatherEffect }
  | { type: 'leaderHorn'; player: PlayerId; row: Row }
  | { type: 'move'; side: PlayerId; card: Card; from: Row; to: Row }
  | { type: 'toHand'; player: PlayerId; card: Card; from: 'discard' | 'opponentDiscard' | 'deck' }
  | { type: 'discard'; player: PlayerId; card: Card }
  | { type: 'reveal'; player: PlayerId; cards: Card[] }
  | { type: 'shuffleDiscards' }
  | { type: 'perk'; player: PlayerId; faction: Faction; cards: Card[] }
  | { type: 'roundEnd'; round: number; scores: [number, number]; winner: PlayerId | null; lives: [number, number] }
  | { type: 'gameOver'; winner: PlayerId | 'draw' };

export interface DeckList {
  faction: Faction;
  leader: string;
  /** [card id, copies] */
  cards: [string, number][];
}

export interface PlayerConfig {
  name: string;
  deck: DeckList;
}

export interface GameConfig {
  seed: number;
  players: [PlayerConfig, PlayerConfig];
}
