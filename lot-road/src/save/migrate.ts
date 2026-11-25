import { hasMap } from "../content/maps/registry";
import { SAVE_VERSION } from "../content/tuning";
import type { SaveBlob } from "./schema";

export interface MigrateResult {
  blob: SaveBlob | null;
  /** Newer than this build. The caller must not write over it. */
  future: boolean;
}

/**
 * Fill defaults and open the next yard once this build actually contains it.
 * Travel is what caps the purse at 16. A win card keeps the coins it shows.
 */
export function migrate(input: SaveBlob, ids: string[] = []): MigrateResult {
  if (input.game !== "lot-road") return { blob: null, future: false };
  if (input.v > SAVE_VERSION) return { blob: input, future: true };
  const blob: SaveBlob = structuredClone(input);
  blob.v = SAVE_VERSION;
  blob.profile ??= {
    coins: 0,
    bestPurse: 0,
    mapsUnlocked: ["reed-bend"],
    cleared: [],
    settings: { muted: false, renderer: "auto", reducedMotion: false },
  };
  blob.profile.settings ??= { muted: false, renderer: "auto", reducedMotion: false };
  blob.profile.mapsUnlocked ??= ["reed-bend"];
  blob.profile.cleared ??= [];
  blob.profile.coins ??= 0;
  blob.profile.bestPurse ??= blob.profile.coins;
  blob.run.sold ??= {};
  blob.run.resources ??= {};
  blob.run.stations ??= {};
  blob.run.order ??= {};
  blob.run.stats ??= { taps: 0, playMs: 0 };
  blob.run.nodes ??= [];
  blob.run.stationJobs ??= [];
  blob.run.hands ??= 0;
  blob.run.sales ??= {};
  blob.run.crafted ??= {};
  if (!blob.run.phase) blob.run.phase = blob.run.launched ? "travel" : "play";

  const known = ids.length ? ids : null;
  for (const cleared of blob.profile.cleared) {
    const next = nextOf(cleared);
    if (!next) continue;
    const available = known ? known.includes(next) : hasMap(next);
    if (available && !blob.profile.mapsUnlocked.includes(next)) {
      blob.profile.mapsUnlocked.push(next);
    }
  }
  if (!blob.profile.mapsUnlocked.includes("reed-bend")) {
    blob.profile.mapsUnlocked.unshift("reed-bend");
  }
  return { blob, future: false };
}

function nextOf(id: string): string | null {
  if (id === "reed-bend") return "kiln-ridge";
  if (id === "kiln-ridge") return "salt-steps";
  if (id === "salt-steps") return "glow-orchard";
  return null;
}
