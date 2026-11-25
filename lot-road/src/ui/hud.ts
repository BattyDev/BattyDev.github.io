import type { MapDef } from "../content/types";
import { hasMap } from "../content/maps/registry";
import { tuning } from "../content/tuning";
import type { CampState } from "../sim/camp";
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
  onReplay: () => void;
  onFullscreen: () => void;
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
  private bars!: HTMLElement;
  private labels!: HTMLElement;
  private banner!: HTMLElement;
  private panel!: HTMLElement;
  private card!: HTMLElement;
  private debugEl!: HTMLElement;
  private fullBtn!: HTMLButtonElement;
  private freshArmed = false;
  private canReplay = false;
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
            <button class="full" type="button" aria-label="Full screen">Full</button>
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
      <div class="bars"></div>
      <div class="pad-labels"></div>
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
    this.bars = host.querySelector(".bars") as HTMLElement;
    this.labels = host.querySelector(".pad-labels") as HTMLElement;
    this.banner = host.querySelector(".banner") as HTMLElement;
    this.panel = host.querySelector(".panel") as HTMLElement;
    this.card = host.querySelector(".card") as HTMLElement;
    this.debugEl = host.querySelector(".debug") as HTMLElement;
    this.fullBtn = host.querySelector(".full") as HTMLButtonElement;
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
    this.fullBtn.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.hooks.onFullscreen();
    });
  }

  /** A desktop without the fullscreen API hides the control. Phones are hidden in CSS. */
  showFullscreen(available: boolean): void {
    this.fullBtn.classList.toggle("no-api", !available);
  }

  setFullscreen(active: boolean): void {
    this.fullBtn.textContent = active ? "Exit" : "Full";
    this.fullBtn.setAttribute("aria-label", active ? "Exit full screen" : "Full screen");
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

  update(camp: CampState, snapshot: RenderSnapshot, width: number, height: number): void {
    this.root.classList.add("roam");
    this.name.textContent = "Snow camp";
    this.pips.innerHTML = "";
    const plates: [string, number][] = [
      ["coin", camp.money],
      ["meat", camp.raw],
      ["cooked", camp.cooked],
    ];
    if (camp.wood > 0 || camp.planks > 0) plates.push(["wood", camp.wood]);
    if (camp.ore > 0 || camp.bars > 0) plates.push(["stone", camp.ore]);
    this.stack.innerHTML = plates
      .map(([key, value]) => `<div class="plate">${icon(String(key))}<b>${value}</b></div>`)
      .join("");
    this.goal.textContent = camp.hint;
    this.act.classList.add("hidden");
    this.hint.classList.add("hidden");

    const reduced = document.documentElement.classList.contains("reduced");
    this.bars.innerHTML = "";
    for (const bar of snapshot.bars) {
      const p = project(bar.x, 2.2, bar.z, width, height);
      const row = document.createElement("div");
      row.className = "bar";
      row.style.left = `${p.x}px`;
      row.style.top = `${p.y}px`;
      const fill = document.createElement("i");
      fill.style.width = `${Math.max(0, Math.min(1, bar.frac)) * 100}%`;
      fill.style.background = bar.color;
      row.appendChild(fill);
      this.bars.appendChild(row);
    }
    this.labels.innerHTML = "";
    for (const label of snapshot.labels) {
      const p = project(label.x, 0.2, label.z, width, height);
      const el = document.createElement("div");
      el.className = "pad-label";
      el.textContent = label.text;
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      this.labels.appendChild(el);
    }
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
    const heading = map.nextId ? "On the road" : "The road ends";
    const purseNote = map.nextId
      ? `The hands are paid. ${keep} coins stay in the purse.`
      : "The road stops here. The purse stays as it is.";
    this.card.innerHTML = `
      <p>${map.name}</p>
      <h2>${heading}</h2>
      <p class="purse">${state.profile.coins}</p>
      <p>${purseNote}</p>
      ${map.nextId ? `<p>${nextLine}</p>` : ""}
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
      ${this.canReplay ? `<button type="button" data-act="replay">Walk this lot again</button>` : ""}
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
        if (act === "replay") {
          this.hooks.onReplay();
          this.panel.classList.add("hidden");
        }
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
