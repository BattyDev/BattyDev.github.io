/**
 * Snow-camp loop. The joystick only moves the hunter. The axe hits a bear
 * when you walk up to it. Raw meat is carried to the grill, cooked meat to
 * the counter, and the bills that fall are picked up by walking over them.
 * A pad spends the money you are carrying while you stand on it.
 */

export interface CampDrop {
  id: string;
  kind: "raw" | "bill";
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
  kind: "grill" | "carry" | "hand";
  label: string;
  price: number;
  rank: number;
  max: number;
  stood: number;
}

export interface CampWorker {
  x: number;
  z: number;
  held: "raw" | "cooked" | null;
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

export interface CampState {
  x: number;
  z: number;
  facing: number;
  swing: number;
  raw: number;
  cooked: number;
  wood: number;
  ore: number;
  money: number;
  carryMax: number;
  grillRank: number;
  bears: CampBear[];
  drops: CampDrop[];
  grill: CampGrill;
  grillAt: { x: number; z: number };
  counterAt: { x: number; z: number };
  pads: CampPad[];
  worker: CampWorker | null;
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

const IN = 2.15;
const OUT = 2.58;
const WORLD = 3.65;
const SPEED = 3.15;
const HIT = 1.02;
const PICK = 0.48;
const NEAR = 0.72;
const PAD = 0.56;
const STAND = 420;
const COOK = 3400;

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
    money: 0,
    carryMax: 4,
    grillRank: 0,
    bears: [
      bear("bear-a", 0.15, -3.15),
      bear("bear-b", -3.05, -0.4),
      bear("bear-c", 3.05, 0.35),
    ],
    drops: [],
    grill: { phase: "empty", left: 0, total: COOK },
    grillAt: { x: -1.05, z: 0.2 },
    counterAt: { x: 1.15, z: 0.45 },
    pads: [
      { id: "pad-grill", x: -1.05, z: -0.85, kind: "grill", label: "Faster grill", price: 4, rank: 0, max: 5, stood: 0 },
      { id: "pad-carry", x: 0.1, z: -1.2, kind: "carry", label: "Carry", price: 6, rank: 0, max: 5, stood: 0 },
      { id: "pad-hand", x: 1.25, z: -0.9, kind: "hand", label: "A hand", price: 12, rank: 0, max: 1, stood: 0 },
    ],
    worker: null,
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

export function carriedGoods(state: CampState): number {
  return state.raw + state.cooked + state.wood + state.ore;
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
    bear.hp -= 1;
    state.swing = 280;
    state.facing = Math.atan2(bear.x - state.x, bear.z - state.z);
    cues.push("chop");
    if (bear.hp <= 0) {
      bear.down = 9000;
      scatter(state, bear.x, bear.z, 2, "raw", 1);
      float(state, bear.x, bear.z, "meat", "#E07A6A");
    }
  }

  for (const drop of [...state.drops]) {
    if (Math.hypot(drop.x - state.x, drop.z - state.z) > PICK) continue;
    if (drop.kind === "raw" && carriedGoods(state) >= state.carryMax) continue;
    state.drops = state.drops.filter((item) => item.id !== drop.id);
    if (drop.kind === "raw") {
      state.raw += 1;
      float(state, drop.x, drop.z, "+meat", "#E07A6A");
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

  state.serveCd = Math.max(0, state.serveCd - step);
  if (near(state, state.counterAt) && state.cooked > 0 && state.serveCd === 0) {
    state.cooked -= 1;
    pay(state, cues);
  }

  tickWorker(state, step, cues);
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
    return {
      ...fresh,
      ...data,
      grillAt: fresh.grillAt,
      counterAt: fresh.counterAt,
      pads: fresh.pads.map((pad) => {
        const saved = data.pads?.find((item) => item.id === pad.id);
        return saved ? { ...pad, rank: saved.rank, stood: 0, price: pad.price } : pad;
      }),
      grill: data.grill ?? fresh.grill,
      drops: data.drops ?? [],
      worker: data.worker ?? null,
      floaters: [],
    };
  } catch {
    return null;
  }
}

function tickWorker(state: CampState, step: number, cues: CampCue[]): void {
  const hand = state.worker;
  if (!hand) return;
  if (hand.held === "cooked") {
    hand.tx = state.counterAt.x;
    hand.tz = state.counterAt.z - 0.35;
    stepToward(hand, step, 2.2);
    if (Math.hypot(hand.x - state.counterAt.x, hand.z - state.counterAt.z) < 0.85 && state.serveCd === 0) {
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
    } else if (!state.worker) {
      state.worker = { x: pad.x, z: pad.z, held: null, tx: state.grillAt.x, tz: state.grillAt.z };
      cues.push("hire");
    }
  }
}

function pay(state: CampState, cues: CampCue[]): void {
  state.serveCd = 700;
  scatter(state, state.counterAt.x, state.counterAt.z + 0.15, 4, "bill", 1);
  cues.push("sell");
}

function slide(state: CampState, dx: number, dz: number): void {
  const nx = clamp(state.x + dx, WORLD);
  const nz = clamp(state.z + dz, WORLD);
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
  return gate > 0.46;
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
  if (Math.hypot(x, z) < OUT + 0.25 || Math.hypot(x, z) > WORLD) {
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
  return { x: Math.sin(a) * 3.15, z: Math.cos(a) * 3.15 };
}

function scatter(state: CampState, x: number, z: number, count: number, kind: CampDrop["kind"], n: number): void {
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + 0.5;
    const dist = kind === "bill" ? 0.7 : 0.48;
    state.drops.push({
      id: `d${state.nextId++}`,
      kind,
      n,
      x: clamp(x + Math.cos(a) * dist, WORLD),
      z: clamp(z + Math.sin(a) * dist, WORLD),
    });
  }
}

function hintFor(state: CampState): string {
  let pad: CampPad | null = null;
  let best = 1.05;
  for (const item of state.pads) {
    if (item.rank >= item.max) continue;
    const dist = Math.hypot(item.x - state.x, item.z - state.z);
    if (dist < best) {
      pad = item;
      best = dist;
    }
  }
  if (pad) return `${pad.label} ${pad.rank}/${pad.max} · stand · ${pad.price}`;
  if (state.drops.some((drop) => drop.kind === "bill")) return "Pick up the money";
  if (state.cooked > 0) return "Stand at the counter";
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

function bear(id: string, x: number, z: number): CampBear {
  return { id, x, z, hp: 3, max: 3, hitCd: 0, down: 0, vx: 0.3, vz: 0.15, turn: 1200 };
}

function clamp(n: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, n));
}
