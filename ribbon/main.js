import { newState, start, tick, advanceStage, nextCycle, damage, gainXP, choose, defeatBoss, locales, duration } from './engine.js?v=3';
import { CourtRenderer } from './render.js?v=3';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const s = newState(params.get('quick') === '1');
const renderer = new CourtRenderer($('game'));
const keys = new Set();
const stick = $('stick');
const nub = stick.firstElementChild;
const stickMove = { x: 0, z: 0 };
let activePointer = null;
let heldTime = 0;
let previousMode = '';
let previousChoices = null;
let last = performance.now();
let ctx = null;
let sound = false;
const toggles = (ids, on) => ids.forEach(id => $(id).hidden = !on);
function resetInput() {
  keys.clear();
  stickMove.x = 0;
  stickMove.z = 0;
  nub.style.transform = '';
  if (activePointer !== null && stick.hasPointerCapture(activePointer)) {
    stick.releasePointerCapture(activePointer);
  }
  activePointer = null;
}
function pause() {
  resetInput();
  if (s.mode === 'play') {
    s.mode = 'paused';
    show();
  }
}
function resume() {
  if (s.mode === 'paused') {
    s.mode = 'play';
    last = performance.now();
    show();
  }
}
function begin() {
  resetInput();
  start(s);
  renderer.camera.x = 0;
  renderer.camera.z = 0;
  heldTime = 0;
  last = performance.now();
  show();
  tone(494, .13);
}
function tone(freq, len) {
  if (!ctx || !sound || ctx.state !== 'running') {
    return;
  }
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(freq * 1.42, ctx.currentTime + len);
  gain.gain.setValueAtTime(.045, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + len);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + len);
}
$('sound').onclick = async () => {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) {
      return;
    }
    ctx ??= new Audio();
    if (!sound) {
      await ctx.resume();
    }
    sound = !sound;
    $('sound').textContent = sound ? 'Sound on' : 'Sound off';
    $('sound').setAttribute('aria-pressed', String(sound));
    $('sound').setAttribute('aria-label', sound ? 'Mute sound' : 'Enable sound');
    tone(440, .13);
  }
  catch {
    $('sound').textContent = 'Sound unavailable';
  }
};
$('start').onclick = begin;
$('restart').onclick = begin;
$('pause').onclick = pause;
$('resume').onclick = resume;
$('continue').onclick = () => {
  nextCycle(s);
  show();
};
$('retire').onclick = () => {
  if (s.mode === 'victory') {
    s.mode = 'retired';
    show();
  }
};
function take(i) {
  choose(s, i);
  tone(640, .16);
  show();
}
const glyph = {
  nova: '✦', haste: '♢', split: '✧', aura: '☽', stride: '❧', heart: '♡'
};
function show() {
  if (s.mode === previousMode && s.choices === previousChoices) {
    return;
  }
  previousMode = s.mode;
  previousChoices = s.choices;
  resetInput();
  $('app').dataset.mode = s.mode;
  $('title').hidden = s.mode !== 'title';
  $('hud').hidden = s.mode === 'title';
  const modal = !['title', 'play'].includes(s.mode);
  $('dialog').hidden = !modal;
  $('pause').disabled = s.mode !== 'play';
  $('choices').replaceChildren();
  toggles(['resume'], s.mode === 'paused');
  toggles(['restart'], ['paused', 'dead', 'retired'].includes(s.mode));
  toggles(['continue', 'retire'], s.mode === 'victory');
  if (!modal) {
    if (document.activeElement?.closest('#dialog')) {
      document.activeElement.blur();
    }
    return;
  }
  const titles = {
    paused: ['Intermission', 'Run paused', 'Resume when you’re ready to return to the courtyard.'], choice: ['Level ' + s.level, 'Choose a blessing', 'Select one gift for your current build.'], dead: ['Run ended', 'The ribbon falls', 'Lumina reached ' + locales[s.stage - 1].name + ' with ' + s.kills + ' foes defeated.'], victory: ['Cycle ' + s.cycle + ' complete', 'Eclipse broken', 'Retire victorious, or enter a harder cycle with your health and blessings.'], retired: ['Victory', 'A ribbon of dawn', 'You cleared ' + s.cycle + ' cycle' + (s.cycle === 1 ? '' : 's') + ' and defeated ' + s.kills + ' foes.']
  };
  const [k, h, p] = titles[s.mode];
  $('kicker').textContent = k;
  $('dialogTitle').textContent = h;
  $('copy').textContent = p;
  if (s.mode === 'choice') {
    s.choices.forEach(([id, name, , desc], i) => {
      const b = document.createElement('button');
      b.className = 'choice';
      const icon = document.createElement('span');
      const body = document.createElement('span');
      const strong = document.createElement('strong');
      const small = document.createElement('small');
      const key = document.createElement('kbd');
      icon.textContent = glyph[id];
      strong.textContent = name;
      small.textContent = desc;
      body.append(strong, small);
      key.textContent = String(i + 1);
      b.append(icon, body, key);
      b.onclick = () => take(i);
      $('choices').append(b);
    });
    tone(760, .18);
  }
  $('dialog').querySelector('button:not([hidden])')?.focus({ preventScroll: true });
}
function drag(e) {
  if (e.pointerId !== activePointer) {
    return;
  }
  const r = stick.getBoundingClientRect();
  const dx = e.clientX - r.left - r.width / 2;
  const dz = e.clientY - r.top - r.height / 2;
  const radius = r.width * .35;
  const len = Math.hypot(dx, dz);
  const m = Math.min(1, len / radius);
  const a = Math.max(0, (m - .13) / .87);
  stickMove.x = len ? dx / len * a : 0;
  stickMove.z = len ? dz / len * a : 0;
  nub.style.transform = 'translate(' + ((len ? dx / len : 0) * m * radius) + 'px,' + ((len ? dz / len : 0) * m * radius) + 'px)';
}
stick.onpointerdown = e => {
  if (s.mode !== 'play' || activePointer !== null || e.button !== 0) {
    return;
  }
  e.preventDefault();
  activePointer = e.pointerId;
  stick.setPointerCapture(activePointer);
  drag(e);
};
stick.onpointermove = drag;
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  stick.addEventListener(name, e => {
    if (e.pointerId === activePointer) {
      resetInput();
    }
  });
}
const movements = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
window.addEventListener('keydown', e => {
  if (e.code === 'Escape' && !e.repeat) {
    if (s.mode === 'paused') {
      resume();
    }
    else {
      pause();
    }
    return;
  }
  if (s.mode === 'choice') {
    if (['Digit1', 'Digit2', 'Digit3'].includes(e.code) && !e.repeat) {
      e.preventDefault();
      take(Number(e.key) - 1);
    }
    else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const cards = Array.from($('choices').children);
      const dir = ['ArrowDown', 'ArrowRight'].includes(e.key) ? 1 : -1;
      cards[(cards.indexOf(document.activeElement) + dir + 3) % 3]?.focus();
    }
    return;
  }
  if (s.mode === 'play' && movements.includes(e.code)) {
    e.preventDefault();
    keys.add(e.code);
  }
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pause();
  }
});
const orientation = matchMedia('(orientation:portrait)');
orientation.addEventListener('change', pause);
new ResizeObserver(() => renderer.resize()).observe($('game'));
const pressing = (a, b) => Number(keys.has(a) || keys.has(b));
function hud() {
  const p = s.player;
  const d = duration(s);
  $('health').textContent = Math.ceil(p.hp) + ' / ' + p.maxHp;
  $('hpBar').style.width = p.hp / p.maxHp * 100 + '%';
  $('xp').textContent = s.xp + ' / ' + s.need;
  $('lvl').textContent = 'LV ' + s.level;
  $('xpBar').style.width = Math.min(100, s.xp / s.need * 100) + '%';
  $('court').textContent = 'Cycle ' + s.cycle + ' · ' + locales[s.stage - 1].name;
  const secs = Math.max(0, Math.ceil(d - s.stageTime));
  $('clock').textContent = isFinite(secs) ? Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0') : 'Boss encounter';
  const boss = s.enemies.find(e => e.kind === 'boss');
  $('bossHud').hidden = !boss || s.mode === 'victory';
  if (boss) {
    $('bossHud').querySelector('i').style.width = Math.max(0, boss.hp / boss.maxHp * 100) + '%';
  }
  $('stageNotice').hidden = s.notice <= 0 || s.mode !== 'play';
  $('stageNotice').textContent = locales[s.stage - 1].name;
  $('stageNotice').style.opacity = Math.min(1, Math.max(0, s.notice));
}
let nextHUD = 0;
function frame(now) {
  const dt = Math.min(.08, (now - last) / 1000);
  last = now;
  const move = { x: stickMove.x + pressing('ArrowRight', 'KeyD') - pressing('ArrowLeft', 'KeyA'), z: stickMove.z + pressing('ArrowDown', 'KeyS') - pressing('ArrowUp', 'KeyW') };
  if (s.mode === 'play') {
    heldTime += dt;
    while (heldTime >= 1 / 60 && s.mode === 'play') {
      const cool = s.cool;
      tick(s, 1 / 60, move);
      if (s.cool > cool + .05) {
        tone(580, .055);
      }
      heldTime -= 1 / 60;
    }
  }
  else {
    heldTime = 0;
  }
  if (s.mode === 'title') {
    s.time += dt;
  }
  show();
  if (now > nextHUD && s.mode !== 'title') {
    hud();
    nextHUD = now + 85;
  }
  renderer.draw(s, dt);
  requestAnimationFrame(frame);
}
if (params.get('test') === '1') {
  window.__game = {
    get state() {
      return s;
    }, advanceStage() {
      advanceStage(s);
      show();
    }, gainXP(n) {
      gainXP(s, n);
      show();
    }, damage(n) {
      s.player.inv = 0;
      damage(s, n);
      show();
    }, defeatBoss() {
      defeatBoss(s);
      show();
    }, worldToScreen(...args) {
      return renderer.project(...args);
    }
  };
}
show();
requestAnimationFrame(frame);
