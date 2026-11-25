import type { MapDef } from "../types";
import { reedBend } from "./reed-bend";

/**
 * Yards the running build can actually enter. A cleared Reed Bend save
 * only grows mapsUnlocked for ids in this list, so a phase-1 build does
 * not point the travel card at a missing module.
 */
const MAPS: Record<string, MapDef> = {
  [reedBend.id]: reedBend,
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
