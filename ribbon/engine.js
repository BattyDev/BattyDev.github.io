export const LIMIT = 48;
export const locales = [
  {
    name: 'Roseglass Cloister', sky: ['#7078ad', '#f3c8cb', '#ffe8c8'], ground: ['#ded0c2', '#e6d9c9'], inlay: '#bb938c', masonry: ['#ffe8cf', '#d9ac9d', '#a27c89'], leaf: ['#ec939f', '#b66586'], enemy: 'Rosewing'
  },
  {
    name: 'Moonwater Gallery', sky: ['#465b94', '#c1bee2', '#f1dbd0'], ground: ['#b6c9d0', '#ccd7d9'], inlay: '#8d9ab2', masonry: ['#e7e6df', '#adb5c6', '#737993'], leaf: ['#a7c6cd', '#679da7'], enemy: 'Moon Knight'
  },
  {
    name: 'Astral Observatory', sky: ['#3f396e', '#b59ac5', '#efc8be'], ground: ['#c2b3c7', '#d3c3cb'], inlay: '#99809c', masonry: ['#f2dcca', '#c4a4b5', '#897394'], leaf: ['#c293be', '#9268a2'], enemy: 'Eclipse Guard'
  },
  {
    name: 'The Eclipse Court', sky: ['#262d55', '#806b9b', '#e1a59d'], ground: ['#a99bae', '#bdabb9'], inlay: '#816581', masonry: ['#f3ceba', '#b994a6', '#726483'], leaf: ['#cb89aa', '#8b638c'], enemy: 'Eclipse Moth'
  }
];
export const blessings = [
  ['nova', 'Starfall', 'A brighter star', 'Wand strikes deal 28% more base damage.'],
  ['haste', 'Quickspell', 'A quicker beat', 'Reduce wand recovery by 13%.'],
  ['split', 'Twin Comet', 'A second light', 'Fire an extra star with every volley.'],
  ['aura', 'Lunar Halo', 'An orbiting ward', 'Pulse moonlight through nearby foes.'],
  ['stride', 'Ribbonstep', 'Lighter footsteps', 'Increase movement speed and crystal reach.'],
  ['heart', 'Heartseam', 'A stronger heart', 'Gain 20 maximum health and heal 32.']
];
const cap = (n, a, b) => Math.max(a, Math.min(b, n));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function newState(quick = false) {
  return {
    quick, mode: 'title', stage: 1, cycle: 1, stageTime: 0, time: 0, kills: 0, level: 1, xp: 0, need: 5, player: {
      x: 0, z: 0, hp: 100, maxHp: 100, face: 1, moving: false, walk: 0, inv: 0
    }, build: Object.fromEntries(blessings.map(b => [b[0], 0])), enemies: [], gems: [], shots: [], effects: [], warnings: [], choices: [], cool: 0, spawn: .2, halo: 0, serial: 0, notice: 0, bossClock: 0
  };
}
export const duration = s => (s.quick ? [8, 10, 12] : [90, 120, 180])[s.stage - 1] ?? Infinity;
export function start(s) {
  Object.assign(s, newState(s.quick), { mode: 'play', notice: 3, pendingStage: false });
  for (let i = 0; i < 3; i++) {
    spawn(s, 'moth');
    const e = s.enemies.at(-1);
    e.x = (i - 1) * 2.7;
    e.z = -8 - i * 2.3;
  }
}
function clearCourt(s) {
  for (const k of ['enemies', 'gems', 'shots', 'effects', 'warnings']) {
    s[k].length = 0;
  }
  s.stageTime = 0;
  s.spawn = .3;
  s.notice = 3;
  s.player.inv = 1;
  s.bossClock = 2;
}
export function advanceStage(s) {
  if (s.mode !== 'play' || s.stage >= 4) {
    return;
  }
  s.pendingStage = true;
  const unclaimed = s.gems.reduce((sum, g) => sum + g.value, 0);
  s.gems.length = 0;
  if (unclaimed) {
    gainXP(s, unclaimed);
  }
  if (s.mode === 'choice') {
    return;
  }
  s.pendingStage = false;
  s.stage++;
  clearCourt(s);
  if (s.stage === 4) {
    spawn(s, 'boss');
    const boss = s.enemies.at(-1);
    boss.x = s.player.x * .85;
    boss.z = Math.max(-LIMIT, s.player.z - 11);
  }
}
export function nextCycle(s) {
  if (s.mode !== 'victory') {
    return;
  }
  s.cycle++;
  s.stage = 1;
  clearCourt(s);
  s.mode = 'play';
}
export function damage(s, n) {
  if (s.mode !== 'play' || s.player.inv > 0) {
    return;
  }
  s.player.hp = Math.max(0, s.player.hp - n);
  s.player.inv = .8;
  if (!s.player.hp) {
    s.mode = 'dead';
  }
}
const limits = { split: 4, haste: 11, stride: 7 };
function offer(s) {
  if (s.mode !== 'play' || s.xp < s.need) {
    return;
  }
  s.xp -= s.need;
  s.level++;
  s.need = Math.floor(5 + 2.6 * (s.level - 1));
  const deck = blessings.filter(([id]) => s.build[id] < (limits[id] ?? Infinity));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  s.choices = deck.slice(0, 3);
  s.mode = 'choice';
}
export function gainXP(s, n) {
  if (s.mode !== 'play') {
    return;
  }
  s.xp += n;
  offer(s);
}
export function choose(s, i) {
  if (s.mode !== 'choice' || !s.choices[i]) {
    return;
  }
  const id = s.choices[i][0];
  s.build[id]++;
  if (id === 'heart') {
    s.player.maxHp += 20;
    s.player.hp = Math.min(s.player.maxHp, s.player.hp + 32);
  }
  s.choices = [];
  s.mode = 'play';
  offer(s);
  if (s.pendingStage && s.mode === 'play') {
    advanceStage(s);
  }
}
function spawn(s, kind) {
  if (s.enemies.length >= 80) {
    return;
  }
  const a = Math.random() * Math.PI * 2;
  const r = kind === 'boss' ? 12 : 13 + Math.random() * 7;
  const p = s.player;
  let x = cap(p.x + Math.sin(a) * r, -LIMIT, LIMIT);
  let z = cap(p.z + Math.cos(a) * r, -LIMIT, LIMIT);
  if (Math.hypot(x - p.x, z - p.z) < 8) {
    x = p.x * .65;
    z = p.z * .65;
  }
  const boss = kind === 'boss';
  const knight = kind === 'knight';
  const factor = 1 + (s.cycle - 1) * .48;
  const hp = (boss ? (s.quick ? 430 : 18000) : knight ? 48 : 18) * (boss ? 1 : (1 + .24 * (s.stage - 1))) * factor;
  s.enemies.push({
    id: ++s.serial, x, z, kind, hp, maxHp: hp, phase: a, speed: (boss ? 1.13 : knight ? 1.55 : 2.02) * (1 + .025 * Math.min(10, s.cycle - 1)), hit: 0
  });
}
function gem(s, e) {
  if (s.gems.length < 150) {
    s.gems.push({ x: e.x, z: e.z, value: e.kind === 'knight' ? 4 : 2 });
    return;
  }
  let near = s.gems[0];
  for (const g of s.gems) {
    if (dist(g, e) < dist(near, e)) {
      near = g;
    }
  }
  near.value += e.kind === 'knight' ? 4 : 2;
}
function effect(s, x, z, kind, r = .5) {
  if (s.effects.length < 90) {
    s.effects.push({
      x, z, kind, r, t: .4
    });
  }
}
function hit(s, e, n) {
  if (e.hp <= 0) {
    return;
  }
  e.hp -= n;
  e.hit = .12;
  effect(s, e.x, e.z, 'spark');
  if (e.hp <= 0) {
    s.kills++;
    if (e.kind !== 'boss') {
      gem(s, e);
    }
  }
}
export function defeatBoss(s) {
  const e = s.enemies.find(e => e.kind === 'boss');
  if (e && s.mode === 'play') {
    hit(s, e, e.hp);
    s.mode = 'victory';
    s.warnings.length = 0;
  }
}
function fire(s) {
  const p = s.player;
  const targets = s.enemies.filter(e => e.hp > 0 && dist(e, p) < 15).sort((a, b) => dist(a, p) - dist(b, p));
  if (!targets.length) {
    return;
  }
  for (let i = 0; i <= s.build.split && s.shots.length < 64; i++) {
    const target = targets[i % targets.length];
    s.shots.push({
      x: p.x + (i % 2 ? .4 : -.4), z: p.z, h: 1.3, target, life: 1.35, damage: 16 * (1 + .28 * s.build.nova)
    });
  }
  s.cool = Math.max(.14, .57 * Math.pow(.87, s.build.haste));
}
export function tick(s, dt, input = { x: 0, z: 0 }) {
  if (s.mode !== 'play') {
    return;
  }
  const p = s.player;
  s.time += dt;
  s.stageTime += dt;
  s.notice -= dt;
  p.inv = Math.max(0, p.inv - dt);
  s.cool -= dt;
  s.spawn -= dt;
  s.halo -= dt;
  const mag = Math.hypot(input.x, input.z);
  const scale = (4.5 + .32 * s.build.stride) * dt / Math.max(1, mag);
  p.x = cap(p.x + input.x * scale, -LIMIT, LIMIT);
  p.z = cap(p.z + input.z * scale, -LIMIT, LIMIT);
  p.moving = mag > .05;
  if (p.moving) {
    p.walk += dt * mag * 9;
    if (Math.abs(input.x) > .12) {
      p.face = Math.sign(input.x);
    }
  }
  if (s.stageTime >= duration(s)) {
    advanceStage(s);
    return;
  }
  if (s.spawn <= 0) {
    const rate = s.stage === 4 ? 1.8 : Math.max(.27, 1.2 - .13 * s.stage - .09 * (s.cycle - 1) - .002 * s.stageTime);
    spawn(s, Math.random() < (s.stage - 1) * .15 ? 'knight' : 'moth');
    s.spawn = rate;
  }
  if (s.cool <= 0) {
    fire(s);
  }
  if (s.build.aura && s.halo <= 0) {
    const r = 3.3 + .16 * s.build.aura;
    effect(s, p.x, p.z, 'halo', r);
    for (const e of s.enemies) {
      if (dist(p, e) < r) {
        hit(s, e, 17 * s.build.aura);
      }
    }
    s.halo = 1.7;
  }
  for (const shot of s.shots) {
    const e = shot.target;
    if (e.hp <= 0) {
      shot.life = 0;
      continue;
    }
    const d = dist(shot, e);
    const v = 16 * dt;
    shot.life -= dt;
    if (d < v + .3) {
      hit(s, e, shot.damage);
      shot.life = 0;
    }
    else {
      shot.dx = (e.x - shot.x) / d;
      shot.dz = (e.z - shot.z) / d;
      shot.x += shot.dx * v;
      shot.z += shot.dz * v;
    }
  }
  const bossFell = s.enemies.some(e => e.kind === 'boss' && e.hp <= 0);
  s.shots = s.shots.filter(o => o.life > 0);
  s.enemies = s.enemies.filter(e => e.hp > 0);
  if (s.mode !== 'play') {
    return;
  }
  for (const e of s.enemies) {
    const d = Math.max(.01, dist(p, e));
    e.x += (p.x - e.x) / d * e.speed * dt;
    e.z += (p.z - e.z) / d * e.speed * dt;
    e.hit -= dt;
    if (d < (e.kind === 'boss' ? 1.75 : .64)) {
      damage(s, (e.kind === 'boss' ? 20 : 8) + 2 * (s.cycle - 1));
    }
  }
  if (s.stage === 4 && (s.bossClock -= dt) <= 0) {
    const b = s.enemies.find(e => e.kind === 'boss');
    if (b) {
      s.warnings.push({
        x: p.x, z: p.z, r: 2.8, t: 1.55
      });
      if (b.hp < b.maxHp * .65) {
        const d = Math.max(.01, dist(b, p));
        const sideX = (p.z - b.z) / d;
        const sideZ = (b.x - p.x) / d;
        for (const side of [-1, 1]) {
          s.warnings.push({
            x: p.x + side * 3.7 * sideX, z: p.z + side * 3.7 * sideZ, r: 2.25, t: 1.55
          });
        }
      }
      s.bossClock = b.hp < b.maxHp * .65 ? 2.85 : 3.8;
    }
  }
  for (const w of s.warnings) {
    w.t -= dt;
    if (w.t <= 0) {
      effect(s, w.x, w.z, 'burst', w.r);
      if (dist(w, p) < w.r) {
        damage(s, 23);
      }
    }
  }
  s.warnings = s.warnings.filter(w => w.t > 0);
  if (s.mode !== 'play') {
    return;
  }
  if (bossFell) {
    s.mode = 'victory';
    s.warnings.length = 0;
    return;
  }
  for (const e of s.effects) {
    e.t -= dt;
  }
  s.effects = s.effects.filter(e => e.t > 0);
  let collected = 0;
  for (const g of s.gems) {
    const d = dist(p, g);
    if (d < 1.05) {
      collected += g.value;
      g.value = 0;
    }
    else if (d < 3.2 + .5 * s.build.stride) {
      g.x += (p.x - g.x) * dt * 5;
      g.z += (p.z - g.z) * dt * 5;
    }
  }
  s.gems = s.gems.filter(g => g.value > 0);
  if (collected) {
    gainXP(s, collected);
  }
}
