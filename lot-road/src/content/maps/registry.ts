import type { MapDef } from "../types";
import { glowOrchard } from "./glow-orchard";
import { kilnRidge } from "./kiln-ridge";
import { reedBend } from "./reed-bend";
import { saltSteps } from "./salt-steps";

/**
 * Yards the running build can actually enter. A cleared save only grows
 * mapsUnlocked for ids in this list.
 * The map modules are data. Three.js stays in the renderer chunk, so the
 * first Reed Bend frame does not pay for a second yard's meshes.
 */
const MAPS: Record<string, MapDef> = {
  [reedBend.id]: reedBend,
  [kilnRidge.id]: kilnRidge,
  [saltSteps.id]: saltSteps,
  [glowOrchard.id]: glowOrchard,
};

export function getMap(id: string): MapDef {
  const map = MAPS[id];
  if (!map) throw new Error(`Unknown yard: ${id}`);
  return map;
}

export function hasMap(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(MAPS, id);
}

export function mapIds(): string[] {
  return Object.keys(MAPS);
}

export function startingMap(): MapDef {
  return reedBend;
}
