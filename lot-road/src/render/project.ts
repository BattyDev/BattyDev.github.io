/** Shared world-to-screen math for the chunky yard and the flat yard. */

export const VIEW = {
  yaw: (45 * Math.PI) / 180,
  pitch: (50 * Math.PI) / 180,
  dist: 28,
  lookY: 0.4,
  frustumHeight: 12.5,
  near: 0.1,
  far: 80,
};

/** The camera slides with the hunter. Tests leave this at the origin. */
export const look = { x: 0, z: 0 };

export function cameraEye(): [number, number, number] {
  const { yaw, pitch, dist } = VIEW;
  return [
    dist * Math.cos(pitch) * Math.sin(yaw) + look.x,
    dist * Math.sin(pitch),
    dist * Math.cos(pitch) * Math.cos(yaw) + look.z,
  ];
}

function norm(v: number[]): number[] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Orthographic project. Matches Three's camera: yaw 45°, pitch 50°,
 * distance 28, looking at (0, 0.4, 0), frustum height 12.5.
 */
export function project(x: number, y: number, z: number, viewW: number, viewH: number): { x: number; y: number } {
  const eye = cameraEye();
  const target = [look.x, VIEW.lookY, look.z];
  const zaxis = norm([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const xaxis = norm(cross([0, 1, 0], zaxis));
  const yaxis = cross(zaxis, xaxis);
  const rel = [x - eye[0], y - eye[1], z - eye[2]];
  const cx = dot(rel, xaxis);
  const cy = dot(rel, yaxis);
  const aspect = viewW / Math.max(1, viewH);
  const halfH = VIEW.frustumHeight / 2;
  const halfW = halfH * aspect;
  const ndcX = cx / halfW;
  const ndcY = cy / halfH;
  return {
    x: (ndcX * 0.5 + 0.5) * viewW,
    y: (-ndcY * 0.5 + 0.5) * viewH,
  };
}
