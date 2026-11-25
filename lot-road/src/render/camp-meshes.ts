import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Chunky camp meshes. Boxes and 5-side cones, so a phone full of hunters,
 * bears, and trees stays in a few thousand triangles.
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
const cyl = (r: number, h: number, n = 5) => new THREE.CylinderGeometry(r, r, h, n);
const cone = (r: number, h: number, n = 5) => new THREE.ConeGeometry(r, h, n);

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
    const geo = part.geo.clone();
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

const FACE = () => new THREE.SphereGeometry(0.15, 6, 4);
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
  const parts: Part[] = [
    { geo: box(0.18, 0.16, 0.26), color: BOOT, x: -0.12, y: 0.08 },
    { geo: box(0.18, 0.16, 0.26), color: BOOT, x: 0.12, y: 0.08 },
    { geo: box(0.14, 0.22, 0.14), color: NAVY, x: -0.1, y: 0.26 },
    { geo: box(0.14, 0.22, 0.14), color: NAVY, x: 0.1, y: 0.26 },
    { geo: box(0.46, 0.5, 0.3), color: coat, y: 0.64 },
    { geo: box(0.48, 0.07, 0.32), color: TRIM, y: 0.42 },
    { geo: box(0.12, 0.32, 0.12), color: coat, x: -0.3, y: 0.7 },
    { geo: box(0.12, 0.32, 0.12), color: coat, x: 0.3, y: 0.7 },
    { geo: box(0.13, 0.06, 0.13), color: TRIM, x: -0.3, y: 0.56 },
    { geo: box(0.13, 0.06, 0.13), color: TRIM, x: 0.3, y: 0.56 },
    { geo: box(0.12, 0.1, 0.12), color: MITT, x: -0.3, y: 0.5 },
    { geo: box(0.12, 0.1, 0.12), color: MITT, x: 0.3, y: 0.5 },
    { geo: box(0.34, 0.28, 0.3), color: coat, y: 1.16 },
    { geo: FACE(), color: SKIN, y: 1.1, z: 0.1 },
    { geo: box(0.3, 0.06, 0.08), color: TRIM, y: 1.26, z: 0.16 },
    { geo: box(0.3, 0.05, 0.08), color: TRIM, y: 0.98, z: 0.16 },
    { geo: box(0.06, 0.24, 0.08), color: TRIM, x: -0.14, y: 1.12, z: 0.16 },
    { geo: box(0.06, 0.24, 0.08), color: TRIM, x: 0.14, y: 1.12, z: 0.16 },
    { geo: box(0.04, 0.04, 0.03), color: "#1C1915", x: -0.05, y: 1.12, z: 0.24 },
    { geo: box(0.04, 0.04, 0.03), color: "#1C1915", x: 0.05, y: 1.12, z: 0.24 },
    { geo: box(0.05, 0.08, 0.04), color: "#5C6A78", y: 0.72, z: 0.16 },
  ];
  if (held === "axe") {
    parts.push(
      { geo: box(0.05, 0.46, 0.05), color: WOOD_DARK, x: 0.42, y: 0.62 },
      { geo: box(0.16, 0.12, 0.05), color: "#C5CCD1", x: 0.5, y: 0.42 },
    );
  } else if (held === "log") {
    parts.push({ geo: cyl(0.1, 0.7, 6), color: WOOD, y: 1.05, z: 0.02, rz: Math.PI / 2 });
  } else if (held === "meat") {
    parts.push({ geo: box(0.22, 0.1, 0.16), color: "#E15B55", y: 0.48, z: 0.22 });
  } else if (held === "plank") {
    parts.push({ geo: box(0.34, 0.08, 0.12), color: WOOD, y: 0.5, z: 0.2 });
  } else if (held === "bar") {
    parts.push({ geo: box(0.32, 0.08, 0.1), color: "#8A939C", y: 0.5, z: 0.2 });
  }
  return mergeParts(parts);
}

export function beastGeo(wounds: number): THREE.BufferGeometry {
  const parts: Part[] = [
    { geo: box(0.72, 0.42, 1.05), color: "#F4EDE4", y: 0.5 },
    { geo: box(0.4, 0.34, 0.38), color: "#F7F4EC", z: 0.62, y: 0.72 },
    { geo: box(0.1, 0.1, 0.08), color: "#F4EDE4", x: -0.14, y: 0.94, z: 0.58 },
    { geo: box(0.1, 0.1, 0.08), color: "#F4EDE4", x: 0.14, y: 0.94, z: 0.58 },
    { geo: box(0.18, 0.12, 0.16), color: "#E7DDD2", z: 0.84, y: 0.62 },
    { geo: box(0.08, 0.06, 0.06), color: "#1C1915", z: 0.93, y: 0.64 },
    { geo: box(0.05, 0.05, 0.03), color: "#1C1915", x: -0.08, z: 0.8, y: 0.78 },
    { geo: box(0.05, 0.05, 0.03), color: "#1C1915", x: 0.08, z: 0.8, y: 0.78 },
    { geo: box(0.16, 0.36, 0.18), color: "#F7F4EC", x: -0.22, z: 0.32, y: 0.18 },
    { geo: box(0.16, 0.36, 0.18), color: "#F7F4EC", x: 0.22, z: 0.32, y: 0.18 },
    { geo: box(0.16, 0.36, 0.18), color: "#F7F4EC", x: -0.22, z: -0.32, y: 0.18 },
    { geo: box(0.16, 0.36, 0.18), color: "#F7F4EC", x: 0.22, z: -0.32, y: 0.18 },
  ];
  if (wounds > 0) parts.push({ geo: box(0.14, 0.1, 0.1), color: "#E07A6A", x: 0.2, y: 0.62, z: 0.1 });
  if (wounds > 1) parts.push({ geo: box(0.12, 0.1, 0.1), color: "#C43838", x: -0.16, y: 0.6, z: -0.12 });
  return mergeParts(parts);
}

export function wolfGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.36, 0.36, 0.9), color: "#7E93A8", y: 0.48 },
    { geo: box(0.22, 0.22, 0.32), color: "#4E6274", z: 0.52, y: 0.62 },
    { geo: cone(0.06, 0.16, 4), color: "#4E6274", x: -0.08, y: 0.82, z: 0.5 },
    { geo: cone(0.06, 0.16, 4), color: "#4E6274", x: 0.08, y: 0.82, z: 0.5 },
    { geo: box(0.1, 0.08, 0.16), color: "#1C1915", z: 0.7, y: 0.56 },
    { geo: box(0.08, 0.28, 0.1), color: "#6E8498", x: -0.12, z: 0.22, y: 0.16 },
    { geo: box(0.08, 0.28, 0.1), color: "#6E8498", x: 0.12, z: 0.22, y: 0.16 },
    { geo: box(0.08, 0.28, 0.1), color: "#6E8498", x: -0.12, z: -0.24, y: 0.16 },
    { geo: box(0.08, 0.28, 0.1), color: "#6E8498", x: 0.12, z: -0.24, y: 0.16 },
    { geo: box(0.1, 0.1, 0.28), color: "#4E6274", z: -0.58, y: 0.42 },
  ]);
}

export function sealGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.55, 0.28, 0.7), color: "#8A97A3", y: 0.22 },
    { geo: box(0.4, 0.16, 0.4), color: "#D5DDE3", y: 0.28, z: 0.05 },
    { geo: box(0.28, 0.22, 0.26), color: "#9AA6B0", z: 0.4, y: 0.32 },
    { geo: box(0.08, 0.06, 0.06), color: "#1C1915", z: 0.54, y: 0.34 },
    { geo: box(0.16, 0.06, 0.22), color: "#6E7C88", x: -0.32, y: 0.12 },
    { geo: box(0.16, 0.06, 0.22), color: "#6E7C88", x: 0.32, y: 0.12 },
    { geo: box(0.16, 0.08, 0.14), color: "#6E7C88", z: -0.4, y: 0.12 },
  ]);
}

export function snowTreeGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.16, 0.28, 0.16), color: WOOD_DARK, y: 0.14 },
    { geo: cone(0.46, 0.55, 5), color: "#3E8F56", y: 0.48 },
    { geo: cone(0.22, 0.16, 5), color: "#F7FBFD", y: 0.62 },
    { geo: cone(0.32, 0.42, 5), color: "#5AAA6A", y: 0.86 },
    { geo: cone(0.16, 0.22, 5), color: "#F7FBFD", y: 1.02 },
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
  return mergeParts([
    { geo: box(0.28, 0.05, 0.16), color: "#7DDE6A", y: 0.04 },
    { geo: box(0.28, 0.05, 0.16), color: "#3E9A62", y: 0.09 },
    { geo: box(0.28, 0.05, 0.16), color: "#7DDE6A", y: 0.14 },
    { geo: box(0.28, 0.05, 0.16), color: "#8FE07A", y: 0.19 },
    { geo: box(0.08, 0.2, 0.17), color: "#A67C52", y: 0.11 },
  ]);
}

export function goodsStackGeo(color: string): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.22, 0.1, 0.16), color, y: 0.06 },
    { geo: box(0.18, 0.08, 0.14), color, y: 0.14 },
  ]);
}

export function grillGeo(): THREE.BufferGeometry {
  return mergeParts([
    { geo: box(0.86, 0.06, 0.66), color: "#D5D8DC", y: 0.03 },
    { geo: box(0.08, 0.28, 0.08), color: "#2A2724", x: -0.28, z: -0.2, y: 0.2 },
    { geo: box(0.08, 0.28, 0.08), color: "#2A2724", x: 0.28, z: -0.2, y: 0.2 },
    { geo: box(0.08, 0.28, 0.08), color: "#2A2724", x: -0.28, z: 0.2, y: 0.2 },
    { geo: box(0.08, 0.28, 0.08), color: "#2A2724", x: 0.28, z: 0.2, y: 0.2 },
    { geo: box(0.62, 0.06, 0.42), color: "#2A2724", y: 0.36 },
    { geo: box(0.5, 0.03, 0.06), color: "#3A3632", y: 0.4, z: -0.1 },
    { geo: box(0.5, 0.03, 0.06), color: "#3A3632", y: 0.4 },
    { geo: box(0.5, 0.03, 0.06), color: "#3A3632", y: 0.4, z: 0.1 },
    { geo: box(0.18, 0.05, 0.14), color: "#E07A3D", y: 0.32 },
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
    { geo: box(0.1, 0.7, 0.1), color: WOOD_DARK, x: -0.48, z: -0.22, y: 0.4 },
    { geo: box(0.1, 0.7, 0.1), color: WOOD_DARK, x: 0.48, z: -0.22, y: 0.4 },
    { geo: box(0.1, 0.7, 0.1), color: WOOD_DARK, x: -0.48, z: 0.22, y: 0.4 },
    { geo: box(0.1, 0.7, 0.1), color: WOOD_DARK, x: 0.48, z: 0.22, y: 0.4 },
    { geo: box(1.15, 0.1, 0.62), color: WOOD, y: 0.55 },
    { geo: box(1.2, 0.08, 0.7), color: "#A67C52", y: 0.82 },
    { geo: box(1.05, 0.06, 0.4), color: "#F7FBFD", y: 0.88, z: -0.08 },
    { geo: box(0.22, 0.14, 0.16), color: "#E6B325", x: 0.28, y: 0.66 },
    { geo: box(0.28, 0.08, 0.2), color: WOOD_DARK, x: -0.2, y: 0.46, z: 0.16 },
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
