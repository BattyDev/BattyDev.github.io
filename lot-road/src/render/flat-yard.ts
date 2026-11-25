import { project } from "./project";
import type { RenderSnapshot, SnapshotProp, YardRenderer } from "./types";

/**
 * Phase-1 flat yard: a ground diamond and chunky rectangles.
 * Same projection as the WebGL camera, so the HUD and the taps do not move
 * when a phone drops out of WebGL. A baked backdrop can replace the diamond later.
 */
export class FlatYard implements YardRenderer {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private host!: HTMLElement;
  private width = 1;
  private height = 1;
  private snapshot: RenderSnapshot | null = null;

  mount(host: HTMLElement): void {
    this.host = host;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "yard";
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Flat yard needs a canvas");
    this.ctx = ctx;
    host.prepend(this.canvas);
  }

  setTier(): void {
    /* Flat is the last tier. Nothing else to drop. */
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.max(1, Math.floor(width * dpr));
    this.canvas.height = Math.max(1, Math.floor(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.snapshot) this.draw(this.snapshot);
  }

  sync(snapshot: RenderSnapshot): void {
    this.snapshot = snapshot;
    this.draw(snapshot);
  }

  stats(): { calls: number; triangles: number } {
    return { calls: 0, triangles: 0 };
  }

  dispose(): void {
    this.canvas?.remove();
  }

  private draw(snapshot: RenderSnapshot): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = snapshot.palette.meadow;
    ctx.fillRect(0, 0, w, h);

    const corners = [
      project(0, 0, -3.5, w, h),
      project(3.5, 0, 0, w, h),
      project(0, 0, 3.5, w, h),
      project(-3.5, 0, 0, w, h),
    ];
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (const corner of corners.slice(1)) ctx.lineTo(corner.x, corner.y);
    ctx.closePath();
    ctx.fillStyle = snapshot.palette.pad;
    ctx.fill();

    const water = project(2.7, 0, 2.5, w, h);
    ctx.fillStyle = snapshot.palette.water;
    ctx.beginPath();
    ctx.ellipse(water.x, water.y, 54, 28, -0.5, 0, Math.PI * 2);
    ctx.fill();

    for (const tuft of snapshot.dressing) {
      if (tuft.kind === "tree") this.upright(tuft.x, tuft.z, 0.9 * tuft.scale, "#7BA04A");
      if (tuft.kind === "rock") this.upright(tuft.x, tuft.z, 0.35 * tuft.scale, "#C0B4A4");
      if (tuft.kind === "grass") this.upright(tuft.x, tuft.z, 0.28, "#8FB456");
    }

    const sprites: { y: number; draw: () => void }[] = [];
    for (const prop of snapshot.props) {
      if (prop.stage <= 0 && prop.disc === "off") continue;
      const p = project(prop.x, 0, prop.z, w, h);
      sprites.push({ y: p.y, draw: () => this.prop(prop, snapshot) });
    }
    sprites.push({
      y: project(snapshot.boss.x, 0, snapshot.boss.z, w, h).y,
      draw: () => {
        if (snapshot.ring) this.ring(snapshot.boss.x, snapshot.boss.z);
        this.person(snapshot.boss.x, snapshot.boss.z, snapshot.ring ? "#7EB6E6" : "#F6EFE2", snapshot.ring ? "#F7F4EC" : "#C43B3B", 1.9);
        if (snapshot.ring) this.pack(snapshot.boss.x, snapshot.boss.z, snapshot.carry);
      },
    });
    if (snapshot.axe) {
      const axe = snapshot.axe;
      sprites.push({
        y: project(axe.x, 0.7, axe.z, w, h).y,
        draw: () => this.axe(axe.x, axe.z),
      });
    }
    snapshot.hands.forEach((hand) => {
      const p = project(hand.x, 0, hand.z, w, h);
      sprites.push({
        y: p.y,
        draw: () => this.person(hand.x, hand.z, hand.color, null, 1.7),
      });
    });
    sprites.sort((a, b) => a.y - b.y);
    for (const sprite of sprites) sprite.draw();
  }

  private prop(prop: SnapshotProp, snapshot: RenderSnapshot): void {
    const ctx = this.ctx;
    let x = prop.x;
    let z = prop.z;
    if (prop.kind === "boat") {
      x += snapshot.boatAway * 1.6;
      z += snapshot.boatAway * 1.8;
    }
    const p = project(x, 0, z, this.width, this.height);
    if (prop.disc !== "off") {
      ctx.fillStyle = prop.disc === "hot" ? "#E6FF3D" : "rgba(28,25,21,0.35)";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, prop.disc === "hot" ? 28 : 20, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const worldH =
      prop.kind === "grove" ? 1.15 * prop.scale : prop.kind === "beast" ? 0.55 : prop.kind === "pad" || prop.kind === "coin" ? 0.16 : prop.kind === "wood" || prop.kind === "meat" ? 0.22 : prop.kind === "pile" ? 0.4 : prop.kind === "reed" || prop.kind === "clay" ? 0.35 + prop.scale * 0.7 : prop.kind === "boat" ? 0.45 : 1;
    const height = this.worldHeight(x, z, worldH);
    const colors: Record<string, string> = {
      reed: "#7BA04A",
      clay: "#D08A5A",
      weave: "#C47A4A",
      bench: "#C47A4A",
      boat: "#A8653A",
      scrub: "#8FB456",
      stone: "#D9D2C8",
      pit: "#2A2724",
      kiln: "#A33B24",
      cart: "#C47A4A",
      brine: "#D5E8F0",
      kelp: "#2E7D4F",
      pan: "#F7F4EC",
      line: "#E7D3B0",
      crate: "#E6C56A",
      post: "#F2B134",
      beast: "#F4F7F8",
      fruit: "#E07A8A",
      press: "#8C5430",
      stall: "#F2B134",
      grove: "#7BA04A",
      wood: "#A8653A",
      meat: "#A33B24",
      coin: "#E6B325",
      pile: "#C47A4A",
      pad: "#7ED07A",
      grill: "#8C5430",
      counter: "#C4A06A",
      deck: "#A67C52",
      raw: "#E07A6A",
      bill: "#7DDE6A",
      smoke: "#F7F4EC",
      gate: snapshot.signLit ? "#F6EFE2" : "#6E5A42",
    };
    ctx.fillStyle = colors[prop.kind] ?? "#C47A4A";
    ctx.fillRect(p.x - 16, p.y - height, 32, height);
    if (prop.kind === "gate") {
      ctx.fillStyle = snapshot.signLit ? "#1C1915" : "#3C3228";
      ctx.font = "700 11px Nunito, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(snapshot.sign.slice(0, 12), p.x, p.y - height + 16);
    }
    if (prop.badge) {
      ctx.fillStyle = "#F6EFE2";
      ctx.fillRect(p.x + 8, p.y - height - 4, 22, 16);
      ctx.fillStyle = "#1C1915";
      ctx.font = "700 12px Nunito, sans-serif";
      ctx.fillText(prop.badge, p.x + 19, p.y - height + 8);
    }
  }

  private worldHeight(x: number, z: number, world: number): number {
    const feet = project(x, 0, z, this.width, this.height);
    const head = project(x, world, z, this.width, this.height);
    return Math.max(10, feet.y - head.y);
  }

  private upright(x: number, z: number, world: number, color: string): void {
    const p = project(x, 0, z, this.width, this.height);
    const h = this.worldHeight(x, z, world);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(p.x - h * 0.28, p.y - h, h * 0.56, h);
  }

  private ring(x: number, z: number): void {
    const p = project(x, 0, z, this.width, this.height);
    this.ctx.strokeStyle = "#3EE0E0";
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.ellipse(p.x, p.y, 16, 8, 0, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  private pack(x: number, z: number, carry: RenderSnapshot["carry"]): void {
    const p = project(x, 0.8, z, this.width, this.height);
    const ctx = this.ctx;
    const meat = carry.raw + carry.cooked;
    if (meat > 0) {
      ctx.fillStyle = "#E07A6A";
      ctx.fillRect(p.x - 6, p.y - 8 - meat * 3, 10, 6 + meat * 3);
    }
    if (carry.money > 0) {
      ctx.fillStyle = "#7DDE6A";
      ctx.fillRect(p.x + 4, p.y - 6 - Math.min(10, carry.money) * 2, 8, 6 + Math.min(10, carry.money) * 2);
    }
  }

  private axe(x: number, z: number): void {
    const p = project(x, 0.7, z, this.width, this.height);
    const ctx = this.ctx;
    ctx.fillStyle = "#8C5A32";
    ctx.fillRect(p.x - 3, p.y - 18, 6, 20);
    ctx.fillStyle = "#D9D2C8";
    ctx.fillRect(p.x - 11, p.y - 20, 22, 6);
  }

  private person(x: number, z: number, shirt: string, scarf: string | null, world: number): void {
    const p = project(x, 0, z, this.width, this.height);
    const h = this.worldHeight(x, z, world);
    const ctx = this.ctx;
    ctx.fillStyle = shirt;
    ctx.fillRect(p.x - h * 0.22, p.y - h, h * 0.44, h);
    ctx.fillStyle = "#E6C56A";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - h - h * 0.18);
    ctx.lineTo(p.x + h * 0.28, p.y - h);
    ctx.lineTo(p.x - h * 0.28, p.y - h);
    ctx.fill();
    if (scarf) {
      ctx.fillStyle = scarf;
      ctx.fillRect(p.x - h * 0.22, p.y - h + h * 0.22, h * 0.44, Math.max(3, h * 0.08));
    }
  }
}
