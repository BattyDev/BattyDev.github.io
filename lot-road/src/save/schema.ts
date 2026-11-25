import type { Profile, RunState } from "../sim/state";

/**
 * The blob a future account would store, untouched.
 * A later sync wraps this same object. Do not rename fields for a server.
 *
 * Wrapper, not built here:
 * { accountId, revision, updatedAt, blob }
 */
export interface SaveBlob {
  v: number;
  game: "lot-road";
  savedAt: number;
  profile: Profile;
  run: SaveRun;
}

export interface SaveRun {
  mapId: string;
  stage: number;
  sold: Record<string, number>;
  resources: Record<string, number>;
  stations: Record<string, number>;
  /** Count, not positions. A reload stands the Hands back on their marks. */
  hands: number;
  stationJobs: { stationId: string; remainingMs: number; recipeId: string; totalMs?: number }[];
  nodes: { id: string; charges: number; regrow: number[] }[];
  order: Record<string, number>;
  stats: { taps: number; playMs: number };
  sales?: Record<string, number>;
  crafted?: Record<string, number>;
  pad?: RunState["pad"];
  pendingSale?: RunState["pendingSale"];
  phase?: RunState["phase"];
  launched?: boolean;
  launchLeft?: number;
  bossCd?: number;
  hintLeft?: number;
  idleMs?: number;
}

export function isSaveBlob(value: unknown): value is SaveBlob {
  if (!value || typeof value !== "object") return false;
  const blob = value as Partial<SaveBlob>;
  return blob.game === "lot-road" && typeof blob.v === "number" && !!blob.profile && !!blob.run;
}
