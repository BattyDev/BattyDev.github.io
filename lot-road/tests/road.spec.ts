import { describe, expect, it } from "vitest";
import { glowOrchard } from "../src/content/maps/glow-orchard";
import { kilnRidge } from "../src/content/maps/kiln-ridge";
import { saltSteps } from "../src/content/maps/salt-steps";
import { createGame } from "../src/sim/state";
import { runHighlighted, type BotResult } from "./bot";

function detail(result: BotResult, label = ""): string {
  const seconds = Math.round(result.state.run.stats.playMs / 1000);
  return JSON.stringify({
    seconds,
    phase: result.state.run.phase,
    stage: result.state.run.stage,
    coins: result.state.profile.coins,
    resources: result.state.run.resources,
    low: result.state.run.low,
    sold: result.state.run.sold,
    sales: result.state.run.sales,
    crafted: result.state.run.crafted,
    order: result.state.run.order,
    stations: result.state.run.stations,
    hands: result.state.run.hands.length,
    tides: result.state.run.tides,
    shortBuys: result.shortBuys,
  });
}

describe("the rest of the road", () => {
  it("finishes Kiln Ridge in 10–15 minutes", () => {
    const state = createGame(kilnRidge);
    const result = runHighlighted(state, kilnRidge, 1_200_000);
    const text = detail(result);
    const seconds = Math.round(result.state.run.stats.playMs / 1000);
    expect(result.done, text).toBe(true);
    expect(seconds, text).toBeGreaterThanOrEqual(600);
    expect(seconds, text).toBeLessThanOrEqual(900);
    expect(result.negatives, text).toEqual([]);
    expect(result.shortBuys, text).toEqual([]);
    expect(result.state.profile.mapsUnlocked).toContain("salt-steps");
    expect(result.state.profile.coins).toBeGreaterThan(16);
  });

  it("finishes Salt Steps in 10–15 minutes", () => {
    const state = createGame(saltSteps);
    const result = runHighlighted(state, saltSteps, 1_200_000);
    const text = detail(result);
    const seconds = Math.round(result.state.run.stats.playMs / 1000);
    expect(result.done, text).toBe(true);
    expect(seconds, text).toBeGreaterThanOrEqual(600);
    expect(seconds, text).toBeLessThanOrEqual(900);
    expect(result.negatives, text).toEqual([]);
    expect(result.shortBuys, text).toEqual([]);
    expect(result.state.profile.mapsUnlocked).toContain("glow-orchard");
  });

  it("still finishes Salt Steps after losing a pile each tide", () => {
    const state = createGame(saltSteps);
    const result = runHighlighted(state, saltSteps, 1_200_000, { wash: true });
    const text = detail(result);
    expect(result.done, text).toBe(true);
    expect(result.negatives, text).toEqual([]);
    expect(result.shortBuys, text).toEqual([]);
  });

  it("finishes Glow Orchard early taps in 10–16 minutes", () => {
    const state = createGame(glowOrchard);
    const result = runHighlighted(state, glowOrchard, 1_300_000, { shake: "early" });
    const text = detail(result);
    const seconds = Math.round(result.state.run.stats.playMs / 1000);
    expect(result.done, text).toBe(true);
    expect(seconds, text).toBeGreaterThanOrEqual(600);
    expect(seconds, text).toBeLessThanOrEqual(960);
    expect(result.negatives, text).toEqual([]);
    expect(result.shortBuys, text).toEqual([]);
    expect(result.state.run.phase).toBe("end");
    expect(result.state.profile.coins).toBeGreaterThan(16);
  });

  it("finishes a perfect Glow Orchard shake without going past 15 minutes", () => {
    const state = createGame(glowOrchard);
    const result = runHighlighted(state, glowOrchard, 1_300_000, { shake: "perfect" });
    const text = detail(result);
    const seconds = Math.round(result.state.run.stats.playMs / 1000);
    expect(result.done, text).toBe(true);
    expect(seconds, text).toBeLessThanOrEqual(900);
    expect(result.negatives, text).toEqual([]);
    expect(result.shortBuys, text).toEqual([]);
  });
});
