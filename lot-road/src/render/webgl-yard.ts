import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { cameraEye, look, VIEW } from "./project";
import type { RenderSnapshot, SnapshotProp, YardRenderer } from "./types";

const HOT = new THREE.Color("#E6FF3D");
const IDLE = new THREE.Color("#1C1915");

function paint(geo: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const color = new THREE.Color(hex);
  const count = geo.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

interface Part {
  geo: THREE.BufferGeometry;
  color: string;
  x?: number;
  y?: number;
  z?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  ry?: number;
}

function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map((part) => {
    const geo = part.geo.clone();
    geo.applyMatrix4(new THREE.Matrix4().makeScale(part.sx ?? 1, part.sy ?? 1, part.sz ?? 1));
    if (part.ry) geo.applyMatrix4(new THREE.Matrix4().makeRotationY(part.ry));
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(part.x ?? 0, part.y ?? 0, part.z ?? 0));
    return paint(geo, part.color);
  });
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error("Could not merge a yard mesh");
  merged.computeVertexNormals();
  return merged;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r: number, h: number, n = 6) => new THREE.CylinderGeometry(r, r, h, n);
const cone = (r: number, h: number, n = 6) => new THREE.ConeGeometry(r, h, n);
const sphere = (r: number) => new THREE.SphereGeometry(r, 7, 5);

function person(shirt: string, scarf: string | null): THREE.BufferGeometry {
  const parts: Part[] = [
    { geo: cyl(0.22, 0.72, 6), color: shirt, y: 0.62 },
    { geo: sphere(0.2), color: "#F3D2B3", y: 1.18 },
    { geo: cone(0.28, 0.22, 7), color: "#E6C56A", y: 1.42 },
    { geo: cyl(0.3, 0.06, 7), color: "#E6C56A", y: 1.32 },
    { geo: box(0.12, 0.42, 0.12), color: shirt, x: -0.28, y: 0.78 },
    { geo: box(0.12, 0.42, 0.12), color: shirt, x: 0.28, y: 0.78 },
    { geo: cyl(0.09, 0.34, 5), color: "#5C4636", x: -0.1, y: 0.18 },
    { geo: cyl(0.09, 0.34, 5), color: "#5C4636", x: 0.1, y: 0.18 },
  ];
  if (scarf) parts.push({ geo: box(0.34, 0.1, 0.16), color: scarf, y: 1.02, z: 0.08 });
  return mergeParts(parts);
}

function reedGeo(): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    parts.push({
      geo: cone(0.08, 0.85, 5),
      color: i % 2 ? "#8FB85A" : "#6E9440",
      x: Math.cos(a) * 0.18,
      z: Math.sin(a) * 0.18,
      y: 0.48,
      ry: a,
    });
  }
  parts.push({ geo: cyl(0.28, 0.08, 7), color: "#6A8F3E", y: 0.06 });
  return mergeParts(parts);
}

function clayGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: sphere(0.34), color: "#D08A5A", y: 0.16, sy: 0.45 },
    { geo: sphere(0.16), color: "#E0A070", x: 0.16, y: 0.2 },
    { geo: box(0.5, 0.06, 0.36), color: "#A86840", y: 0.04 },
  ]);
}

function weaveGeo(rank: number): THREE.BufferGeometry {
  const parts: Part[] = [
    { geo: box(0.1, 0.9, 0.1), color: "#C47A4A", x: -0.38, y: 0.5 },
    { geo: box(0.1, 0.9, 0.1), color: "#C47A4A", x: 0.38, y: 0.5 },
    { geo: box(0.9, 0.1, 0.1), color: "#A8653A", y: 0.92 },
    { geo: box(0.7, 0.04, 0.5), color: "#E6D2A8", y: 0.55 },
  ];
  if (rank >= 2) parts.push({ geo: box(0.9, 0.08, 0.08), color: "#8C4E28", y: 0.72 });
  return mergeParts(parts);
}

function benchGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.9, 0.08, 0.55), color: "#C47A4A", y: 0.48 },
    { geo: box(0.08, 0.46, 0.08), color: "#8C5430", x: -0.34, z: -0.18, y: 0.24 },
    { geo: box(0.08, 0.46, 0.08), color: "#8C5430", x: 0.34, z: -0.18, y: 0.24 },
    { geo: box(0.08, 0.46, 0.08), color: "#8C5430", x: -0.34, z: 0.18, y: 0.24 },
    { geo: box(0.08, 0.46, 0.08), color: "#8C5430", x: 0.34, z: 0.18, y: 0.24 },
    { geo: cyl(0.12, 0.16, 7), color: "#E7D3B0", x: 0.12, y: 0.62 },
    { geo: cyl(0.1, 0.14, 7), color: "#C47A4A", x: -0.16, y: 0.6 },
  ]);
}

function boatGeo(rank: number): THREE.BufferGeometry {
  const wide = rank >= 2 ? 1.15 : 1;
  const parts: Part[] = [
    { geo: box(0.95 * wide, 0.16, 0.42), color: "#C47A4A", y: 0.16 },
    { geo: box(0.2, 0.18, 0.46), color: "#8C5430", x: -0.42 * wide, y: 0.28 },
    { geo: box(0.2, 0.18, 0.46), color: "#8C5430", x: 0.42 * wide, y: 0.28 },
    { geo: box(0.28, 0.2, 0.28), color: "#E6C56A", y: 0.32 },
    { geo: box(0.22, 0.18, 0.22), color: "#7BA04A", x: 0.22, y: 0.3 },
  ];
  if (rank >= 2) {
    parts.push(
      { geo: box(0.08, 0.7, 0.08), color: "#8C5430", x: 0.2, y: 0.6 },
      { geo: box(0.28, 0.18, 0.04), color: "#F6EFE2", x: 0.36, y: 0.78 },
      { geo: box(0.3, 0.22, 0.3), color: "#A33B24", x: -0.2, y: 0.36 },
    );
  }
  return mergeParts(parts);
}

function treeGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: cyl(0.08, 0.4, 5), color: "#8C5A32", y: 0.22 },
    { geo: cone(0.42, 0.7, 6), color: "#7BA04A", y: 0.7 },
    { geo: cone(0.32, 0.5, 6), color: "#8FB456", y: 1.05 },
  ]);
}

function rockGeo(): THREE.BufferGeometry {
  return mergeParts([{ geo: sphere(0.28), color: "#C0B4A4", y: 0.16, sx: 1.2, sy: 0.7, sz: 0.9 }]);
}

function scrubGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: sphere(0.28), color: "#8FB456", y: 0.28 },
    { geo: sphere(0.18), color: "#6E9440", x: 0.16, y: 0.22 },
    { geo: cyl(0.05, 0.2, 5), color: "#8C5A32", y: 0.1 },
  ]);
}

function stonePileGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: sphere(0.22), color: "#D9D2C8", y: 0.16, sx: 1.3, sy: 0.7 },
    { geo: sphere(0.14), color: "#C0B4A4", x: 0.18, y: 0.18 },
  ]);
}

function pitGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: cyl(0.42, 0.16, 8), color: "#2A2724", y: 0.08 },
    { geo: cone(0.16, 0.28, 6), color: "#E6C56A", y: 0.28 },
  ]);
}

function kilnGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.7, 0.7, 0.7), color: "#A33B24", y: 0.4 },
    { geo: box(0.28, 0.22, 0.08), color: "#2A2724", z: 0.38, y: 0.28 },
    { geo: cyl(0.1, 0.28, 6), color: "#E7D3B0", y: 0.85 },
  ]);
}

function cartGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.9, 0.28, 0.46), color: "#C47A4A", y: 0.32 },
    { geo: cyl(0.12, 0.08, 8), color: "#2A2724", x: -0.28, z: 0.2, y: 0.12 },
    { geo: cyl(0.12, 0.08, 8), color: "#2A2724", x: 0.28, z: 0.2, y: 0.12 },
  ]);
}

function brineGeo(): THREE.BufferGeometry {
  return mergeParts([{ geo: cyl(0.26, 0.08, 8), color: "#D5E8F0", y: 0.06 }]);
}

function kelpGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: cone(0.08, 0.5, 5), color: "#2E7D4F", y: 0.28, ry: 0.4 },
    { geo: cone(0.06, 0.4, 5), color: "#3E9A62", x: 0.1, y: 0.22 },
  ]);
}

function panGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: cyl(0.36, 0.1, 8), color: "#C4A574", y: 0.2 },
    { geo: cyl(0.28, 0.06, 8), color: "#F7F4EC", y: 0.26 },
  ]);
}

function lineGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.08, 0.7, 0.08), color: "#8C5430", x: -0.28, y: 0.4 },
    { geo: box(0.08, 0.7, 0.08), color: "#8C5430", x: 0.28, y: 0.4 },
    { geo: box(0.7, 0.04, 0.04), color: "#E7D3B0", y: 0.72 },
  ]);
}

function crateStationGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.7, 0.08, 0.5), color: "#C47A4A", y: 0.4 },
    { geo: box(0.28, 0.22, 0.28), color: "#E6C56A", y: 0.55 },
  ]);
}

function postGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.1, 0.9, 0.1), color: "#8C5430", y: 0.5 },
    { geo: sphere(0.12), color: "#F2B134", y: 1.0 },
  ]);
}

function fruitTreeGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: cyl(0.08, 0.4, 5), color: "#8C5A32", y: 0.22 },
    { geo: sphere(0.36), color: "#6E8B4E", y: 0.7 },
    { geo: sphere(0.08), color: "#E07A8A", x: 0.16, y: 0.78 },
    { geo: sphere(0.07), color: "#F2B134", x: -0.12, y: 0.84 },
  ]);
}

function pressGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.5, 0.5, 0.4), color: "#8C5430", y: 0.35 },
    { geo: cyl(0.08, 0.4, 6), color: "#E7D3B0", y: 0.7 },
    { geo: box(0.16, 0.16, 0.16), color: "#E07A3D", x: 0.28, y: 0.3 },
  ]);
}

function stallGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.8, 0.08, 0.4), color: "#C47A4A", y: 0.45 },
    { geo: box(0.08, 0.7, 0.08), color: "#8C5430", x: -0.32, y: 0.4 },
    { geo: box(0.08, 0.7, 0.08), color: "#8C5430", x: 0.32, y: 0.4 },
    { geo: box(0.7, 0.06, 0.4), color: "#F2B134", y: 0.78 },
  ]);
}

function beastGeo(wounds: number): THREE.BufferGeometry {
  const parts: Part[] = [
    { geo: box(0.62, 0.36, 0.9), color: "#F4F7F8", y: 0.4 },
    { geo: box(0.28, 0.24, 0.32), color: "#F7F4EC", z: 0.52, y: 0.52 },
    { geo: sphere(0.06), color: "#1C1915", x: -0.08, z: 0.66, y: 0.58 },
    { geo: sphere(0.06), color: "#1C1915", x: 0.08, z: 0.66, y: 0.58 },
    { geo: cyl(0.07, 0.28, 5), color: "#E7EEF2", x: -0.18, z: 0.22, y: 0.14 },
    { geo: cyl(0.07, 0.28, 5), color: "#E7EEF2", x: 0.18, z: 0.22, y: 0.14 },
    { geo: cyl(0.07, 0.28, 5), color: "#E7EEF2", x: -0.18, z: -0.24, y: 0.14 },
    { geo: cyl(0.07, 0.28, 5), color: "#E7EEF2", x: 0.18, z: -0.24, y: 0.14 },
  ];
  if (wounds > 0) parts.push({ geo: sphere(0.1), color: "#E07A6A", x: 0.16, y: 0.5, z: 0.1 });
  if (wounds > 1) parts.push({ geo: sphere(0.09), color: "#C43838", x: -0.12, y: 0.48, z: -0.05 });
  return mergeParts(parts);
}

function parkaGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: cyl(0.24, 0.78, 7), color: "#7EB6E6", y: 0.62 },
    { geo: sphere(0.2), color: "#F3D2B3", y: 1.2 },
    { geo: sphere(0.23), color: "#7EB6E6", y: 1.34 },
    { geo: box(0.4, 0.08, 0.18), color: "#F7F4EC", y: 1.02, z: 0.08 },
    { geo: box(0.12, 0.46, 0.12), color: "#7EB6E6", x: -0.3, y: 0.78 },
    { geo: box(0.12, 0.46, 0.12), color: "#7EB6E6", x: 0.3, y: 0.78 },
    { geo: box(0.1, 0.06, 0.12), color: "#F7F4EC", x: -0.3, y: 0.58 },
    { geo: box(0.1, 0.06, 0.12), color: "#F7F4EC", x: 0.3, y: 0.58 },
    { geo: cyl(0.09, 0.34, 5), color: "#5C4636", x: -0.1, y: 0.18 },
    { geo: cyl(0.09, 0.34, 5), color: "#5C4636", x: 0.1, y: 0.18 },
    { geo: box(0.08, 0.08, 0.46), color: "#8C5A32", x: 0.34, y: 0.72, z: 0.12 },
    { geo: box(0.22, 0.12, 0.05), color: "#D9D2C8", x: 0.34, y: 0.78, z: 0.32 },
  ]);
}

function logGeo(): THREE.BufferGeometry {
  return mergeParts([{ geo: cyl(0.1, 0.42, 6), color: "#C47A4A", y: 0.12, ry: Math.PI / 2 }]);
}

function meatGeo(): THREE.BufferGeometry {
  return mergeParts([{ geo: sphere(0.14), color: "#A33B24", y: 0.14, sx: 1.3, sy: 0.7, sz: 0.9 }]);
}

function coinGeo(): THREE.BufferGeometry {
  return mergeParts([{ geo: cyl(0.12, 0.04, 8), color: "#E6B325", y: 0.08 }]);
}

function pileGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: cyl(0.46, 0.08, 8), color: "#A8653A", y: 0.06 },
    { geo: box(0.28, 0.16, 0.2), color: "#C47A4A", y: 0.18 },
  ]);
}

function padGeo(): THREE.BufferGeometry {
  return mergeParts([{ geo: cyl(0.42, 0.04, 10), color: "#7ED07A", y: 0.04 }]);
}

function millMesh(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.7, 0.36, 0.45), color: "#A67C52", y: 0.32 },
    { geo: cyl(0.16, 0.08, 8), color: "#D9D2C8", y: 0.54 },
    { geo: box(0.34, 0.06, 0.16), color: "#E6C56A", x: 0.28, y: 0.4 },
  ]);
}

function forgeMesh(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.55, 0.5, 0.5), color: "#5C4636", y: 0.32 },
    { geo: box(0.22, 0.16, 0.08), color: "#E07A3D", z: 0.26, y: 0.28 },
    { geo: cyl(0.08, 0.22, 6), color: "#C4A06A", y: 0.66 },
  ]);
}

function grillMesh(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.7, 0.28, 0.4), color: "#8C5430", y: 0.32 },
    { geo: box(0.5, 0.06, 0.28), color: "#2A2724", y: 0.48 },
    { geo: box(0.08, 0.2, 0.08), color: "#C4A06A", x: -0.28, y: 0.2 },
    { geo: box(0.08, 0.2, 0.08), color: "#C4A06A", x: 0.28, y: 0.2 },
  ]);
}

function counterMesh(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.9, 0.32, 0.42), color: "#C4A06A", y: 0.36 },
    { geo: box(0.16, 0.1, 0.16), color: "#7DDE6A", x: 0.24, y: 0.56 },
    { geo: cyl(0.1, 0.04, 8), color: "#F7F4EC", x: -0.2, y: 0.54 },
  ]);
}

function deckMesh(): THREE.BufferGeometry {
  return mergeParts([{ geo: box(1.15, 0.08, 0.85), color: "#A67C52", y: 0.04 }]);
}

function rawMesh(): THREE.BufferGeometry {
  return mergeParts([{ geo: sphere(0.12), color: "#E07A6A", y: 0.12, sx: 1.4, sy: 0.7, sz: 0.9 }]);
}

function billMesh(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.22, 0.04, 0.12), color: "#7DDE6A", y: 0.06 },
    { geo: box(0.2, 0.04, 0.1), color: "#3E9A62", y: 0.1 },
  ]);
}

function smokeMesh(): THREE.BufferGeometry {
  return mergeParts([{ geo: sphere(0.16), color: "#F7F4EC", y: 0.9, sx: 1, sy: 0.7, sz: 1 }]);
}

function axeGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.08, 0.08, 0.62), color: "#8C5A32", z: 0.05 },
    { geo: box(0.34, 0.18, 0.06), color: "#D9D2C8", z: 0.34, y: 0.04 },
  ]);
}

function extraGeos(): Record<string, THREE.BufferGeometry> {
  return {
    scrub: scrubGeo(),
    stone: stonePileGeo(),
    pit: pitGeo(),
    kiln: kilnGeo(),
    cart: cartGeo(),
    brine: brineGeo(),
    kelp: kelpGeo(),
    pan: panGeo(),
    line: lineGeo(),
    crate: crateStationGeo(),
    post: postGeo(),
    fruit: fruitTreeGeo(),
    press: pressGeo(),
    stall: stallGeo(),
    grove: treeGeo(),
    beast: beastGeo(0),
    beast1: beastGeo(1),
    beast2: beastGeo(2),
    wood: logGeo(),
    meat: meatGeo(),
    coin: coinGeo(),
    pile: pileGeo(),
    pad: padGeo(),
    grill: grillMesh(),
    mill: millMesh(),
    forge: forgeMesh(),
    counter: counterMesh(),
    deck: deckMesh(),
    raw: rawMesh(),
    bill: billMesh(),
    smoke: smokeMesh(),
  };
}

function grassGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: cone(0.08, 0.28, 4), color: "#8FB456", y: 0.14 },
    { geo: cone(0.06, 0.22, 4), color: "#6E9440", x: 0.08, y: 0.1 },
  ]);
}

function signTexture(text: string, lit: boolean): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");
  ctx.fillStyle = lit ? "#F6EFE2" : "#6E5A42";
  ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = lit ? "#1C1915" : "#3C3228";
  ctx.font = "700 42px Nunito, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 12), 128, 50);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const LAMBERT = new THREE.MeshLambertMaterial({ vertexColors: true });

function mesh(geo: THREE.BufferGeometry, shadow: boolean): THREE.Mesh {
  const item = new THREE.Mesh(geo, LAMBERT);
  item.castShadow = shadow;
  item.receiveShadow = shadow;
  return item;
}

/**
 * Chunky isometric yard. One Lambert material, vertex colors, no postprocessing.
 * Props are merged so a phone stays under the draw-call budget.
 */
export class WebglYard implements YardRenderer {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, VIEW.near, VIEW.far);
  private host!: HTMLElement;
  private builtFor = "";
  private tier: "high" | "low" = "low";
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private objects = new Map<string, THREE.Object3D>();
  private discMesh!: THREE.InstancedMesh;
  private discIds: string[] = [];
  private signMat!: THREE.MeshBasicMaterial;
  private signLit = false;
  private signText = "";
  private phone = false;
  private geos: THREE.BufferGeometry[] = [];
  private kindGeos: Record<string, THREE.BufferGeometry> = {};

  mount(host: HTMLElement): void {
    this.host = host;
    this.phone = window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 520;
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.phone,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor("#C9D98A", 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = "yard";
    host.prepend(this.renderer.domElement);
    this.hemi = new THREE.HemisphereLight("#FFF6E4", "#8AA05A", 0.95);
    this.sun = new THREE.DirectionalLight("#FFF8EC", 1.2);
    this.sun.position.set(10, 16, 8);
    this.scene.add(this.hemi, this.sun);
    const eye = cameraEye();
    this.camera.position.set(eye[0], eye[1], eye[2]);
    this.camera.lookAt(0, VIEW.lookY, 0);
  }

  setTier(tier: "high" | "low"): void {
    this.tier = tier;
    // The pause menu can ask for a tier before mount finishes.
    if (!this.renderer) return;
    const shadows = tier === "high";
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(1024, 1024);
      this.sun.shadow.camera.near = 1;
      this.sun.shadow.camera.far = 40;
      this.sun.shadow.camera.left = -12;
      this.sun.shadow.camera.right = 12;
      this.sun.shadow.camera.top = 12;
      this.sun.shadow.camera.bottom = -12;
    }
  }

  resize(width: number, height: number): void {
    const aspect = width / Math.max(1, height);
    const halfH = VIEW.frustumHeight / 2;
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
    const dprCap = this.tier === "low" || this.phone ? 1.5 : 2;
    let dpr = Math.min(window.devicePixelRatio || 1, this.tier === "low" ? 1 : dprCap);
    if (this.tier === "low") dpr = 1;
    let bw = Math.floor(width * dpr);
    let bh = Math.floor(height * dpr);
    if (this.phone) {
      const scale = Math.min(1, 720 / Math.max(1, Math.min(bw, bh)), 1280 / Math.max(1, Math.max(bw, bh)));
      bw = Math.max(1, Math.floor(bw * scale));
      bh = Math.max(1, Math.floor(bh * scale));
    }
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(bw, bh, false);
    this.renderer.domElement.style.width = `${width}px`;
    this.renderer.domElement.style.height = `${height}px`;
  }

  sync(snapshot: RenderSnapshot): void {
    const eye = cameraEye();
    this.camera.position.set(eye[0], eye[1], eye[2]);
    this.camera.lookAt(look.x, VIEW.lookY, look.z);
    if (this.builtFor !== snapshot.mapId) this.build(snapshot);
    this.ensureActors(snapshot);
    this.renderer.setClearColor(snapshot.palette.letter, 1);
    const pulse = snapshot.reduced ? 1 : 1 + Math.sin(snapshot.time / 160) * 0.08;
    this.discIds.forEach((id, index) => {
      const prop = snapshot.props.find((item) => item.id === id);
      const matrix = new THREE.Matrix4();
      if (!prop || prop.disc === "off") {
        matrix.makeScale(0, 0, 0);
      } else {
        const hot = prop.disc === "hot";
        const s = (hot ? 0.72 : 0.5) * (hot ? pulse : 1);
        matrix.makeScale(s, s, s);
        matrix.setPosition(prop.x, 0.04, prop.z);
        this.discMesh.setColorAt(index, hot ? HOT : IDLE);
      }
      this.discMesh.setMatrixAt(index, matrix);
    });
    this.discMesh.instanceMatrix.needsUpdate = true;
    if (this.discMesh.instanceColor) this.discMesh.instanceColor.needsUpdate = true;

    for (const prop of snapshot.props) this.placeProp(prop, snapshot);
    this.placePeople(snapshot);
    this.placeAxe(snapshot);
    if (this.signText !== snapshot.sign || this.signLit !== snapshot.signLit) {
      this.signText = snapshot.sign;
      this.signLit = snapshot.signLit;
      this.signMat.map?.dispose();
      this.signMat.map = signTexture(snapshot.sign, snapshot.signLit);
      this.signMat.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
  }

  stats(): { calls: number; triangles: number } {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  dispose(): void {
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    for (const geo of this.geos) geo.dispose();
    this.signMat?.map?.dispose();
    this.signMat?.dispose();
  }

  private track(geo: THREE.BufferGeometry): THREE.BufferGeometry {
    this.geos.push(geo);
    return geo;
  }

  private build(snapshot: RenderSnapshot): void {
    for (const child of [...this.scene.children]) {
      if (child !== this.hemi && child !== this.sun) this.scene.remove(child);
    }
    this.objects.clear();
    const shadow = this.tier === "high";
    const ground = mesh(this.track(new THREE.CircleGeometry(16, 20)), false);
    ground.geometry = paint(ground.geometry as THREE.BufferGeometry, snapshot.palette.meadow);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    const pad = mesh(this.track(new THREE.CircleGeometry(3.45, 20)), false);
    pad.geometry = paint(pad.geometry as THREE.BufferGeometry, snapshot.palette.pad);
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0;
    pad.receiveShadow = true;
    const water = mesh(this.track(new THREE.CircleGeometry(3.1, 16)), false);
    water.geometry = paint(water.geometry as THREE.BufferGeometry, snapshot.palette.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set(2.7, -0.02, 2.5);
    this.scene.add(ground, pad, water);

    this.addFence(snapshot, shadow);
    this.addDressing(snapshot, shadow);

    const reed = this.track(reedGeo());
    const clay = this.track(clayGeo());
    const weave1 = this.track(weaveGeo(1));
    const weave2 = this.track(weaveGeo(2));
    const bench = this.track(benchGeo());
    const skiff = this.track(boatGeo(1));
    const barge = this.track(boatGeo(2));
    const extras = extraGeos();
    for (const geo of Object.values(extras)) this.track(geo);
    this.kindGeos = {
      reed,
      clay,
      weave: weave1,
      bench,
      boat: skiff,
      gate: weave1,
      ...extras,
    };
    const boss = this.track(snapshot.ring ? parkaGeo() : person("#F6EFE2", "#C43B3B"));
    for (const prop of snapshot.props) {
      let geo = extras[prop.kind] ?? reed;
      if (prop.kind === "reed") geo = reed;
      if (prop.kind === "clay") geo = clay;
      if (prop.kind === "weave") geo = weave1;
      if (prop.kind === "bench") geo = bench;
      if (prop.kind === "boat") geo = skiff;
      if (prop.kind === "gate") {
        this.addGate(snapshot, shadow);
        continue;
      }
      const item = mesh(geo, shadow);
      item.userData.geo1 = prop.kind === "weave" ? weave1 : prop.kind === "boat" ? skiff : geo;
      item.userData.geo2 = prop.kind === "weave" ? weave2 : prop.kind === "boat" ? barge : geo;
      if (prop.kind === "beast") {
        item.userData.full = extras.beast;
        item.userData.mid = extras.beast1;
        item.userData.low = extras.beast2;
      }
      this.scene.add(item);
      this.objects.set(prop.id, item);
    }
    const bossMesh = mesh(boss, shadow);
    this.scene.add(bossMesh);
    this.objects.set("boss", bossMesh);
    if (snapshot.ring) this.addHunterGear(bossMesh, shadow);
    const axe = mesh(this.track(axeGeo()), shadow);
    this.scene.add(axe);
    this.objects.set("axe", axe);
    for (let i = 0; i < 5; i += 1) {
      const hand = mesh(this.track(person(snapshot.hands[i]?.color ?? "#C43838", "#F7F4EC")), shadow);
      hand.visible = false;
      this.scene.add(hand);
      this.objects.set(`hand${i}`, hand);
    }

    this.discIds = snapshot.props.map((prop) => prop.id);
    const discGeo = new THREE.CircleGeometry(1, 16);
    discGeo.rotateX(-Math.PI / 2);
    this.track(discGeo);
    this.discMesh = new THREE.InstancedMesh(
      discGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
      this.discIds.length,
    );
    this.discMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.discMesh.frustumCulled = false;
    this.scene.add(this.discMesh);
    this.builtFor = snapshot.mapId;
    this.signText = "";
  }

  private addFence(snapshot: RenderSnapshot, shadow: boolean): void {
    const camp = snapshot.mapId === "camp";
    const radius = camp ? 2.48 : 3.55;
    const h = camp ? 0.95 : 0.62;
    const count = camp ? 28 : 18;
    const geo = this.track(paint(box(camp ? 0.12 : 0.16, h, 0.1), camp ? "#C4A06A" : snapshot.palette.wood));
    const posts: THREE.Vector3[] = [];
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2;
      let da = Math.abs(a);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < (camp ? 0.38 : 0.46)) continue;
      posts.push(new THREE.Vector3(Math.sin(a) * radius, h / 2, -Math.cos(a) * radius));
    }
    const inst = new THREE.InstancedMesh(geo, LAMBERT, posts.length);
    posts.forEach((pos, index) => {
      const matrix = new THREE.Matrix4().setPosition(pos);
      inst.setMatrixAt(index, matrix);
    });
    inst.castShadow = shadow;
    this.scene.add(inst);
  }

  private addDressing(snapshot: RenderSnapshot, shadow: boolean): void {
    const kinds = [
      { kind: "tree", geo: this.track(treeGeo()) },
      { kind: "rock", geo: this.track(rockGeo()) },
      { kind: "grass", geo: this.track(grassGeo()) },
    ] as const;
    for (const kind of kinds) {
      const items = snapshot.dressing.filter((item) => item.kind === kind.kind);
      if (!items.length) continue;
      const keep = this.tier === "low" ? items.slice(0, Math.ceil(items.length / 2)) : items;
      const inst = new THREE.InstancedMesh(kind.geo, LAMBERT, keep.length);
      keep.forEach((item, index) => {
        const matrix = new THREE.Matrix4().makeScale(item.scale, item.scale, item.scale);
        matrix.setPosition(item.x, 0, item.z);
        inst.setMatrixAt(index, matrix);
      });
      inst.castShadow = shadow && kind.kind === "tree";
      this.scene.add(inst);
    }
  }

  private addGate(snapshot: RenderSnapshot, shadow: boolean): void {
    const group = new THREE.Group();
    const post = this.track(paint(box(0.16, 1.05, 0.16), snapshot.mapId === "camp" ? "#C43838" : snapshot.palette.wood));
    const left = mesh(post, shadow);
    const right = mesh(post, shadow);
    left.position.set(-0.55, 0.52, 0);
    right.position.set(0.55, 0.52, 0);
    const beam = mesh(this.track(paint(box(1.3, 0.1, 0.1), snapshot.mapId === "camp" ? "#C43838" : "#A8653A")), shadow);
    beam.position.set(0, 1.02, 0);
    this.signMat = new THREE.MeshBasicMaterial({ map: signTexture(snapshot.sign || " ", false) });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.42), this.signMat);
    board.position.set(0, 0.72, 0.08);
    board.visible = snapshot.sign.length > 0;
    group.add(left, right, beam, board);
    group.userData.left = left;
    group.userData.right = right;
    group.userData.beam = beam;
    this.scene.add(group);
    this.objects.set("gate", group);
  }

  private placeProp(prop: SnapshotProp, snapshot: RenderSnapshot): void {
    const obj = this.objects.get(prop.id);
    if (!obj) return;
    if (prop.kind === "gate") {
      const left = obj.userData.left as THREE.Object3D;
      const right = obj.userData.right as THREE.Object3D;
      const beam = obj.userData.beam as THREE.Object3D;
      const open = snapshot.gateOpen ? 0.45 : 0;
      left.position.x = -0.55 - open;
      right.position.x = 0.55 + open;
      beam.visible = !snapshot.gateOpen;
      obj.position.set(prop.x, 0, prop.z);
      obj.visible = true;
      return;
    }
    obj.visible = prop.stage > 0;
    if (prop.stage <= 0) return;
    const meshObj = obj as THREE.Mesh;
    if (prop.kind === "weave" || prop.kind === "boat") {
      const next = prop.stage >= 2 ? meshObj.userData.geo2 : meshObj.userData.geo1;
      if (next && meshObj.geometry !== next) meshObj.geometry = next as THREE.BufferGeometry;
    }
    if (prop.kind === "beast" && meshObj.userData.full) {
      const next = prop.scale > 0.67 ? meshObj.userData.full : prop.scale > 0.34 ? meshObj.userData.mid : meshObj.userData.low;
      if (next && meshObj.geometry !== next) meshObj.geometry = next as THREE.BufferGeometry;
    }
    let y = 0;
    let sx = 1;
    let sy = 1;
    let sz = 1;
    if (prop.kind === "smoke") y = 0.15 + Math.sin(snapshot.time / 180) * 0.12;
    if (prop.kind === "reed" || prop.kind === "clay" || prop.kind === "grove") {
      sy = Math.max(0.2, prop.scale);
    }
    if (prop.kind === "pile") {
      const bulk = 0.85 + prop.scale * 0.4;
      sx = bulk;
      sy = bulk;
      sz = bulk;
    }
    if (prop.kind === "boat" || prop.kind === "cart" || prop.kind === "stall") {
      const slide = snapshot.boatAway * 2.6;
      obj.position.set(prop.x + slide * 0.6, 0.02 + Math.sin(snapshot.boatAway * Math.PI) * 0.05, prop.z + slide * 0.7);
    } else {
      obj.position.set(prop.x, y, prop.z);
    }
    const shake = prop.shake ? Math.sin(snapshot.time / 18) * 0.12 : 0;
    obj.rotation.y = shake;
    obj.scale.set(sx, sy, sz);
  }

  private placePeople(snapshot: RenderSnapshot): void {
    const boss = this.objects.get("boss");
    if (boss) {
      boss.position.set(snapshot.boss.x, 0, snapshot.boss.z);
      boss.rotation.z = Math.sin(snapshot.boss.swing * Math.PI) * 0.45;
      boss.rotation.y = snapshot.boss.facing;
      const pack = boss.getObjectByName("pack");
      const cash = boss.getObjectByName("cash");
      const goods = snapshot.carry.raw + snapshot.carry.cooked;
      if (pack) {
        pack.visible = goods > 0;
        pack.scale.y = 0.4 + Math.min(4, goods) * 0.35;
      }
      if (cash) {
        cash.visible = snapshot.carry.money > 0;
        cash.scale.y = 0.35 + Math.min(10, snapshot.carry.money) * 0.12;
      }
    }
    for (let i = 0; i < 5; i += 1) {
      const hand = this.objects.get(`hand${i}`);
      const data = snapshot.hands[i];
      if (!hand) continue;
      if (!data) {
        hand.visible = false;
        continue;
      }
      hand.visible = true;
      hand.position.set(data.x, 0, data.z);
      const bob = data.walking && !snapshot.reduced ? Math.sin(snapshot.time / 90 + i) * 0.06 : 0;
      hand.position.y = bob;
      hand.rotation.y = data.walking ? 0.4 : -0.5;
      hand.scale.setScalar(1.7 / 1.9);
    }
  }

  private addHunterGear(boss: THREE.Object3D, shadow: boolean): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.5, 24),
      new THREE.MeshBasicMaterial({ color: 0x3ee0e0, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    const pack = mesh(this.track(paint(box(0.22, 0.2, 0.14), "#E07A6A")), shadow);
    pack.name = "pack";
    pack.position.set(0, 0.78, -0.22);
    const cash = mesh(this.track(paint(box(0.16, 0.24, 0.1), "#7DDE6A")), shadow);
    cash.name = "cash";
    cash.position.set(0.02, 1.05, -0.2);
    cash.visible = false;
    pack.visible = false;
    boss.add(ring, pack, cash);
  }

  /** Drops appear after the yard is built, so a missing id grows a mesh here. */
  private ensureActors(snapshot: RenderSnapshot): void {
    const shadow = this.tier === "high";
    const want = new Set(snapshot.props.map((prop) => prop.id));
    for (const prop of snapshot.props) {
      if (this.objects.has(prop.id) || prop.kind === "gate") continue;
      const geo = this.kindGeos[prop.kind] ?? this.kindGeos.grove;
      if (!geo) continue;
      const item = mesh(geo, shadow);
      this.scene.add(item);
      this.objects.set(prop.id, item);
    }
    for (const [id, obj] of this.objects) {
      if (id === "boss" || id === "axe" || id === "gate" || id.startsWith("hand")) continue;
      if (!want.has(id)) {
        this.scene.remove(obj);
        this.objects.delete(id);
      }
    }
  }

  private placeAxe(snapshot: RenderSnapshot): void {
    const axe = this.objects.get("axe");
    if (!axe) return;
    if (!snapshot.axe) {
      axe.visible = false;
      return;
    }
    axe.visible = true;
    axe.position.set(snapshot.axe.x, 0.7, snapshot.axe.z);
    axe.rotation.y = -snapshot.axe.angle;
  }
}
