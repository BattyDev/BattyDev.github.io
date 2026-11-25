import { describe, expect, it } from "vitest";
import { cookTime, createCamp, inWall, tickCamp } from "../src/sim/camp";

describe("snow camp", () => {
  it("hits a bear you walk up to, then drops raw meat", () => {
    const camp = createCamp();
    const bear = camp.bears[0];
    camp.x = bear.x;
    camp.z = bear.z + 0.4;
    tickCamp(camp, { x: 0, z: 0 }, 40);
    expect(bear.hp).toBe(2);
    bear.hitCd = 0;
    tickCamp(camp, { x: 0, z: 0 }, 40);
    bear.hitCd = 0;
    tickCamp(camp, { x: 0, z: 0 }, 40);
    expect(bear.down).toBeGreaterThan(0);
    expect(camp.drops.filter((drop) => drop.kind === "raw")).toHaveLength(2);
  });

  it("cooks raw meat on the grill and sells it at the counter for bills", () => {
    const camp = createCamp();
    camp.raw = 1;
    camp.x = camp.grillAt.x;
    camp.z = camp.grillAt.z;
    tickCamp(camp, { x: 0, z: 0 }, 40);
    expect(camp.grill.phase).toBe("cook");
    expect(camp.raw).toBe(0);
    const total = cookTime(camp);
    for (let t = 0; t < total + 150; t += 100) tickCamp(camp, { x: 0, z: 0 }, 100);
    expect(camp.cooked).toBe(1);
    camp.x = camp.counterAt.x;
    camp.z = camp.counterAt.z;
    const cues = tickCamp(camp, { x: 0, z: 0 }, 40);
    expect(camp.cooked).toBe(0);
    expect(camp.drops.filter((drop) => drop.kind === "bill")).toHaveLength(4);
    expect(cues).toContain("sell");
  });

  it("picks up bills and spends them by standing on a pad", () => {
    const camp = createCamp();
    camp.drops.push({ id: "bill", kind: "bill", x: 0.2, z: 0.2, n: 4 });
    camp.x = 0.2;
    camp.z = 0.2;
    tickCamp(camp, { x: 0, z: 0 }, 40);
    expect(camp.money).toBe(4);
    const pad = camp.pads[0];
    camp.x = pad.x;
    camp.z = pad.z;
    for (let i = 0; i < 5; i += 1) tickCamp(camp, { x: 0, z: 0 }, 50);
    expect(pad.rank).toBe(0);
    for (let i = 0; i < 6; i += 1) tickCamp(camp, { x: 0, z: 0 }, 50);
    expect(pad.rank).toBe(1);
    expect(camp.money).toBe(0);
    expect(camp.grillRank).toBe(1);
  });

  it("keeps the hunter out of the palisade except at the gate", () => {
    expect(inWall(2.3, 0)).toBe(true);
    expect(inWall(0, -2.3)).toBe(false);
    const camp = createCamp();
    camp.x = 1.9;
    camp.z = 0;
    for (let i = 0; i < 20; i += 1) tickCamp(camp, { x: 1, z: 0 }, 50);
    expect(camp.x).toBeLessThan(2.16);
  });
});
