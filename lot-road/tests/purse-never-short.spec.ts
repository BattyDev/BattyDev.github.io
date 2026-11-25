import { describe, expect, it } from "vitest";
import { reedBend } from "../src/content/maps/reed-bend";
import { apply, highlighted } from "../src/sim/actions";
import { createGame } from "../src/sim/state";
import { runHighlighted } from "./bot";

describe("purse", () => {
  it("never highlights a buy the purse cannot pay", () => {
    const state = createGame(reedBend);
    const result = runHighlighted(state, reedBend, 1_200_000);
    expect(result.shortBuys).toEqual([]);
    expect(result.negatives).toEqual([]);
  });

  it("refuses a buy when the purse is short", () => {
    const state = createGame(reedBend);
    state.run.sales.reedSkiff = 2;
    state.profile.coins = 3;
    const action = highlighted(state, reedBend);
    expect(action?.type).not.toBe("buy");
    const before = state.profile.coins;
    apply(state, reedBend, {
      type: "buy",
      buyId: "hire1",
      verb: "HIRE",
      sub: "Hire · 12",
      propId: "gate",
    });
    expect(state.profile.coins).toBe(before);
    expect(state.run.hands.length).toBe(0);
  });
});
