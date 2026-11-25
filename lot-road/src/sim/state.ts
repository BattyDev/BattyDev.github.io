import type { MapDef } from "../content/types";
import { tuning } from "../content/tuning";

export interface HandRt {
  x: number;
  z: number;
  mode: "idle" | "move" | "chop" | "craft";
  toX: number;
  toZ: number;
  after: "idle" | "chop" | "craft" | "haul";
  nodeId: string;
  stationId: string;
  left: number;
  waiting: boolean;
  haulGood: string;
  haulOrder: boolean;
  /** Tide index this Hand already carried a pile for. */
  tideMark: number;
}

export interface NodeRt {
  id: string;
  charges: number;
  /** Milliseconds until each spent charge returns. Remaining time, not a clock, so a closed tab does not fast-forward the stump. */
  pending: number[];
}

export interface JobRt {
  stationId: string;
  recipeId: string;
  left: number;
  total: number;
  elapsed: number;
  paused: boolean;
  windowsHit: number;
}

export interface PadRt {
  saleId: string;
  good: string;
  have: number;
  need: number;
}

export interface PendingSale {
  saleId: string;
  good: string;
  count: number;
  coins: number;
  left: number;
  total: number;
}

export interface Floater {
  id: number;
  x: number;
  z: number;
  text: string;
  color: string;
  age: number;
}

export interface RunState {
  mapId: string;
  stage: number;
  resources: Record<string, number>;
  sold: Record<string, number>;
  sales: Record<string, number>;
  crafted: Record<string, number>;
  stations: Record<string, number>;
  nodes: NodeRt[];
  jobs: JobRt[];
  hands: HandRt[];
  order: Record<string, number>;
  pad: PadRt | null;
  pendingSale: PendingSale | null;
  launchLeft: number;
  launched: boolean;
  bossCd: number;
  buffer: number;
  hintLeft: number;
  idleMs: number;
  stats: { taps: number; playMs: number };
  phase: "play" | "travel" | "end";
  /** Goods sitting where a tide can reach them. */
  low: Record<string, number>;
  /** Goods on the way up the steps. */
  transit: Record<string, number>;
  clockMs: number;
  tides: number;
  haulLeft: number;
  shakeMs: number;
  shakeSpent: boolean;
  earlyLock: number;
  pickedMs: number;
}

export interface Profile {
  coins: number;
  bestPurse: number;
  mapsUnlocked: string[];
  cleared: string[];
  settings: {
    muted: boolean;
    renderer: "auto" | "webgl" | "flat";
    reducedMotion: boolean;
  };
}

export interface GameState {
  profile: Profile;
  run: RunState;
  floaters: Floater[];
  floaterId: number;
  /** Boss swing, counted down in ms. Visual only. */
  swingMs: number;
  shakeId: string;
  shakeMs: number;
  banner: string;
}

export function emptyHand(x: number, z: number): HandRt {
  return {
    x,
    z,
    mode: "idle",
    toX: x,
    toZ: z,
    after: "idle",
    nodeId: "",
    stationId: "",
    left: 0,
    waiting: false,
    haulGood: "",
    haulOrder: false,
    tideMark: -1,
  };
}

export function createRun(map: MapDef): RunState {
  const stations: Record<string, number> = {};
  for (const station of map.stations) stations[station.id] = station.initial;
  return {
    mapId: map.id,
    stage: 1,
    resources: {},
    sold: {},
    sales: {},
    crafted: {},
    stations,
    nodes: map.nodes
      .filter((node) => node.stage <= 1)
      .map((node) => ({ id: node.id, charges: node.charges, pending: [] })),
    jobs: [],
    hands: [],
    order: {},
    pad: null,
    pendingSale: null,
    launchLeft: 0,
    launched: false,
    bossCd: 0,
    buffer: 0,
    hintLeft: tuning.hintFreeActions,
    idleMs: 0,
    stats: { taps: 0, playMs: 0 },
    phase: "play",
    low: {},
    transit: {},
    clockMs: 0,
    tides: 0,
    haulLeft: 0,
    shakeMs: 0,
    shakeSpent: false,
    earlyLock: 0,
    pickedMs: 0,
  };
}

export function createGame(map: MapDef): GameState {
  return {
    profile: {
      coins: map.startCoins ?? 0,
      bestPurse: 0,
      mapsUnlocked: [map.id],
      cleared: [],
      settings: { muted: false, renderer: "auto", reducedMotion: false },
    },
    run: createRun(map),
    floaters: [],
    floaterId: 1,
    swingMs: 0,
    shakeId: "",
    shakeMs: 0,
    banner: "",
  };
}

export function bumpPurse(state: GameState): void {
  if (state.profile.coins > state.profile.bestPurse) {
    state.profile.bestPurse = state.profile.coins;
  }
}

export const FLOAT_COLOR: Record<string, string> = {
  coin: "#FFE38A",
  reed: "#F4FFC8",
  clay: "#FFE0C2",
  mat: "#FFD7B0",
  crock: "#FFF6E8",
  scrub: "#E4F0B0",
  stone: "#E7E2DA",
  brick: "#F0B0A0",
  salt: "#FFFDF8",
  kelp: "#D5F0C8",
  crate: "#F0D2A8",
  fruit: "#FFB0C4",
  nectar: "#FFE9A0",
  juice: "#FFC090",
  jar: "#FFE8C8",
  charcoal: "#D9D2C8",
  brine: "#D5E8F0",
  dried: "#C8E6C0",
};
