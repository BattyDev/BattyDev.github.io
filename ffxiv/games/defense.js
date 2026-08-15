/* Hold the Line — lane defense with the FC as the garrison.
 *
 * The trinity maps about as literally as it can: tanks stop things moving,
 * healers sustain and haste, DPS delete. Stats come from the same derivation the
 * arena uses, so a character who is strong there is strong here.
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $("field"), ctx = canvas.getContext("2d");
  var W = canvas.width, H = canvas.height;

  /* Figures are drawn at double the old size, so the board is scaled to match —
   * otherwise the closest posts (120 apart) would overlap a 76px portrait. */
  var SCALE = 1.4;
  var sc = function (pts) {
    return pts.map(function (p) { return [p[0] * SCALE, p[1] * SCALE]; });
  };

  /* path the enemies walk, in unscaled design coords */
  var PATH = sc([
    [-30, 90], [180, 90], [230, 160], [230, 300], [300, 360],
    [560, 360], [620, 300], [620, 180], [690, 120], [880, 120]
  ]);

  /* posts flank the path; each is a placement slot */
  var POSTS = sc([
    [120, 170], [150, 30], [310, 120], [310, 240], [170, 300],
    [400, 290], [420, 430], [540, 250], [700, 300], [720, 60], [830, 210]
  ]);

  var STARTING_GIL = 220;
  var CRYSTAL_MAX = 100;

  var roster = [], bench = [], byId = {};
  var towers = [], enemies = [], shots = [];
  var selected = null;
  var gil = STARTING_GIL, crystal = CRYSTAL_MAX, wave = 0;
  var running = false, spawning = null, raf = null, lastT = 0;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- path helpers ---------- */

  var pathLen = 0, segs = [];
  (function measure() {
    for (var i = 0; i < PATH.length - 1; i++) {
      var dx = PATH[i + 1][0] - PATH[i][0], dy = PATH[i + 1][1] - PATH[i][1];
      var l = Math.hypot(dx, dy);
      segs.push({ x: PATH[i][0], y: PATH[i][1], dx: dx / l, dy: dy / l, len: l, start: pathLen });
      pathLen += l;
    }
  })();

  function pointAt(d) {
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (d <= s.start + s.len || i === segs.length - 1) {
        var t = Math.max(0, d - s.start);
        return { x: s.x + s.dx * t, y: s.y + s.dy * t };
      }
    }
    return { x: PATH[PATH.length - 1][0], y: PATH[PATH.length - 1][1] };
  }

  /* ---------- units ---------- */

  /* ranges are in board units, so they scale with the board */
  function towerStats(u) {
    var p = u.power;
    if (u.role === "tank") {
      return { range: 74 * SCALE, dmg: 4 + 6 * p, rate: 0.9, hold: 1.5 + p, label: "holds" };
    }
    if (u.role === "healer") {
      return { range: 96 * SCALE, dmg: 0, rate: 1.4, mend: 1.2 + 2.4 * p, haste: 0.28, label: "mends" };
    }
    return { range: (118 + 34 * p) * SCALE, dmg: 15 + 34 * p, rate: 1.1 + 0.7 * p, label: "strikes" };
  }

  function benchCost(u) { return 30 + u.cost * 11; }

  /* ---------- bench UI ---------- */

  function renderBench() {
    var box = $("bench");
    box.innerHTML = "";
    bench.forEach(function (u) {
      var cost = benchCost(u);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "unit-card role-" + u.role +
        (selected === u ? " is-selected" : "") + (gil < cost ? " is-locked" : "");
      b.innerHTML =
        '<span class="face">' +
          '<img class="job" src="' + u.icon + '" alt="" loading="lazy"></span>' +
        '<span class="who"><b>' + esc(u.name) + '</b>' +
        '<small><span class="role-pill">' + u.roleLabel + '</span> ' + esc(u.job) + '</small></span>' +
        '<span class="cost">' + cost + "</span>";
      /* style API, not an attribute string — the URL would break the quoting */
      WHGame.stageArt(b.querySelector(".face"), u);
      b.addEventListener("click", function () {
        if (gil < cost) return;
        selected = selected === u ? null : u;
        renderBench();
      });
      box.appendChild(b);
    });
  }

  function updateHud() {
    $("wave").textContent = wave;
    $("gil").textContent = Math.floor(gil);
    var pct = Math.max(0, crystal / CRYSTAL_MAX);
    $("crystal").textContent = Math.round(pct * 100) + "%";
    $("crystal-fill").style.width = (pct * 100) + "%";
  }

  /* ---------- placement ---------- */

  function canvasPos(ev) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) * (W / r.width),
      y: (ev.clientY - r.top) * (H / r.height)
    };
  }

  canvas.addEventListener("click", function (ev) {
    if (!selected) return;
    var p = canvasPos(ev);
    var best = null, bestD = 42 * SCALE;
    POSTS.forEach(function (post, i) {
      if (towers.some(function (t) { return t.post === i; })) return;
      var d = Math.hypot(post[0] - p.x, post[1] - p.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best === null) return;

    var cost = benchCost(selected);
    if (gil < cost) return;
    gil -= cost;

    var st = towerStats(selected);
    towers.push({
      u: selected, post: best, x: POSTS[best][0], y: POSTS[best][1],
      st: st, cd: 0, haste: 0
    });
    bench = bench.filter(function (u) { return u !== selected; });
    selected = null;
    renderBench(); updateHud();
  });

  /* ---------- waves ---------- */

  function startWave() {
    wave++;
    running = true;
    $("start").disabled = true;
    $("start").textContent = "Wave " + wave + " incoming…";

    var count = 4 + wave * 2;
    var hp = 42 * Math.pow(1.28, wave - 1);
    /* scaled with the board so the walk stays about 29s end to end */
    var spd = (44 + wave * 2.2) * SCALE;
    var made = 0;

    spawning = setInterval(function () {
      enemies.push({
        d: 0, hp: hp, maxHp: hp, spd: spd, hold: 0,
        boss: wave % 5 === 0 && made === count - 1
      });
      if (enemies[enemies.length - 1].boss) {
        var e = enemies[enemies.length - 1];
        e.hp = e.maxHp = hp * 6; e.spd = spd * 0.66;
      }
      if (++made >= count) { clearInterval(spawning); spawning = null; }
    }, Math.max(240, 620 - wave * 18));

    updateHud();
  }

  function waveDone() {
    running = false;
    gil += 60 + wave * 18;
    /* the company sends another face up after each wave */
    var fresh = roster.filter(function (u) {
      return !towers.some(function (t) { return t.u.id === u.id; }) && bench.indexOf(u) === -1;
    });
    if (fresh.length) {
      var rng = WHGame.makeRng(WHGame.hashString("reinforce" + wave));
      bench = bench.concat(WHGame.shuffled(fresh, rng).slice(0, 2));
    }
    $("start").disabled = false;
    $("start").textContent = "Begin wave " + (wave + 1);
    renderBench(); updateHud();
  }

  /* ---------- simulation ---------- */

  function tick(dt) {
    /* healers haste neighbours and mend the crystal */
    towers.forEach(function (t) { t.haste = 0; });
    towers.forEach(function (t) {
      if (t.u.role !== "healer") return;
      towers.forEach(function (o) {
        if (o === t) return;
        if (Math.hypot(o.x - t.x, o.y - t.y) <= t.st.range) o.haste += t.st.haste;
      });
      crystal = Math.min(CRYSTAL_MAX, crystal + t.st.mend * dt * 0.35);
    });

    /* towers act */
    towers.forEach(function (t) {
      t.cd -= dt * (1 + t.haste);
      if (t.cd > 0) return;
      /* target whoever is in range and furthest along the path — the one closest
       * to the crystal is the one worth killing */
      var target = null;
      enemies.forEach(function (e) {
        var p = pointAt(e.d);
        if (Math.hypot(p.x - t.x, p.y - t.y) > t.st.range) return;
        if (target === null || e.d > target.d) target = e;
      });
      if (!target) return;
      t.cd = 1 / t.st.rate;

      if (t.u.role === "tank") {
        target.hold = Math.max(target.hold, t.st.hold);
        target.hp -= t.st.dmg;
      } else if (t.u.role === "dps") {
        target.hp -= t.st.dmg;
        var p = pointAt(target.d);
        shots.push({ x1: t.x, y1: t.y, x2: p.x, y2: p.y, life: 0.14, role: t.u.role });
      }
    });

    /* enemies advance */
    for (var i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      if (e.hp <= 0) {
        gil += e.boss ? 60 : 9;
        enemies.splice(i, 1);
        continue;
      }
      if (e.hold > 0) { e.hold -= dt; continue; }
      e.d += e.spd * dt;
      if (e.d >= pathLen) {
        crystal -= e.boss ? 25 : 7;
        enemies.splice(i, 1);
      }
    }

    for (var j = shots.length - 1; j >= 0; j--) {
      shots[j].life -= dt;
      if (shots[j].life <= 0) shots.splice(j, 1);
    }

    if (crystal <= 0) return gameOver();
    if (running && !spawning && enemies.length === 0) waveDone();
    updateHud();
  }

  function gameOver() {
    running = false;
    cancelAnimationFrame(raf); raf = null;
    if (spawning) { clearInterval(spawning); spawning = null; }
    $("verdict").hidden = false;
    $("verdict-title").textContent = "The crystal falls";
    $("verdict-text").textContent = "The company held for " + (wave - 1) + " full wave" +
      (wave - 1 === 1 ? "" : "s") + ".";
    $("restart").hidden = false;
    $("start").disabled = true;
  }

  /* ---------- rendering ---------- */


  var ROLE_HEX = { tank: "#4d80c4", healer: "#58b070", dps: "#c4544d" };

  /* ctx.roundRect is not everywhere yet, so trace it by hand */
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    /* path */
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.strokeStyle = "#122b39"; ctx.lineWidth = 34 * SCALE;
    ctx.beginPath(); PATH.forEach(function (p, i) { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); ctx.stroke();
    ctx.strokeStyle = "#1b3d50"; ctx.lineWidth = 26 * SCALE;
    ctx.stroke();

    /* crystal at the end */
    var end = PATH[PATH.length - 1];
    ctx.save();
    ctx.translate(end[0] - 12 * SCALE, end[1]);
    ctx.fillStyle = crystal > 30 ? "#7cc0f0" : "#e07a72";
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.moveTo(0, -31); ctx.lineTo(20, 0); ctx.lineTo(0, 31); ctx.lineTo(-20, 0);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    /* empty posts */
    POSTS.forEach(function (p, i) {
      if (towers.some(function (t) { return t.post === i; })) return;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 21, 0, Math.PI * 2);
      ctx.strokeStyle = selected ? "rgba(198,166,100,.85)" : "rgba(198,166,100,.28)";
      ctx.setLineDash([5, 5]); ctx.lineWidth = 2.5; ctx.stroke(); ctx.setLineDash([]);
    });

    /* towers */
    towers.forEach(function (t) {
      var hex = ROLE_HEX[t.u.role];
      if (selected) {
        ctx.beginPath(); ctx.arc(t.x, t.y, t.st.range, 0, Math.PI * 2);
        ctx.fillStyle = hex + "12"; ctx.fill();
      }
      /* head-to-waist crop in a square, at double the previous size */
      var w = 76, h = 76, x = t.x - w / 2, y = t.y - h / 2;

      /* drop shadow so the portrait lifts off the board — no ground ellipse,
       * since a head-and-torso crop has no feet to cast one */
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      ctx.fillStyle = "#0b1d28"; roundRect(x, y, w, h, 3); ctx.fill();
      ctx.restore();

      ctx.save();
      roundRect(x, y, w, h, 3); ctx.clip();
      var rec = WHGame.stagedImage(t.u);
      var img = rec.img;
      if (img && img.complete && img.naturalWidth) {
        if (rec.full) {
          /* crop the full-body render to head-and-torso */
          var c = WHGame.PORTRAIT_CROP;
          ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, x, y, w, h);
        } else {
          ctx.drawImage(img, x, y, w, h);   // headshot placeholder, already framed
        }
      } else { ctx.fillStyle = "#12283a"; ctx.fillRect(x, y, w, h); }
      /* soften the bottom edge of the crop */
      var g = ctx.createLinearGradient(0, y + h * 0.72, 0, y + h);
      g.addColorStop(0, "rgba(11,29,40,0)"); g.addColorStop(1, "rgba(11,29,40,.75)");
      ctx.fillStyle = g; ctx.fillRect(x, y + h * 0.72, w, h * 0.28);
      ctx.restore();

      roundRect(x, y, w, h, 3);
      ctx.strokeStyle = hex; ctx.lineWidth = 2; ctx.stroke();
      if (t.haste > 0) {
        roundRect(x - 3, y - 3, w + 6, h + 6, 4);
        ctx.strokeStyle = "rgba(88,176,112,.75)"; ctx.lineWidth = 1.5; ctx.stroke();
      }
    });

    /* shots */
    shots.forEach(function (s) {
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2);
      ctx.strokeStyle = "rgba(230,207,149," + (s.life / 0.14) + ")";
      ctx.lineWidth = 2; ctx.stroke();
    });

    /* enemies */
    enemies.forEach(function (e) {
      var p = pointAt(e.d);
      var r = e.boss ? 21 : 13;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = e.hold > 0 ? "#8a6bb0" : (e.boss ? "#c4544d" : "#a0524c");
      ctx.fill();
      ctx.strokeStyle = "#e6cf95"; ctx.lineWidth = 1.5; ctx.stroke();
      /* hp pip */
      ctx.fillStyle = "#0a1a23"; ctx.fillRect(p.x - r, p.y - r - 10, r * 2, 4);
      ctx.fillStyle = "#7cc0f0"; ctx.fillRect(p.x - r, p.y - r - 10, r * 2 * Math.max(0, e.hp / e.maxHp), 4);
    });
  }

  /* live handles on the simulation, for poking at balance from the console */
  window.__def = {
    enemies: enemies, towers: towers,
    stats: function () {
      return { pathLen: pathLen, wave: wave, running: running, gil: gil, crystal: crystal,
               enemyD: enemies.map(function (e) { return Math.round(e.d); }),
               towerPts: towers.map(function (t) { return [t.x, t.y, t.u.role, Math.round(t.st.range)]; }) };
    }
  };

  function loop(now) {
    var dt = Math.min(0.05, (now - lastT) / 1000 || 0);
    lastT = now;
    if (running || enemies.length) tick(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  /* ---------- boot ---------- */

  $("start").addEventListener("click", function () { if (!running) startWave(); });
  $("restart").addEventListener("click", function () { location.reload(); });

  WHGame.loadRoster().then(function (units) {
    roster = units;
    roster.forEach(function (u) { byId[u.id] = u; });

    /* opening hand: guarantee a tank and a healer exist to buy */
    var rng = WHGame.makeRng(WHGame.hashString("bench"));
    var tank = roster.filter(function (u) { return u.role === "tank"; });
    var heal = roster.filter(function (u) { return u.role === "healer"; });
    var dps = roster.filter(function (u) { return u.role === "dps"; });
    bench = [].concat(
      WHGame.shuffled(tank, rng).slice(0, 2),
      WHGame.shuffled(heal, rng).slice(0, 2),
      WHGame.shuffled(dps, rng).slice(0, 3)
    );

    $("loading").hidden = true;
    $("game").hidden = false;
    $("stamp").textContent = units.length + " adventurers";
    renderBench(); updateHud();
    lastT = performance.now();
    raf = requestAnimationFrame(loop);
  }).catch(function (err) {
    $("loading").innerHTML = '<div class="error">Could not load the roster: ' + esc(err.message) + "</div>";
  });
})();
