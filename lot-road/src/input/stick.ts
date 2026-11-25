import { project } from "../render/project";

/**
 * A finger drag is a direction on the screen. Turn it into a world step
 * so "up" on the glass is up the yard, not up the world Z axis.
 */
export function worldMove(dx: number, dy: number, viewW: number, viewH: number): { x: number; z: number } {
  const mag = Math.hypot(dx, dy);
  if (mag < 8) return { x: 0, z: 0 };
  const o = project(0, 0, 0, viewW, viewH);
  const px = project(1, 0, 0, viewW, viewH);
  const pz = project(0, 0, 1, viewW, viewH);
  const xx = px.x - o.x;
  const xy = px.y - o.y;
  const zx = pz.x - o.x;
  const zy = pz.y - o.y;
  const det = xx * zy - zx * xy || 1;
  const x = (dx * zy - zx * dy) / det;
  const z = (xx * dy - xy * dx) / det;
  const len = Math.hypot(x, z) || 1;
  const strength = Math.min(1, mag / 56);
  return { x: (x / len) * strength, z: (z / len) * strength };
}
