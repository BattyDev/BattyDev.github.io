import { describe, expect, it } from "vitest";
import { screenAxes, worldMove } from "../src/input/stick";

describe("desktop keys", () => {
  it("treats WASD and the arrow keys as the same stick", () => {
    expect(screenAxes(new Set(["KeyW"]))).toEqual({ x: 0, y: -1 });
    expect(screenAxes(new Set(["ArrowUp"]))).toEqual({ x: 0, y: -1 });
    expect(screenAxes(new Set(["KeyA", "ArrowLeft"]))).toEqual({ x: -1, y: 0 });
    expect(screenAxes(new Set(["KeyD"]))).toEqual({ x: 1, y: 0 });
    expect(screenAxes(new Set(["ArrowRight"]))).toEqual({ x: 1, y: 0 });
    expect(screenAxes(new Set(["KeyS"]))).toEqual({ x: 0, y: 1 });
    expect(screenAxes(new Set(["ArrowDown"]))).toEqual({ x: 0, y: 1 });
    expect(screenAxes(new Set(["KeyW", "KeyD"]))).toEqual({ x: 1, y: -1 });
    expect(screenAxes(new Set(["KeyA", "KeyD"]))).toBeNull();
    expect(screenAxes(new Set(["KeyF"]))).toBeNull();
  });

  it("turns a key axis into a world step", () => {
    const step = worldMove(-80, 0, 390, 844);
    expect(Math.hypot(step.x, step.z)).toBeGreaterThan(0.9);
  });
});
