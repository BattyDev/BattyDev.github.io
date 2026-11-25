import type { MapDef } from "../content/types";
import { tickHands } from "./hands";
import { ageFloaters, finishLaunch, finishSale, tickJobs, tickNodes } from "./mutate";
import { tickSpecial } from "./special";
import { refresh } from "./actions";
import type { GameState } from "./state";

/** Advance the yard by dt milliseconds. No renderer, no clock skip. */
export function tick(state: GameState, map: MapDef, dt: number): void {
  if (dt <= 0) return;
  const run = state.run;
  if (run.phase !== "play") {
    ageFloaters(state, dt);
    return;
  }
  run.stats.playMs += dt;
  run.idleMs += dt;
  if (run.bossCd > 0) run.bossCd = Math.max(0, run.bossCd - dt);

  if (run.pendingSale) {
    run.pendingSale.left -= dt;
    if (run.pendingSale.left <= 0) {
      finishSale(state, map);
      refresh(state, map);
    }
  }

  if (run.launchLeft > 0) {
    run.launchLeft -= dt;
    if (run.launchLeft <= 0) {
      finishLaunch(state, map);
      refresh(state, map);
    }
  }

  tickJobs(state, map, dt);
  tickSpecial(state, map, dt);
  tickNodes(state, map, dt);
  tickHands(state, map, dt);
  ageFloaters(state, dt);
  refresh(state, map);
}
