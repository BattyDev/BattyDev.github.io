import { describe, expect, it } from "vitest";
import { SAVE_VERSION } from "../src/content/tuning";
import { migrate } from "../src/save/migrate";
import { fromBlob, toBlob } from "../src/save/storage";
import type { SaveBlob } from "../src/save/schema";
import { createGame } from "../src/sim/state";
import { reedBend } from "../src/content/maps/reed-bend";

function midStage(): SaveBlob {
  return {
    v: 1,
    game: "lot-road",
    savedAt: 1_700_000_000_000,
    profile: {
      coins: 6,
      bestPurse: 36,
      mapsUnlocked: ["reed-bend"],
      cleared: [],
      settings: { muted: false, renderer: "auto", reducedMotion: false },
    },
    run: {
      mapId: "reed-bend",
      stage: 3,
      sold: { reed: 12, mat: 10, crock: 4 },
      resources: { reed: 3, clay: 2, mat: 1, crock: 0 },
      stations: { weave: 2, crock: 1, boat: 1 },
      hands: 2,
      stationJobs: [{ stationId: "weave", remainingMs: 4000, recipeId: "weave2" }],
      nodes: [
        { id: "reedA", charges: 1, regrow: [2000, 4000] },
        { id: "reedB", charges: 4, regrow: [] },
        { id: "clay", charges: 3, regrow: [1000] },
      ],
      order: { mat: 0, crock: 0 },
      stats: { taps: 40, playMs: 180_000 },
    },
  };
}

describe("save migrate", () => {
  it("restores a mid-stage Reed Bend", () => {
    const migrated = migrate(midStage(), ["reed-bend"]);
    expect(migrated.future).toBe(false);
    const state = fromBlob(migrated.blob!);
    expect(state.run.stage).toBe(3);
    expect(state.profile.coins).toBe(6);
    expect(state.run.resources.clay).toBe(2);
    expect(state.run.stations.weave).toBe(2);
    expect(state.run.hands).toHaveLength(2);
    expect(state.run.nodes.find((node) => node.id === "reedA")?.charges).toBe(1);
    expect(state.run.nodes.find((node) => node.id === "reedA")?.pending).toEqual([2000, 4000]);
    expect(state.run.jobs[0]?.left).toBe(4000);
    expect(state.run.sold.crock).toBe(4);
  });

  it("unlocks Kiln Ridge only once that yard is in the build, and does not cap the purse", () => {
    const cleared: SaveBlob = {
      ...midStage(),
      profile: {
        ...midStage().profile,
        coins: 140,
        bestPurse: 140,
        cleared: ["reed-bend"],
      },
      run: {
        ...midStage().run,
        stage: 5,
        launched: true,
        phase: "travel",
      },
    };
    const phase1 = migrate(cleared, ["reed-bend"]);
    expect(phase1.blob?.profile.mapsUnlocked).toEqual(["reed-bend"]);
    expect(phase1.blob?.profile.coins).toBe(140);

    const phase2 = migrate(cleared, ["reed-bend", "kiln-ridge"]);
    expect(phase2.blob?.profile.mapsUnlocked).toContain("kiln-ridge");
    expect(phase2.blob?.profile.coins).toBe(140);
    expect(phase2.blob?.run.phase).toBe("travel");
  });

  it("round-trips a live run", () => {
    const state = createGame(reedBend);
    state.profile.coins = 4;
    state.run.resources.reed = 3;
    state.run.stage = 2;
    const again = fromBlob(toBlob(state));
    expect(again.profile.coins).toBe(4);
    expect(again.run.resources.reed).toBe(3);
    expect(again.run.stage).toBe(2);
  });

  it("does not apply a newer blob", () => {
    const newer = midStage();
    newer.v = SAVE_VERSION + 1;
    const result = migrate(newer, ["reed-bend"]);
    expect(result.future).toBe(true);
  });
});
