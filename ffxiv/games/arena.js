/* Wild Hearts Arena — party auto-battler.
 *
 * Combat is an ATB loop: every fighter fills a gauge at its own speed, acts when
 * full, and the whole thing is driven by a seeded RNG so a challenge code always
 * replays identically for whoever opens it.
 */
(function () {
  "use strict";

  var PARTY_SIZE = 4;
  /* Top four by cost come to 47, so this forces a real trade: one star and three
   * cheap bodies, or four solid mid-tier picks. */
  var BUDGET = 24;
  /* Fixed step, so a fight is the same length in simulated time no matter the
   * frame rate. Tuned to land around 15s — fast enough to rematch, slow enough
   * that the log reads rather than blurs. */
  var TICK_MS = 85;
  var MAX_TICKS = 700;     // judged on remaining HP if nobody has won by then

  var $ = function (id) { return document.getElementById(id); };

  var roster = [];
  var byId = {};
  var picked = [];
  var speed = 1;
  var sim = null;
  var timer = null;

  /* ---------- draft ---------- */

  function unitCard(u) {
    var b = document.createElement("button");
    b.className = "unit-card role-" + u.role;
    b.type = "button";
    b.dataset.id = u.id;
    b.innerHTML =
      '<span class="face">' +
        '<img class="job" src="' + u.icon + '" alt="" loading="lazy">' +
      '</span>' +
      '<span class="who">' +
        '<b>' + esc(u.name) + '</b>' +
        '<small><span class="role-pill">' + u.roleLabel + '</span> ' + esc(u.job) + ' Lv' + u.level + '</small>' +
      '</span>' +
      '<span class="cost">' + u.cost + '</span>';
    /* set via the style API, never inline in the markup — a URL in an attribute
     * string breaks out of the quoting */
    /* 35 cards, so defer the full-body art until each is scrolled near */
    WHGame.stageArt(b.querySelector(".face"), u, { lazy: true });
    b.title = u.name + " — " + u.job + " Lv" + u.level + "\n" +
              u.jobs100 + " jobs at 100 · " + u.race + " (" + u.passive.text + ")\n" +
              u.mounts + " mounts · " + u.minions + " minions";
    b.addEventListener("click", function () { toggle(u); });
    return b;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function spent() {
    return picked.reduce(function (n, u) { return n + u.cost; }, 0);
  }

  function toggle(u) {
    var i = picked.indexOf(u);
    if (i !== -1) picked.splice(i, 1);
    else {
      if (picked.length >= PARTY_SIZE) return;
      if (spent() + u.cost > BUDGET) return;
      picked.push(u);
    }
    renderDraft();
  }

  /* Cards are built once and then only re-styled. Rebuilding the grid on every
   * pick would reset each portrait to its headshot and flash the whole board. */
  function buildGrid() {
    var grid = $("roster");
    grid.innerHTML = "";
    roster.forEach(function (u) {
      u.el = unitCard(u);
      grid.appendChild(u.el);
    });
  }

  function renderDraft() {
    var s = spent();
    $("spent").textContent = s;
    $("budget").textContent = BUDGET;
    $("party-count").textContent = picked.length + " / " + PARTY_SIZE + " chosen";
    var pct = Math.min(100, (s / BUDGET) * 100);
    $("budget-fill").style.width = pct + "%";
    $("budget-fill").classList.toggle("over", s > BUDGET);

    var roles = { tank: 0, healer: 0, dps: 0 };
    picked.forEach(function (u) { roles[u.role]++; });
    $("picked-summary").innerHTML = picked.length
      ? "Party: " + roles.tank + " tank · " + roles.healer + " healer · " + roles.dps + " DPS" +
        (roles.healer === 0 && picked.length === PARTY_SIZE ? " — <b>no healer, bold choice</b>" : "") +
        (roles.tank === 0 && picked.length === PARTY_SIZE ? " — <b>nobody to hold the line</b>" : "")
      : "";

    roster.forEach(function (u) {
      if (!u.el) return;
      var isPicked = picked.indexOf(u) !== -1;
      var affordable = picked.length < PARTY_SIZE && s + u.cost <= BUDGET;
      u.el.classList.toggle("is-picked", isPicked);
      u.el.classList.toggle("is-locked", !isPicked && !affordable);
    });

    $("fight").disabled = picked.length !== PARTY_SIZE;
  }

  /* ---------- combat ---------- */

  function instance(u, side) {
    return {
      u: u, side: side,
      hp: u.maxHp, maxHp: u.maxHp,
      atb: Math.random() * 0, // filled deterministically below
      alive: true,
      shield: 0,
      el: null
    };
  }

  function makeSim(you, foe, seed) {
    var rng = WHGame.makeRng(seed);
    var a = you.map(function (u) { return instance(u, "you"); });
    var b = foe.map(function (u) { return instance(u, "foe"); });
    /* deterministic stagger so turn order is not a wall of simultaneous hits */
    a.concat(b).forEach(function (f) { f.atb = rng() * 60; });
    /* fx is a queue of things that happened, drained by the renderer. The sim
     * never touches the DOM, so it stays replayable and speed-independent. */
    return { rng: rng, you: a, foe: b, tick: 0, over: false, winner: null, log: [], fx: [] };
  }

  function livingOf(list) { return list.filter(function (f) { return f.alive; }); }

  /* Tanks soak: enemies pick a tank most of the time if one still stands. */
  function pickTarget(enemies, rng) {
    var live = livingOf(enemies);
    if (!live.length) return null;
    var tanks = live.filter(function (f) { return f.u.role === "tank"; });
    if (tanks.length && rng() < 0.62) return tanks[Math.floor(rng() * tanks.length)];
    return live[Math.floor(rng() * live.length)];
  }

  function lowestAlly(allies) {
    var live = livingOf(allies);
    if (!live.length) return null;
    return live.reduce(function (a, b) { return (a.hp / a.maxHp) <= (b.hp / b.maxHp) ? a : b; });
  }

  function act(s, f, allies, enemies) {
    var rng = s.rng;

    /* healer: top up the worst-off ally if anyone is hurt enough to matter */
    if (f.u.role === "healer") {
      var t = lowestAlly(allies);
      if (t && t.hp / t.maxHp < 0.72) {
        var amt = Math.round(f.u.heal * (0.85 + rng() * 0.3));
        var before = t.hp;
        t.hp = Math.min(t.maxHp, t.hp + amt);
        s.fx.push({ k: "heal", on: t, amt: t.hp - before });
        push(s, "heal", f.u.name + " mends " + t.u.name + " for " + (t.hp - before) + ".");
        return;
      }
    }

    var target = pickTarget(enemies, rng);
    if (!target) return;

    s.fx.push({ k: "attack", on: f });

    if (rng() < target.u.dodge) {
      s.fx.push({ k: "miss", on: target });
      push(s, "tick", target.u.name + " slips aside from " + f.u.name + ".");
      return;
    }

    var crit = rng() < f.u.crit;
    var raw = f.u.atk * (0.85 + rng() * 0.3) * (crit ? 1.75 : 1);
    var dmg = Math.max(1, Math.round(raw * (1 - target.u.def)));
    target.hp -= dmg;

    s.fx.push({ k: "hit", on: target, amt: dmg, crit: crit });
    push(s, crit ? "crit" : "", f.u.name + (crit ? " crits " : " hits ") + target.u.name + " for " + dmg + ".");

    if (target.hp <= 0) {
      target.hp = 0; target.alive = false;
      s.fx.push({ k: "down", on: target });
      push(s, "down", target.u.name + " is down.");
    }
  }

  function push(s, cls, text) {
    s.log.push({ cls: cls, text: text });
  }

  function step(s) {
    if (s.over) return;
    s.tick++;

    var all = s.you.concat(s.foe).filter(function (f) { return f.alive; });
    all.forEach(function (f) { f.atb += f.u.spd / 18; });

    /* act in gauge order so faster units genuinely go first */
    all.filter(function (f) { return f.atb >= 100; })
       .sort(function (x, y) { return y.atb - x.atb; })
       .forEach(function (f) {
         if (!f.alive || s.over) return;
         f.atb -= 100;
         if (f.side === "you") act(s, f, s.you, s.foe);
         else act(s, f, s.foe, s.you);
         checkOver(s);
       });

    if (s.tick >= MAX_TICKS) finishOnHp(s);
  }

  function hpFrac(list) {
    var cur = 0, max = 0;
    list.forEach(function (f) { cur += Math.max(0, f.hp); max += f.maxHp; });
    return max ? cur / max : 0;
  }

  function checkOver(s) {
    var youUp = livingOf(s.you).length, foeUp = livingOf(s.foe).length;
    if (youUp && foeUp) return;
    s.over = true;
    if (youUp && !foeUp) s.winner = "you";
    else if (!youUp && foeUp) s.winner = "foe";
    else s.winner = "draw";
  }

  function finishOnHp(s) {
    s.over = true;
    var y = hpFrac(s.you), f = hpFrac(s.foe);
    s.winner = y === f ? "draw" : (y > f ? "you" : "foe");
    push(s, "tick", "Time. Judged on remaining health.");
  }

  /* ---------- battle rendering ---------- */

  function fighterEl(f) {
    var d = document.createElement("div");
    d.className = "fighter role-" + f.u.role;
    d.innerHTML =
      '<span class="face">' +
        '<img class="job-tag" src="' + f.u.icon + '" alt="" loading="lazy">' +
      '</span>' +
      '<span class="bars">' +
        '<span class="nm"><b>' + esc(f.u.name) + '</b><span>' + esc(f.u.job) + '</span></span>' +
        '<span class="hp"><i class="chip"></i><i class="cur"></i></span>' +
        '<span class="atb"><i></i></span>' +
      '</span>';
    /* only eight on stage — headshot instantly, full body as soon as it lands */
    WHGame.stageArt(d.querySelector(".face"), f.u);
    f.el = d;
    f.faceEl = d.querySelector(".face");
    f.chipEl = d.querySelector(".hp i.chip");
    f.hpEl = d.querySelector(".hp i.cur");
    f.atbEl = d.querySelector(".atb i");
    return d;
  }

  function paint(s) {
    s.you.concat(s.foe).forEach(function (f) {
      var pct = Math.max(0, (f.hp / f.maxHp) * 100);
      f.hpEl.style.width = pct + "%";
      f.chipEl.style.width = pct + "%";   // lags behind via its CSS transition delay
      f.atbEl.style.width = Math.min(100, f.atb) + "%";
      f.el.classList.toggle("is-down", !f.alive);
    });
  }

  /* restart a CSS animation that may already be running */
  function pulse(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms);
  }

  function popNumber(f, text, cls) {
    var n = document.createElement("span");
    n.className = "pop " + cls;
    n.textContent = text;
    /* jitter so simultaneous hits on one fighter do not stack exactly */
    n.style.marginTop = (Math.random() * 10 - 5).toFixed(1) + "px";
    f.el.appendChild(n);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1000);
  }

  function shakeArena() {
    var a = document.querySelector(".arena");
    pulse(a, "fx-shake", 220);
  }

  /* Drain what the sim reported since the last frame. Capped, because at x8 the
   * queue can hold dozens of events and animating all of them is just noise. */
  function playFx(s) {
    if (!s.fx.length) return;
    var batch = s.fx.splice(0, s.fx.length);
    var shown = 0;
    for (var i = 0; i < batch.length; i++) {
      var e = batch[i];
      if (e.k === "down") {                 // always show deaths
        pulse(e.on.el, "fx-down", 400);
        shakeArena();
        continue;
      }
      if (shown >= 6) continue;
      shown++;
      if (e.k === "attack") {
        pulse(e.on.el, "fx-attack", 300);
      } else if (e.k === "hit") {
        pulse(e.on.faceEl, "fx-hit", 300);
        popNumber(e.on, String(e.amt), e.crit ? "crit" : "dmg");
        if (e.crit) shakeArena();
      } else if (e.k === "heal") {
        pulse(e.on.faceEl, "fx-heal", 500);
        popNumber(e.on, "+" + e.amt, "heal");
      } else if (e.k === "miss") {
        popNumber(e.on, "miss", "miss");
      }
    }
  }

  var logDrawn = 0;
  function drawLog(s) {
    var box = $("log");
    for (; logDrawn < s.log.length; logDrawn++) {
      var e = s.log[logDrawn];
      var p = document.createElement("p");
      if (e.cls) p.className = e.cls;
      p.textContent = e.text;
      box.appendChild(p);
    }
    box.scrollTop = box.scrollHeight;
  }

  function startBattle(you, foe, seed, title) {
    $("draft").hidden = true;
    $("battle").hidden = false;
    $("battle-title").textContent = title;
    $("verdict").hidden = true;
    $("again").hidden = true;
    $("log").innerHTML = "";
    logDrawn = 0;

    sim = makeSim(you, foe, seed);

    var yb = $("units-you"), fb = $("units-foe");
    yb.innerHTML = ""; fb.innerHTML = "";
    sim.you.forEach(function (f) { yb.appendChild(fighterEl(f)); });
    sim.foe.forEach(function (f) { fb.appendChild(fighterEl(f)); });
    paint(sim);

    $("code-out").value = location.origin + location.pathname + "?c=" +
      WHGame.encodeParty(you.map(function (u) { return u.id; }), seed);
    $("share-row").hidden = false;

    run();
  }

  /* Driven off requestAnimationFrame with a time accumulator rather than a bare
   * interval: timers get throttled, and we need a fixed number of simulation
   * steps regardless of frame rate or the outcome stops matching the share code. */
  function run() {
    stop();
    var last = performance.now(), carry = 0;
    var frame = function (now) {
      var dt = Math.min(250, now - last);
      last = now;
      carry += dt * speed;
      var budget = 40; // never block a frame, however far behind we are
      while (carry >= TICK_MS && !sim.over && budget-- > 0) {
        carry -= TICK_MS;
        step(sim);
      }
      paint(sim); playFx(sim); drawLog(sim);
      if (sim.over) { stop(); showVerdict(sim); return; }
      timer = requestAnimationFrame(frame);
    };
    timer = requestAnimationFrame(frame);
  }

  function stop() {
    if (timer) cancelAnimationFrame(timer);
    timer = null;
  }

  function showVerdict(s) {
    var v = $("verdict");
    v.hidden = false;
    var survivors = livingOf(s.you).length;
    if (s.winner === "you") {
      $("verdict-title").textContent = "Victory";
      $("verdict-text").textContent = survivors + " of " + s.you.length + " still standing after " +
        Math.round(s.tick * 0.06) + "s.";
    } else if (s.winner === "foe") {
      $("verdict-title").textContent = "Defeat";
      $("verdict-text").textContent = "The rival party held. " +
        livingOf(s.foe).length + " of theirs survived.";
    } else {
      $("verdict-title").textContent = "Draw";
      $("verdict-text").textContent = "Both parties spent, nothing between them.";
    }
    $("again").hidden = false;
  }

  /* ---------- wiring ---------- */

  /* Draft the house party out of everyone the player did not take — a character
   * fighting themselves reads as a bug even when the maths is fine. */
  function rivalParty(seed) {
    var rng = WHGame.makeRng(seed ^ 0x9e3779b9);
    var pool = roster.filter(function (u) { return picked.indexOf(u) === -1; });
    return WHGame.draftAi(pool, BUDGET, PARTY_SIZE, rng);
  }

  function boot() {
    WHGame.loadRoster().then(function (units) {
      roster = units.sort(function (a, b) { return b.cost - a.cost || a.name.localeCompare(b.name); });
      roster.forEach(function (u) { byId[u.id] = u; });

      $("loading").hidden = true;
      $("draft").hidden = false;
      $("stamp").textContent = roster.length + " adventurers";
      $("tank-count").textContent = roster.filter(function (u) { return u.role === "tank"; }).length;
      $("healer-count").textContent = roster.filter(function (u) { return u.role === "healer"; }).length;

      buildGrid();
      renderDraft();
      tryIncomingCode();
    }).catch(function (err) {
      $("loading").innerHTML = '<div class="error">Could not load the roster: ' + esc(err.message) + "</div>";
    });
  }

  /* Someone opened a challenge link: they fight the shared party as the rival. */
  function tryIncomingCode() {
    var code = new URLSearchParams(location.search).get("c");
    if (!code) return;
    var got = WHGame.decodeParty(code);
    if (!got) { $("code-note").textContent = "That challenge code could not be read."; return; }
    var foe = got.ids.map(function (id) { return byId[id]; }).filter(Boolean);
    if (!foe.length) { $("code-note").textContent = "That challenge names adventurers who are no longer in the roster."; return; }
    pendingFoe = { units: foe, seed: got.seed };
    $("code-note").innerHTML = "<b>Challenge loaded.</b> Draft your four and you will face " +
      foe.map(function (u) { return esc(u.name); }).join(", ") + ".";
  }

  var pendingFoe = null;

  $("fight").addEventListener("click", function () {
    var seed = pendingFoe ? pendingFoe.seed : (WHGame.hashString(picked.map(function (u) { return u.id; }).join(",") + Date.now()) >>> 0);
    var foe = pendingFoe ? pendingFoe.units : rivalParty(seed);
    var title = pendingFoe ? "Your party vs. a challenger" : "Your party vs. the house";
    startBattle(picked.slice(), foe, seed, title);
  });

  $("clear").addEventListener("click", function () { picked = []; renderDraft(); });

  $("back").addEventListener("click", function () {
    stop();
    $("battle").hidden = true;
    $("draft").hidden = false;
  });

  $("again").addEventListener("click", function () {
    if (!sim) return;
    var you = sim.you.map(function (f) { return f.u; });
    var foe = sim.foe.map(function (f) { return f.u; });
    startBattle(you, foe, (WHGame.hashString(String(Date.now())) >>> 0), $("battle-title").textContent);
  });

  $("speed").addEventListener("click", function () {
    speed = speed === 1 ? 3 : (speed === 3 ? 8 : 1);
    $("speed").textContent = "Speed ×" + speed;
  });

  $("copy").addEventListener("click", function () {
    var el = $("code-out");
    el.select();
    navigator.clipboard.writeText(el.value).then(function () {
      $("copy").textContent = "Copied";
      setTimeout(function () { $("copy").textContent = "Copy challenge"; }, 1400);
    }).catch(function () { document.execCommand("copy"); });
  });

  $("load-code").addEventListener("click", function () {
    var raw = $("code-in").value.trim();
    if (!raw) return;
    var code = raw.indexOf("c=") !== -1 ? raw.split("c=")[1] : raw;
    var got = WHGame.decodeParty(code);
    if (!got) { $("code-note").textContent = "That challenge code could not be read."; return; }
    var foe = got.ids.map(function (id) { return byId[id]; }).filter(Boolean);
    if (!foe.length) { $("code-note").textContent = "That challenge names nobody in the current roster."; return; }
    pendingFoe = { units: foe, seed: got.seed };
    $("code-note").innerHTML = "<b>Challenge loaded.</b> You will face " +
      foe.map(function (u) { return esc(u.name); }).join(", ") + ".";
  });

  boot();
})();
