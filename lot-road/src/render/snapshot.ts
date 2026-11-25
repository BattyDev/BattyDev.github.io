import type { MapDef } from "../content/types";
import { highlighted } from "../sim/actions";
import type { GameState } from "../sim/state";
import { slotPos } from "../sim/query";
import type { RenderSnapshot, SnapshotProp } from "./types";

export function buildSnapshot(state: GameState, map: MapDef, time: number, reduced: boolean, signLit: boolean): RenderSnapshot {
  const hot = state.run.phase === "play" ? highlighted(state, map)?.propId ?? "" : "";
  const props: SnapshotProp[] = [];

  for (const node of map.nodes) {
    const live = state.run.nodes.find((item) => item.id === node.id);
    const visible = node.stage <= state.run.stage;
    const slot = slotPos(map, node.slot);
    const fill = live ? live.charges / node.charges : 0;
    props.push({
      id: node.id,
      kind: node.kind,
      x: slot.x,
      z: slot.z,
      stage: visible ? 1 : 0,
      disc: !visible ? "off" : hot === node.id ? "hot" : "idle",
      scale: visible ? 0.28 + 0.72 * fill : 0,
      badge: "",
      shake: state.shakeId === node.id && state.shakeMs > 0,
    });
  }

  for (const station of map.stations) {
    const rank = state.run.stations[station.id] ?? 0;
    const slot = slotPos(map, station.slot);
    let badge = "";
    for (const mark of map.badges) {
      if (state.run.stage >= mark.fromStage && mark.station === station.id) {
        const held = (state.run.resources[mark.good] ?? 0) + (state.run.low[mark.good] ?? 0);
        badge = String(held);
      }
    }
    const showDisc = rank > 0 || hot === station.id;
    props.push({
      id: station.id,
      kind: station.kind,
      x: slot.x,
      z: slot.z,
      stage: rank,
      disc: !showDisc ? "off" : hot === station.id ? "hot" : "idle",
      scale: 1,
      badge,
      shake: state.shakeId === station.id && state.shakeMs > 0,
    });
  }

  const gate = slotPos(map, "gate");
  props.push({
    id: "gate",
    kind: "gate",
    x: gate.x,
    z: gate.z,
    stage: state.run.launched ? 2 : 1,
    disc: hot === "gate" ? "hot" : "idle",
    scale: 1,
    badge: "",
    shake: false,
  });

  const boss = slotPos(map, "boss");
  let boatAway = 0;
  if (state.run.pendingSale) {
    boatAway = 1 - state.run.pendingSale.left / Math.max(1, state.run.pendingSale.total);
  } else if (state.run.launchLeft > 0) {
    boatAway = 1 - state.run.launchLeft / Math.max(1, map.season.ms);
  }

  return {
    mapId: map.id,
    palette: map.palette,
    props,
    dressing: map.dressing,
    hands: state.run.hands.map((hand, index) => ({
      x: hand.x,
      z: hand.z,
      color: map.handColors[index % map.handColors.length] ?? "#C47A4A",
      walking: hand.mode === "move",
    })),
    boss: { x: boss.x, z: boss.z, swing: state.swingMs > 0 ? state.swingMs / 320 : 0, facing: -0.6 },
    axe: null,
    floaters: state.floaters.map((floater) => ({ ...floater })),
    boatAway,
    gateOpen: state.run.launched || state.run.launchLeft > 0,
    signLit,
    sign: map.    sign,
    reduced,
    time,
    bars: [],
    labels: [],
    carry: { raw: 0, cooked: 0, wood: 0, ore: 0, money: 0 },
    ring: false,
  };
}
