import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { cameraEye, project, VIEW } from "../src/render/project";

describe("project", () => {
  it("matches the Three.js orthographic camera", () => {
    const width = 360;
    const height = 640;
    const eye = cameraEye();
    const halfH = VIEW.frustumHeight / 2;
    const halfW = halfH * (width / height);
    const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, VIEW.near, VIEW.far);
    camera.position.set(eye[0], eye[1], eye[2]);
    camera.lookAt(0, VIEW.lookY, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const points: [number, number, number][] = [
      [0, 0, 0],
      [2.4, 0, 2.2],
      [-3, 0.6, 0.2],
      [0, 1.9, 1.2],
      [0, 0.4, -3.4],
    ];
    for (const [x, y, z] of points) {
      const projected = new THREE.Vector3(x, y, z).project(camera);
      const expected = {
        x: (projected.x * 0.5 + 0.5) * width,
        y: (-projected.y * 0.5 + 0.5) * height,
      };
      const got = project(x, y, z, width, height);
      expect(got.x).toBeCloseTo(expected.x, 2);
      expect(got.y).toBeCloseTo(expected.y, 2);
    }
  });
});
