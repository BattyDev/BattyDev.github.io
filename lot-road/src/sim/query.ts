import type { Cond, GoalDef, MapDef, RecipeDef, SaleDef } from "../content/types";
import type { GameState, NodeRt, RunState } from "./state";

export function condMet(cond: Cond | undefined, run: RunState): boolean {
  if (!cond) return true;
  switch (cond.type) {
    case "sales":
      return (run.sales[cond.id ?? ""] ?? 0) >= cond.n;
    case "sold":
      return (run.sold[cond.good ?? ""] ?? 0) >= cond.n;
    case "station":
      return (run.stations[cond.id ?? ""] ?? 0) >= cond.n;
    case "hands":
      return run.hands.length >= cond.n;
    case "order":
      return (run.order[cond.good ?? ""] ?? 0) >= cond.n;
    case "crafted":
      return (run.crafted[cond.good ?? ""] ?? 0) >= cond.n;
    case "tides":
      return run.tides >= cond.n;
    default:
      return false;
  }
}

export function goalHave(goal: GoalDef, run: RunState): number {
  switch (goal.type) {
    case "sales":
      return run.sales[goal.id ?? ""] ?? 0;
    case "sold":
      return run.sold[goal.good ?? ""] ?? 0;
    case "station":
      return run.stations[goal.id ?? ""] ?? 0;
    case "hands":
      return run.hands.length;
    case "order":
      return run.order[goal.good ?? ""] ?? 0;
    case "crafted":
      return run.crafted[goal.good ?? ""] ?? 0;
    case "tides":
      return run.tides;
    case "launched":
      return run.launched ? 1 : 0;
    default:
      return 0;
  }
}

export function goalMet(goal: GoalDef, run: RunState): boolean {
  return goalHave(goal, run) >= goal.n;
}

export function recipeFor(map: MapDef, stationId: string, rank: number): RecipeDef | null {
  return map.recipes.find((recipe) => recipe.station === stationId && recipe.rank === rank) ?? null;
}

export function hasInputs(run: RunState, recipe: RecipeDef): boolean {
  return recipe.inputs.every((input) => (run.resources[input.good] ?? 0) >= input.n);
}

/** The coin sale the yard is willing to run right now. Season orders replace it. */
export function activeSale(run: RunState, map: MapDef): SaleDef | null {
  if (run.pendingSale || run.pad) return null;
  if (run.stage === map.season.stage) return null;
  for (const sale of map.sales) {
    if (run.stage < sale.stageMin || run.stage > sale.stageMax) continue;
    if (!condMet(sale.requires, run)) continue;
    if (sale.blockedBy && condMet(sale.blockedBy, run)) continue;
    if (sale.whenHeld && (run.resources[sale.whenHeld.good] ?? 0) < sale.whenHeld.n) continue;
    if (sale.limit && (run.sales[sale.id] ?? 0) >= sale.limit) continue;
    return sale;
  }
  return null;
}

export function orderReady(run: RunState, map: MapDef): boolean {
  return map.season.lines.every((line) => (run.order[line.good] ?? 0) >= line.n);
}

export function orderLoadGood(run: RunState, map: MapDef): string | null {
  if (run.stage !== map.season.stage || run.launched || run.launchLeft > 0) return null;
  for (const line of map.season.lines) {
    if ((run.order[line.good] ?? 0) >= line.n) continue;
    if ((run.resources[line.good] ?? 0) > 0) return line.good;
    if (line.also && (run.resources[line.also] ?? 0) > 0) return line.also;
  }
  return null;
}

/** What the yard is trying to produce so the highlight and the Hands agree. */
export function desiredOutput(state: GameState, map: MapDef): string {
  const run = state.run;
  if (run.stage === map.season.stage && !run.launched) {
    for (const line of map.season.lines) {
      if ((run.order[line.good] ?? 0) < line.n) return line.good;
    }
  }
  const sale = activeSale(run, map);
  if (sale) return sale.good;
  if (run.pad) return run.pad.good;
  if (map.id !== "reed-bend") return map.season.lines[0]?.good ?? "reed";
  if (run.stage <= 1) return "reed";
  if (run.stage === 2) return "mat";
  return "crock";
}

/**
 * Raw good under its threshold, lowest fill first.
 * A tie goes to reed so the weave frame is not starved while clay is also empty.
 * Nodes that have not appeared yet are skipped.
 */
export function gatherGood(state: GameState, map: MapDef): string | null {
  let best: { good: string; score: number } | null = null;
  for (const [good, threshold] of Object.entries(map.thresholds)) {
    if (!bestNode(state, map, good)) continue;
    const have = state.run.resources[good] ?? 0;
    if (have >= threshold) continue;
    const score = have / threshold;
    const tie = best && Math.abs(score - best.score) < 0.001;
    // Reed Bend keeps the weave fed. Later yards follow the good the sale is short of.
    const prefer = map.id === "reed-bend" ? "reed" : scarceRaw(state, map, desiredOutput(state, map));
    if (!best || score < best.score - 0.001 || (tie && good === prefer)) {
      best = { good, score };
    }
  }
  return best?.good ?? null;
}

export function bestNode(state: GameState, map: MapDef, good: string): NodeRt | null {
  const found = state.run.nodes.filter((node) => {
    const def = map.nodes.find((item) => item.id === node.id);
    return !!def && def.good === good && def.stage <= state.run.stage && node.charges > 0;
  });
  found.sort((a, b) => b.charges - a.charges);
  return found[0] ?? null;
}

/**
 * Raw good the stuck station is short of. Crafted inputs (a mat, a brick)
 * walk back to the raw node that feeds them.
 */
export function scarceRaw(state: GameState, map: MapDef, output: string): string {
  const rankRecipe =
    map.recipes.find(
      (recipe) => recipe.output === output && (state.run.stations[recipe.station] ?? 0) === recipe.rank,
    ) ?? map.recipes.find((recipe) => recipe.output === output);
  if (!rankRecipe) return output;
  for (const input of rankRecipe.inputs) {
    if ((state.run.resources[input.good] ?? 0) >= input.n) continue;
    if (map.nodes.some((node) => node.good === input.good)) return input.good;
    return scarceRaw(state, map, input.good);
  }
  for (const input of rankRecipe.inputs) {
    if (map.nodes.some((node) => node.good === input.good)) return input.good;
  }
  return rankRecipe.inputs[0]?.good ?? "reed";
}

export function goalLine(state: GameState, map: MapDef): string {
  const run = state.run;
  if (run.phase !== "play") return "";
  if (run.stage === map.season.stage && !run.launched) {
    if (run.launchLeft > 0) return map.away ?? "The cart is away";
    if (!orderReady(run, map)) {
      return map.season.lines
        .map((line) => `${line.label} ${run.order[line.good] ?? 0}/${line.n}`)
        .join(" · ");
    }
    return "Launch the season";
  }
  const stage = map.stages.find((item) => item.id === run.stage);
  if (!stage) return "";
  for (const goal of stage.goals) {
    if (goalMet(goal, run)) continue;
    if (goal.countLabel) return `${goal.countLabel} ${Math.min(goalHave(goal, run), goal.n)}/${goal.n}`;
    return goal.line ?? stage.name;
  }
  return stage.name;
}

export function slotPos(map: MapDef, slot: string): { x: number; z: number } {
  return map.slots[slot] ?? { x: 0, z: 0 };
}
