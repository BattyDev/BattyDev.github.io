import { locales, LIMIT } from './engine.js?v=3';
const TAU = Math.PI * 2;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const assets = {};
function loadIllustrations() {
  for (const name of ['lumina', 'moth', 'knight', 'boss']) {
    const image = new Image();
    image.onload = () => {
      const sizes = [image];
      let source = image;
      while (source.height > 48) {
        const smaller = document.createElement('canvas');
        smaller.width = Math.max(1, Math.ceil(source.width / 2));
        smaller.height = Math.max(1, Math.ceil(source.height / 2));
        smaller.getContext('2d').drawImage(source, 0, 0, smaller.width, smaller.height);
        sizes.push(smaller);
        source = smaller;
      }
      assets[name] = sizes;
    };
    image.src = new URL('./assets/' + name + '.webp', import.meta.url).href;
  }
}
function seed(a, b) {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
export class CourtRenderer {
  constructor(canvas) {
    loadIllustrations();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.camera = { x: 0, z: 0 };
    this.renderScale = 1;
    this.frameCost = 1 / 60;
    this.scaleSamples = 0;
    this.resize();
    this.props = [];
    for (let iz = -5; iz <= 5; iz++) {
      for (let ix = -5; ix <= 5; ix++) {
        if (!ix && !iz) {
          continue;
        }
        const n = seed(ix, iz);
        const x = ix * 10 + (seed(ix + 2, iz) - .5) * 3;
        const z = iz * 10 + (seed(ix, iz + 9) - .5) * 3;
        if (n < .86) {
          this.props.push({
            x, z, k: n < .27 ? 'tree' : n < .47 ? 'arch' : n < .65 ? 'obelisk' : 'lamp', phase: n * 7
          });
        }
      }
    }
    this.props.push({
      x: -5, z: -7, k: 'arch', phase: .4
    }, {
      x: 7, z: -5, k: 'tree', phase: 1
    }, {
      x: -7, z: 2, k: 'lamp', phase: 0
    });
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    const d = Math.min(devicePixelRatio || 1, 1.65) * this.renderScale;
    this.pixelRatio = d;
    this.canvas.width = Math.round(this.w * d);
    this.canvas.height = Math.round(this.h * d);
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
    this.f = Math.min(this.h * .94, this.w * 1.48);
    this.base = this.h * .62;
    this.skyCache = null;
    this.terrain = null;
  }
  project(x, z, h = 0) {
    // Rotate the world into the tilted chase camera, then divide by camera depth.
    const dz = this.camera.z + 12.6 - z;
    const dy = h - 7.15;
    const depth = dz * .946 - dy * .324;
    const k = this.f / Math.max(.15, depth);
    return {
      x: this.w * .5 + (x - this.camera.x) * k, y: this.base - (dy * .946 + dz * .324) * k, k, d: depth
    };
  }
  poly(points, color, stroke) {
    const c = this.ctx;
    c.beginPath();
    points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
    c.closePath();
    c.fillStyle = color;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 1;
      c.stroke();
    }
  }
  face(points, color) {
    const p = points.map(([x, z, h]) => this.project(x, z, h));
    if (p.some(v => v.d < .65)) {
      return;
    }
    this.poly(p.map(v => [v.x, v.y]), color);
  }
  circ(x, y, rx, ry, color) {
    const c = this.ctx;
    c.beginPath();
    c.ellipse(x, y, Math.max(.1, rx), Math.max(.1, ry), 0, 0, TAU);
    c.fillStyle = color;
    c.fill();
  }
  sky(stage, L) {
    const c = this.ctx;
    const w = this.w;
    const h = this.h;
    const horizon = this.base - this.f * .324 / .946;
    if (this.skyCache?.stage !== stage || this.skyCache.horizon !== horizon) {
      const buffer = document.createElement('canvas');
      buffer.width = Math.ceil(w);
      buffer.height = Math.ceil(h);
      const b = buffer.getContext('2d');
      const g = b.createLinearGradient(0, 0, 0, h * .75);
      L.sky.forEach((v, i) => g.addColorStop(i * .5, v));
      b.fillStyle = g;
      b.fillRect(0, 0, w, h);
      const sx = w * .73;
      const sy = horizon * .54;
      const sr = Math.min(h * .055, w * .09);
      const glow = b.createRadialGradient(sx, sy, 0, sx, sy, sr * 2.3);
      glow.addColorStop(0, '#fff4cf');
      glow.addColorStop(1, '#fff1ca00');
      b.fillStyle = glow;
      b.fillRect(sx - 3 * sr, sy - 3 * sr, 6 * sr, 6 * sr);
      b.fillStyle = '#fff2d7';
      b.beginPath();
      b.arc(sx, sy, sr, 0, TAU);
      b.fill();
      b.strokeStyle = '#ffeaceaa';
      b.beginPath();
      b.arc(sx, sy, sr * 1.23, 0, TAU);
      b.stroke();
      if (stage === 4) {
        b.fillStyle = '#685d89';
        b.beginPath();
        b.arc(sx + sr * .24, sy - sr * .16, sr * .9, 0, TAU);
        b.fill();
      }
      for (let i = 0; i < 50; i++) {
        const x = seed(i, 52) * w;
        const y = seed(i, 42) * horizon;
        b.fillStyle = '#fff5dcbb';
        b.fillRect(x, y, 1.5, 1.5);
      }
      for (let layer = 0; layer < 2; layer++) {
        b.fillStyle = layer ? '#998ca7' : '#b7a4b7';
        b.beginPath();
        b.moveTo(0, h);
        for (let x = -8; x < w + 12; x += 8) {
          const n = x / w * 12;
          b.lineTo(x, horizon - h * (.025 + .034 * Math.sin(n + layer * 4) + .022 * Math.sin(n * 2.3 + layer) + .012 * Math.sin(n * 5)) + (layer * .023 * h));
        }
        b.lineTo(w, h);
        b.fill();
      }
      for (let i = 0; i < 39; i++) {
        const x = (i + seed(i, 6)) * (w / 39);
        const bh = h * (.026 + .083 * seed(i, 7));
        const bw = bh * (.2 + seed(i, 9) * .24);
        const y = horizon + 3;
        b.fillStyle = i % 3 ? '#a696ad' : '#978ba5';
        b.fillRect(x - bw / 2, y - bh, bw, bh);
        b.beginPath();
        b.moveTo(x - bw * .8, y - bh);
        b.lineTo(x, y - bh * 1.58);
        b.lineTo(x + bw * .8, y - bh);
        b.fill();
        if (i % 3 === 0) {
          b.fillStyle = '#f7d1b7';
          b.fillRect(x - 1, y - bh * .8, 2, bh * .2);
        }
      }
      this.skyCache = { stage, buffer, horizon };
    }
    c.drawImage(this.skyCache.buffer, 0, 0);
    const far = this.project(0, this.camera.z - 155).y;
    c.fillStyle = L.ground[0];
    c.fillRect(0, far, w, h - far);
  }
  ground(s, L) {
    const c = this.ctx;
    const t = 6;
    const cz = this.camera.z;
    const cx = this.camera.x;
    // The sky pass has already painted the base paving colour. Batch the contrasting
    // stones and inlays across the court so moving the camera costs a few fills.
    const stones = new Path2D();
    const diamonds = new Path2D();
    const petals = new Path2D();
    const grid = [];
    for (let j = Math.floor((cz - 89) / t); j <= Math.ceil((cz + 10) / t); j++) {
      const z = j * t;
      const back = this.project(cx, z);
      const front = this.project(cx, z + t);
      if (front.y < 0 || back.y > this.h + 1 || front.d < 1) continue;
      const half = this.w / (2 * back.k) + t;
      const start = Math.floor((cx - half) / t);
      const end = Math.ceil((cx + half) / t);
      const lines = new Path2D();
      lines.moveTo(0, back.y);
      lines.lineTo(this.w, back.y);
      const mid = this.project(cx, z + t / 2);
      for (let i = start; i <= end; i++) {
        const x = i * t - cx;
        const a = this.w / 2 + x * back.k;
        const b = this.w / 2 + x * front.k;
        const path = i % 3 === 0 || j % 3 === 0;
        lines.moveTo(a, back.y);
        lines.lineTo(b, front.y);
        if (path && ((i + j) & 1)) {
          stones.moveTo(a, back.y);
          stones.lineTo(a + t * back.k + .5, back.y);
          stones.lineTo(b + t * front.k + .5, front.y + .5);
          stones.lineTo(b, front.y + .5);
          stones.closePath();
        }
        const center = this.w / 2 + (x + t / 2) * mid.k;
        if (path && back.k > 5) {
          const radius = mid.k * .39;
          diamonds.moveTo(center, mid.y - radius * .48);
          diamonds.lineTo(center + radius, mid.y);
          diamonds.lineTo(center, mid.y + radius * .48);
          diamonds.lineTo(center - radius, mid.y);
          diamonds.closePath();
        } else if (!path && back.k > 6) {
          for (let n = 0; n < 3; n++) {
            const px = center + (seed(i + n, j) - .5) * 3 * mid.k;
            const py = mid.y + (seed(j + n, i) - .5) * mid.k;
            petals.moveTo(px + mid.k * .075, py);
            petals.ellipse(px, py, mid.k * .075, mid.k * .035, 0, 0, TAU);
          }
        }
      }
      grid.push({lines, width:clamp(back.k * .025, .45, 1.5)});
    }
    c.fillStyle = L.ground[1];
    c.fill(stones);
    c.strokeStyle = L.inlay + '62';
    for (const row of grid) {
      c.lineWidth = row.width;
      c.stroke(row.lines);
    }
    c.fillStyle = L.inlay + '88';
    c.fill(diamonds);
    c.fillStyle = L.inlay + 'aa';
    c.fill(petals);
    const horizon = this.base - this.f * .324 / .946;
    const grad = c.createLinearGradient(0, horizon, 0, horizon + this.f * .21);
    grad.addColorStop(0, L.sky[2]);
    grad.addColorStop(1, L.sky[2] + '00');
    c.fillStyle = grad;
    c.fillRect(0, this.project(cx, cz - 155).y, this.w, this.f * .22);
    for (const [x, z, axis] of [[-LIMIT - .3, cz, 0], [LIMIT + .3, cz, 0], [cx, -LIMIT - .3, 1], [cx, LIMIT + .3, 1]]) {
      const pts = axis ? [[x - 100, z, 0], [x + 100, z, 0], [x + 100, z + .22, 0], [x - 100, z + .22, 0]] : [[x, cz - 79, 0], [x + .2, cz - 79, 0], [x + .2, cz + 8, 0], [x, cz + 8, 0]];
      this.face(pts, '#ddaa69');
    }
  }
  warnings(s) {
    for (const w of s.warnings) {
      const p = this.project(w.x, w.z);
      this.circ(p.x, p.y, p.k * w.r, p.k * w.r * .5, '#a92b5e66');
      this.ring(w.x, w.z, w.r, '#fc577a', 3);
      this.ring(w.x, w.z, w.r * (1 - w.t / 1.55), '#ffe7bf', 2);
    }
  }
  backdrop(state, palette) {
    const {x, z} = this.camera;
    const previous = this.terrain;
    if (!previous || previous.stage !== state.stage || previous.base !== this.base ||
        Math.abs(x - previous.x) + Math.abs(z - previous.z) > .012) {
      const buffer = previous?.buffer || document.createElement('canvas');
      const density = Math.min(1, this.pixelRatio);
      const width = Math.ceil(this.w * density);
      const height = Math.ceil(this.h * density);
      if (buffer.width !== width || buffer.height !== height) {
        buffer.width = width;
        buffer.height = height;
      }
      const screen = this.ctx;
      this.ctx = buffer.getContext('2d', {alpha:false});
      this.ctx.setTransform(density, 0, 0, density, 0, 0);
      this.sky(state.stage, palette);
      this.ground(state, palette);
      this.ctx = screen;
      this.terrain = {buffer, stage:state.stage, base:this.base, x, z};
    }
    this.ctx.drawImage(this.terrain.buffer, 0, 0, this.w, this.h);
  }
  ring(x, z, r, color, width) {
    const c = this.ctx;
    c.beginPath();
    for (let i = 0; i <= 32; i++) {
      const a = TAU * i / 32;
      const p = this.project(x + r * Math.cos(a), z + r * Math.sin(a));
      if (i) {
        c.lineTo(p.x, p.y);
      }
      else {
        c.moveTo(p.x, p.y);
      }
    }
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
  }
  box(x, z, w, d, y, h, col) {
    const a = x - w / 2;
    const b = x + w / 2;
    const n = z - d / 2;
    const f = z + d / 2;
    this.face([[a, f, y], [b, f, y], [b, f, h], [a, f, h]], col[1]);
    const side = x > this.camera.x ? a : b;
    this.face([[side, n, y], [side, f, y], [side, f, h], [side, n, h]], col[2]);
    this.face([[a, n, h], [b, n, h], [b, f, h], [a, f, h]], col[0]);
  }
  prop(o, L, time, stage) {
    const { x, z, k } = o;
    const c = this.ctx;
    const p = this.project(x, z);
    const stone = L.masonry;
    const gold = ['#ffedb2', '#d6ad69', '#997989'];
    this.circ(p.x, p.y, p.k * 1.5, p.k * .48, '#77647834');
    if (stage === 2 && (k === 'obelisk' || k === 'tree')) {
      this.box(x, z, 3.4, 2.6, 0, .32, stone);
      this.face([[x - 1.52, z - 1.12, .33], [x + 1.52, z - 1.12, .33], [x + 1.52, z + 1.12, .33], [x - 1.52, z + 1.12, .33]], '#7fb1c1');
      this.box(x, z, .59, .59, .33, 1.2, stone);
      const crown = this.project(x, z, 1.27);
      this.circ(crown.x, crown.y, p.k * .72, p.k * .21, stone[1]);
      this.circ(crown.x, crown.y - p.k * .07, p.k * .7, p.k * .19, '#bbebeb');
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        for (let j = 0; j <= 8; j++) {
          const u = j / 8;
          const a = i * TAU / 5;
          const q = this.project(x + Math.cos(a) * u, z + Math.sin(a) * u, 1.3 + Math.sin(u * Math.PI) * .7 - u * .93);
          if (j) {
            c.lineTo(q.x, q.y);
          }
          else {
            c.moveTo(q.x, q.y);
          }
        }
        c.strokeStyle = '#dff7f3';
        c.lineWidth = Math.max(1, p.k * .04);
        c.stroke();
      }
    }
    else if (stage >= 3 && (k === 'arch' || k === 'tree')) {
      this.box(x, z, 1.55, 1.5, 0, .32, stone);
      this.box(x, z, .8, .81, .32, .72, gold);
      this.box(x, z, .36, .38, .72, 1.36, stone);
      const center = this.project(x, z, 2.45);
      const r = p.k * 1.36;
      for (let i = 0; i < 3; i++) {
        c.save();
        c.translate(center.x, center.y);
        c.rotate(i * .92 + o.phase + time * .07);
        c.beginPath();
        c.ellipse(0, 0, r, r * (i === 2 ? .86 : .35), 0, 0, TAU);
        c.lineWidth = Math.max(1, p.k * .075);
        c.strokeStyle = gold[i === 1 ? 1 : 0];
        c.stroke();
        c.restore();
      }
      this.circ(center.x, center.y, r * .29, r * .29, stage === 4 ? '#655370' : '#d49bb5');
      this.star(center.x - r * .09, center.y - r * .09, r * .16, '#f9dfb7');
    }
    else if (k === 'tree') {
      this.box(x, z, 1.38, 1.38, 0, .36, stone);
      this.box(x, z, .3, .34, .34, 2.5, ['#bea0a0', '#926d7a', '#795a72']);
      const top = this.project(x, z, 2.8);
      const r = p.k * (stage === 3 ? 1.25 : 1.55);
      for (let i = 0; i < 8; i++) {
        const a = i * 2.4;
        const ox = Math.cos(a) * r * .52;
        const oy = Math.sin(a) * r * .4;
        c.save();
        c.translate(top.x + ox, top.y + oy);
        this.poly([[-.61 * r, 0], [-.37 * r, -.47 * r], [.18 * r, -.6 * r], [.55 * r, -.17 * r], [.44 * r, .31 * r], [-.18 * r, .47 * r]], i % 3 ? L.leaf[0] : L.leaf[1]);
        this.poly([[-.61 * r, 0], [-.18 * r, .47 * r], [.44 * r, .31 * r], [.55 * r, -.17 * r], [.1 * r, .07 * r]], L.leaf[1] + '85');
        c.restore();
      }
    }
    else if (k === 'arch') {
      for (const side of [-1, 1]) {
        const xx = x + side * 1.6;
        this.box(xx, z, .72, .74, 0, .34, stone);
        this.box(xx, z, .4, .45, .34, 3.24, stone);
        this.box(xx, z, .68, .63, 3.04, 3.31, gold);
      }
      for (let i = 0; i < 10; i++) {
        const a = i * Math.PI / 10;
        const b = (i + 1) * Math.PI / 10;
        this.face([[x + Math.cos(a) * 1.81, z + .22, 3.23 + Math.sin(a) * 1.64], [x + Math.cos(b) * 1.81, z + .22, 3.23 + Math.sin(b) * 1.64], [x + Math.cos(b) * 1.41, z + .22, 3.23 + Math.sin(b) * 1.32], [x + Math.cos(a) * 1.41, z + .22, 3.23 + Math.sin(a) * 1.32]], i % 2 ? stone[0] : stone[1]);
      }
      const flutter = Math.sin(time * 1.6 + o.phase) * .1;
      this.face([[x - .42, z, 4.71], [x + .42, z, 4.71], [x + .42, z + flutter, 3.59], [x, z + flutter, 3.26], [x - .42, z + flutter, 3.59]], L.leaf[1]);
      this.face([[x, z + .026, 4.39], [x + .11, z + .026, 4.12], [x, z + .026, 3.9], [x - .11, z + .026, 4.12]], gold[0]);
    }
    else if (k === 'obelisk') {
      this.box(x, z, 1.23, 1.23, 0, .29, stone);
      this.box(x, z, .88, .88, .29, .63, stone);
      this.box(x, z, .18, .18, .63, 1.1, gold);
      const t = this.project(x, z, 2.9);
      const m = this.project(x, z, 1.76);
      const b = this.project(x, z, .89);
      const r = m.k * .54;
      this.poly([[t.x, t.y], [m.x + r, m.y], [b.x, b.y], [m.x - r, m.y]], L.leaf[1]);
      this.poly([[t.x, t.y], [m.x - r, m.y], [m.x, m.y + .04 * r]], '#fff1e6');
      this.poly([[t.x, t.y], [m.x + r, m.y], [m.x, m.y + .04 * r]], L.leaf[0]);
    }
    else {
      this.box(x, z, .62, .65, 0, .29, stone);
      this.box(x, z, .15, .15, .29, 2.02, gold);
      this.box(x, z, .61, .54, 1.95, 2.1, gold);
      this.box(x, z, .4, .39, 2.1, 2.59, ['#fff4c7', '#ffe4a1', '#e6b884']);
      this.box(x, z, .65, .57, 2.59, 2.73, gold);
    }
  }
  cachedProp(object, palette, time, stage, point) {
    // Near-camera architecture fills the screen and benefits from exact clipping.
    if (point.d < 7) {
      this.prop(object, palette, time, stage);
      return;
    }
    const angle = (object.x - this.camera.x) / point.d;
    let frame = object.frame;
    const animated = stage >= 3 && (object.k === 'tree' || object.k === 'arch');
    const animateRing = animated && (time < frame?.time || time - frame?.time > .48 + object.phase * .04);
    if (!frame || frame.stage !== stage || animateRing ||
        Math.abs(angle - frame.angle) > .065 || Math.abs(point.k / frame.scale - 1) > .09) {
      // Enclose the projected architecture before drawing into its transparent tile.
      const corners = [];
      for (const dx of [-2.65, 2.65]) {
        for (const dz of [-1.7, 1.7]) {
          for (const h of [-.45, 5.15]) {
            corners.push(this.project(object.x + dx, object.z + dz, h));
          }
        }
      }
      const left = Math.floor(Math.min(...corners.map(p => p.x))) - 2;
      const top = Math.floor(Math.min(...corners.map(p => p.y))) - 2;
      const width = Math.ceil(Math.max(...corners.map(p => p.x))) - left + 2;
      const height = Math.ceil(Math.max(...corners.map(p => p.y))) - top + 2;
      const density = Math.min(this.pixelRatio, 480 / Math.max(width, height));
      const buffer = frame?.buffer || document.createElement('canvas');
      buffer.width = Math.max(1, Math.ceil(width * density));
      buffer.height = Math.max(1, Math.ceil(height * density));
      const screen = this.ctx;
      this.ctx = buffer.getContext('2d');
      this.ctx.setTransform(density, 0, 0, density, -left * density, -top * density);
      this.prop(object, palette, time, stage);
      this.ctx = screen;
      frame = {buffer, stage, angle, time, scale:point.k, x:left - point.x,
        y:top - point.y, width:buffer.width / density, height:buffer.height / density};
      object.frame = frame;
    }
    const factor = point.k / frame.scale;
    this.ctx.drawImage(frame.buffer, point.x + frame.x * factor, point.y + frame.y * factor,
      frame.width * factor, frame.height * factor);
  }
  actor(o, s) {
    const c = this.ctx;
    const p = this.project(o.x, o.z);
    const hero = o === s.player;
    const k = hero ? 'lumina' : o.kind;
    const sizes = assets[k];
    const boss = k === 'boss';
    const flier = boss || k === 'moth';
    const height = boss ? 3.95 : hero ? 2.05 : flier ? 1.03 : 1.85;
    const bob = hero ? (o.moving ? .06 * Math.abs(Math.sin(o.walk)) : 0) : flier ? .22 + .11 * Math.sin(s.time * 4 + o.phase) : .06 * Math.abs(Math.sin(s.time * 6 + o.phase));
    const top = this.project(o.x, o.z, height + bob);
    const base = this.project(o.x, o.z, bob);
    const h = base.y - top.y;
    this.circ(p.x, p.y, p.k * (boss ? 1.35 : hero ? .52 : .43), p.k * (boss ? .44 : .18), '#57435a4f');
    if (sizes) {
      let image = sizes[0];
      const pixels = h * this.pixelRatio;
      for (let i = 1; i < sizes.length && sizes[i].height >= pixels; i++) {
        image = sizes[i];
      }
      const stretch = flier ? 1 + Math.sin(s.time * 6 + o.phase) * .07 : 1;
      const width = h * sizes[0].width / sizes[0].height * stretch;
      if (hero && o.inv > 0) c.globalAlpha = .65 + .35 * Math.abs(Math.sin(s.time * 18));
      else if (o.hit > 0) c.globalAlpha = .66;
      if (hero && o.face < 0) {
        c.save();
        c.translate(base.x, base.y);
        c.scale(-1, 1);
        c.drawImage(image, -width / 2, -h, width, h);
        c.restore();
      } else {
        c.drawImage(image, base.x - width / 2, base.y - h, width, h);
      }
      c.globalAlpha = 1;
      return;
    }
    c.save();
    c.translate(base.x, base.y);
    if (hero && o.inv > 0) {
      c.globalAlpha = .65 + .35 * Math.abs(Math.sin(s.time * 18));
    }
    {
      c.scale(h / 100, h / 100);
      if (hero || k === 'knight') {
        if (hero) {
          c.scale(o.face, 1);
        }
        this.poly([[-13, -30], [-11, -1], [-4, -1], [0, -29], [5, -1], [12, -1], [13, -31]], '#413752');
        this.poly([[0, -77], [-15, -62], [-12, -51], [-23, -26], [0, -21], [22, -29], [12, -51], [14, -65]], hero ? '#fff4df' : '#43415e', '#7d667a');
        this.poly([[-16, -39], [17, -37], [22, -29], [0, -21], [-23, -26]], hero ? '#e3b57f' : '#77799e');
        this.circ(0, -77, 13, 15, '#f5ccae');
        this.poly([[-16, -75], [-13, -91], [0, -99], [14, -90], [17, -67], [6, -70], [1, -82], [-6, -68], [-14, -58]], hero ? '#ebc47f' : '#454562');
        this.poly([[-1, -64], [-14, -71], [-16, -57], [-3, -60], [-18, -35], [-8, -39], [0, -57], [12, -37], [16, -35], [7, -60], [17, -59], [14, -71]], '#d77493');
        if (hero) {
          c.rotate(.16);
          c.fillStyle = '#a27a51';
          c.fillRect(21, -82, 2.5, 54);
          this.star(22, -85, 8, '#ffe490');
        }
      }
      else {
        const r = boss ? 65 : 57;
        for (const sign of [-1, 1]) {
          c.save();
          c.scale(sign, 1);
          this.poly([[0, -44], [r * .45, -85], [r, -91], [r * .9, -57], [r * .63, -43], [r * .73, -21], [r * .4, -9], [0, -37]], boss ? '#715181' : '#82679e', '#594968');
          this.poly([[7, -44], [r * .56, -70], [r * .75, -70], [r * .55, -53]], '#e9b2ba');
          c.restore();
        }
        this.circ(0, -43, 5, 19, '#493d5b');
      }
    }
    c.restore();
  }
  star(x, y, r, color) {
    this.poly([[x, y - r], [x + r * .24, y - r * .24], [x + r, y], [x + r * .24, y + r * .24], [x, y + r], [x - r * .24, y + r * .24], [x - r, y], [x - r * .24, y - r * .24]], color);
  }
  draw(s, dt) {
    // The backing store can shrink under sustained load. Projection, HUD and touch
    // coordinates always use CSS pixels, so the camera and controls do not move.
    if (s.mode === 'play' && dt > 0) {
      this.frameCost += (dt - this.frameCost) * .12;
      this.scaleSamples++;
      const nativeDensity = Math.min(devicePixelRatio || 1, 1.65);
      const floor = Math.max(.54, Math.min(1, 310 / (Math.min(this.w, this.h) * nativeDensity)));
      let scale = this.renderScale;
      if (this.scaleSamples >= 12 && this.frameCost > .035) {
        scale = Math.max(floor, scale * .78);
      } else if (this.scaleSamples >= 240 && this.frameCost < .019) {
        scale = Math.min(1, scale + .09);
      }
      if (Math.abs(scale - this.renderScale) > .02) {
        this.renderScale = scale;
        this.scaleSamples = 0;
        this.resize();
      }
    }
    const c = this.ctx;
    const title = s.mode === 'title';
    const target = s.player;
    const lerp = title ? 1 : 1 - Math.exp(-dt * 8);
    this.base = this.h * (title && this.w < this.h ? .34 : .49);
    this.camera.x += ((title ? (this.w < this.h ? -.5 : -3.4) : target.x) - this.camera.x) * lerp;
    this.camera.z += ((title ? .6 : target.z) - this.camera.z) * lerp;
    const L = locales[s.stage - 1];
    this.backdrop(s, L);
    this.warnings(s);
    const objects = [];
    const add = (o, k) => {
      const p = this.project(o.x, o.z);
      if (p.d > 1.8 && p.d < 78 && p.x > -p.k * 4 && p.x < this.w + p.k * 4 && p.y < this.h + p.k * 5) {
        objects.push({ o, k });
      }
    };
    for (const o of this.props) {
      add(o, 'prop');
    }
    for (const e of s.enemies) {
      add(e, 'actor');
    }
    for (const g of s.gems) {
      add(g, 'gem');
    }
    for (const b of s.shots) {
      add(b, 'shot');
    }
    for (const e of s.effects) {
      add(e, 'effect');
    }
    add(target, 'actor');
    objects.sort((a, b) => a.o.z - b.o.z);
    for (const { o, k } of objects) {
      if (k === 'prop') {
        const p = this.project(o.x, o.z);
        const pl = this.project(target.x, target.z, 1);
        c.save();
        if (o.z > target.z && Math.abs(p.x - pl.x) < p.k * 2.4 && p.y - p.k * 5 < pl.y) {
          c.globalAlpha = .28;
        }
        this.cachedProp(o, L, s.time, s.stage, p);
        c.restore();
      }
      else if (k === 'actor') {
        this.actor(o, s);
      }
      else if (k === 'gem') {
        const p = this.project(o.x, o.z, .43 + .09 * Math.sin(s.time * 3 + o.x));
        const r = Math.max(2, p.k * .24);
        this.poly([[p.x, p.y - r], [p.x + r * .7, p.y], [p.x, p.y + r], [p.x - r * .7, p.y]], '#3faeb9', '#4c8298');
        this.poly([[p.x, p.y - r], [p.x, p.y + r * .3], [p.x - r * .7, p.y]], '#aaf8e7');
      }
      else if (k === 'shot') {
        const p = this.project(o.x, o.z, 1.05);
        const q = this.project(o.x - (o.dx || 0) * .85, o.z - (o.dz || 0) * .85, 1.05);
        c.strokeStyle = '#fff1b9';
        c.lineWidth = Math.max(2, p.k * .1);
        c.beginPath();
        c.moveTo(q.x, q.y);
        c.lineTo(p.x, p.y);
        c.stroke();
        this.star(p.x, p.y, p.k * .25, '#fff9d8');
      }
      else {
        const p = this.project(o.x, o.z, .9);
        if (o.kind === 'spark') {
          this.star(p.x, p.y, p.k * .48 * o.t / .4, '#ffedbd');
        }
        else {
          this.ring(o.x, o.z, o.r * (1 - o.t / .45), o.kind === 'burst' ? '#ff7696' : '#fff3d5', 3);
        }
      }
    }
    for (let i = 0; i < 12; i++) {
      const x = (seed(i, 47) * this.w + s.time * (3 + i % 4)) % this.w;
      const y = (seed(i, 43) * this.h + s.time * (5 + i % 3)) % this.h;
      this.circ(x, y, 2.2, 1, '#ffeddfaa');
    }
  }
}
