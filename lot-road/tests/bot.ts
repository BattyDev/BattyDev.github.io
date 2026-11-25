import type { MapDef } from "../src/content/types";
import { actIfReady, highlighted } from "../src/sim/actions";
import { shakePhase } from "../src/sim/special";
import { tick } from "../src/sim/tick";
import type { GameState } from "../src/sim/state";

export interface BotResult {
  state: GameState;
  done: boolean;
  negatives: string[];
  shortBuys: string[];
}

export interface BotOptions {
  /** Perfect waits for a full ring. Early taps while it is still filling. */
  shake?: "perfect" | "early";
  /** Drop one low pile at the start of every real tide warning. */
  wash?: boolean;
}

/** Always takes the highlight. One 100 ms step, same as the sim. */
export function runHighlighted(state: GameState, map: MapDef, maxMs: number, options: BotOptions = {}): BotResult {
  const negatives: string[] = [];
  const shortBuys: string[] = [];
  let elapsed = 0;
  let washedTide = -1;
  const note = () => {
    if (state.profile.coins < 0) negatives.push(`coins ${state.profile.coins} @ ${elapsed}`);
    for (const [good, amount] of Object.entries(state.run.resources)) {
      if (amount < 0) negatives.push(`${good} ${amount} @ ${elapsed}`);
    }
    for (const [good, amount] of Object.entries(state.run.order)) {
      if (amount < 0) negatives.push(`order ${good} ${amount} @ ${elapsed}`);
    }
    for (const [good, amount] of Object.entries(state.run.low)) {
      if (amount < 0) negatives.push(`low ${good} ${amount} @ ${elapsed}`);
    }
  };
  while (elapsed < maxMs && state.run.phase === "play") {
    tick(state, map, 100);
    elapsed += 100;
    if (options.wash && map.special?.type === "tide" && state.run.tides > 0) {
      const tide = map.special;
      if (state.run.clockMs >= tide.warnAtMs && washedTide !== state.run.tides) {
        for (const good of tide.lowGoods) {
          if ((state.run.low[good] ?? 0) > 0) {
            state.run.low[good] -= 1;
            break;
          }
        }
        washedTide = state.run.tides;
      }
    }
    const action = highlighted(state, map);
    if (options.shake !== "early" && action?.type === "shake" && shakePhase(state, map) === "fill") {
      note();
      continue;
    }
    if (action?.type === "buy" && action.buyId) {
      const buy = map.buys.find((item) => item.id === action.buyId);
      if (buy && state.profile.coins < buy.cost) {
        shortBuys.push(`${buy.id} need ${buy.cost} have ${state.profile.coins}`);
      }
    }
    actIfReady(state, map);
    note();
    if (negatives.length > 4) break;
  }
  return {
    state,
    done: state.run.phase !== "play" && state.run.launched,
    negatives,
    shortBuys,
  };
}
