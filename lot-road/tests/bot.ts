import type { MapDef } from "../src/content/types";
import { actIfReady, highlighted } from "../src/sim/actions";
import { tick } from "../src/sim/tick";
import type { GameState } from "../src/sim/state";

export interface BotResult {
  state: GameState;
  done: boolean;
  negatives: string[];
  shortBuys: string[];
}

/** Always takes the highlight. One 100 ms step, same as the sim. */
export function runHighlighted(state: GameState, map: MapDef, maxMs: number): BotResult {
  const negatives: string[] = [];
  const shortBuys: string[] = [];
  let elapsed = 0;
  const note = () => {
    if (state.profile.coins < 0) negatives.push(`coins ${state.profile.coins} @ ${elapsed}`);
    for (const [good, amount] of Object.entries(state.run.resources)) {
      if (amount < 0) negatives.push(`${good} ${amount} @ ${elapsed}`);
    }
    for (const [good, amount] of Object.entries(state.run.order)) {
      if (amount < 0) negatives.push(`order ${good} ${amount} @ ${elapsed}`);
    }
  };
  while (elapsed < maxMs && state.run.phase === "play") {
    tick(state, map, 100);
    elapsed += 100;
    const action = highlighted(state, map);
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
