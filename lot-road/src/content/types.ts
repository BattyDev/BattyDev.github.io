/** Data-only yard descriptions. The sim reads these and never imports three. */

export interface Vec2 {
  x: number;
  z: number;
}

export interface Palette {
  meadow: string;
  pad: string;
  water: string;
  wood: string;
  reed: string;
  clay: string;
  letter: string;
}

export interface Cond {
  type: "sales" | "sold" | "station" | "hands" | "order" | "crafted" | "tides";
  id?: string;
  good?: string;
  n: number;
}

export interface NodeDef {
  id: string;
  slot: string;
  kind: string;
  good: string;
  charges: number;
  bossMs: number;
  handMs: number;
  regrowMs: number;
  yield: number;
  /** Stage that reveals the node. 1 means it is there on the first frame. */
  stage: number;
  verb: string;
  sub: string;
  /** Harvest lands on the low terrace, where a tide can take it. */
  low?: boolean;
}

export interface StationDef {
  id: string;
  slot: string;
  kind: string;
  /** Rank at the start of a fresh yard. 0 is unbuilt. */
  initial: number;
  /** Starts its recipe whenever the inputs are sitting there. */
  auto?: boolean;
}

export interface RecipeDef {
  id: string;
  station: string;
  /** Exact station rank this recipe belongs to. */
  rank: number;
  inputs: { good: string; n: number }[];
  output: string;
  n: number;
  ms: number;
  verb: string;
  sub: string;
  /** Stoke points, measured from the moment the batch starts. */
  windows?: { at: number; ms: number }[];
}

export interface SaleDef {
  id: string;
  good: string;
  count: number;
  coins: number;
  ms: number;
  stageMin: number;
  stageMax: number;
  requires?: Cond;
  blockedBy?: Cond;
  loadSub: string;
  sellSub: string;
  /** Stop offering the sale after this many loads. */
  limit?: number;
  /** Skip this sale until the player is holding the good. */
  whenHeld?: { good: string; n: number };
  /** A lantern sale also counts as juice shipped. */
  countsAs?: { good: string; n: number };
}

export interface BuyDef {
  id: string;
  verb: string;
  sub: string;
  cost: number;
  stage: number;
  kind: "station" | "hand";
  target: string;
  rank: number;
  after?: Cond;
  sound: "hire" | "build";
}

export interface GoalDef {
  type: "sales" | "sold" | "station" | "hands" | "order" | "launched" | "crafted" | "tides";
  id?: string;
  good?: string;
  n: number;
  /** Static sentence, used when the goal is not a count. */
  line?: string;
  /** When set, the card reads `${countLabel} ${have}/${n}`. */
  countLabel?: string;
}

export interface StageDef {
  id: number;
  name: string;
  goals: GoalDef[];
}

export interface UnlockDef {
  stage: number;
  station: string;
  rank: number;
}

export interface SeasonDef {
  stage: number;
  lines: { good: string; n: number; label: string; also?: string }[];
  pay: number;
  bonus: number;
  ms: number;
}

export interface HudRow {
  key: string;
  icon: string;
}

export interface DressingDef {
  kind: "tree" | "rock" | "grass";
  x: number;
  z: number;
  scale: number;
}

export interface StokeSpecial {
  type: "stoke";
  station: string;
  /** Hire order, starting at 0. That Hand hits each window after the delay. */
  stokerIndex: number;
  stokerDelayMs: number;
}

export interface TideSpecial {
  type: "tide";
  cycleMs: number;
  warnAtMs: number;
  tutorialWarnAtMs: number;
  haulMs: number;
  lowGoods: string[];
}

export interface ShakeSpecial {
  type: "shake";
  fillMs: number;
  lateMs: number;
  perfectFruit: number;
  perfectNectar: number;
  earlyFruit: number;
  pickerMs: number;
  pickerIndex: number;
  /** After an early tap the tree rests this long. A full ring does not. */
  earlyLockMs?: number;
}

/** A craft the highlight takes before a plainer sale, when its inputs exist. */
export interface PreferDef {
  station: string;
  inputs: { good: string; n: number }[];
  saleId: string;
}

export type HandRole = "loop" | "crafter" | "gather" | "haul" | "stoke" | "pick";

export interface MapDef {
  id: string;
  name: string;
  sign: string;
  nextId: string | null;
  nextName: string | null;
  palette: Palette;
  slots: Record<string, Vec2>;
  handSlots: string[];
  handColors: string[];
  nodes: NodeDef[];
  stations: StationDef[];
  recipes: RecipeDef[];
  sales: SaleDef[];
  buys: BuyDef[];
  stages: StageDef[];
  unlocks: UnlockDef[];
  season: SeasonDef;
  /** Hand cap. Reed Bend is 3. */
  handCap: number;
  /** Station the first hired Hand stays on. */
  primary: string;
  thresholds: Record<string, number>;
  hud: { stage: number; rows: HudRow[] }[];
  /** Shown on the station once the good leaves the plate row. */
  badges: { fromStage: number; station: string; good: string }[];
  dressing: DressingDef[];
  /** Boat station id, so sell animations know which mesh shoves off. */
  boat: string;
  /** Purse on a fresh visit. Travel overwrites this with the 16-coin cap. */
  startCoins?: number;
  /** Button line while the cart is leaving. */
  away?: string;
  special?: StokeSpecial | TideSpecial | ShakeSpecial;
  handRoles?: HandRole[];
  prefer?: PreferDef;
}
