import test from 'node:test';
import { CourtRenderer } from '../render.js';
import assert from 'node:assert/strict';
import { advanceStage, choose, damage, defeatBoss, duration, gainXP, LIMIT, newState, nextCycle, start, tick } from '../engine.js';
const fresh = (quick = false) => {
  const s = newState(quick);
  start(s);
  return s;
};
const chooseAll = s => {
  while (s.mode === 'choice')
    choose(s, 0);
};
const dt = 1 / 60;
test('both input axes share a normalized movement budget and a world boundary', () => {
  const s = fresh();
  tick(s, dt, { x: 1, z: 1 });
  assert.ok(Math.abs(Math.hypot(s.player.x, s.player.z) - 4.5 * dt) < 1e-10);
  s.player.x = LIMIT;
  s.player.z = -LIMIT;
  tick(s, dt, { x: 1, z: -1 });
  assert.equal(s.player.x, LIMIT);
  assert.equal(s.player.z, -LIMIT);
});
test('new runs, defeat and restart reset all transient and accumulated state', () => {
  const s = fresh(true);
  gainXP(s, 12);
  chooseAll(s);
  s.player.inv = 0;
  damage(s, 999);
  assert.equal(s.mode, 'dead');
  start(s);
  assert.equal(s.player.hp, 100);
  assert.equal(s.level, 1);
  assert.equal(s.cycle, 1);
  assert.equal(s.stage, 1);
  assert.equal(s.gems.length, 0);
  assert.equal(s.shots.length, 0);
  assert.equal(s.quick, true);
});
test('each level pauses all simulation and offers three distinct eligible upgrades', () => {
  const s = fresh();
  Object.assign(s.build, { haste: 11, split: 4, stride: 7 });
  gainXP(s, 500);
  const t = s.time;
  tick(s, 1, { x: 1, z: 1 });
  assert.equal(s.time, t);
  while (s.mode === 'choice') {
    assert.deepEqual(s.choices.map(x => x[0]).sort(), ['aura', 'heart', 'nova']);
    choose(s, 0);
  }
  assert.ok(s.level > 5);
});
test('stage expiry sweeps loose crystal value once and resolves queued levels before travel', () => {
  const s = fresh();
  s.gems.push({ x: 0, z: 0, value: 5 }, { x: 3, z: 1, value: 7 });
  s.stageTime = 90;
  tick(s, dt);
  assert.equal(s.mode, 'choice');
  assert.equal(s.stage, 1);
  assert.equal(s.gems.length, 0);
  choose(s, 0);
  assert.equal(s.mode, 'choice');
  choose(s, 0);
  assert.equal(s.mode, 'play');
  assert.equal(s.stage, 2);
  assert.equal(s.xp, 0);
  assert.equal(s.stageTime, 0);
  assert.equal(s.enemies.length, 0);
});
test('all three stage durations and ten boss cycles retain health and blessings', () => {
  const s = fresh();
  s.build.nova = 3;
  s.player.hp = 43;
  for (let cycle = 1; cycle <= 10; cycle++) {
    for (const seconds of [90, 120, 180]) {
      assert.equal(duration(s), seconds);
      advanceStage(s);
    }
    assert.equal(s.enemies[0].kind, 'boss');
    assert.ok(s.enemies[0].hp >= 6000);
    defeatBoss(s);
    assert.equal(s.mode, 'victory');
    nextCycle(s);
    assert.equal(s.cycle, cycle + 1);
    assert.equal(s.player.hp, 43);
    assert.equal(s.build.nova, 3);
    assert.equal(s.stage, 1);
    assert.equal(s.enemies.length, 0);
  }
});
test('boss kill and lethal ground impact in the same step resolve as defeat', () => {
  const s = fresh();
  advanceStage(s);
  advanceStage(s);
  advanceStage(s);
  const b = s.enemies[0];
  b.hp = 1;
  s.player.hp = 1;
  s.player.inv = 0;
  s.spawn = 100;
  s.shots.push({
    x: b.x, z: b.z, target: b, damage: 20, life: 1
  });
  s.warnings.push({
    x: s.player.x, z: s.player.z, t: dt / 2, r: 3
  });
  tick(s, dt);
  assert.equal(s.mode, 'dead');
});
test('crystal merging preserves kill value at the cap', () => {
  const s = fresh();
  s.spawn = 100;
  s.enemies.length = 0;
  s.gems = Array.from({ length: 150 }, () => ({ x: 30, z: 30, value: 1 }));
  const e = {
    id: 99, kind: 'knight', hp: 1, x: 30, z: 30
  };
  s.enemies.push(e);
  s.shots.push({
    x: 30, z: 30, target: e, damage: 10, life: 1
  });
  tick(s, dt);
  assert.equal(s.gems.length, 150);
  assert.equal(s.gems.reduce((v, g) => v + g.value, 0), 154);
});
test('paused, retired and terminal states freeze position, timers and damage', () => {
  for (const mode of ['paused', 'retired', 'dead', 'victory', 'title']) {
    const s = fresh();
    s.mode = mode;
    tick(s, 1, { x: 1, z: 0 });
    damage(s, 30);
    assert.equal(s.time, 0);
    assert.equal(s.player.x, 0);
    assert.equal(s.player.hp, 100);
  }
});
test('an ordinary moving build clears all normal-duration courts and the boss', context => {
  let seed = 2311;
  context.mock.method(Math, 'random', () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296));
  const s = fresh();
  const priority = ['split', 'nova', 'haste', 'aura', 'heart', 'stride'];
  let bossStart = 0;
  for (let i = 0; i < 60 * 650; i++) {
    if (s.mode === 'choice') {
      const best = s.choices.reduce((best, card, i) => priority.indexOf(card[0]) < priority.indexOf(s.choices[best][0]) ? i : best, 0);
      choose(s, best);
      continue;
    }
    if (s.mode !== 'play') {
      break;
    }
    if (s.stage === 4 && !bossStart) {
      bossStart = s.time;
    }
    const angle = s.time * .37;
    tick(s, dt, { x: Math.sin(angle) * 9 - s.player.x, z: Math.cos(angle) * 9 - s.player.z });
    assert.ok(s.enemies.length <= 80 && s.gems.length <= 150 && s.shots.length <= 64);
  }
  assert.equal(s.mode, 'victory');
  assert.ok(bossStart >= 390);
  assert.ok(s.time - bossStart >= 8);
  context.diagnostic('Cleared cycle at level ' + s.level + ' with ' + s.player.hp + ' HP; boss lasted ' + (s.time - bossStart).toFixed(1) + ' seconds.');
});
test('perspective follows world position, shrinks distant figures and projects height upward', () => {
  const view = Object.assign(Object.create(CourtRenderer.prototype), {
    camera: {x: 12, z: 15}, w: 400, h: 800, f: 580, base: 385
  });
  const near = view.project(12, 15);
  const far = view.project(12, -5);
  assert.equal(near.x, 200);
  assert.equal(far.x, 200);
  assert.ok(near.k > far.k);
  assert.ok(near.y > far.y);
  assert.ok(view.project(12, 15, 2).y < near.y);
  view.camera.x += 20;
  view.camera.z += 20;
  assert.deepEqual(view.project(32, 35), near);
});
