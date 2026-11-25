import type { MapDef, RecipeDef, ShakeSpecial, TideSpecial } from "../content/types";
import { tuning } from "../content/tuning";
import type { Action } from "./actions";
import { pushFloat, startCraft } from "./mutate";
import { slotPos } from "./query";
import { FLOAT_COLOR, type GameState, type JobRt } from "./state";

export type ShakePhase = "off" | "fill" | "perfect" | "late" | "spent";

export function shakePhase(state: GameState, map: MapDef): ShakePhase {
  const special = map.special;
  if (!special || special.type !== "shake") return "off";
  if (!map.nodes.some((node) => node.kind === "fruit" && node.stage <= state.run.stage)) return "off";
  if (state.run.shakeSpent) return "spent";
  if (state.run.shakeMs < special.fillMs) return "fill";
  if (state.run.shakeMs <= special.fillMs + special.lateMs) return "perfect";
  return "late";
}

function shakeTree(map: MapDef, stage: number): string {
  const trees = map.nodes.filter((node) => node.kind === "fruit" && node.stage <= stage);
  return trees[trees.length - 1]?.id ?? trees[0]?.id ?? "tree";
}

function shakeAction(state: GameState, map: MapDef, phase: ShakePhase): Action {
  const sub =
    phase === "perfect" ? "Full ring" : phase === "late" ? "The ring slipped" : "The ring is filling";
  return { type: "shake", verb: "SHAKE", sub, propId: shakeTree(map, state.run.stage) };
}

/** STOKE, HAUL, or a ripe SHAKE. These beat a buy so a short window is not missed. */
export function timedAction(state: GameState, map: MapDef): Action | null {
  const stoke = stokeAction(state, map);
  if (stoke) return stoke;
  const haul = haulAction(state, map);
  if (haul) return haul;
  const phase = shakePhase(state, map);
  if (phase === "perfect" || phase === "late") return shakeAction(state, map, phase);
  return null;
}

/** SHAKE while the ring is still filling. The economy wins when it has a job. */
export function fillingShake(state: GameState, map: MapDef): Action | null {
  const phase = shakePhase(state, map);
  if (phase !== "fill") return null;
  return shakeAction(state, map, phase);
}

function stokeAction(state: GameState, map: MapDef): Action | null {
  const special = map.special;
  if (!special || special.type !== "stoke") return null;
  const job = state.run.jobs.find((item) => item.stationId === special.station);
  if (!job) return null;
  const recipe = map.recipes.find((item) => item.id === job.recipeId);
  const window = recipe?.windows?.[job.windowsHit];
  if (!recipe || !window) return null;
  const open = job.elapsed >= window.at && job.elapsed <= window.at + window.ms;
  if (!open && !job.paused) return null;
  return { type: "stoke", stationId: job.stationId, verb: "STOKE", sub: "The kiln mouth", propId: special.station };
}

export function tideWarning(state: GameState, map: MapDef): boolean {
  const tide = tideOf(map);
  if (!tide) return false;
  const warnAt = state.run.tides === 0 ? tide.tutorialWarnAtMs : tide.warnAtMs;
  return state.run.clockMs >= warnAt && state.run.clockMs < tide.cycleMs;
}

function haulAction(state: GameState, map: MapDef): Action | null {
  const tide = tideOf(map);
  if (!tide || state.run.haulLeft > 0 || !tideWarning(state, map)) return null;
  const sitting = lowTotal(state, tide);
  if (sitting <= 0) return null;
  const post = map.stations.find((station) => station.kind === "post");
  return {
    type: "haul",
    verb: "HAUL",
    sub: `${sitting} on the low step`,
    propId: post?.id ?? map.boat,
  };
}

function tideOf(map: MapDef): TideSpecial | null {
  return map.special?.type === "tide" ? map.special : null;
}

function lowTotal(state: GameState, tide: TideSpecial): number {
  return tide.lowGoods.reduce((sum, good) => sum + (state.run.low[good] ?? 0), 0);
}

export function applyTimed(state: GameState, map: MapDef, action: Action): boolean {
  if (action.type === "stoke") return applyStoke(state, map, action.stationId ?? "");
  if (action.type === "haul") return startHaul(state, map);
  if (action.type === "shake") return applyShake(state, map);
  return false;
}

function applyStoke(state: GameState, map: MapDef, stationId: string): boolean {
  const job = state.run.jobs.find((item) => item.stationId === stationId);
  const recipe = job && map.recipes.find((item) => item.id === job.recipeId);
  if (!job || !recipe?.windows || job.windowsHit >= recipe.windows.length) return false;
  const window = recipe.windows[job.windowsHit];
  const open = job.elapsed >= window.at && job.elapsed <= window.at + window.ms;
  if (!open && !job.paused) return false;
  job.windowsHit += 1;
  job.paused = false;
  state.run.bossCd = tuning.debounceMs;
  return true;
}

function startHaul(state: GameState, map: MapDef): boolean {
  const tide = tideOf(map);
  if (!tide || state.run.haulLeft > 0) return false;
  let moved = 0;
  for (const good of tide.lowGoods) {
    const have = state.run.low[good] ?? 0;
    if (have <= 0) continue;
    state.run.transit[good] = (state.run.transit[good] ?? 0) + have;
    state.run.low[good] = 0;
    moved += have;
  }
  if (moved <= 0) return false;
  state.run.haulLeft = tide.haulMs;
  state.run.bossCd = tuning.debounceMs;
  return true;
}

function finishHaul(state: GameState, map: MapDef): void {
  for (const [good, count] of Object.entries(state.run.transit)) {
    if (count <= 0) continue;
    state.run.resources[good] = (state.run.resources[good] ?? 0) + count;
    const pos = slotPos(map, "boat");
    pushFloat(state, pos.x, pos.z, `+${count}`, FLOAT_COLOR[good] ?? "#fff");
  }
  state.run.transit = {};
}

function applyShake(state: GameState, map: MapDef): boolean {
  const special = map.special;
  if (!special || special.type !== "shake") return false;
  const phase = shakePhase(state, map);
  if (phase === "off" || phase === "spent") return false;
  const pos = slotPos(map, shakeTree(map, state.run.stage));
  if (phase === "perfect") {
    state.run.resources.fruit = (state.run.resources.fruit ?? 0) + special.perfectFruit;
    state.run.resources.nectar = (state.run.resources.nectar ?? 0) + special.perfectNectar;
    pushFloat(state, pos.x, pos.z, `+${special.perfectFruit}`, FLOAT_COLOR.fruit);
    state.run.shakeMs = 0;
    state.run.shakeSpent = false;
  } else {
    state.run.resources.fruit = (state.run.resources.fruit ?? 0) + special.earlyFruit;
    pushFloat(state, pos.x, pos.z, `+${special.earlyFruit}`, FLOAT_COLOR.fruit);
    state.run.shakeSpent = true;
    state.run.earlyLock = special.earlyLockMs ?? 0;
  }
  state.run.bossCd = tuning.debounceMs;
  state.swingMs = 280;
  return true;
}

/** Advance windows, tides, the orchard ring, and stations that run themselves. */
export function tickSpecial(state: GameState, map: MapDef, dt: number): void {
  tickWindows(state, map, dt);
  tickTide(state, map, dt);
  tickShake(state, map, dt);
  tickAuto(state, map);
}

function tickWindows(state: GameState, map: MapDef, dt: number): void {
  for (const job of state.run.jobs) {
    const recipe = map.recipes.find((item) => item.id === job.recipeId);
    if (!recipe?.windows?.length) continue;
    if (!job.paused) {
      job.elapsed += dt;
      job.left = Math.max(0, job.total - job.elapsed);
      const window = recipe.windows[job.windowsHit];
      if (window && job.elapsed > window.at + window.ms) {
        job.paused = true;
        job.elapsed = window.at + window.ms;
        job.left = Math.max(0, job.total - job.elapsed);
      }
    }
    maybeStoker(state, map, job, recipe);
  }
}

function maybeStoker(state: GameState, map: MapDef, job: JobRt, recipe: RecipeDef): void {
  const special = map.special;
  if (!special || special.type !== "stoke" || job.stationId !== special.station) return;
  if (state.run.hands.length <= special.stokerIndex) return;
  const window = recipe.windows?.[job.windowsHit];
  if (!window) return;
  const openFor = job.paused ? special.stokerDelayMs : job.elapsed - window.at;
  const open = job.elapsed >= window.at && job.elapsed <= window.at + window.ms;
  if (job.paused || (open && openFor >= special.stokerDelayMs)) {
    job.windowsHit += 1;
    job.paused = false;
  }
}

function tickTide(state: GameState, map: MapDef, dt: number): void {
  const tide = tideOf(map);
  if (!tide) return;
  if (state.run.haulLeft > 0) {
    state.run.haulLeft -= dt;
    if (state.run.haulLeft <= 0) finishHaul(state, map);
  }
  state.run.clockMs += dt;
  if (state.run.clockMs < tide.cycleMs) return;
  state.run.clockMs = 0;
  const tutorial = state.run.tides === 0;
  if (!tutorial && state.run.haulLeft <= 0) {
    for (const good of tide.lowGoods) state.run.low[good] = 0;
  } else if (tutorial && lowTotal(state, tide) > 0 && state.run.haulLeft <= 0) {
    startHaul(state, map);
  }
  state.run.tides += 1;
}

function tickShake(state: GameState, map: MapDef, dt: number): void {
  const special = map.special;
  if (!special || special.type !== "shake") return;
  if (state.run.earlyLock > 0) {
    state.run.earlyLock -= dt;
    if (state.run.earlyLock <= 0) {
      state.run.shakeSpent = false;
      state.run.shakeMs = 0;
    }
  } else {
    state.run.shakeMs += dt;
    if (state.run.shakeMs > special.fillMs + special.lateMs) {
      state.run.shakeMs = 0;
      state.run.shakeSpent = false;
    }
  }
  if (state.run.hands.length <= special.pickerIndex) return;
  state.run.pickedMs += dt;
  if (state.run.pickedMs < special.pickerMs) return;
  state.run.pickedMs = 0;
  state.run.resources.fruit = (state.run.resources.fruit ?? 0) + 1;
  const pos = slotPos(map, shakeTree(map, state.run.stage));
  pushFloat(state, pos.x, pos.z, "+1", FLOAT_COLOR.fruit);
}

function tickAuto(state: GameState, map: MapDef): void {
  for (const station of map.stations) {
    if (!station.auto) continue;
    if ((state.run.stations[station.id] ?? 0) <= 0) continue;
    if (state.run.jobs.some((job) => job.stationId === station.id)) continue;
    startCraft(state, map, station.id);
  }
}

/** One pile per Hand per tide, during the warning. The player's HAUL clears the step. */
export function handHaulOne(state: GameState, map: MapDef, tideMark: number): { good: string; mark: number } | null {
  const tide = tideOf(map);
  if (!tide || !tideWarning(state, map) || tideMark === state.run.tides) return null;
  for (const good of tide.lowGoods) {
    if ((state.run.low[good] ?? 0) <= 0) continue;
    state.run.low[good] -= 1;
    state.run.resources[good] = (state.run.resources[good] ?? 0) + 1;
    return { good, mark: state.run.tides };
  }
  return null;
}
