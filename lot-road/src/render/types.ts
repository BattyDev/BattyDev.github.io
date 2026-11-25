import type { DressingDef, Palette } from "../content/types";

export interface SnapshotProp {
  id: string;
  kind: string;
  x: number;
  z: number;
  /** 0 hidden, 1 built, 2 upgraded (or open, for the gate). */
  stage: number;
  disc: "hot" | "idle" | "off";
  /** 0–1, how full a harvest node looks. Stations ignore it. */
  scale: number;
  badge: string;
  shake: boolean;
}

export interface RenderSnapshot {
  mapId: string;
  palette: Palette;
  props: SnapshotProp[];
  dressing: DressingDef[];
  hands: { x: number; z: number; color: string; walking: boolean }[];
  boss: { x: number; z: number; swing: number };
  floaters: { id: number; x: number; z: number; text: string; color: string; age: number }[];
  /** 0 at the dock, 1 shoved off. */
  boatAway: number;
  gateOpen: boolean;
  signLit: boolean;
  sign: string;
  reduced: boolean;
  time: number;
}

export interface YardRenderer {
  mount(host: HTMLElement): void;
  sync(snapshot: RenderSnapshot): void;
  resize(width: number, height: number): void;
  dispose(): void;
  stats(): { calls: number; triangles: number };
  setTier(tier: "high" | "low"): void;
}
