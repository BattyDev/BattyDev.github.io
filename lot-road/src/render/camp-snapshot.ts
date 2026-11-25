import { look } from "./project";
import type { CampState } from "../sim/camp";
import type { RenderSnapshot, SnapshotProp } from "./types";

const palette = {
  meadow: "#E4F1F6",
  pad: "#F7FBFD",
  water: "#D5E4EA",
  wood: "#C4A06A",
  reed: "#E7F4F8",
  clay: "#C43838",
  letter: "#D5E6EE",
};

/** The snow camp, drawn with the same prop list as the other yards. */
export function campSnapshot(state: CampState, time: number, reduced: boolean): RenderSnapshot {
  look.x = Math.max(-1.5, Math.min(1.5, state.x * 0.8));
  look.z = Math.max(-1.5, Math.min(1.5, state.z * 0.8));

  const props: SnapshotProp[] = [];
  props.push({
    id: "gate",
    kind: "gate",
    x: 0,
    z: -2.45,
    stage: 1,
    disc: "off",
    scale: 1,
    badge: "",
    shake: false,
  });
  props.push(deck("deck-grill", state.grillAt.x, state.grillAt.z));
  props.push(deck("deck-counter", state.counterAt.x, state.counterAt.z));
  props.push({
    id: "grill",
    kind: "grill",
    x: state.grillAt.x,
    z: state.grillAt.z,
    stage: 1,
    disc: state.grill.phase === "empty" ? "idle" : "hot",
    scale: 1,
    badge: state.grill.phase === "cook" ? "..." : state.grill.phase === "done" ? "OK" : "",
    shake: false,
  });
  if (state.grill.phase === "cook") {
    props.push({
      id: "smoke",
      kind: "smoke",
      x: state.grillAt.x,
      z: state.grillAt.z,
      stage: 1,
      disc: "off",
      scale: 1,
      badge: "",
      shake: false,
    });
  }
  props.push({
    id: "counter",
    kind: "counter",
    x: state.counterAt.x,
    z: state.counterAt.z,
    stage: 1,
    disc: "idle",
    scale: 1,
    badge: "",
    shake: false,
  });

  for (const bear of state.bears) {
    props.push({
      id: bear.id,
      kind: "beast",
      x: bear.x,
      z: bear.z,
      stage: bear.down > 0 ? 0 : 1,
      disc: "off",
      scale: bear.hp / bear.max,
      badge: "",
      shake: bear.hitCd > 280,
    });
  }
  for (const drop of state.drops) {
    props.push({
      id: drop.id,
      kind: drop.kind === "raw" ? "raw" : "bill",
      x: drop.x,
      z: drop.z,
      stage: 1,
      disc: "off",
      scale: 1,
      badge: "",
      shake: false,
    });
  }
  for (const pad of state.pads) {
    props.push({
      id: pad.id,
      kind: "pad",
      x: pad.x,
      z: pad.z,
      stage: 1,
      disc: pad.rank >= pad.max ? "off" : state.money >= pad.price ? "hot" : "idle",
      scale: 1,
      badge: `${pad.rank}/${pad.max}`,
      shake: false,
    });
  }

  const customers = [0, 1, 2].map((i) => ({
    x: state.counterAt.x + (i - 1) * 0.38,
    z: state.counterAt.z + 0.85 + i * 0.08,
    color: "#C43838",
    walking: i === 0 && state.serveCd > 0,
  }));
  if (state.serveCd > 0) customers[0].z += 0.7;

  const hands = state.worker
    ? [
        ...customers,
        { x: state.worker.x, z: state.worker.z, color: "#3D8B7A", walking: true },
      ]
    : customers;

  const bars = state.bears
    .filter((bear) => bear.down <= 0)
    .map((bear) => ({ x: bear.x, z: bear.z, frac: bear.hp / bear.max, color: "#7DDE6A" }));
  if (state.grill.phase === "cook") {
    bars.push({
      x: state.grillAt.x,
      z: state.grillAt.z,
      frac: 1 - state.grill.left / Math.max(1, state.grill.total),
      color: "#F2B134",
    });
  }

  return {
    mapId: "camp",
    palette,
    props,
    dressing: [
      { kind: "tree", x: -4.2, z: 1.8, scale: 1.2 },
      { kind: "tree", x: 4.3, z: 1.2, scale: 1.1 },
      { kind: "tree", x: -3.6, z: -3.4, scale: 1.3 },
      { kind: "rock", x: 3.8, z: -2.8, scale: 1 },
      { kind: "grass", x: 4.4, z: 2.6, scale: 1 },
    ],
    hands,
    boss: { x: state.x, z: state.z, swing: state.swing / 280, facing: state.facing },
    axe: null,
    floaters: state.floaters.map((floater) => ({ ...floater })),
    boatAway: 0,
    gateOpen: false,
    signLit: false,
    sign: "",
    reduced,
    time,
    bars,
    labels: state.pads.map((pad) => ({
      x: pad.x,
      z: pad.z,
      text: `${pad.rank}/${pad.max}  ${pad.price}`,
    })),
    carry: {
      raw: state.raw,
      cooked: state.cooked,
      wood: state.wood,
      ore: state.ore,
      money: state.money,
    },
    ring: true,
  };
}

function deck(id: string, x: number, z: number): SnapshotProp {
  return { id, kind: "deck", x, z, stage: 1, disc: "off", scale: 1, badge: "", shake: false };
}
