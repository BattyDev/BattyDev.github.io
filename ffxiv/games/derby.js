/* Wild Hearts Derby — one seeded race a day.
 *
 * Field and result both come from the UTC date, so every member of the FC loads
 * the same eight runners and the same finish. Form is nudged by real data
 * (mounts owned = time in the saddle) but stays mostly luck, which is the point.
 */
(function () {
  "use strict";

  var FIELD = 8;
  var LENGTH = 1000;      // abstract furlongs
  var $ = function (id) { return document.getElementById(id); };

  var runners = [];
  var bet = null;
  var raf = null;
  var finished = [];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function todayLabel() {
    var d = new Date();
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  }

  /* Form: mostly the same for everyone, lightly weighted by mounts owned so the
   * FC's veteran riders are a touch quicker. Never enough to make it a foregone
   * conclusion. */
  function formOf(u) {
    var m = Math.min(u.mounts, 120) / 120;
    return 0.92 + m * 0.16;
  }

  function buildRace() {
    var seed = WHGame.dailySeed("derby");
    var rng = WHGame.makeRng(seed);
    var field = WHGame.shuffled(runners, rng).slice(0, FIELD);

    return field.map(function (u) {
      return {
        u: u,
        pos: 0,
        form: formOf(u),
        /* each runner gets its own burst rhythm, fixed for the day */
        phase: rng() * Math.PI * 2,
        wobble: 0.55 + rng() * 0.9,
        /* kept narrow on purpose: a wide luck band means the field strings out and
         * you spend most of the race watching stragglers after the result is known */
        luck: 0.92 + rng() * 0.18,
        done: false,
        place: 0
      };
    });
  }

  var race = null;

  function render() {
    var box = $("track");
    box.innerHTML = "";
    race.forEach(function (r) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "lane role-" + r.u.role + (bet === r ? " is-bet" : "");
      b.innerHTML =
        '<span class="face"></span>' +
        '<span class="nm"><b>' + esc(r.u.name) + '</b><small>' + esc(r.u.job) + " · " + r.u.mounts + ' mounts</small></span>' +
        '<span class="rail"><i></i><span class="finish"></span></span>' +
        '<span class="place"></span>';
      /* background-image goes through the style API — a raw URL inside a style
       * attribute string breaks out of the quoting and eats the markup */
      WHGame.stageArt(b.querySelector(".face"), r.u);
      WHGame.stageArt(b.querySelector(".rail i"), r.u);
      b.addEventListener("click", function () {
        if (raf) return;
        bet = r;
        $("start").disabled = false;
        $("start").textContent = "Race — backing " + r.u.name;
        render();
      });
      r.el = b;
      r.dot = b.querySelector(".rail i");
      r.placeEl = b.querySelector(".place");
      box.appendChild(b);
    });
  }

  function step(t) {
    var allDone = true;
    race.forEach(function (r) {
      if (r.done) return;
      allDone = false;
      /* smooth pseudo-random surges: sine rhythm times per-runner luck */
      var surge = 1 + Math.sin(t * 0.004 * r.wobble + r.phase) * 0.45;
      r.pos += r.form * r.luck * surge * 5.2;
      if (r.pos >= LENGTH) {
        r.pos = LENGTH;
        r.done = true;
        finished.push(r);
        r.place = finished.length;
        r.placeEl.textContent = ordinal(r.place);
        if (r.place === 1) r.el.classList.add("is-won");
      }
    });

    race.forEach(function (r) {
      var rail = r.el.querySelector(".rail");
      var w = rail.clientWidth - 86;   // token is 80px wide plus a little breathing room
      r.dot.style.transform = "translateX(" + (Math.min(r.pos, LENGTH) / LENGTH) * w + "px)";
      r.el.classList.toggle("is-running", !r.done);
    });

    if (allDone) { raf = null; settle(); return; }
    raf = requestAnimationFrame(step);
  }

  function ordinal(n) {
    return n + (["th", "st", "nd", "rd"][(n % 100 - n % 10 !== 10) * (n % 10 < 4) * (n % 10)] || "th");
  }

  function settle() {
    var winner = finished[0];
    var v = $("verdict");
    v.hidden = false;
    if (bet === winner) {
      $("verdict-title").textContent = "Called it";
      $("verdict-text").textContent = winner.u.name + " takes the card by " +
        Math.max(1, Math.round((winner.pos - finished[1].pos) || 1)) + " lengths.";
    } else {
      $("verdict-title").textContent = winner.u.name + " wins";
      $("verdict-text").textContent = "You backed " + bet.u.name + ", who came in " +
        ordinal(bet.place) + ".";
    }
    $("reset").hidden = false;
    $("start").disabled = true;
    $("start").textContent = "Race run for today";
  }

  function replay() {
    cancelAnimationFrame(raf); raf = null;
    finished = [];
    race.forEach(function (r) { r.pos = 0; r.done = false; r.place = 0; });
    render();
    $("verdict").hidden = true;
    $("reset").hidden = true;
    $("start").disabled = false;
    $("start").textContent = "Race — backing " + (bet ? bet.u.name : "");
  }

  $("start").addEventListener("click", function () {
    if (!bet || raf) return;
    $("start").disabled = true;
    $("start").textContent = "And they're off…";
    var t0 = performance.now();
    raf = requestAnimationFrame(function loop(now) {
      step(now - t0);
    });
  });

  $("reset").addEventListener("click", replay);

  WHGame.loadRoster().then(function (units) {
    runners = units;
    race = buildRace();
    $("loading").hidden = true;
    $("game").hidden = false;
    $("stamp").textContent = units.length + " adventurers";
    $("race-day").textContent = todayLabel() + " · today's card";
    render();
  }).catch(function (err) {
    $("loading").innerHTML = '<div class="error">Could not load the roster: ' + esc(err.message) + "</div>";
  });
})();
