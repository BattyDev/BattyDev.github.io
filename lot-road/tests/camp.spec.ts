import { describe, expect, it } from "vitest";
import { cookTime, createCamp, inWall, padAccess, stationTime, tickCamp } from "../src/sim/camp";

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

  it("chops trees for wood, and rocks only after the tool pad", () => {
    const camp = createCamp();
    const tree = camp.nodes.find((node) => node.kind === "tree");
    if (!tree) throw new Error("missing tree");
    camp.x = tree.x;
    camp.z = tree.z;
    tickCamp(camp, { x: 0, z: 0 }, 40);
    tree.hitCd = 0;
    tickCamp(camp, { x: 0, z: 0 }, 40);
    expect(camp.wood).toBe(2);

    const rock = camp.nodes.find((node) => node.kind === "rock");
    if (!rock) throw new Error("missing rock");
    camp.x = rock.x;
    camp.z = rock.z;
    tickCamp(camp, { x: 0, z: 0 }, 40);
    expect(rock.hp).toBe(rock.max);
    camp.toolRank = 1;
    tickCamp(camp, { x: 0, z: 0 }, 40);
    expect(rock.hp).toBeLessThan(rock.max);
  });

  it("saws wood into planks and sells those to a plank buyer", () => {
    const camp = createCamp();
    camp.wood = 1;
    camp.x = camp.millAt.x;
    camp.z = camp.millAt.z;
    tickCamp(camp, { x: 0, z: 0 }, 40);
    expect(camp.mill.phase).toBe("cook");
    for (let t = 0; t < stationTime(camp) + 150; t += 100) tickCamp(camp, { x: 0, z: 0 }, 100);
    expect(camp.planks).toBe(1);
    camp.order = "plank";
    camp.x = camp.counterAt.x;
    camp.z = camp.counterAt.z;
    tickCamp(camp, { x: 0, z: 0 }, 40);
    expect(camp.planks).toBe(0);
    expect(camp.drops.filter((drop) => drop.kind === "bill")).toHaveLength(6);
  });

  it("keeps the hunter out of the palisade except at the gate", () => {
    expect(inWall(4.7, 0)).toBe(true);
    expect(inWall(0, -4.7)).toBe(false);
    const camp = createCamp();
    camp.x = 3.6;
    camp.z = 0;
    for (let i = 0; i < 40; i += 1) tickCamp(camp, { x: 1, z: 0 }, 50);
    expect(camp.x).toBeLessThan(4.32);
  });

  it("hunts a wolf and a seal with the axe", () => {
    const camp = createCamp();
    for (const species of ["wolf", "seal"] as const) {
      const animal = camp.bears.find((bear) => bear.species === species);
      if (!animal) throw new Error(`missing ${species}`);
      camp.x = animal.x;
      camp.z = animal.z;
      tickCamp(camp, { x: 0, z: 0 }, 40);
      expect(animal.hp).toBe(2);
      animal.hitCd = 0;
    }
  });

  it("unlocks pads one step at a time and only spends on an open pad", () => {
    const camp = createCamp();
    expect(padAccess(camp, "grill")).toBe("open");
    expect(padAccess(camp, "carry")).toBe("dim");
    expect(padAccess(camp, "hand")).toBe("hidden");
    camp.money = 40;
    const carry = camp.pads.find((pad) => pad.kind === "carry");
    if (!carry) throw new Error("missing carry pad");
    camp.x = carry.x;
    camp.z = carry.z;
    for (let i = 0; i < 12; i += 1) tickCamp(camp, { x: 0, z: 0 }, 50);
    expect(carry.rank).toBe(0);
    expect(camp.hint.includes("Carry")).toBe(false);
    const grill = camp.pads[0];
    grill.rank = 1;
    expect(padAccess(camp, "carry")).toBe("open");
    expect(padAccess(camp, "hand")).toBe("dim");
    expect(padAccess(camp, "tool")).toBe("hidden");
  });
});
