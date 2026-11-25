import "@fontsource/lilita-one/latin-400.css";
import "@fontsource/nunito/latin-700.css";
import "./ui/hud.css";
import { getMap, hasMap, startingMap } from "./content/maps/registry";
import type { MapDef } from "./content/types";
import { tuning } from "./content/tuning";
import { AudioBus, type Cue } from "./audio/bus";
import { project } from "./render/project";
import { buildSnapshot } from "./render/snapshot";
import type { YardRenderer } from "./render/types";
import { loadFromStorage, parkFutureSave, toBlob, writeSave } from "./save/storage";
import { actionForProp, flushBuffer, requestAct, requestProp, type ActResult } from "./sim/actions";
import { createGame, type GameState } from "./sim/state";
import { tick } from "./sim/tick";
import { Hud } from "./ui/hud";

const params = new URLSearchParams(location.search);
const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

const app = document.querySelector("#app") as HTMLElement;
const audio = new AudioBus();
let futureHold = false;
let saveTimer = 0;
let lastBlob = "";
let renderer: YardRenderer | null = null;
let rendererKind: "webgl" | "flat" = "webgl";
const frames: number[] = [];
let warmed = 0;
let droppedToFlat = false;

const loaded = params.has("reset") ? fresh() : loadFromStorage(localStorage);
let state: GameState = loaded.state;
let map: MapDef = resolveMap(state);
futureHold = loaded.future;
if (params.has("reset")) {
  try {
    localStorage.removeItem("lot-road.save.v1");
    localStorage.removeItem("lot-road.save.bak");
  } catch {
    /* private mode */
  }
}

if (reducedQuery.matches) state.profile.settings.reducedMotion = true;
applyReduced();
document.body.style.background = map.palette.letter;

const hud = new Hud(app, {
  onAct: () => act(),
  onMute: () => {
    state.profile.settings.muted = !state.profile.settings.muted;
    audio.muted = state.profile.settings.muted;
    flushNow();
    return state.profile.settings.muted;
  },
  isMuted: () => state.profile.settings.muted,
  onRenderer: (mode) => {
    state.profile.settings.renderer = mode;
    flushNow();
    void mountRenderer(pickKind());
  },
  onFresh: () => {
    if (futureHold) parkFutureSave(localStorage);
    futureHold = false;
    state = createGame(startingMap());
    map = startingMap();
    state.banner = "";
    hud.showBanner("", false);
    flushNow();
  },
  onTravel: () => {
    if (!map.nextId || !hasMap(map.nextId)) return;
    // Travel keeps 16 coins. Materials, Hands, and ranks stay behind.
    const next = getMap(map.nextId);
    state.profile.coins = Math.min(state.profile.coins, tuning.travelKeep);
    state.run = createGame(next).run;
    map = next;
    document.body.style.background = map.palette.letter;
    flushNow();
    void mountRenderer(pickKind());
  },
  onDismissFuture: () => {
    parkFutureSave(localStorage);
    futureHold = false;
    state.banner = "";
    hud.showBanner("", false);
    flushNow();
  },
});

audio.muted = state.profile.settings.muted;
if (futureHold) {
  hud.showBanner("This save is from a newer Lot Road. Refresh the page.", true);
}
if (params.get("debug") === "1") hud.setDebug("calls 0 · tris 0");

void mountRenderer(pickKind());

let last = performance.now();
let hidden = document.hidden;

function frame(now: number): void {
  const dt = Math.min(100, now - last);
  last = now;
  if (!hidden && !hud.paused() && !futureHold) {
    tick(state, map, dt);
    const extra = flushBuffer(state, map);
    if (extra) react(extra);
  }
  const reduced = reducedQuery.matches || state.profile.settings.reducedMotion;
  const signLit = state.run.phase !== "play" && !!map.nextId && hasMap(map.nextId);
  const snapshot = buildSnapshot(state, map, now, reduced, signLit);
  const rect = app.getBoundingClientRect();
  try {
    renderer?.resize(rect.width, rect.height);
    renderer?.sync(snapshot);
  } catch (error) {
    console.error(error);
    if (rendererKind === "webgl") void mountRenderer("flat");
  }
  hud.update(state, map, snapshot, rect.width, rect.height);
  watchFrame(dt);
  if (params.get("debug") === "1" && renderer) {
    const stats = renderer.stats();
    hud.setDebug(`${rendererKind} · calls ${stats.calls} · tris ${stats.triangles}`);
  }
  maybeScheduleSave();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

app.addEventListener("pointerdown", (event) => {
  if ((event.target as HTMLElement).closest(".act, .pause, .panel, .card, .banner")) return;
  if (event.pointerType === "touch" && !event.isPrimary) return;
  audio.unlock();
  if (hud.paused() || futureHold) return;
  const rect = app.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const prop = pickProp(x, y, rect.width, rect.height);
  let result: ActResult | null = null;
  if (prop && actionForProp(state, map, prop)) result = requestProp(state, map, prop);
  else result = requestAct(state, map);
  if (result) react(result);
});

app.addEventListener("contextmenu", (event) => event.preventDefault());

window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (event.code !== "Space" && event.code !== "Enter") return;
  if ((event.target as HTMLElement).closest?.("button, input")) return;
  event.preventDefault();
  audio.unlock();
  act();
});

document.addEventListener("visibilitychange", () => {
  hidden = document.hidden;
  if (hidden) {
    flushNow();
  } else {
    last = performance.now();
  }
});

window.addEventListener("pagehide", () => flushNow());

function act(): void {
  if (hud.paused() || futureHold) return;
  audio.unlock();
  hud.flashDown();
  const result = requestAct(state, map);
  if (result) react(result);
}

const seen = { stage: state.run.stage, phase: state.run.phase };

function react(result: ActResult): void {
  audio.play(result.sound as Cue);
  const reduced = reducedQuery.matches || state.profile.settings.reducedMotion;
  if (!reduced && (result.sound === "hire" || result.sound === "build" || result.sound === "sell")) {
    navigator.vibrate?.(12);
  }
  if (state.run.stage !== seen.stage || state.run.phase !== seen.phase) {
    seen.stage = state.run.stage;
    seen.phase = state.run.phase;
    flushNow();
  }
}

function pickProp(x: number, y: number, width: number, height: number): string | null {
  const snapshot = buildSnapshot(state, map, performance.now(), false, false);
  let best: string | null = null;
  let bestD = 32;
  for (const prop of snapshot.props) {
    if (prop.stage <= 0 && prop.disc === "off") continue;
    const p = project(prop.x, 0.4, prop.z, width, height);
    const dist = Math.hypot(p.x - x, p.y - y);
    if (dist < bestD) {
      best = prop.id;
      bestD = dist;
    }
  }
  return best;
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (gl && "getExtension" in gl) {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    return !!gl;
  } catch {
    return false;
  }
}

function pickKind(): "webgl" | "flat" {
  const query = params.get("renderer");
  if (query === "flat") return "flat";
  if (query === "webgl") return "webgl";
  if (state.profile.settings.renderer === "flat") return "flat";
  if (state.profile.settings.renderer === "webgl") return "webgl";
  return hasWebGL() ? "webgl" : "flat";
}

async function mountRenderer(kind: "webgl" | "flat"): Promise<void> {
  renderer?.dispose();
  renderer = null;
  rendererKind = kind;
  app.querySelector(".yard")?.remove();
  try {
    if (kind === "flat") {
      const { FlatYard } = await import("./render/flat-yard");
      renderer = new FlatYard();
    } else {
      const { WebglYard } = await import("./render/webgl-yard");
      renderer = new WebglYard();
    }
    // The WebGL context is created in mount. Set the tier after that,
    // or a phone path throws and the yard never appears.
    renderer.mount(app);
    if (rendererKind === "webgl") {
      const phone = window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 520;
      renderer.setTier(phone ? "low" : "high");
    }
    const rect = app.getBoundingClientRect();
    renderer.resize(rect.width, rect.height);
  } catch (error) {
    console.error(error);
    if (kind !== "flat") {
      await mountRenderer("flat");
      return;
    }
    renderer = null;
  }
  warmed = 0;
  frames.length = 0;
}

function watchFrame(dt: number): void {
  if (rendererKind !== "webgl") return;
  if (params.get("renderer")) return;
  if (state.profile.settings.renderer !== "auto") return;
  warmed += dt;
  if (warmed < 2000) return;
  frames.push(dt);
  if (frames.length > 90) frames.shift();
  if (frames.length < 40) return;
  const sorted = [...frames].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median > 50 && !droppedToFlat && state.profile.settings.renderer === "auto") {
    droppedToFlat = true;
    void mountRenderer("flat");
    return;
  }
  if (median > 40) renderer?.setTier("low");
  else if (median < 28) renderer?.setTier("high");
}

function maybeScheduleSave(): void {
  if (futureHold) return;
  const raw = JSON.stringify(toBlob(state));
  if (raw === lastBlob) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    lastBlob = raw;
    const ok = writeSave(localStorage, state);
    if (!ok) hud.showBanner(state.banner, false);
  }, 300);
}

function flushNow(): void {
  if (futureHold) return;
  window.clearTimeout(saveTimer);
  const ok = writeSave(localStorage, state);
  lastBlob = JSON.stringify(toBlob(state));
  if (!ok) hud.showBanner(state.banner, false);
}

function fresh(): { state: GameState; future: false; blocked: false } {
  return { state: createGame(startingMap()), future: false, blocked: false };
}

function resolveMap(game: GameState): MapDef {
  return hasMap(game.run.mapId) ? getMap(game.run.mapId) : startingMap();
}

function applyReduced(): void {
  const on = reducedQuery.matches || state.profile.settings.reducedMotion;
  document.documentElement.classList.toggle("reduced", on);
}

reducedQuery.addEventListener("change", applyReduced);
