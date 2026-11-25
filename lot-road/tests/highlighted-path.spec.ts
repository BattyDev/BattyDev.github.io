import { describe, expect, it } from "vitest";
import { reedBend } from "../src/content/maps/reed-bend";
import { hasMap } from "../src/content/maps/registry";
import { highlighted } from "../src/sim/actions";
import { createGame } from "../src/sim/state";
import { runHighlighted } from "./bot";

describe("Reed Bend highlighted path", () => {
  it("gives a reed on the first tap", () => {
    const state = createGame(reedBend);
    const action = highlighted(state, reedBend);
    expect(action?.verb).toBe("CUT");
    expect(action?.type).toBe("harvest");
    const result = runHighlighted(state, reedBend, 1);
    expect(result.state.run.resources.reed).toBe(1);
    expect(result.state.profile.coins).toBe(0);
    expect(result.negatives).toEqual([]);
  });

  it("pays the first skiff in under 20 seconds", () => {
    const state = createGame(reedBend);
    const result = runHighlighted(state, reedBend, 20_000);
    expect(result.state.profile.coins).toBeGreaterThan(0);
    expect(result.state.run.sales.reedSkiff).toBeGreaterThanOrEqual(1);
  });

  it("finishes in 600–900 sim seconds without going negative", () => {
    const state = createGame(reedBend);
    const result = runHighlighted(state, reedBend, 1_200_000);
    const seconds = Math.round(result.state.run.stats.playMs / 1000);
    const detail = JSON.stringify({
      seconds,
      phase: result.state.run.phase,
      stage: result.state.run.stage,
      coins: result.state.profile.coins,
      resources: result.state.run.resources,
      sold: result.state.run.sold,
      sales: result.state.run.sales,
      order: result.state.run.order,
      stations: result.state.run.stations,
      hands: result.state.run.hands.length,
      shortBuys: result.shortBuys,
    });
    expect(result.done, detail).toBe(true);
    expect(seconds, detail).toBeGreaterThanOrEqual(600);
    expect(seconds, detail).toBeLessThanOrEqual(900);
    expect(result.negatives, detail).toEqual([]);
    expect(result.shortBuys, detail).toEqual([]);
    expect(result.state.run.launched).toBe(true);
    expect(result.state.profile.cleared).toContain("reed-bend");
    if (hasMap("kiln-ridge")) {
      expect(result.state.profile.mapsUnlocked).toContain("kiln-ridge");
    }
    // The cap waits for GO. The win card is still holding the season purse.
    expect(result.state.profile.coins).toBeGreaterThan(16);
  });
});
