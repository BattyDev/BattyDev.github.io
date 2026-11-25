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
  type: "sales" | "sold" | "station" | "hands" | "order";
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
}

export interface StationDef {
  id: string;
  slot: string;
  kind: string;
  /** Rank at the start of a fresh yard. 0 is unbuilt. */
  initial: number;
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
  type: "sales" | "sold" | "station" | "hands" | "order" | "launched";
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
  lines: { good: string; n: number; label: string }[];
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
}
