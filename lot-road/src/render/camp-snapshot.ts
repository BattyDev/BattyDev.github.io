import { look } from "./project";
import { padAccess, type CampState } from "../sim/camp";
import type { RenderSnapshot, SnapshotProp } from "./types";

const PAD_ICON: Record<string, string> = {
  grill: "grill",
  carry: "bag",
  hand: "person",
  tool: "axe",
  station: "saw",
  gather: "gather",
  ridge: "gate",
};

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
  look.x = Math.max(-6.2, Math.min(6.2, state.x * 0.95));
  look.z = Math.max(-6.2, Math.min(6.2, state.z * 0.95));

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
  props.push({ ...deck("deck-grill", state.grillAt.x, state.grillAt.z), kind: "hearth" });
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
    id: "mill",
    kind: "mill",
    x: state.millAt.x,
    z: state.millAt.z,
    stage: 1,
    disc: state.mill.phase === "empty" ? "idle" : "hot",
    scale: 1,
    badge: state.mill.phase === "done" ? "OK" : "",
    shake: false,
  });
  props.push({
    id: "forge",
    kind: "forge",
    x: state.forgeAt.x,
    z: state.forgeAt.z,
    stage: 1,
    disc: state.forge.phase === "empty" ? "idle" : "hot",
    scale: 1,
    badge: state.forge.phase === "done" ? "OK" : "",
    shake: false,
  });
  for (const node of state.nodes) {
    props.push({
      id: node.id,
      kind: node.kind === "tree" ? "grove" : "stone",
      x: node.x,
      z: node.z,
      stage: node.down > 0 ? 0 : 1,
      disc: "off",
      scale: node.kind === "tree" && node.down <= 0 ? 1 : node.hp / node.max,
      badge: "",
      shake: node.hitCd > 280,
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
      kind: bear.species === "wolf" ? "wolf" : bear.species === "seal" ? "seal" : "beast",
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
    const access = padAccess(state, pad.kind);
    if (access === "hidden") continue;
    props.push({
      id: pad.id,
      kind: access === "dim" ? "mark-dim" : `mark-${PAD_ICON[pad.kind] ?? "grill"}`,
      x: pad.x,
      z: pad.z,
      stage: 1,
      disc: "off",
      scale: 1,
      badge: "",
      shake: false,
    });
  }

  const coats = ["#C43838", "#3D6EA5", "#E6C56A"];
  const front = state.order === "plank" ? "#3D6EA5" : state.order === "bar" ? "#E6C56A" : "#C43838";
  const line = [front, ...coats.filter((color) => color !== front)];
  const customers = [0, 1, 2].map((i) => ({
    x: state.counterAt.x + (i - 1) * 1.05,
    z: state.counterAt.z + 1.45 + i * 0.04,
    color: line[i] ?? front,
    walking: i === 0 && state.serveCd > 0,
  }));
  if (state.serveCd > 0) customers[0].z += 0.7;

  const hands = [...customers];
  if (state.worker) hands.push({ x: state.worker.x, z: state.worker.z, color: "#4C9BE8", walking: true });
  if (state.gatherer) hands.push({ x: state.gatherer.x, z: state.gatherer.z, color: "#4C9BE8", walking: true });

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
  if (state.mill.phase === "cook") {
    bars.push({
      x: state.millAt.x,
      z: state.millAt.z,
      frac: 1 - state.mill.left / Math.max(1, state.mill.total),
      color: "#C4A06A",
    });
  }
  if (state.forge.phase === "cook") {
    bars.push({
      x: state.forgeAt.x,
      z: state.forgeAt.z,
      frac: 1 - state.forge.left / Math.max(1, state.forge.total),
      color: "#E6C56A",
    });
  }

  return {
    mapId: "camp",
    palette,
    props,
    dressing: [
      { kind: "tree", x: -8.2, z: 2.4, scale: 1.9 },
      { kind: "tree", x: 8.4, z: 1.6, scale: 1.7 },
      { kind: "tree", x: -6.4, z: -7.2, scale: 2.05 },
      { kind: "tree", x: 7.2, z: -6.4, scale: 1.6 },
      { kind: "rock", x: 8.1, z: -3.2, scale: 1.55 },
      { kind: "rock", x: -7.6, z: 5.4, scale: 1.3 },
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
    labels: [],
    carry: {
      raw: state.raw,
      cooked: state.cooked,
      wood: state.wood + state.planks,
      ore: state.ore + state.bars,
      money: state.money,
    },
    ring: true,
  };
}

function deck(id: string, x: number, z: number): SnapshotProp {
  return { id, kind: "deck", x, z, stage: 1, disc: "off", scale: 1, badge: "", shake: false };
}
