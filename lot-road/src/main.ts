import "@fontsource/lilita-one/latin-400.css";
import "@fontsource/nunito/latin-700.css";
import "./ui/hud.css";
import { getMap, hasMap, startingMap } from "./content/maps/registry";
import type { MapDef } from "./content/types";
import { SAVE_KEY, tuning } from "./content/tuning";
import { AudioBus, type Cue } from "./audio/bus";
import { screenAxes, worldMove } from "./input/stick";
import { campSnapshot } from "./render/camp-snapshot";
import type { YardRenderer } from "./render/types";
import { loadFromStorage, parkFutureSave, toBlob, writeSave } from "./save/storage";
import { campFromRaw, createCamp, tickCamp, type CampState } from "./sim/camp";
import { createGame, createRun, type GameState } from "./sim/state";
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
document.body.style.background = "#D5E6EE";

let camp: CampState = createCamp();
if (!params.has("reset")) camp = campFromRaw(localStorage.getItem(SAVE_KEY)) ?? camp;
const stickEl = document.createElement("div");
stickEl.className = "stick hidden";
stickEl.innerHTML = "<i></i>";
const knob = stickEl.querySelector("i") as HTMLElement;
let stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
const held = new Set<string>();

const hud = new Hud(app, {
  onAct: () => {
    /* Walking is the only control. */
  },
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
    camp = createCamp();
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
  onReplay: () => {
    // A cleared lot can be walked again. The purse and the clear bonus stay put.
    state.run = createRun(map);
    state.floaters = [];
    flushNow();
  },
  onDismissFuture: () => {
    parkFutureSave(localStorage);
    futureHold = false;
    state.banner = "";
    hud.showBanner("", false);
    flushNow();
  },
  onFullscreen: () => toggleFullscreen(),
});
hud.showFullscreen(fullscreenAvailable());

app.appendChild(stickEl);
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
    const cues = tickCamp(camp, readMove(), dt);
    for (const cue of cues) audio.play(cue as Cue);
  }
  const reduced = reducedQuery.matches || state.profile.settings.reducedMotion;
  const snapshot = campSnapshot(camp, now, reduced);
  const rect = app.getBoundingClientRect();
  try {
    renderer?.resize(rect.width, rect.height);
    renderer?.sync(snapshot);
  } catch (error) {
    console.error(error);
    if (rendererKind === "webgl") void mountRenderer("flat");
  }
  hud.update(camp, snapshot, rect.width, rect.height);
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
  if ((event.target as HTMLElement).closest(".pause, .full, .panel, .card, .banner")) return;
  if (event.pointerType === "touch" && !event.isPrimary) return;
  audio.unlock();
  if (hud.paused() || futureHold) return;
  stick = { id: event.pointerId, ox: event.clientX, oy: event.clientY, x: event.clientX, y: event.clientY };
  app.setPointerCapture(event.pointerId);
  placeStick();
});

app.addEventListener("pointermove", (event) => {
  if (!stick || event.pointerId !== stick.id) return;
  stick.x = event.clientX;
  stick.y = event.clientY;
  placeStick();
});

const endStick = (event: PointerEvent) => {
  if (!stick || event.pointerId !== stick.id) return;
  stick = null;
  stickEl.classList.add("hidden");
};
app.addEventListener("pointerup", endStick);
app.addEventListener("pointercancel", endStick);
app.addEventListener("contextmenu", (event) => event.preventDefault());

window.addEventListener("keydown", (event) => {
  if (event.code.startsWith("Arrow") || event.code === "Space") event.preventDefault();
  if (event.repeat) return;
  const target = event.target;
  if (target instanceof HTMLElement && target.closest("input, textarea")) return;
  // KeyF, not F11. F11 is the browser's own fullscreen shortcut.
  if (event.code === "KeyF" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    toggleFullscreen();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  held.add(event.code);
  audio.unlock();
});
window.addEventListener("keyup", (event) => held.delete(event.code));
window.addEventListener("blur", () => held.clear());
document.addEventListener("fullscreenchange", () => hud.setFullscreen(isFullscreen()));
document.addEventListener("webkitfullscreenchange", () => hud.setFullscreen(isFullscreen()));

document.addEventListener("visibilitychange", () => {
  hidden = document.hidden;
  if (hidden) {
    held.clear();
    flushNow();
  } else {
    last = performance.now();
  }
});

window.addEventListener("pagehide", () => flushNow());

function readMove(): { x: number; z: number } {
  const rect = app.getBoundingClientRect();
  if (stick) return worldMove(stick.x - stick.ox, stick.y - stick.oy, rect.width, rect.height);
  const axes = screenAxes(held);
  if (!axes) return { x: 0, z: 0 };
  return worldMove(axes.x * 80, axes.y * 80, rect.width, rect.height);
}

type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};

function fullscreenAvailable(): boolean {
  const el = app as FullscreenElement;
  const doc = document as FullscreenDocument;
  const enabled = document.fullscreenEnabled || !!doc.webkitFullscreenEnabled;
  return enabled && typeof (el.requestFullscreen || el.webkitRequestFullscreen) === "function";
}

function isFullscreen(): boolean {
  const doc = document as FullscreenDocument;
  return document.fullscreenElement === app || doc.webkitFullscreenElement === app;
}

function toggleFullscreen(): void {
  if (!fullscreenAvailable()) return;
  const el = app as FullscreenElement;
  const doc = document as FullscreenDocument;
  const done = isFullscreen()
    ? (document.exitFullscreen?.bind(document) ?? doc.webkitExitFullscreen?.bind(document))?.()
    : (el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el))?.();
  void Promise.resolve(done).catch(() => {
    /* The browser refused the gesture. Leave the yard as it is. */
  });
}

function placeStick(): void {
  if (!stick) return;
  const rect = app.getBoundingClientRect();
  stickEl.classList.remove("hidden");
  stickEl.style.left = `${stick.ox - rect.left}px`;
  stickEl.style.top = `${stick.oy - rect.top}px`;
  const dx = Math.max(-48, Math.min(48, stick.x - stick.ox));
  const dy = Math.max(-48, Math.min(48, stick.y - stick.oy));
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
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
  const raw = JSON.stringify(toBlob(state)) + JSON.stringify(camp);
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
  const ok = writeSave(localStorage, state, camp);
  lastBlob = JSON.stringify(toBlob(state)) + JSON.stringify(camp);
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
