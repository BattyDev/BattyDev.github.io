/**
 * Snow-camp loop. The joystick only moves the hunter. The axe hits a bear
 * when you walk up to it. Raw meat is carried to the grill, cooked meat to
 * the counter, and the bills that fall are picked up by walking over them.
 * A pad spends the money you are carrying while you stand on it.
 */

export interface CampDrop {
  id: string;
  kind: "raw" | "wood" | "ore" | "bill";
  x: number;
  z: number;
  /** Bills can be worth more than one. Raw is always one. */
  n: number;
}

export interface CampBear {
  id: string;
  x: number;
  z: number;
  hp: number;
  max: number;
  hitCd: number;
  down: number;
  vx: number;
  vz: number;
  turn: number;
  species: "bear" | "wolf" | "seal";
}

export interface CampGrill {
  phase: "empty" | "cook" | "done";
  left: number;
  total: number;
}

export interface CampPad {
  id: string;
  x: number;
  z: number;
  kind: "grill" | "carry" | "hand" | "tool" | "station" | "gather" | "ridge";
  label: string;
  price: number;
  rank: number;
  max: number;
  stood: number;
}

export interface CampWorker {
  x: number;
  z: number;
  held: "raw" | "cooked" | "wood" | "ore" | null;
  tx: number;
  tz: number;
}

export interface CampFloater {
  id: number;
  x: number;
  z: number;
  text: string;
  color: string;
  age: number;
}

export type CampOrder = "cooked" | "plank" | "bar";

export interface CampNode {
  id: string;
  kind: "tree" | "rock";
  x: number;
  z: number;
  hp: number;
  max: number;
  hitCd: number;
  down: number;
}

export interface CampState {
  x: number;
  z: number;
  facing: number;
  swing: number;
  raw: number;
  cooked: number;
  wood: number;
  ore: number;
  planks: number;
  bars: number;
  money: number;
  carryMax: number;
  grillRank: number;
  toolRank: number;
  stationRank: number;
  madePlanks: number;
  madeBars: number;
  sales: number;
  order: CampOrder;
  reach: number;
  ridge: boolean;
  bears: CampBear[];
  nodes: CampNode[];
  drops: CampDrop[];
  grill: CampGrill;
  mill: CampGrill;
  forge: CampGrill;
  grillAt: { x: number; z: number };
  millAt: { x: number; z: number };
  forgeAt: { x: number; z: number };
  counterAt: { x: number; z: number };
  pads: CampPad[];
  worker: CampWorker | null;
  gatherer: CampWorker | null;
  serveCd: number;
  floaters: CampFloater[];
  hint: string;
  moved: boolean;
  nextId: number;
  floaterId: number;
}

export interface CampMove {
  x: number;
  z: number;
}

export type CampCue = "chop" | "sell" | "load" | "build" | "hire" | "craft";

/** The palisade is a ring. Twice the old radius is four times the ground. */
const IN = 4.3;
const OUT = 5.16;
const WORLD = 7.3;
const RIDGE = 8.9;
const GATE = 0.23;
const SPEED = 3.15;
const HIT = 1.02;
const PICK = 0.48;
const NEAR = 0.72;
const PAD = 0.62;
const STAND = 420;
const COOK = 3400;
const PAD_ORDER = ["grill", "carry", "hand", "tool", "station", "gather", "ridge"] as const;

export function createCamp(): CampState {
  return {
    x: 0,
    z: 0.15,
    facing: Math.PI,
    swing: 0,
    raw: 0,
    cooked: 0,
    wood: 0,
    ore: 0,
    planks: 0,
    bars: 0,
    money: 0,
    carryMax: 4,
    grillRank: 0,
    toolRank: 0,
    stationRank: 0,
    madePlanks: 0,
    madeBars: 0,
    sales: 0,
    order: "cooked",
    reach: WORLD,
    ridge: false,
    bears: [
      bear("bear-a", 0.4, -6.2, "bear"),
      bear("bear-b", -6.0, 0.5, "bear"),
      bear("bear-c", 5.9, -0.6, "bear"),
      bear("wolf-a", 6.4, 2.4, "wolf"),
      bear("seal-a", -6.2, -2.6, "seal"),
    ],
    nodes: [
      node("tree-a", -5.6, 2.6, "tree", 2),
      node("tree-b", 5.4, 3.3, "tree", 2),
      node("tree-c", -3.4, 5.8, "tree", 2),
      node("rock-a", 6.1, -2.4, "rock", 3),
      node("rock-b", -6.2, -2.0, "rock", 3),
    ],
    drops: [],
    grill: { phase: "empty", left: 0, total: COOK },
    mill: { phase: "empty", left: 0, total: 4200 },
    forge: { phase: "empty", left: 0, total: 4200 },
    grillAt: { x: -2.6, z: 0.3 },
    millAt: { x: -2.3, z: 2.7 },
    forgeAt: { x: 2.7, z: -2.2 },
    counterAt: { x: 2.6, z: 0.5 },
    pads: [
      { id: "pad-grill", x: -2.6, z: -1.6, kind: "grill", label: "Faster grill", price: 4, rank: 0, max: 5, stood: 0 },
      { id: "pad-carry", x: -0.7, z: -2.2, kind: "carry", label: "Carry", price: 6, rank: 0, max: 5, stood: 0 },
      { id: "pad-hand", x: 2.3, z: -1.7, kind: "hand", label: "A hand", price: 12, rank: 0, max: 1, stood: 0 },
      { id: "pad-tool", x: -3.4, z: 1.3, kind: "tool", label: "Tool", price: 8, rank: 0, max: 3, stood: 0 },
      { id: "pad-station", x: -0.5, z: 3.1, kind: "station", label: "Stations", price: 8, rank: 0, max: 3, stood: 0 },
      { id: "pad-gather", x: 1.7, z: 2.7, kind: "gather", label: "Gatherer", price: 14, rank: 0, max: 1, stood: 0 },
      { id: "pad-ridge", x: 0.8, z: -3.5, kind: "ridge", label: "New ground", price: 16, rank: 0, max: 1, stood: 0 },
    ],
    worker: null,
    gatherer: null,
    serveCd: 0,
    floaters: [],
    hint: "Drag to walk out to the bears",
    moved: false,
    nextId: 1,
    floaterId: 1,
  };
}

export function cookTime(state: CampState): number {
  return Math.round(COOK * Math.pow(0.82, state.grillRank));
}

export function stationTime(state: CampState): number {
  return Math.round(4200 * Math.pow(0.82, state.stationRank));
}

export function carriedGoods(state: CampState): number {
  return state.raw + state.cooked + state.wood + state.ore + state.planks + state.bars;
}

export function tickCamp(state: CampState, move: CampMove, dt: number): CampCue[] {
  const cues: CampCue[] = [];
  const step = Math.min(100, Math.max(0, dt));
  const mag = Math.min(1, Math.hypot(move.x, move.z));
  if (mag > 0.08) {
    state.moved = true;
    state.facing = Math.atan2(move.x, move.z);
    const scale = (SPEED * step) / 1000 / mag;
    slide(state, move.x * scale, move.z * scale);
  }
  state.swing = Math.max(0, state.swing - step);

  for (const bear of state.bears) {
    bear.hitCd = Math.max(0, bear.hitCd - step);
    if (bear.down > 0) {
      bear.down -= step;
      if (bear.down <= 0) reviveBear(state, bear);
      continue;
    }
    wanderOut(bear, step);
    if (bear.hitCd > 0) continue;
    if (Math.hypot(bear.x - state.x, bear.z - state.z) > HIT) continue;
    bear.hitCd = 420;
    bear.hp -= 1 + state.toolRank;
    state.swing = 280;
    state.facing = Math.atan2(bear.x - state.x, bear.z - state.z);
    cues.push("chop");
    if (bear.hp <= 0) {
      bear.down = 9000;
      scatter(state, bear.x, bear.z, 2, "raw", 1);
      float(state, bear.x, bear.z, "meat", "#E07A6A");
    }
  }

  for (const node of state.nodes) tickNode(state, node, step, cues);

  for (const drop of [...state.drops]) {
    if (Math.hypot(drop.x - state.x, drop.z - state.z) > PICK) continue;
    if (drop.kind !== "bill" && carriedGoods(state) >= state.carryMax) continue;
    state.drops = state.drops.filter((item) => item.id !== drop.id);
    if (drop.kind === "raw") {
      state.raw += 1;
      float(state, drop.x, drop.z, "+meat", "#E07A6A");
    } else if (drop.kind === "wood") {
      state.wood += 1;
      float(state, drop.x, drop.z, "+wood", "#C4A06A");
    } else if (drop.kind === "ore") {
      state.ore += 1;
      float(state, drop.x, drop.z, "+ore", "#9AA7B2");
    } else {
      state.money += drop.n;
      float(state, drop.x, drop.z, `+${drop.n}`, "#7DDE6A");
      cues.push("load");
    }
  }

  if (state.grill.phase === "cook") {
    state.grill.left -= step;
    if (state.grill.left <= 0) {
      state.grill.phase = "done";
      state.grill.left = 0;
      cues.push("craft");
    }
  }

  const atGrill = near(state, state.grillAt);
  if (atGrill && state.grill.phase === "done" && carriedGoods(state) < state.carryMax) {
    state.grill.phase = "empty";
    state.cooked += 1;
    float(state, state.grillAt.x, state.grillAt.z, "cooked", "#E6A15A");
  } else if (atGrill && state.grill.phase === "empty" && state.raw > 0) {
    state.raw -= 1;
    const total = cookTime(state);
    state.grill = { phase: "cook", left: total, total };
  }

  boil(state.mill, step, cues);
  boil(state.forge, step, cues);
  feedStation(state, state.millAt, state.mill, "wood", "planks");
  feedStation(state, state.forgeAt, state.forge, "ore", "bars");

  state.serveCd = Math.max(0, state.serveCd - step);
  if (near(state, state.counterAt) && state.serveCd === 0 && holding(state, state.order) > 0) {
    take(state, state.order);
    pay(state, cues);
  }

  tickWorker(state, step, cues);
  tickGatherer(state, step);
  tickPads(state, step, cues);

  for (const floater of state.floaters) floater.age += step;
  state.floaters = state.floaters.filter((item) => item.age < 700);
  state.hint = hintFor(state);
  return cues;
}

export function campFromRaw(raw: string | null): CampState | null {
  if (!raw) return null;
  try {
    const blob = JSON.parse(raw) as { camp?: CampState };
    const data = blob.camp;
    if (!data || !Array.isArray(data.bears) || typeof data.money !== "number") return null;
    const fresh = createCamp();
    const camp: CampState = {
      ...fresh,
      ...data,
      grillAt: fresh.grillAt,
      millAt: fresh.millAt,
      forgeAt: fresh.forgeAt,
      counterAt: fresh.counterAt,
      mill: data.mill ?? fresh.mill,
      forge: data.forge ?? fresh.forge,
      gatherer: data.gatherer ?? null,
      order: data.order ?? "cooked",
      planks: data.planks ?? 0,
      bars: data.bars ?? 0,
      toolRank: data.toolRank ?? 0,
      stationRank: data.stationRank ?? 0,
      reach: data.ridge ? RIDGE : fresh.reach,
      pads: fresh.pads.map((pad) => {
        const saved = data.pads?.find((item) => item.id === pad.id);
        return saved ? { ...pad, rank: saved.rank, stood: 0, price: pad.price } : pad;
      }),
      bears: fresh.bears.map((bear) => {
        const saved = data.bears.find((item) => item.id === bear.id);
        return saved ? { ...bear, hp: saved.hp, max: saved.max, down: saved.down } : bear;
      }),
      nodes: fresh.nodes.map((node) => {
        const saved = data.nodes?.find((item) => item.id === node.id);
        return saved ? { ...node, hp: saved.hp, max: saved.max, down: saved.down } : node;
      }),
      grill: data.grill ?? fresh.grill,
      drops: data.drops ?? [],
      worker: data.worker ?? null,
      floaters: [],
    };
    if (data.ridge) addRidge(camp, data);
    return camp;
  } catch {
    return null;
  }
}

/** Grill first. Each later pad waits until the one before it has been bought once. */
export function padAccess(state: CampState, kind: string): "open" | "dim" | "hidden" {
  const index = PAD_ORDER.indexOf(kind as (typeof PAD_ORDER)[number]);
  if (index < 0) return "hidden";
  if (index === 0) return "open";
  const prev = state.pads.find((pad) => pad.kind === PAD_ORDER[index - 1]);
  if (prev && prev.rank >= 1) return "open";
  if (index === 1) return "dim";
  const earlier = state.pads.find((pad) => pad.kind === PAD_ORDER[index - 2]);
  return earlier && earlier.rank >= 1 ? "dim" : "hidden";
}

function tickWorker(state: CampState, step: number, cues: CampCue[]): void {
  const hand = state.worker;
  if (!hand) return;
    if (hand.held === "cooked") {
    hand.tx = state.counterAt.x;
    hand.tz = state.counterAt.z - 0.35;
    stepToward(hand, step, 2.2);
    if (state.order === "cooked" && Math.hypot(hand.x - state.counterAt.x, hand.z - state.counterAt.z) < 0.85 && state.serveCd === 0) {
      hand.held = null;
      pay(state, cues);
    }
    return;
  }
  if (hand.held === "raw") {
    hand.tx = state.grillAt.x;
    hand.tz = state.grillAt.z;
    stepToward(hand, step, 2.2);
    if (Math.hypot(hand.x - state.grillAt.x, hand.z - state.grillAt.z) < 0.7 && state.grill.phase === "empty") {
      hand.held = null;
      const total = cookTime(state);
      state.grill = { phase: "cook", left: total, total };
    }
    return;
  }
  if (state.grill.phase === "done") {
    hand.tx = state.grillAt.x;
    hand.tz = state.grillAt.z;
    stepToward(hand, step, 2.2);
    if (Math.hypot(hand.x - state.grillAt.x, hand.z - state.grillAt.z) < 0.7) {
      // The hunter standing on the grill already took it above.
      if (state.grill.phase === "done") {
        state.grill.phase = "empty";
        hand.held = "cooked";
      }
    }
    return;
  }
  const raw = state.drops.find((drop) => drop.kind === "raw");
  if (raw && state.grill.phase === "empty") {
    hand.tx = raw.x;
    hand.tz = raw.z;
    stepToward(hand, step, 2.2);
    if (Math.hypot(hand.x - raw.x, hand.z - raw.z) < 0.45) {
      state.drops = state.drops.filter((drop) => drop.id !== raw.id);
      hand.held = "raw";
    }
    return;
  }
  hand.tx = state.grillAt.x + 0.45;
  hand.tz = state.grillAt.z + 0.35;
  stepToward(hand, step, 1.6);
}

function tickPads(state: CampState, step: number, cues: CampCue[]): void {
  for (const pad of state.pads) {
    if (padAccess(state, pad.kind) !== "open") {
      pad.stood = 0;
      continue;
    }
    if (pad.rank >= pad.max) {
      pad.stood = 0;
      continue;
    }
    const here = Math.hypot(pad.x - state.x, pad.z - state.z) <= PAD;
    if (!here || state.money < pad.price) {
      pad.stood = 0;
      continue;
    }
    pad.stood += step;
    if (pad.stood < STAND) continue;
    pad.stood = 0;
    pad.rank += 1;
    state.money -= pad.price;
    float(state, pad.x, pad.z, `-${pad.price}`, "#7DDE6A");
    if (pad.kind === "grill") {
      state.grillRank = pad.rank;
      cues.push("build");
    } else if (pad.kind === "carry") {
      state.carryMax = 4 + pad.rank;
      cues.push("build");
    } else if (pad.kind === "tool") {
      state.toolRank = pad.rank;
      cues.push("build");
    } else if (pad.kind === "station") {
      state.stationRank = pad.rank;
      cues.push("build");
    } else if (pad.kind === "hand" && !state.worker) {
      state.worker = { x: pad.x, z: pad.z, held: null, tx: state.grillAt.x, tz: state.grillAt.z };
      cues.push("hire");
    } else if (pad.kind === "gather" && !state.gatherer) {
      state.gatherer = { x: pad.x, z: pad.z, held: null, tx: state.millAt.x, tz: state.millAt.z };
      cues.push("hire");
    } else if (pad.kind === "ridge" && !state.ridge) {
      addRidge(state);
      cues.push("build");
    }
  }
}

function pay(state: CampState, cues: CampCue[]): void {
  const bills = state.order === "bar" ? 8 : state.order === "plank" ? 6 : 4;
  state.serveCd = 700;
  state.sales += 1;
  scatter(state, state.counterAt.x, state.counterAt.z + 0.15, bills, "bill", 1);
  state.order = nextOrder(state);
  cues.push("sell");
}

function nextOrder(state: CampState): CampOrder {
  if (state.madeBars > 0 && state.sales % 3 === 0) return "bar";
  if (state.madePlanks > 0 && state.sales % 2 === 0) return "plank";
  return "cooked";
}

function holding(state: CampState, order: CampOrder): number {
  if (order === "plank") return state.planks;
  if (order === "bar") return state.bars;
  return state.cooked;
}

function take(state: CampState, order: CampOrder): void {
  if (order === "plank") state.planks -= 1;
  else if (order === "bar") state.bars -= 1;
  else state.cooked -= 1;
}

function boil(station: CampGrill, step: number, cues: CampCue[]): void {
  if (station.phase !== "cook") return;
  station.left -= step;
  if (station.left <= 0) {
    station.phase = "done";
    station.left = 0;
    cues.push("craft");
  }
}

function feedStation(
  state: CampState,
  at: { x: number; z: number },
  station: CampGrill,
  input: "wood" | "ore",
  output: "planks" | "bars",
): void {
  if (!near(state, at)) return;
  if (station.phase === "done" && carriedGoods(state) < state.carryMax) {
    station.phase = "empty";
    state[output] += 1;
    if (output === "planks") state.madePlanks += 1;
    else state.madeBars += 1;
    float(state, at.x, at.z, output === "planks" ? "planks" : "bars", "#E6C56A");
    return;
  }
  if (station.phase === "empty" && state[input] > 0) {
    state[input] -= 1;
    const total = stationTime(state);
    station.phase = "cook";
    station.left = total;
    station.total = total;
  }
}

function tickNode(state: CampState, node: CampNode, step: number, cues: CampCue[]): void {
  node.hitCd = Math.max(0, node.hitCd - step);
  if (node.down > 0) {
    node.down -= step;
    if (node.down <= 0) {
      node.down = 0;
      node.hp = node.max;
    }
    return;
  }
  if (node.kind === "rock" && state.toolRank < 1) return;
  if (node.hitCd > 0) return;
  if (Math.hypot(node.x - state.x, node.z - state.z) > HIT) return;
  node.hitCd = 420;
  node.hp -= 1 + state.toolRank;
  state.swing = 280;
  state.facing = Math.atan2(node.x - state.x, node.z - state.z);
  cues.push("chop");
  if (node.hp > 0) return;
  node.down = 8000;
  if (node.kind === "tree") {
    scatter(state, node.x, node.z, 2, "wood", 1);
    float(state, node.x, node.z, "wood", "#C4A06A");
  } else {
    scatter(state, node.x, node.z, 1, "ore", 1);
    float(state, node.x, node.z, "ore", "#9AA7B2");
  }
}

function tickGatherer(state: CampState, step: number): void {
  const hand = state.gatherer;
  if (!hand) return;
  if (hand.held === "wood" || hand.held === "ore") {
    const at = hand.held === "wood" ? state.millAt : state.forgeAt;
    const station = hand.held === "wood" ? state.mill : state.forge;
    hand.tx = at.x;
    hand.tz = at.z;
    stepToward(hand, step, 2.1);
    if (station.phase === "empty" && Math.hypot(hand.x - at.x, hand.z - at.z) < 0.7) {
      const total = stationTime(state);
      station.phase = "cook";
      station.left = total;
      station.total = total;
      hand.held = null;
    }
    return;
  }
  const drop = state.drops.find((item) => item.kind === "wood" || (item.kind === "ore" && state.toolRank > 0));
  if (!drop) {
    hand.tx = state.millAt.x + 0.4;
    hand.tz = state.millAt.z;
    stepToward(hand, step, 1.5);
    return;
  }
  hand.tx = drop.x;
  hand.tz = drop.z;
  stepToward(hand, step, 2.1);
  if (Math.hypot(hand.x - drop.x, hand.z - drop.z) < 0.45) {
    state.drops = state.drops.filter((item) => item.id !== drop.id);
    hand.held = drop.kind === "ore" ? "ore" : "wood";
  }
}

function slide(state: CampState, dx: number, dz: number): void {
  const nx = clamp(state.x + dx, state.reach);
  const nz = clamp(state.z + dz, state.reach);
  if (!inWall(nx, nz)) {
    state.x = nx;
    state.z = nz;
    return;
  }
  if (!inWall(nx, state.z)) state.x = nx;
  else if (!inWall(state.x, nz)) state.z = nz;
}

export function inWall(x: number, z: number): boolean {
  const r = Math.hypot(x, z);
  if (r < IN || r > OUT) return false;
  const ang = Math.atan2(x, z);
  const gate = Math.abs(Math.PI - Math.abs(ang));
  return gate > GATE;
}

function wanderOut(bear: CampBear, step: number): void {
  bear.turn -= step;
  if (bear.turn <= 0) {
    bear.turn = 1600;
    const a = Math.atan2(bear.vz, bear.vx) + 0.8;
    bear.vx = Math.cos(a) * 0.45;
    bear.vz = Math.sin(a) * 0.45;
  }
  let x = bear.x + (bear.vx * step) / 1000;
  let z = bear.z + (bear.vz * step) / 1000;
  if (Math.hypot(x, z) < OUT + 0.35 || Math.hypot(x, z) > 7.05) {
    bear.vx *= -1;
    bear.vz *= -1;
    x = bear.x;
    z = bear.z;
  }
  bear.x = x;
  bear.z = z;
}

function reviveBear(state: CampState, bear: CampBear): void {
  const spot = outside(state.nextId++);
  bear.x = spot.x;
  bear.z = spot.z;
  bear.hp = bear.max;
  bear.down = 0;
}

function outside(n: number): { x: number; z: number } {
  const a = Math.PI + ((n % 5) - 2) * 0.55;
  return { x: Math.sin(a) * 6.35, z: Math.cos(a) * 6.35 };
}

function scatter(state: CampState, x: number, z: number, count: number, kind: CampDrop["kind"], n: number): void {
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + 0.5;
    const dist = kind === "bill" ? 0.7 : 0.48;
    state.drops.push({
      id: `d${state.nextId++}`,
      kind,
      n,
      x: clamp(x + Math.cos(a) * dist, state.reach),
      z: clamp(z + Math.sin(a) * dist, state.reach),
    });
  }
}

function hintFor(state: CampState): string {
  let pad: CampPad | null = null;
  let best = PAD + 0.01;
  for (const item of state.pads) {
    if (padAccess(state, item.kind) !== "open") continue;
    const dist = Math.hypot(item.x - state.x, item.z - state.z);
    if (dist <= PAD && dist < best) {
      pad = item;
      best = dist;
    }
  }
  if (pad) {
    const progress = `${pad.label} ${pad.rank}/${pad.max}`;
    return pad.rank >= pad.max ? progress : `${progress} · ${pad.price}`;
  }
  if (state.drops.some((drop) => drop.kind === "bill")) return "Pick up the money";
  if (state.order === "plank" && state.planks > 0) return "They want planks. Stand at the counter";
  if (state.order === "bar" && state.bars > 0) return "They want metal. Stand at the counter";
  if (state.order !== "cooked" && holding(state, state.order) === 0 && state.cooked > 0) {
    return state.order === "plank" ? "This buyer wants planks" : "This buyer wants metal";
  }
  if (state.cooked > 0 && state.order === "cooked") return "Stand at the counter";
  if (state.grill.phase === "done") return "Pick up the cooked meat";
  if (state.grill.phase === "cook") return "The meat is cooking";
  if (state.raw > 0) return "Stand at the grill";
  if (!state.moved) return "Drag to walk out to the bears";
  return "Walk up to a bear";
}

function near(state: CampState, at: { x: number; z: number }): boolean {
  return Math.hypot(state.x - at.x, state.z - at.z) <= NEAR;
}

function stepToward(body: { x: number; z: number; tx: number; tz: number }, step: number, speed: number): void {
  const dx = body.tx - body.x;
  const dz = body.tz - body.z;
  const dist = Math.hypot(dx, dz) || 1;
  const hop = Math.min(dist, (speed * step) / 1000);
  body.x += (dx / dist) * hop;
  body.z += (dz / dist) * hop;
}

function float(state: CampState, x: number, z: number, text: string, color: string): void {
  state.floaters.push({ id: state.floaterId++, x, z, text, color, age: 0 });
  if (state.floaters.length > 8) state.floaters.shift();
}

function addRidge(state: CampState, saved?: { nodes?: CampNode[]; bears?: CampBear[] }): void {
  const tree = node("tree-r", -7.4, -4.6, "tree", 2);
  const rock = node("rock-r", 7.2, 4.8, "rock", 3);
  const extra = bear("bear-d", 1.4, -8.0);
  const oldTree = saved?.nodes?.find((item) => item.id === tree.id);
  const oldRock = saved?.nodes?.find((item) => item.id === rock.id);
  const oldBear = saved?.bears?.find((item) => item.id === extra.id);
  state.nodes = state.nodes.filter((item) => item.id !== tree.id && item.id !== rock.id);
  state.bears = state.bears.filter((item) => item.id !== extra.id);
  state.nodes.push(
    oldTree ? { ...tree, hp: oldTree.hp, max: oldTree.max, down: oldTree.down } : tree,
    oldRock ? { ...rock, hp: oldRock.hp, max: oldRock.max, down: oldRock.down } : rock,
  );
  state.bears.push(oldBear ? { ...extra, hp: oldBear.hp, max: oldBear.max, down: oldBear.down } : extra);
  state.ridge = true;
  state.reach = RIDGE;
}

function node(id: string, x: number, z: number, kind: CampNode["kind"], max: number): CampNode {
  return { id, kind, x, z, hp: max, max, hitCd: 0, down: 0 };
}

function bear(id: string, x: number, z: number, species: CampBear["species"] = "bear"): CampBear {
  return { id, x, z, hp: 3, max: 3, hitCd: 0, down: 0, vx: 0.3, vz: 0.15, turn: 1200, species };
}

function clamp(n: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, n));
}
