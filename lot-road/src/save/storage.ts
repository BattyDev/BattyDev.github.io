import { mapIds, getMap } from "../content/maps/registry";
import { SAVE_BAK, SAVE_FUTURE, SAVE_KEY, tuning } from "../content/tuning";
import { createGame, createRun, emptyHand, type GameState, type HandRt } from "../sim/state";
import { slotPos } from "../sim/query";
import { migrate } from "./migrate";
import { isSaveBlob, type SaveBlob } from "./schema";

export interface LoadOutcome {
  state: GameState;
  future: boolean;
  blocked: boolean;
}

export function toBlob(state: GameState, now = Date.now()): SaveBlob {
  const run = state.run;
  return {
    v: 1,
    game: "lot-road",
    savedAt: now,
    profile: structuredClone(state.profile),
    run: {
      mapId: run.mapId,
      stage: run.stage,
      sold: { ...run.sold },
      resources: { ...run.resources },
      stations: { ...run.stations },
      hands: run.hands.length,
      stationJobs: run.jobs.map((job) => ({
        stationId: job.stationId,
        remainingMs: job.left,
        totalMs: job.total,
        recipeId: job.recipeId,
        elapsed: job.elapsed,
        paused: job.paused,
        windowsHit: job.windowsHit,
      })),
      nodes: run.nodes.map((node) => ({
        id: node.id,
        charges: node.charges,
        regrow: [...node.pending],
      })),
      order: { ...run.order },
      stats: { ...run.stats },
      sales: { ...run.sales },
      crafted: { ...run.crafted },
      pad: run.pad ? { ...run.pad } : null,
      pendingSale: run.pendingSale ? { ...run.pendingSale } : null,
      phase: run.phase,
      launched: run.launched,
      launchLeft: run.launchLeft,
      bossCd: run.bossCd,
      hintLeft: run.hintLeft,
      idleMs: run.idleMs,
      low: { ...run.low },
      transit: { ...run.transit },
      clockMs: run.clockMs,
      tides: run.tides,
      haulLeft: run.haulLeft,
      shakeMs: run.shakeMs,
      shakeSpent: run.shakeSpent,
      earlyLock: run.earlyLock,
      pickedMs: run.pickedMs,
    },
  };
}

export function fromBlob(blob: SaveBlob): GameState {
  const map = getMap(blob.run.mapId);
  const state = createGame(map);
  state.profile = structuredClone(blob.profile);
  const run = createRun(map);
  run.mapId = blob.run.mapId;
  run.stage = blob.run.stage || 1;
  run.resources = { ...blob.run.resources };
  run.sold = { ...blob.run.sold };
  run.sales = { ...(blob.run.sales ?? {}) };
  run.crafted = { ...(blob.run.crafted ?? {}) };
  run.stations = { ...run.stations, ...blob.run.stations };
  run.order = { ...blob.run.order };
  run.stats = { ...blob.run.stats };
  run.pad = blob.run.pad ?? null;
  run.pendingSale = blob.run.pendingSale ?? null;
  run.phase = blob.run.phase ?? "play";
  run.launched = !!blob.run.launched;
  run.launchLeft = blob.run.launchLeft ?? 0;
  run.bossCd = blob.run.bossCd ?? 0;
  run.hintLeft = blob.run.hintLeft ?? tuning.hintFreeActions;
  run.idleMs = blob.run.idleMs ?? 0;
  run.low = { ...(blob.run.low ?? {}) };
  run.transit = { ...(blob.run.transit ?? {}) };
  run.clockMs = blob.run.clockMs ?? 0;
  run.tides = blob.run.tides ?? 0;
  run.haulLeft = blob.run.haulLeft ?? 0;
  run.shakeMs = blob.run.shakeMs ?? 0;
  run.shakeSpent = !!blob.run.shakeSpent;
  run.earlyLock = blob.run.earlyLock ?? 0;
  run.pickedMs = blob.run.pickedMs ?? 0;
  run.jobs = (blob.run.stationJobs ?? []).map((job) => ({
    stationId: job.stationId,
    recipeId: job.recipeId,
    left: job.remainingMs,
    total: job.totalMs ?? job.remainingMs,
    elapsed: job.elapsed ?? Math.max(0, (job.totalMs ?? job.remainingMs) - job.remainingMs),
    paused: !!job.paused,
    windowsHit: job.windowsHit ?? 0,
  }));
  if (blob.run.nodes?.length) {
    run.nodes = blob.run.nodes.map((node) => ({
      id: node.id,
      charges: node.charges,
      pending: [...(node.regrow ?? [])],
    }));
  }
  // A stage can reveal a node the blob never saw (an older save, or a
  // field that was left out). Charges start full; spent stumps are the ones we stored.
  for (const def of map.nodes) {
    if (def.stage > run.stage) continue;
    if (run.nodes.some((node) => node.id === def.id)) continue;
    run.nodes.push({ id: def.id, charges: def.charges, pending: [] });
  }
  run.hands = rebuildHands(blob.run.hands ?? 0, map.id);
  state.run = run;
  return state;
}

function rebuildHands(count: number, mapId: string): HandRt[] {
  const map = getMap(mapId);
  const hands: HandRt[] = [];
  for (let i = 0; i < count; i += 1) {
    const pos = slotPos(map, map.handSlots[i] ?? "hand0");
    hands.push(emptyHand(pos.x, pos.z));
  }
  return hands;
}

export function loadFromStorage(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): LoadOutcome {
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) return { state: createGame(getMap("reed-bend")), future: false, blocked: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: createGame(getMap("reed-bend")), future: false, blocked: false };
  }
  if (!parsed || typeof parsed !== "object" || (parsed as { game?: string }).game !== "lot-road") {
    return { state: createGame(getMap("reed-bend")), future: false, blocked: false };
  }
  if (!isSaveBlob(parsed)) {
    return { state: createGame(getMap("reed-bend")), future: false, blocked: false };
  }
  const migrated = migrate(parsed, mapIds());
  if (migrated.future || !migrated.blob) {
    return { state: createGame(getMap("reed-bend")), future: true, blocked: false };
  }
  return { state: fromBlob(migrated.blob), future: false, blocked: false };
}

export function writeSave(storage: Pick<Storage, "getItem" | "setItem">, state: GameState): boolean {
  const previous = storage.getItem(SAVE_KEY);
  const raw = JSON.stringify(toBlob(state));
  try {
    if (previous) storage.setItem(SAVE_BAK, previous);
    storage.setItem(SAVE_KEY, raw);
    return true;
  } catch {
    state.banner = "This browser blocked saving.";
    return false;
  }
}

/** Keep a newer blob, and start this build clean. */
export function parkFutureSave(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): void {
  const raw = storage.getItem(SAVE_KEY);
  if (raw) storage.setItem(SAVE_FUTURE, raw);
  storage.removeItem(SAVE_KEY);
}
