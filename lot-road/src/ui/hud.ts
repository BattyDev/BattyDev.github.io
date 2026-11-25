import type { MapDef } from "../content/types";
import { hasMap } from "../content/maps/registry";
import { tuning } from "../content/tuning";
import { highlighted } from "../sim/actions";
import { goalLine } from "../sim/query";
import type { GameState } from "../sim/state";
import { project } from "../render/project";
import type { RenderSnapshot } from "../render/types";
import { icon } from "./icons";

export interface HudHooks {
  onAct: () => void;
  onMute: () => boolean;
  isMuted: () => boolean;
  onRenderer: (mode: "auto" | "webgl" | "flat") => void;
  onFresh: () => void;
  onTravel: () => void;
  onDismissFuture: () => void;
}

/**
 * DOM chrome shared by both renderers. The yard never draws numbers.
 */
export class Hud {
  readonly root: HTMLElement;
  private verb!: HTMLElement;
  private sub!: HTMLElement;
  private goal!: HTMLElement;
  private name!: HTMLElement;
  private pips!: HTMLElement;
  private stack!: HTMLElement;
  private act!: HTMLElement;
  private hint!: HTMLElement;
  private floaters!: HTMLElement;
  private banner!: HTMLElement;
  private panel!: HTMLElement;
  private card!: HTMLElement;
  private debugEl!: HTMLElement;
  private freshArmed = false;
  private cardKey = "";

  constructor(host: HTMLElement, private hooks: HudHooks) {
    host.innerHTML = `
      <div class="hud">
        <div class="banner hidden"></div>
        <div class="top">
          <div class="brand">
            <p class="word">LOT<br>ROAD</p>
            <p class="yard-name"></p>
            <div class="pips"></div>
            <button class="pause" type="button" aria-label="Pause">II</button>
          </div>
          <div class="stack"></div>
        </div>
        <p class="goal"></p>
        <div class="bottom">
          <div class="act" role="button" tabindex="0" aria-label="Do the highlighted job">
            <span class="verb">CUT</span>
            <small></small>
          </div>
        </div>
        <div class="hint hidden" aria-hidden="true"></div>
        <div class="panel hidden"></div>
        <div class="card hidden"></div>
        <div class="debug hidden"></div>
      </div>
      <div class="floaters"></div>
    `;
    this.root = host.querySelector(".hud") as HTMLElement;
    this.verb = host.querySelector(".verb") as HTMLElement;
    this.sub = host.querySelector(".act small") as HTMLElement;
    this.goal = host.querySelector(".goal") as HTMLElement;
    this.name = host.querySelector(".yard-name") as HTMLElement;
    this.pips = host.querySelector(".pips") as HTMLElement;
    this.stack = host.querySelector(".stack") as HTMLElement;
    this.act = host.querySelector(".act") as HTMLElement;
    this.hint = host.querySelector(".hint") as HTMLElement;
    this.floaters = host.querySelector(".floaters") as HTMLElement;
    this.banner = host.querySelector(".banner") as HTMLElement;
    this.panel = host.querySelector(".panel") as HTMLElement;
    this.card = host.querySelector(".card") as HTMLElement;
    this.debugEl = host.querySelector(".debug") as HTMLElement;
    // The goal sits just above the button. Pull it into the bottom stack.
    const bottom = host.querySelector(".bottom") as HTMLElement;
    bottom.prepend(this.goal);

    const press = (down: boolean) => this.act.classList.toggle("is-down", down);
    this.act.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      press(true);
      this.hooks.onAct();
    });
    this.act.addEventListener("pointerup", () => press(false));
    this.act.addEventListener("pointerleave", () => press(false));
    host.querySelector(".pause")?.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.togglePause();
    });
  }

  flashDown(): void {
    this.act.classList.add("is-down");
    window.setTimeout(() => this.act.classList.remove("is-down"), 90);
  }

  setDebug(text: string): void {
    this.debugEl.classList.toggle("hidden", !text);
    this.debugEl.textContent = text;
  }

  showBanner(text: string, future: boolean): void {
    if (!text) {
      this.banner.classList.add("hidden");
      this.banner.innerHTML = "";
      return;
    }
    this.banner.classList.remove("hidden");
    this.banner.innerHTML = future
      ? `<p>${text}</p><button type="button">Start a fresh lot on this device</button>`
      : `<p>${text}</p>`;
    this.banner.querySelector("button")?.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.hooks.onDismissFuture();
    });
  }

  update(state: GameState, map: MapDef, snapshot: RenderSnapshot, width: number, height: number): void {
    this.name.textContent = map.name;
    const stageCount = map.stages.length;
    this.pips.innerHTML = map.stages
      .map((stage) => `<i class="pip${stage.id <= state.run.stage ? " on" : ""}"></i>`)
      .join("");
    if (state.run.phase !== "play") {
      this.pips.querySelectorAll(".pip").forEach((pip) => pip.classList.add("on"));
    }

    const rows = [...map.hud].reverse().find((row) => row.stage <= state.run.stage)?.rows ?? map.hud[0].rows;
    this.stack.innerHTML = rows
      .map((row) => {
        const value = row.key === "coin" ? state.profile.coins : state.run.resources[row.key] ?? 0;
        return `<div class="plate">${icon(row.icon)}<b>${value}</b></div>`;
      })
      .join("");

    const action = highlighted(state, map);
    let verb = action?.verb ?? "…";
    let sub = action?.sub ?? "";
    if (!action && state.run.pendingSale) {
      verb = "SELL";
      sub = "On the water";
    } else if (!action && state.run.launchLeft > 0) {
      verb = "LAUNCH";
      sub = "The barge is away";
    } else if (!action && state.run.phase !== "play") {
      verb = "DONE";
      sub = map.name;
    }
    this.verb.textContent = verb;
    this.sub.textContent = sub;
    this.goal.textContent = state.run.phase === "play" ? goalLine(state, map) : "";
    this.act.setAttribute("aria-label", `${verb}. ${sub}`);

    const showHint =
      state.run.phase === "play" &&
      (state.run.hintLeft > 0 || state.run.idleMs >= tuning.hintIdleMs) &&
      !state.run.pendingSale;
    this.hint.classList.toggle("hidden", !showHint);

    const reduced = document.documentElement.classList.contains("reduced");
    this.floaters.innerHTML = "";
    for (const floater of snapshot.floaters) {
      const p = project(floater.x, 1.2, floater.z, width, height);
      const t = Math.min(1, floater.age / tuning.floatLifeMs);
      const rise = reduced ? 0 : t * tuning.floatRisePx;
      const span = document.createElement("span");
      span.textContent = floater.text;
      span.style.left = `${p.x}px`;
      span.style.top = `${p.y - rise}px`;
      span.style.color = floater.color;
      span.style.opacity = String(1 - t);
      this.floaters.appendChild(span);
    }

    this.renderCard(state, map);
    void stageCount;
  }

  private renderCard(state: GameState, map: MapDef): void {
    const key = `${state.run.phase}:${state.profile.coins}:${state.run.launched}`;
    if (state.run.phase === "play") {
      this.cardKey = "";
      this.card.classList.add("hidden");
      return;
    }
    if (key === this.cardKey) return;
    this.cardKey = key;
    const keep = Math.min(state.profile.coins, tuning.travelKeep);
    const nextReady = !!(map.nextId && hasMap(map.nextId));
    const nextLine = nextReady
      ? `${map.nextName} is open.`
      : `${map.name} is loaded. ${map.nextName ?? "The next yard"} opens with the next update.`;
    this.card.classList.remove("hidden");
    this.card.innerHTML = `
      <p>${map.name}</p>
      <h2>${map.nextId ? "On the road" : "The road ends"}</h2>
      <p class="purse">${state.profile.coins}</p>
      <p>The hands are paid. ${keep} coins stay in the purse.</p>
      <p>${nextLine}</p>
      ${nextReady ? `<button type="button">GO</button>` : ""}
    `;
    this.card.querySelector("button")?.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.hooks.onTravel();
    });
  }

  private togglePause(): void {
    if (!this.panel.classList.contains("hidden")) {
      this.panel.classList.add("hidden");
      this.freshArmed = false;
      return;
    }
    this.panel.classList.remove("hidden");
    this.paintPause();
  }

  private paintPause(): void {
    this.freshArmed = false;
    this.panel.innerHTML = `
      <h2>Paused</h2>
      <button type="button" data-act="mute">${this.hooks.isMuted() ? "Unmute" : "Mute"}</button>
      <button type="button" data-act="chunky">Chunky yard</button>
      <button type="button" data-act="flat">Flat yard</button>
      <button type="button" data-act="auto">Auto yard</button>
      <button type="button" data-act="fresh">Start a fresh lot</button>
      <p class="credits">Yards, icons, and sounds are original. Lilita One and Nunito are used under the SIL Open Font License 1.1.</p>
      <button type="button" data-act="close">Back to the yard</button>
    `;
    this.panel.querySelectorAll("button").forEach((button) => {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const act = (button as HTMLElement).dataset.act;
        if (act === "close") this.togglePause();
        if (act === "mute") {
          const muted = this.hooks.onMute();
          (button as HTMLButtonElement).textContent = muted ? "Unmute" : "Mute";
        }
        if (act === "chunky") this.hooks.onRenderer("webgl");
        if (act === "flat") this.hooks.onRenderer("flat");
        if (act === "auto") this.hooks.onRenderer("auto");
        if (act === "fresh") this.armFresh(button as HTMLButtonElement);
      });
    });
  }

  paused(): boolean {
    return !this.panel.classList.contains("hidden");
  }

  private armFresh(button: HTMLButtonElement): void {
    if (!this.freshArmed) {
      this.freshArmed = true;
      button.textContent = "Erase this lot?";
      return;
    }
    this.hooks.onFresh();
    this.panel.classList.add("hidden");
    this.freshArmed = false;
  }
}
