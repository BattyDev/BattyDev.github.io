/**
 * Every number from the Lot Road design lives here.
 * The acceptance bot is the pacing spec: Reed Bend should finish in
 * 600–900 seconds of sim time. If a playtest misses that band, change
 * a knob in this file, not the stage list.
 *
 * Order of knobs, if the bot misses the band:
 *   under 10 min → raise the season order (10/10 toward 14/14)
 *   over 15 min → lower weave rank 1 (12 s toward 9 s)
 *   still over → lower crock time (8 s toward 6 s)
 * Prices stay put unless a buy became unaffordable.
 */
export const tuning = {
  bossChopMs: 550,
  bossDigMs: 650,
  tapBuffer: 1,
  debounceMs: 200,
  hintFreeActions: 3,
  hintIdleMs: 4000,
  sellLockMs: 1600,
  floatLifeMs: 600,
  floatRisePx: 36,
  handSpeed: 2.4,
  /** A Hand this close to arriving counts as covering the station. */
  handCoverMs: 1500,
  travelKeep: 16,
  stepMs: 100,

  reed: {
    charges: 4,
    bossMs: 550,
    handMs: 2200,
    regrowMs: 6000,
    yield: 1,
  },
  clay: {
    charges: 4,
    bossMs: 650,
    handMs: 2400,
    regrowMs: 7000,
    yield: 1,
  },

  skiff: { reed: 6, coins: 8, ms: 1600 },
  weave: {
    reed: 2,
    mat: 1,
    rank1Ms: 12000,
    rank2Ms: 8000,
    upgradeCost: 18,
  },
  matSale: { count: 5, coins: 16, ms: 1600 },
  crock: { clay: 2, mat: 1, ms: 8000, benchCost: 12 },
  crockSale: { count: 4, coins: 20, ms: 1600 },
  barge: { cost: 36, crocks: 8, coins: 48, ms: 2000 },
  // 10/10 cleared in 507s on the perfect bot (weave and the crock bench
  // run together). 14/14 is the design's first knob and still lands short,
  // so the order sits at 22/22, which puts the same bot inside 10–15 min.
  season: { mats: 22, crocks: 22, pay: 40, bonus: 50, ms: 2400 },
  hire: [12, 22, 26] as const,

  /** Mats the weave frame shows as a badge once crocks take the plate. */
  matGoalStage2: 10,
  crockGoal: 12,
  reedSales: 2,
} as const;

export const SAVE_KEY = "lot-road.save.v1";
export const SAVE_BAK = "lot-road.save.bak";
export const SAVE_FUTURE = "lot-road.save.future";
export const SAVE_VERSION = 1;
