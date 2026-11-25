import type { MapDef } from "../content/types";
import { tuning } from "../content/tuning";
import { harvestNode, loadOrder, loadSale, startCraft } from "./mutate";
import { activeSale, bestNode, gatherGood, orderLoadGood, recipeFor, hasInputs, slotPos } from "./query";
import { emptyHand, type GameState, type HandRt } from "./state";

export function addHand(state: GameState, map: MapDef): void {
  const run = state.run;
  if (run.hands.length >= map.handCap) return;
  const gate = slotPos(map, "gate");
  const home = slotPos(map, map.handSlots[run.hands.length] ?? "hand0");
  const hand = emptyHand(gate.x, gate.z);
  hand.mode = "move";
  hand.toX = home.x;
  hand.toZ = home.z;
  hand.after = "idle";
  run.hands.push(hand);
}

/** True when a Hand will be at this station within the cover window. */
export function stationCovered(state: GameState, map: MapDef, stationId: string): boolean {
  const station = map.stations.find((item) => item.id === stationId);
  if (!station) return false;
  const pos = slotPos(map, station.slot);
  for (const hand of state.run.hands) {
    const heading =
      (hand.mode === "craft" && hand.stationId === stationId) ||
      (hand.mode === "move" && hand.after === "craft" && hand.stationId === stationId);
    if (!heading) continue;
    const dist = Math.hypot(hand.x - pos.x, hand.z - pos.z);
    const eta = (dist / tuning.handSpeed) * 1000;
    if (eta <= tuning.handCoverMs) return true;
  }
  return false;
}

function roleOf(index: number, count: number): "loop" | "crafter" | "gather" | "haul" {
  if (count <= 1) return "loop";
  if (index === 0) return "crafter";
  if (count >= 3 && index === count - 1) return "haul";
  return "gather";
}

function send(
  hand: HandRt,
  x: number,
  z: number,
  after: HandRt["after"],
): void {
  if (Math.hypot(hand.x - x, hand.z - z) < 0.15) {
    hand.mode = after === "chop" ? "chop" : after === "craft" ? "craft" : "idle";
    hand.after = after;
    return;
  }
  hand.mode = "move";
  hand.toX = x;
  hand.toZ = z;
  hand.after = after;
}

function assign(state: GameState, map: MapDef, hand: HandRt, index: number): void {
  const run = state.run;
  const role = roleOf(index, run.hands.length);
  const boat = map.stations.find((station) => station.id === map.boat);
  const boatPos = slotPos(map, boat?.slot ?? "boat");

  const sale = activeSale(run, map);
  const canSale = !!sale && (run.resources[sale.good] ?? 0) >= sale.count;
  if (canSale && sale && role !== "crafter") {
    hand.haulGood = sale.good;
    hand.haulOrder = false;
    hand.stationId = "";
    send(hand, boatPos.x, boatPos.z, "haul");
    if (hand.mode !== "move") {
      loadSale(state, map, sale.id);
      hand.mode = "idle";
    }
    return;
  }

  const orderGood = role === "gather" ? null : orderLoadGood(run, map);
  if (orderGood && (role === "haul" || role === "loop")) {
    hand.haulGood = orderGood;
    hand.haulOrder = true;
    send(hand, boatPos.x, boatPos.z, "haul");
    if (hand.mode !== "move") {
      loadOrder(state, map, orderGood);
      hand.mode = "idle";
    }
    return;
  }

  if (role === "loop" || role === "crafter") {
    const rank = run.stations[map.primary] ?? 0;
    const recipe = recipeFor(map, map.primary, rank);
    const station = map.stations.find((item) => item.id === map.primary);
    const busy = run.jobs.some((job) => job.stationId === map.primary);
    if (recipe && station && rank > 0 && !busy && (role === "crafter" || hasInputs(run, recipe))) {
      const pos = slotPos(map, station.slot);
      hand.stationId = map.primary;
      hand.waiting = false;
      if (role === "crafter" || hasInputs(run, recipe)) {
        send(hand, pos.x, pos.z, "craft");
        return;
      }
    }
    if (role === "crafter" && station && rank > 0) {
      const pos = slotPos(map, station.slot);
      hand.stationId = map.primary;
      hand.waiting = false;
      send(hand, pos.x, pos.z, "craft");
      return;
    }
  }

  const raw = gatherGood(state, map);
  const node = (raw && bestNode(state, map, raw)) || fallbackNode(state, map);
  if (!node) {
    hand.mode = "idle";
    return;
  }
  const def = map.nodes.find((item) => item.id === node.id);
  if (!def) return;
  const pos = slotPos(map, def.slot);
  hand.nodeId = node.id;
  hand.left = def.handMs;
  send(hand, pos.x, pos.z, "chop");
  if (hand.mode === "chop") hand.left = def.handMs;
}

function fallbackNode(state: GameState, map: MapDef) {
  for (const def of map.nodes) {
    if (def.stage > state.run.stage) continue;
    const node = bestNode(state, map, def.good);
    if (node) return node;
  }
  return null;
}

function arrive(state: GameState, map: MapDef, hand: HandRt): void {
  hand.x = hand.toX;
  hand.z = hand.toZ;
  if (hand.after === "haul") {
    if (hand.haulOrder) loadOrder(state, map, hand.haulGood);
    else if (hand.haulGood) {
      const sale = activeSale(state.run, map);
      if (sale && sale.good === hand.haulGood) loadSale(state, map, sale.id);
    }
    hand.mode = "idle";
    hand.after = "idle";
    return;
  }
  if (hand.after === "chop") {
    const def = map.nodes.find((node) => node.id === hand.nodeId);
    hand.mode = "chop";
    hand.left = def?.handMs ?? tuning.reed.handMs;
    return;
  }
  if (hand.after === "craft") {
    hand.mode = "craft";
    hand.waiting = false;
    return;
  }
  hand.mode = "idle";
}

export function tickHands(state: GameState, map: MapDef, dt: number): void {
  const run = state.run;
  run.hands.forEach((hand, index) => {
    // A couple of transitions can resolve in one step (arrive, then start).
    for (let step = 0; step < 3; step += 1) {
      if (hand.mode === "move") {
        const dx = hand.toX - hand.x;
        const dz = hand.toZ - hand.z;
        const dist = Math.hypot(dx, dz);
        const stepDist = (tuning.handSpeed * dt) / 1000;
        if (dist <= stepDist || dist < 0.05) {
          arrive(state, map, hand);
          continue;
        }
        hand.x += (dx / dist) * stepDist;
        hand.z += (dz / dist) * stepDist;
        return;
      }
      if (hand.mode === "chop") {
        hand.left -= dt;
        if (hand.left <= 0) {
          harvestNode(state, map, hand.nodeId, "hand");
          hand.mode = "idle";
          continue;
        }
        return;
      }
      if (hand.mode === "craft") {
        const job = run.jobs.find((item) => item.stationId === hand.stationId);
        if (job) {
          hand.waiting = true;
          return;
        }
        if (hand.waiting) {
          hand.waiting = false;
          if (roleOf(index, run.hands.length) !== "crafter") {
            hand.mode = "idle";
            continue;
          }
        }
        if (startCraft(state, map, hand.stationId)) {
          hand.waiting = true;
          return;
        }
        if (roleOf(index, run.hands.length) === "crafter") return;
        hand.mode = "idle";
        continue;
      }
      assign(state, map, hand, index);
      if (hand.mode === "idle") return;
    }
  });
}
