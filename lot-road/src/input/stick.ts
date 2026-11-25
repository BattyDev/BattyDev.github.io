import { project } from "../render/project";

/**
 * Desktop keys share the joystick's screen axes. Up on the keyboard is
 * up the yard. WASD and the arrows are the same stick.
 */
export function screenAxes(held: { has(code: string): boolean }): { x: number; y: number } | null {
  let x = 0;
  let y = 0;
  if (held.has("KeyA") || held.has("ArrowLeft")) x -= 1;
  if (held.has("KeyD") || held.has("ArrowRight")) x += 1;
  if (held.has("KeyW") || held.has("ArrowUp")) y -= 1;
  if (held.has("KeyS") || held.has("ArrowDown")) y += 1;
  if (!x && !y) return null;
  return { x, y };
}

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
