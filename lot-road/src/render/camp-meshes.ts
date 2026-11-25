import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Chunky camp meshes. People use round spheres, animals use faceted
 * icosahedrons, and stations stay low-poly so a phone stays under ~12k tris.
 */

interface Part {
  geo: THREE.BufferGeometry;
  color: string;
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r: number, h: number, n = 6) => new THREE.CylinderGeometry(r, r, h, n);
const cone = (r: number, h: number, n = 6) => new THREE.ConeGeometry(r, h, n);
const ico = (r: number, detail = 0) => new THREE.IcosahedronGeometry(r, detail);
const ball = (r: number, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);

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

function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map((part) => {
    // Icosahedrons are non-indexed and boxes are indexed. Merge needs one kind.
    const source = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    const geo = source.clone();
    geo.applyMatrix4(new THREE.Matrix4().makeScale(part.sx ?? 1, part.sy ?? 1, part.sz ?? 1));
    if (part.rx) geo.applyMatrix4(new THREE.Matrix4().makeRotationX(part.rx));
    if (part.ry) geo.applyMatrix4(new THREE.Matrix4().makeRotationY(part.ry));
    if (part.rz) geo.applyMatrix4(new THREE.Matrix4().makeRotationZ(part.rz));
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(part.x ?? 0, part.y ?? 0, part.z ?? 0));
    return paint(geo, part.color);
  });
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error("Could not merge a camp mesh");
  merged.computeVertexNormals();
  return merged;
}

const COAT = "#8EC8F2";
const TRIM = "#F7FBFD";
const SKIN = "#F6C9A5";
const NAVY = "#243E73";
const BOOT = "#8B5A3C";
const MITT = "#6B4632";
const WOOD = "#C4A06A";
const WOOD_DARK = "#8C5A32";

/** Hooded parka. `held` is the thing in the hands: axe, log, meat, plank, or bar. */
export function parka(coat = COAT, held: "axe" | "log" | "meat" | "plank" | "bar" | "none" = "none"): THREE.BufferGeometry {
  const hoodRing = new THREE.TorusGeometry(0.2, 0.055, 6, 12);
  const parts: Part[] = [
    { geo: cyl(0.1, 0.24, 8), color: BOOT, x: -0.12, y: 0.12 },
    { geo: cyl(0.1, 0.24, 8), color: BOOT, x: 0.12, y: 0.12 },
    { geo: cyl(0.07, 0.2, 6), color: NAVY, x: -0.1, y: 0.32 },
    { geo: cyl(0.07, 0.2, 6), color: NAVY, x: 0.1, y: 0.32 },
    { geo: ball(0.28, 12, 8), color: coat, y: 0.68, sx: 1.05, sy: 1.15, sz: 0.78 },
    { geo: cyl(0.22, 0.07, 10), color: TRIM, y: 0.42, sx: 1.2, sz: 0.9 },
    { geo: cyl(0.06, 0.34, 6), color: coat, x: -0.32, y: 0.72 },
    { geo: cyl(0.06, 0.34, 6), color: coat, x: 0.32, y: 0.72 },
    { geo: ball(0.08), color: MITT, x: -0.32, y: 0.5 },
    { geo: ball(0.08), color: MITT, x: 0.34, y: 0.48, z: 0.12 },
    { geo: ball(0.27, 12, 9), color: coat, y: 1.24, z: -0.02 },
    { geo: ball(0.19, 12, 9), color: SKIN, y: 1.16, z: 0.16 },
    { geo: hoodRing, color: TRIM, y: 1.16, z: 0.12 },
    { geo: ball(0.04, 6, 5), color: "#F4A7B5", x: -0.08, y: 1.08, z: 0.3 },
    { geo: ball(0.04, 6, 5), color: "#F4A7B5", x: 0.08, y: 1.08, z: 0.3 },
    { geo: ball(0.035, 6, 5), color: "#1C1915", x: -0.06, y: 1.18, z: 0.32 },
    { geo: ball(0.035, 6, 5), color: "#1C1915", x: 0.06, y: 1.18, z: 0.32 },
    { geo: box(0.06, 0.1, 0.03), color: "#5C6A78", y: 0.74, z: 0.2 },
  ];
  if (held === "axe") {
    parts.push(
      { geo: cyl(0.04, 0.62, 6), color: WOOD_DARK, x: 0.4, y: 0.55, z: 0.16 },
      { geo: box(0.22, 0.16, 0.05), color: "#C5CCD1", x: 0.46, y: 0.28, z: 0.18 },
    );
  } else if (held === "log") {
    parts.push({ geo: cyl(0.1, 0.72, 6), color: WOOD, y: 1.08, rz: Math.PI / 2 });
  } else if (held === "meat") {
    parts.push(
      { geo: ball(0.1), color: "#E15B55", y: 0.5, z: 0.28, sx: 1.3, sy: 0.55, sz: 0.9 },
      { geo: box(0.04, 0.08, 0.12), color: "#F7F4EC", y: 0.52, z: 0.3 },
    );
  } else if (held === "plank") {
    parts.push({ geo: box(0.36, 0.08, 0.12), color: WOOD, y: 0.52, z: 0.24 });
  } else if (held === "bar") {
    parts.push({ geo: box(0.34, 0.08, 0.1), color: "#8A939C", y: 0.52, z: 0.24 });
  }
  return mergeParts(parts);
}

function meatBits(wounds: number, y: number, z: number): Part[] {
  const parts: Part[] = [];
  if (wounds > 0) parts.push({ geo: ico(0.09), color: "#E07A6A", x: 0.16, y, z });
  if (wounds > 1) parts.push({ geo: ico(0.07), color: "#C43838", x: -0.14, y: y - 0.05, z: z - 0.18 });
  return parts;
}

export function beastGeo(wounds: number): THREE.BufferGeometry {
  return mergeParts([
    { geo: ico(0.42, 1), color: "#F4EDE4", y: 0.58, sx: 0.9, sy: 0.78, sz: 1.25 },
    { geo: ico(0.24, 1), color: "#F7F4EC", z: 0.5, y: 0.82 },
    { geo: ball(0.08, 6, 5), color: "#F4EDE4", x: -0.14, y: 1.08, z: 0.46 },
    { geo: ball(0.08, 6, 5), color: "#F4EDE4", x: 0.14, y: 1.08, z: 0.46 },
    { geo: ico(0.1, 0), color: "#E7DDD2", z: 0.74, y: 0.72, sx: 0.85, sy: 0.65, sz: 1.35 },
    { geo: ball(0.045, 6, 4), color: "#1C1915", z: 0.88, y: 0.7 },
    { geo: ball(0.03, 5, 4), color: "#1C1915", x: -0.08, z: 0.68, y: 0.88 },
    { geo: ball(0.03, 5, 4), color: "#1C1915", x: 0.08, z: 0.68, y: 0.88 },
    { geo: cyl(0.08, 0.36, 6), color: "#F7F4EC", x: -0.2, z: 0.26, y: 0.18 },
    { geo: cyl(0.08, 0.36, 6), color: "#F7F4EC", x: 0.2, z: 0.26, y: 0.18 },
    { geo: cyl(0.08, 0.36, 6), color: "#F7F4EC", x: -0.2, z: -0.3, y: 0.18 },
    { geo: cyl(0.08, 0.36, 6), color: "#F7F4EC", x: 0.2, z: -0.3, y: 0.18 },
    { geo: ball(0.09, 6, 4), color: "#EFE6DC", x: -0.2, z: 0.26, y: 0.04, sy: 0.45 },
    { geo: ball(0.09, 6, 4), color: "#EFE6DC", x: 0.2, z: 0.26, y: 0.04, sy: 0.45 },
    { geo: ball(0.09, 6, 4), color: "#EFE6DC", x: -0.2, z: -0.3, y: 0.04, sy: 0.45 },
    { geo: ball(0.09, 6, 4), color: "#EFE6DC", x: 0.2, z: -0.3, y: 0.04, sy: 0.45 },
    ...meatBits(wounds, 0.7, 0.05),
  ]);
}

export function wolfGeo(wounds = 0): THREE.BufferGeometry {
  return mergeParts([
    { geo: ico(0.28, 1), color: "#7E93A8", y: 0.46, sx: 0.7, sy: 0.75, sz: 1.45 },
    { geo: ico(0.14, 1), color: "#5E7388", z: 0.48, y: 0.58 },
    { geo: cone(0.05, 0.16, 4), color: "#4E6274", x: -0.07, y: 0.78, z: 0.46 },
    { geo: cone(0.05, 0.16, 4), color: "#4E6274", x: 0.07, y: 0.78, z: 0.46 },
    { geo: ico(0.06), color: "#3E4E60", z: 0.64, y: 0.52, sx: 0.7, sy: 0.6, sz: 1.3 },
    { geo: ico(0.025), color: "#F2E6A8", x: -0.04, z: 0.58, y: 0.62 },
    { geo: ico(0.025), color: "#F2E6A8", x: 0.04, z: 0.58, y: 0.62 },
    { geo: cyl(0.04, 0.28, 5), color: "#6E8498", x: -0.1, z: 0.18, y: 0.14 },
    { geo: cyl(0.04, 0.28, 5), color: "#6E8498", x: 0.1, z: 0.18, y: 0.14 },
    { geo: cyl(0.04, 0.28, 5), color: "#6E8498", x: -0.1, z: -0.22, y: 0.14 },
    { geo: cyl(0.04, 0.28, 5), color: "#6E8498", x: 0.1, z: -0.22, y: 0.14 },
    { geo: ico(0.08), color: "#4E6274", z: -0.52, y: 0.42, sx: 0.45, sy: 0.45, sz: 1.4 },
    ...meatBits(wounds, 0.55, 0.05),
  ]);
}

export function sealGeo(wounds = 0): THREE.BufferGeometry {
  return mergeParts([
    { geo: ico(0.32, 1), color: "#8A97A3", y: 0.24, sx: 1.15, sy: 0.55, sz: 1.45 },
    { geo: ico(0.22, 0), color: "#D5DDE3", y: 0.3, z: 0.05, sx: 0.85, sy: 0.4, sz: 0.9 },
    { geo: ico(0.14, 1), color: "#9AA6B0", z: 0.42, y: 0.36 },
    { geo: ico(0.035), color: "#1C1915", x: -0.05, z: 0.54, y: 0.4 },
    { geo: ico(0.035), color: "#1C1915", x: 0.05, z: 0.54, y: 0.4 },
    { geo: ico(0.03), color: "#1C1915", z: 0.56, y: 0.32 },
    { geo: ico(0.08), color: "#6E7C88", x: -0.32, y: 0.12, sx: 1.4, sy: 0.35, sz: 0.8 },
    { geo: ico(0.08), color: "#6E7C88", x: 0.32, y: 0.12, sx: 1.4, sy: 0.35, sz: 0.8 },
    { geo: ico(0.07), color: "#6E7C88", z: -0.42, y: 0.14, sx: 0.5, sy: 0.35, sz: 1.1 },
    ...meatBits(wounds, 0.36, 0.05),
  ]);
}

export function snowTreeGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: cyl(0.09, 0.24, 6), color: WOOD_DARK, y: 0.12 },
    { geo: cone(0.55, 0.52, 8), color: "#2F7A48", y: 0.42 },
    { geo: cyl(0.48, 0.09, 8), color: "#F7FBFD", y: 0.58 },
    { geo: cone(0.4, 0.44, 8), color: "#3E9A5C", y: 0.8 },
    { geo: cyl(0.34, 0.08, 8), color: "#F7FBFD", y: 0.94 },
    { geo: cone(0.26, 0.38, 8), color: "#4EAE68", y: 1.14 },
    { geo: cone(0.16, 0.34, 6), color: "#F4F7F8", y: 1.42 },
  ]);
}

export function oreGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.42, 0.28, 0.36), color: "#5E666E", y: 0.16 },
    { geo: box(0.24, 0.2, 0.22), color: "#4A5158", x: 0.16, y: 0.22, z: 0.06 },
    { geo: box(0.06, 0.22, 0.06), color: "#E07A3D", y: 0.2, rz: 0.4 },
    { geo: box(0.05, 0.16, 0.05), color: "#F2B134", x: 0.1, y: 0.18, rz: -0.5 },
  ]);
}

export function logGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: cyl(0.12, 0.46, 6), color: WOOD, y: 0.14, rz: Math.PI / 2 },
    { geo: cyl(0.12, 0.04, 6), color: "#E6D2A8", x: 0.22, y: 0.14, rz: Math.PI / 2 },
  ]);
}

export function rawMeatGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.28, 0.12, 0.22), color: "#E15B55", y: 0.08 },
    { geo: box(0.06, 0.13, 0.2), color: "#F7F4EC", y: 0.08 },
  ]);
}

export function billStackGeo(): THREE.BufferGeometry {
  const layers: Part[] = [];
  for (let i = 0; i < 7; i += 1) {
    layers.push({
      geo: box(0.34, 0.045, 0.2),
      color: i % 2 ? "#3E9A62" : "#8FE07A",
      y: 0.04 + i * 0.05,
    });
  }
  layers.push({ geo: box(0.08, 0.38, 0.22), color: "#A67C52", y: 0.2 });
  return mergeParts(layers);
}

export function goodsStackGeo(color: string): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.22, 0.1, 0.16), color, y: 0.06 },
    { geo: box(0.18, 0.08, 0.14), color, y: 0.14 },
  ]);
}

export function grillGeo(): THREE.BufferGeometry {
  const bars: Part[] = [];
  for (let i = -2; i <= 2; i += 1) {
    bars.push({ geo: box(0.56, 0.025, 0.03), color: "#3A3632", y: 0.48, z: i * 0.08 });
    bars.push({ geo: box(0.03, 0.025, 0.42), color: "#2E2A27", y: 0.5, x: i * 0.1 });
  }
  return mergeParts([
    { geo: box(0.92, 0.05, 0.72), color: "#E4E7EA", y: 0.025 },
    { geo: cyl(0.05, 0.3, 6), color: "#2A2724", x: -0.3, z: -0.22, y: 0.18 },
    { geo: cyl(0.05, 0.3, 6), color: "#2A2724", x: 0.3, z: -0.22, y: 0.18 },
    { geo: cyl(0.05, 0.3, 6), color: "#2A2724", x: -0.3, z: 0.22, y: 0.18 },
    { geo: cyl(0.05, 0.3, 6), color: "#2A2724", x: 0.3, z: 0.22, y: 0.18 },
    { geo: box(0.7, 0.08, 0.52), color: "#2A2724", y: 0.36 },
    { geo: ball(0.055, 6, 4), color: "#E07A3D", x: -0.12, y: 0.4, z: 0.04 },
    { geo: ball(0.045, 6, 4), color: "#F2B134", x: 0.12, y: 0.4, z: -0.05 },
    { geo: ball(0.04, 6, 4), color: "#C43838", x: 0.02, y: 0.39, z: 0.08 },
    ...bars,
    { geo: ball(0.15, 8, 6), color: "#E15B55", y: 0.58, sx: 1.2, sy: 0.36, sz: 0.85 },
    { geo: cyl(0.028, 0.18, 5), color: "#F7F4EC", x: 0.16, y: 0.58, rz: 1.1 },
    { geo: ico(0.09), color: "#D5DDE3", y: 0.82, sx: 1.3, sy: 0.7, sz: 1 },
    { geo: ico(0.06), color: "#EEF3F6", y: 1.0, x: 0.05 },
  ]);
}

export function millGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.9, 0.08, 0.7), color: WOOD, y: 0.06 },
    { geo: box(0.1, 0.55, 0.1), color: WOOD_DARK, x: -0.28, y: 0.36 },
    { geo: box(0.1, 0.55, 0.1), color: WOOD_DARK, x: 0.28, y: 0.36 },
    { geo: cyl(0.12, 0.55, 6), color: "#D7B07A", y: 0.32, rz: Math.PI / 2 },
    { geo: cyl(0.22, 0.06, 8), color: "#C5CCD1", x: 0.22, y: 0.4, rz: Math.PI / 2 },
  ]);
}

export function forgeGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.7, 0.1, 0.6), color: "#C5CCD1", y: 0.06 },
    { geo: box(0.5, 0.28, 0.46), color: "#6E767E", y: 0.24 },
    { geo: box(0.36, 0.28, 0.34), color: "#5C656E", y: 0.5 },
    { geo: box(0.24, 0.28, 0.24), color: "#4E565E", y: 0.76 },
    { geo: box(0.18, 0.14, 0.08), color: "#E07A3D", z: 0.22, y: 0.32 },
    { geo: box(0.22, 0.12, 0.16), color: "#3A3E44", z: 0.36, y: 0.16 },
    { geo: box(0.1, 0.1, 0.16), color: "#2A2724", z: 0.46, y: 0.2 },
  ]);
}

export function counterGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: cyl(0.07, 1.15, 6), color: WOOD_DARK, x: -0.52, z: -0.28, y: 0.58 },
    { geo: cyl(0.07, 1.15, 6), color: WOOD_DARK, x: 0.52, z: -0.28, y: 0.58 },
    { geo: cyl(0.07, 1.15, 6), color: WOOD_DARK, x: -0.52, z: 0.28, y: 0.58 },
    { geo: cyl(0.07, 1.15, 6), color: WOOD_DARK, x: 0.52, z: 0.28, y: 0.58 },
    { geo: box(1.15, 0.55, 0.08), color: WOOD, y: 0.4, z: 0.28 },
    { geo: box(1.22, 0.1, 0.68), color: WOOD, y: 0.72 },
    { geo: box(1.32, 0.07, 0.52), color: "#A67C52", y: 1.22, z: -0.12, rx: -0.4 },
    { geo: box(1.32, 0.07, 0.52), color: "#A67C52", y: 1.22, z: 0.12, rx: 0.4 },
    { geo: box(1.2, 0.06, 0.4), color: "#F7FBFD", y: 1.3, z: -0.14, rx: -0.4 },
    { geo: box(1.05, 0.05, 0.28), color: "#F7FBFD", y: 1.28, z: 0.16, rx: 0.4 },
    { geo: box(0.36, 0.22, 0.24), color: "#E6B325", x: 0.22, y: 0.9 },
    { geo: box(0.22, 0.04, 0.12), color: "#F7F4EC", x: 0.22, y: 1.02 },
    { geo: box(0.28, 0.08, 0.16), color: WOOD_DARK, x: -0.18, y: 0.48, z: 0.3 },
  ]);
}

export function deckGeo(): THREE.BufferGeometry {
  return mergeParts([{ geo: box(1.25, 0.08, 0.9), color: "#A67C52", y: 0.04 }]);
}

export function hearthGeo(): THREE.BufferGeometry {
  return mergeParts([{ geo: box(1.05, 0.06, 0.8), color: "#D5D8DC", y: 0.03 }]);
}

export function axeGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.06, 0.5, 0.06), color: WOOD_DARK, y: 0.1 },
    { geo: box(0.2, 0.12, 0.05), color: "#C5CCD1", y: 0.32 },
  ]);
}

export function palisadePost(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.16, 1.05, 0.14), color: WOOD, y: 0 },
    { geo: cone(0.12, 0.24, 5), color: "#F7FBFD", y: 0.62 },
  ]);
}

export function triangles(geo: THREE.BufferGeometry): number {
  const index = geo.getIndex();
  return (index ? index.count : geo.getAttribute("position").count) / 3;
}
