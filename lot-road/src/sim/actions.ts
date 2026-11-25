import type { MapDef, RecipeDef } from "../content/types";
import { tuning } from "../content/tuning";
import { addHand, stationCovered } from "./hands";
import { beginSell, enterStage, finishLaunch, harvestNode, loadOrder, loadSale, startCraft } from "./mutate";
import {
  activeSale,
  bestNode,
  condMet,
  desiredOutput,
  gatherGood,
  goalMet,
  hasInputs,
  orderLoadGood,
  orderReady,
  recipeFor,
  scarceRaw,
} from "./query";
import { applyTimed, fillingShake, timedAction } from "./special";
import type { GameState } from "./state";

export interface Action {
  type: "harvest" | "craft" | "load" | "sell" | "buy" | "loadOrder" | "launch" | "stoke" | "haul" | "shake";
  nodeId?: string;
  stationId?: string;
  buyId?: string;
  good?: string;
  saleId?: string;
  verb: string;
  sub: string;
  propId: string;
}

export interface ActResult {
  sound: "chop" | "sell" | "hire" | "build" | "launch" | "load" | "craft" | "error";
  propId: string;
}

export function playerBusy(state: GameState): boolean {
  const run = state.run;
  return run.phase !== "play" || run.bossCd > 0 || !!run.pendingSale || run.launchLeft > 0;
}

function craftChoices(state: GameState, map: MapDef): RecipeDef[] {
  return map.recipes.filter((recipe) => {
    const rank = state.run.stations[recipe.station] ?? 0;
    if (rank !== recipe.rank) return false;
    if (state.run.jobs.some((job) => job.stationId === recipe.station)) return false;
    if (!hasInputs(state.run, recipe)) return false;
    if (stationCovered(state, map, recipe.station)) return false;
    return true;
  });
}

function preferAction(state: GameState, map: MapDef): Action | null {
  const prefer = map.prefer;
  if (!prefer) return null;
  const rank = state.run.stations[prefer.station] ?? 0;
  if (rank <= 0) return null;
  const sale = map.sales.find((item) => item.id === prefer.saleId);
  if (sale && (state.run.resources[sale.good] ?? 0) >= sale.count && !state.run.pad && !state.run.pendingSale) {
    return { type: "load", saleId: sale.id, verb: "LOAD", sub: sale.loadSub, propId: map.boat };
  }
  const ready = prefer.inputs.every((input) => (state.run.resources[input.good] ?? 0) >= input.n);
  if (!ready || state.run.jobs.some((job) => job.stationId === prefer.station)) return null;
  const recipe = recipeFor(map, prefer.station, rank);
  if (!recipe || !hasInputs(state.run, recipe)) return null;
  return { type: "craft", stationId: prefer.station, verb: recipe.verb, sub: recipe.sub, propId: prefer.station };
}

function bestCraft(state: GameState, map: MapDef, output: string): RecipeDef | null {
  const open = craftChoices(state, map);
  return (
    open.find((recipe) => recipe.output === output) ??
    open.find((recipe) => recipe.output === "mat" && (output === "crock" || output === "mat")) ??
    null
  );
}

/**
 * The one legal action. Buys the player can afford win, then the boat,
 * then a craft no Hand will reach in time, then the raw good that craft is short.
 */
export function highlighted(state: GameState, map: MapDef): Action | null {
  const run = state.run;
  if (run.phase !== "play" || run.pendingSale || run.launchLeft > 0) return null;

  const timed = timedAction(state, map);
  if (timed) return timed;

  for (const buy of map.buys) {
    if (run.stage < buy.stage) continue;
    if (buy.kind === "hand" && run.hands.length >= buy.rank) continue;
    if (buy.kind === "station" && (run.stations[buy.target] ?? 0) >= buy.rank) continue;
    if (!condMet(buy.after, run)) continue;
    if (state.profile.coins < buy.cost) continue;
    const propId = buy.kind === "station" ? buy.target : "gate";
    return { type: "buy", buyId: buy.id, verb: buy.verb, sub: buy.sub, propId };
  }

  const prefer = preferAction(state, map);
  if (prefer) return prefer;

  if (run.stage === map.season.stage && !run.launched) {
    if (orderReady(run, map)) {
      return { type: "launch", verb: "LAUNCH", sub: "Send the season", propId: map.boat };
    }
    const good = orderLoadGood(run, map);
    if (good) {
      const line = map.season.lines.find((item) => item.good === good)!;
      return {
        type: "loadOrder",
        good,
        verb: "LOAD",
        sub: `${line.label} ${run.order[good] ?? 0}/${line.n}`,
        propId: map.boat,
      };
    }
  }

  if (run.pad && run.pad.have >= run.pad.need) {
    const sale = map.sales.find((item) => item.id === run.pad!.saleId);
    if (sale) return { type: "sell", verb: "SELL", sub: sale.sellSub, propId: map.boat };
  }

  const sale = activeSale(run, map);
  if (sale && (run.resources[sale.good] ?? 0) >= sale.count) {
    return { type: "load", saleId: sale.id, verb: "LOAD", sub: sale.loadSub, propId: map.boat };
  }

  const output = desiredOutput(state, map);
  const craft = bestCraft(state, map, output);
  if (craft) {
    return {
      type: "craft",
      stationId: craft.station,
      verb: craft.verb,
      sub: craft.sub,
      propId: craft.station,
    };
  }

  const filling = fillingShake(state, map);
  if (filling && (output === "fruit" || output === "juice" || output === "jar")) return filling;

  const raw = gatherGood(state, map) ?? scarceRaw(state, map, output);
  const node = bestNode(state, map, raw);
  if (!node) return null;
  const def = map.nodes.find((item) => item.id === node.id);
  if (!def || def.kind === "fruit") return null;
  return { type: "harvest", nodeId: node.id, verb: def.verb, sub: def.sub, propId: node.id };
}

export function refresh(state: GameState, map: MapDef): void {
  if (state.run.phase !== "play") return;
  for (let guard = 0; guard < 8; guard += 1) {
    const stage = map.stages.find((item) => item.id === state.run.stage);
    if (!stage) return;
    if (!stage.goals.every((goal) => goalMet(goal, state.run))) return;
    if (state.run.stage >= map.stages.length) {
      if (state.run.launched) state.run.phase = map.nextId ? "travel" : "end";
      return;
    }
    // Stage 5 stays put until the launch animation sets `launched`.
    if (state.run.stage === map.season.stage) {
      if (state.run.launched) state.run.phase = map.nextId ? "travel" : "end";
      return;
    }
    state.run.stage += 1;
    enterStage(state, map);
  }
}

export function apply(state: GameState, map: MapDef, action: Action): ActResult {
  const run = state.run;
  run.stats.taps += 1;
  run.idleMs = 0;
  if (run.hintLeft > 0) run.hintLeft -= 1;

  const fail = (propId: string): ActResult => {
    state.shakeId = propId;
    state.shakeMs = 80;
    return { sound: "error", propId };
  };

  if (action.type === "harvest" && action.nodeId) {
    const def = map.nodes.find((node) => node.id === action.nodeId);
    if (!def || !harvestNode(state, map, action.nodeId, "boss")) return fail(action.nodeId);
    run.bossCd = def.bossMs;
    refresh(state, map);
    return { sound: "chop", propId: action.nodeId };
  }

  if (action.type === "craft" && action.stationId) {
    if (!startCraft(state, map, action.stationId)) return fail(action.stationId);
    run.bossCd = tuning.debounceMs;
    state.swingMs = 280;
    refresh(state, map);
    return { sound: "craft", propId: action.stationId };
  }

  if (action.type === "load") {
    const sale = action.saleId ? map.sales.find((item) => item.id === action.saleId) : activeSale(run, map);
    if (!sale || !loadSale(state, map, sale.id)) return fail(map.boat);
    run.bossCd = tuning.debounceMs;
    refresh(state, map);
    return { sound: "load", propId: map.boat };
  }

  if (action.type === "sell") {
    if (!beginSell(state, map)) return fail(map.boat);
    run.bossCd = tuning.debounceMs;
    refresh(state, map);
    return { sound: "sell", propId: map.boat };
  }

  if (action.type === "loadOrder" && action.good) {
    if (!loadOrder(state, map, action.good)) return fail(map.boat);
    run.bossCd = tuning.debounceMs;
    refresh(state, map);
    return { sound: "load", propId: map.boat };
  }

  if (action.type === "launch") {
    if (!orderReady(run, map) || run.launched || run.launchLeft > 0) return fail(map.boat);
    run.launchLeft = map.season.ms;
    run.bossCd = tuning.debounceMs;
    return { sound: "launch", propId: map.boat };
  }

  if (action.type === "stoke" || action.type === "haul" || action.type === "shake") {
    if (!applyTimed(state, map, action)) return fail(action.propId);
    refresh(state, map);
    return { sound: action.type === "haul" ? "load" : action.type === "shake" ? "chop" : "craft", propId: action.propId };
  }

  if (action.type === "buy" && action.buyId) {
    const buy = map.buys.find((item) => item.id === action.buyId);
    if (!buy || state.profile.coins < buy.cost) return fail(action.propId);
    if (buy.kind === "hand" && run.hands.length >= buy.rank) return fail("gate");
    if (buy.kind === "station" && (run.stations[buy.target] ?? 0) >= buy.rank) return fail(buy.target);
    state.profile.coins -= buy.cost;
    if (buy.kind === "hand") addHand(state, map);
    else run.stations[buy.target] = buy.rank;
    run.bossCd = tuning.debounceMs;
    refresh(state, map);
    return { sound: buy.sound, propId: action.propId };
  }

  return fail(action.propId);
}

/** Bot and keyboard: take the highlight the moment the Boss is free. */
export function actIfReady(state: GameState, map: MapDef): ActResult | null {
  if (playerBusy(state)) return null;
  const action = highlighted(state, map);
  if (!action) return null;
  state.run.buffer = 0;
  return apply(state, map, action);
}

/** A tap. One extra press during a swing is kept; the rest drop. */
export function requestAct(state: GameState, map: MapDef): ActResult | null {
  if (playerBusy(state)) {
    if (state.run.buffer < tuning.tapBuffer) state.run.buffer = 1;
    return null;
  }
  state.run.buffer = 0;
  const action = highlighted(state, map);
  if (!action) return null;
  return apply(state, map, action);
}

export function flushBuffer(state: GameState, map: MapDef): ActResult | null {
  if (state.run.buffer <= 0 || playerBusy(state)) return null;
  state.run.buffer = 0;
  const action = highlighted(state, map);
  if (!action) return null;
  return apply(state, map, action);
}

/** Direct prop tap. Null means "not legal", and the yard tap falls through to the highlight. */
export function actionForProp(state: GameState, map: MapDef, propId: string): Action | null {
  const highlightedNow = highlighted(state, map);
  if (highlightedNow && highlightedNow.propId === propId) return highlightedNow;
  const node = map.nodes.find((item) => item.id === propId);
  if (node) {
    const live = state.run.nodes.find((item) => item.id === propId);
    if (!live || live.charges <= 0 || node.stage > state.run.stage) return null;
    return { type: "harvest", nodeId: propId, verb: node.verb, sub: node.sub, propId };
  }
  if (propId === map.boat || propId === "gate") {
    const action = highlighted(state, map);
    if (!action) return null;
    if (action.propId === propId || action.propId === map.boat) return action;
    return null;
  }
  const station = map.stations.find((item) => item.id === propId);
  if (!station) return null;
  const rank = state.run.stations[station.id] ?? 0;
  const recipe = recipeFor(map, station.id, rank);
  if (!recipe) return null;
  if (state.run.jobs.some((job) => job.stationId === station.id)) return null;
  if (!hasInputs(state.run, recipe)) return null;
  return {
    type: "craft",
    stationId: station.id,
    verb: recipe.verb,
    sub: recipe.sub,
    propId: station.id,
  };
}

export function requestProp(state: GameState, map: MapDef, propId: string): ActResult | null {
  const action = actionForProp(state, map, propId);
  if (!action) return null;
  if (playerBusy(state)) {
    if (state.run.buffer < tuning.tapBuffer) state.run.buffer = 1;
    return null;
  }
  return apply(state, map, action);
}
