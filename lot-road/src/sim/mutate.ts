import type { MapDef } from "../content/types";
import { tuning } from "../content/tuning";
import { hasMap } from "../content/maps/registry";
import { recipeFor, hasInputs, slotPos } from "./query";
import { FLOAT_COLOR, bumpPurse, type GameState } from "./state";

export function pushFloat(state: GameState, x: number, z: number, text: string, color: string): void {
  state.floaters.push({
    id: state.floaterId++,
    x,
    z,
    text,
    color,
    age: 0,
  });
  if (state.floaters.length > 8) state.floaters.shift();
}

export function harvestNode(state: GameState, map: MapDef, nodeId: string, who: "boss" | "hand"): boolean {
  const def = map.nodes.find((node) => node.id === nodeId);
  const node = state.run.nodes.find((item) => item.id === nodeId);
  if (!def || !node || node.charges <= 0 || def.stage > state.run.stage) return false;
  node.charges -= 1;
  node.pending.push(def.regrowMs);
  const pile = def.low ? state.run.low : state.run.resources;
  pile[def.good] = (pile[def.good] ?? 0) + def.yield;
  const pos = slotPos(map, def.slot);
  pushFloat(state, pos.x, pos.z, `+${def.yield}`, FLOAT_COLOR[def.good] ?? "#fff");
  if (who === "boss") state.swingMs = 320;
  return true;
}

/** One job per station. A second start, from a Hand or the Boss, is a no-op. */
export function startCraft(state: GameState, map: MapDef, stationId: string): boolean {
  const run = state.run;
  if (run.jobs.some((job) => job.stationId === stationId)) return false;
  const rank = run.stations[stationId] ?? 0;
  const recipe = recipeFor(map, stationId, rank);
  if (!recipe || !hasInputs(run, recipe)) return false;
  for (const input of recipe.inputs) {
    run.resources[input.good] = (run.resources[input.good] ?? 0) - input.n;
  }
  run.jobs.push({
    stationId,
    recipeId: recipe.id,
    left: recipe.ms,
    total: recipe.ms,
    elapsed: 0,
    paused: false,
    windowsHit: 0,
  });
  return true;
}

export function loadSale(state: GameState, map: MapDef, saleId: string): boolean {
  const run = state.run;
  if (run.pad || run.pendingSale) return false;
  const sale = map.sales.find((item) => item.id === saleId);
  if (!sale) return false;
  if ((run.resources[sale.good] ?? 0) < sale.count) return false;
  run.resources[sale.good] = (run.resources[sale.good] ?? 0) - sale.count;
  run.pad = { saleId: sale.id, good: sale.good, have: sale.count, need: sale.count };
  return true;
}

export function beginSell(state: GameState, map: MapDef): boolean {
  const run = state.run;
  if (!run.pad || run.pad.have < run.pad.need || run.pendingSale) return false;
  const sale = map.sales.find((item) => item.id === run.pad!.saleId);
  if (!sale) return false;
  run.pendingSale = {
    saleId: sale.id,
    good: sale.good,
    count: sale.count,
    coins: sale.coins,
    left: sale.ms,
    total: sale.ms,
  };
  run.pad = null;
  return true;
}

export function finishSale(state: GameState, map: MapDef): void {
  const pending = state.run.pendingSale;
  if (!pending) return;
  state.profile.coins += pending.coins;
  bumpPurse(state);
  state.run.sold[pending.good] = (state.run.sold[pending.good] ?? 0) + pending.count;
  state.run.sales[pending.saleId] = (state.run.sales[pending.saleId] ?? 0) + 1;
  const sale = map.sales.find((item) => item.id === pending.saleId);
  if (sale?.countsAs) {
    state.run.sold[sale.countsAs.good] = (state.run.sold[sale.countsAs.good] ?? 0) + sale.countsAs.n;
  }
  state.run.pendingSale = null;
  const pos = slotPos(map, "boat");
  pushFloat(state, pos.x, pos.z + 0.4, `+${pending.coins}`, FLOAT_COLOR.coin);
}

export function loadOrder(state: GameState, map: MapDef, good: string): boolean {
  const line =
    map.season.lines.find((item) => item.good === good) ??
    map.season.lines.find((item) => item.also === good);
  if (!line) return false;
  const have = state.run.resources[good] ?? 0;
  const room = line.n - (state.run.order[line.good] ?? 0);
  const move = Math.min(have, room);
  if (move <= 0) return false;
  state.run.resources[good] = have - move;
  state.run.order[line.good] = (state.run.order[line.good] ?? 0) + move;
  const pos = slotPos(map, "boat");
  pushFloat(state, pos.x, pos.z, `+${move}`, FLOAT_COLOR[good] ?? "#fff");
  return true;
}

export function tickJobs(state: GameState, map: MapDef, dt: number): void {
  for (const job of state.run.jobs) {
    const recipe = map.recipes.find((item) => item.id === job.recipeId);
    // Windowed batches advance in tickSpecial, so a missed stoke can pause them.
    if (recipe?.windows?.length) continue;
    job.left -= dt;
  }
  const done = state.run.jobs.filter((job) => {
    if (job.paused) return false;
    const recipe = map.recipes.find((item) => item.id === job.recipeId);
    if (recipe?.windows && job.windowsHit < recipe.windows.length) return false;
    return job.left <= 0;
  });
  if (!done.length) return;
  state.run.jobs = state.run.jobs.filter((job) => job.left > 0);
  for (const job of done) {
    const recipe = map.recipes.find((item) => item.id === job.recipeId);
    if (!recipe) continue;
    state.run.resources[recipe.output] = (state.run.resources[recipe.output] ?? 0) + recipe.n;
    state.run.crafted[recipe.output] = (state.run.crafted[recipe.output] ?? 0) + recipe.n;
    const station = map.stations.find((item) => item.id === job.stationId);
    const pos = slotPos(map, station?.slot ?? job.stationId);
    pushFloat(state, pos.x, pos.z, `+${recipe.n}`, FLOAT_COLOR[recipe.output] ?? "#fff");
  }
}

export function tickNodes(state: GameState, map: MapDef, dt: number): void {
  for (const node of state.run.nodes) {
    const def = map.nodes.find((item) => item.id === node.id);
    if (!def || node.pending.length === 0) continue;
    const next: number[] = [];
    for (const left of node.pending) {
      const remain = left - dt;
      if (remain <= 0) node.charges = Math.min(def.charges, node.charges + 1);
      else next.push(remain);
    }
    node.pending = next;
  }
}

export function enterStage(state: GameState, map: MapDef): void {
  for (const node of map.nodes) {
    if (node.stage > state.run.stage) continue;
    if (state.run.nodes.some((item) => item.id === node.id)) continue;
    state.run.nodes.push({ id: node.id, charges: node.charges, pending: [] });
  }
  for (const unlock of map.unlocks) {
    if (unlock.stage !== state.run.stage) continue;
    if ((state.run.stations[unlock.station] ?? 0) === 0) {
      state.run.stations[unlock.station] = unlock.rank;
    }
  }
}

/** Clear bonus once. The 16-coin cap waits for the travel button, not this moment. */
export function finishLaunch(state: GameState, map: MapDef): void {
  state.run.launched = true;
  state.run.launchLeft = 0;
  state.profile.coins += map.season.pay;
  if (!state.profile.cleared.includes(map.id)) {
    state.profile.cleared.push(map.id);
    state.profile.coins += map.season.bonus;
    if (map.nextId && hasMap(map.nextId) && !state.profile.mapsUnlocked.includes(map.nextId)) {
      state.profile.mapsUnlocked.push(map.nextId);
    }
  }
  bumpPurse(state);
  state.run.phase = map.nextId ? "travel" : "end";
}

export function ageFloaters(state: GameState, dt: number): void {
  for (const floater of state.floaters) floater.age += dt;
  state.floaters = state.floaters.filter((floater) => floater.age < tuning.floatLifeMs);
  if (state.swingMs > 0) state.swingMs = Math.max(0, state.swingMs - dt);
  if (state.shakeMs > 0) state.shakeMs = Math.max(0, state.shakeMs - dt);
}
