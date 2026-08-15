/* Shared engine for the Wild Hearts mini-games.
 *
 * Everything a unit can do is derived from real Lodestone data, never invented:
 * main job decides the trinity role, main job level and jobs-at-100 decide power
 * and draft cost, race grants a passive, collections drive flavour.
 *
 * All randomness runs through a seeded PRNG so a given (party, party, seed) always
 * resolves to the identical fight. That is what makes a share code replayable.
 */
(function (global) {
  "use strict";

  var DATA_URL = "https://raw.githubusercontent.com/BattyDev/batty-ffxiv-status/data/ffxiv.json";
  var SNAPSHOT_URL = "roster-snapshot.json";
  var ICON_BASE = "../assets/job-icons/";

  /* ---------- trinity ---------- */

  var TANKS = ["Paladin", "Warrior", "Dark Knight", "Gunbreaker", "Gladiator", "Marauder"];
  var HEALERS = ["White Mage", "Scholar", "Astrologian", "Sage", "Conjurer"];

  function roleOf(job) {
    if (TANKS.indexOf(job) !== -1) return "tank";
    if (HEALERS.indexOf(job) !== -1) return "healer";
    return "dps";
  }

  var ROLE_LABEL = { tank: "Tank", healer: "Healer", dps: "DPS" };

  /* Race passives. Small enough to stay flavour, big enough to notice. */
  var RACE_PASSIVE = {
    "Lalafell":  { key: "dodge",  mult: 0.08, text: "Small Target — +8% dodge" },
    "Roegadyn":  { key: "hp",     mult: 0.10, text: "Sturdy — +10% max HP" },
    "Hrothgar":  { key: "atk",    mult: 0.08, text: "Predator — +8% attack" },
    "Miqo'te":   { key: "crit",   mult: 0.10, text: "Keen Eye — +10% crit" },
    "Hyur":      { key: "all",    mult: 0.05, text: "Adaptable — +5% everything" },
    "Viera":     { key: "speed",  mult: 0.10, text: "Fleet — +10% speed" },
    "Au Ra":     { key: "mitig",  mult: 0.08, text: "Scaled — +8% mitigation" }
  };

  var DEFAULT_PASSIVE = { key: "none", mult: 0, text: "No trait" };

  /* ---------- seeded RNG (mulberry32) ---------- */

  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* Stable seed for "everyone sees the same thing today". */
  function dailySeed(salt) {
    var d = new Date();
    var key = d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate() + ":" + (salt || "");
    return hashString(key);
  }

  /* ---------- unit derivation ---------- */

  /* power in 0..1 — main job level carries most of it, breadth tops it up */
  function powerOf(member) {
    var lvl = (member.main_job && member.main_job.level) || 1;
    var breadth = Math.min(member.jobs100 || 0, 32) / 32;
    return 0.65 * (lvl / 100) + 0.35 * breadth;
  }

  /* Draft cost 1..14. Deliberately super-linear at the top so the three or four
   * maxed characters cannot all share a party. */
  function costOf(member) {
    var p = powerOf(member);
    return Math.max(1, Math.min(14, Math.round(1 + 13 * Math.pow(p, 1.35))));
  }

  function buildUnit(member) {
    var job = (member.main_job && member.main_job.job) || "Adventurer";
    var role = roleOf(job);
    var p = powerOf(member);
    var passive = RACE_PASSIVE[member.race] || DEFAULT_PASSIVE;

    var hp, atk, def, heal;
    if (role === "tank") {
      hp = 900 + 900 * p; atk = 55 + 55 * p; def = 0.34; heal = 0;
    } else if (role === "healer") {
      hp = 620 + 620 * p; atk = 42 + 42 * p; def = 0.12; heal = 85 + 105 * p;
    } else {
      hp = 540 + 540 * p; atk = 105 + 135 * p; def = 0.08; heal = 0;
    }

    var spd = 95 + 45 * p;
    var crit = 0.10 + 0.10 * p;
    var dodge = 0.04;

    /* apply race passive */
    var k = passive.key, m = passive.mult;
    if (k === "hp") hp *= 1 + m;
    else if (k === "atk") atk *= 1 + m;
    else if (k === "speed") spd *= 1 + m;
    else if (k === "crit") crit += m;
    else if (k === "dodge") dodge += m;
    else if (k === "mitig") def += m;
    else if (k === "all") { hp *= 1 + m; atk *= 1 + m; spd *= 1 + m; crit += m; }

    return {
      id: member.id,
      name: member.name,
      job: job,
      role: role,
      roleLabel: ROLE_LABEL[role],
      level: (member.main_job && member.main_job.level) || 1,
      jobs100: member.jobs100 || 0,
      race: member.race,
      title: member.title,
      mounts: member.mounts || 0,
      minions: member.minions || 0,
      avatar: member.avatar,
      portrait: member.portrait,
      icon: jobIcon(job),
      passive: passive,
      cost: costOf(member),
      power: p,
      maxHp: Math.round(hp),
      atk: atk,
      def: def,
      heal: heal,
      spd: spd,
      crit: crit,
      dodge: dodge
    };
  }

  /* job-icons.json is keyed by display name; fall back to a slug guess. */
  var ICON_MAP = null;
  function jobIcon(job) {
    if (ICON_MAP && ICON_MAP[job]) return ICON_BASE + ICON_MAP[job];
    return ICON_BASE + job.toLowerCase().replace(/['\s]+/g, "-") + ".png";
  }

  /* ---------- loading ---------- */

  function normalise(raw) {
    /* Accepts either the full published feed or the slim snapshot. */
    var list = (raw.roster || []).filter(function (m) {
      return m.status === undefined || m.status === "ok";
    });
    return list.map(function (m) {
      if (m.jobs100 !== undefined) return m;           // already slim
      return {                                          // full feed -> slim shape
        id: m.id,
        name: m.name,
        avatar: m.avatar,
        portrait: m.portrait,
        race: m.race,
        title: m.title,
        grand_company: m.grand_company,
        fc_rank: m.fc_rank,
        main_job: m.main_job,
        jobs100: (m.jobs || []).filter(function (j) { return j.level === 100; }).length,
        jobs_total: (m.jobs || []).length,
        mounts: (m.collections && m.collections.mounts && m.collections.mounts.owned) || 0,
        minions: (m.collections && m.collections.minions && m.collections.minions.owned) || 0
      };
    });
  }

  function loadIcons() {
    return fetch(ICON_BASE + "job-icons.json")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { ICON_MAP = j; })
      .catch(function () { ICON_MAP = null; });
  }

  /* Live feed first so the games track the real roster; snapshot keeps them
   * playable offline and if the data branch is mid-push. */
  function loadRoster() {
    return loadIcons().then(function () {
      return fetch(DATA_URL, { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("feed " + r.status);
          return r.json();
        })
        .catch(function () {
          return fetch(SNAPSHOT_URL, { cache: "no-store" }).then(function (r) {
            if (!r.ok) throw new Error("snapshot " + r.status);
            return r.json();
          });
        })
        .then(function (raw) {
          return normalise(raw).map(buildUnit);
        });
    });
  }

  /* ---------- artwork ---------- */

  /* Lodestone full-body renders are ~116KB each against ~14KB for the headshot.
   * Loading 35 of them up front is 4MB and leaves every card blank while it waits,
   * so paint the cheap headshot first and upgrade in place once the render lands.
   * Offscreen cards defer entirely until they are scrolled near. */

  /* Lodestone renders are 880x1200 with the character standing centred: head
   * around 8% down, feet near 96%. Zooming to 165% and anchoring near the top
   * frames head-to-waist — big enough to recognise a face, still showing the
   * glam. The headshot placeholder is already a face crop, so it just covers. */
  var PORTRAIT_FRAME = { size: "165% auto", position: "center 10%" };
  var AVATAR_FRAME = { size: "cover", position: "center" };

  /* The same window in 880x1200 source pixels, for canvas drawing. Derived from
   * the CSS above: a 533px square at (173,67). Keep the two in step or the
   * defense board will frame characters differently from the arena. */
  var PORTRAIT_CROP = { sx: 173, sy: 67, sw: 533, sh: 533 };

  function setArt(el, url, frame) {
    if (!el || !url) return;
    var f = frame || AVATAR_FRAME;
    el.style.backgroundImage = 'url("' + String(url).replace(/"/g, "%22") + '")';
    el.style.backgroundPosition = f.position;
    el.style.backgroundSize = f.size;
  }

  var artObserver = null;
  var pendingArt = null;

  function upgradeArt(el, unit) {
    var img = new Image();
    img.onload = function () {
      setArt(el, unit.portrait, PORTRAIT_FRAME);
      el.classList.remove("art-pending");
    };
    img.src = unit.portrait;
  }

  /* opts.lazy defers the full-body fetch until the element nears the viewport */
  function stageArt(el, unit, opts) {
    if (!el || !unit) return;
    var full = unit.portrait;
    if (!full) { setArt(el, unit.avatar, AVATAR_FRAME); return; }

    setArt(el, unit.avatar, AVATAR_FRAME);   // instant, 14KB
    el.classList.add("art-pending");

    if (!(opts && opts.lazy) || typeof IntersectionObserver === "undefined") {
      upgradeArt(el, unit);
      return;
    }

    if (!artObserver) {
      pendingArt = new WeakMap();
      artObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var u = pendingArt.get(en.target);
          artObserver.unobserve(en.target);
          if (u) upgradeArt(en.target, u);
        });
      }, { rootMargin: "300px" });
    }
    pendingArt.set(el, unit);
    artObserver.observe(el);
  }

  /* Canvas equivalent: hand back whichever image is ready, preferring full body. */
  var imgCache = {};
  function stagedImage(unit) {
    var rec = imgCache[unit.id];
    if (rec) return rec;
    rec = { img: null };
    /* no crossOrigin — the Lodestone CDN sends no CORS headers and requesting
     * one makes the load fail. We only draw these, never read pixels back. */
    var small = new Image();
    small.onload = function () { if (!rec.full) rec.img = small; };
    small.src = unit.avatar;
    if (unit.portrait) {
      var big = new Image();
      big.onload = function () { rec.img = big; rec.full = true; };
      big.src = unit.portrait;
    }
    imgCache[unit.id] = rec;
    return rec;
  }

  /* ---------- share codes ---------- */

  function encodeParty(ids, seed) {
    var payload = { v: 1, i: ids, s: seed >>> 0 };
    var json = JSON.stringify(payload);
    return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeParty(code) {
    try {
      var b64 = code.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var obj = JSON.parse(atob(b64));
      if (!obj || obj.v !== 1 || !Array.isArray(obj.i)) return null;
      return { ids: obj.i.map(String), seed: (obj.s >>> 0) || 1 };
    } catch (e) {
      return null;
    }
  }

  function shuffled(list, rng) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* A seeded opponent draft that respects the same budget the player pays. */
  function draftAi(units, budget, size, rng) {
    var pool = shuffled(units, rng);
    var picked = [], spent = 0;
    /* try for a tank and a healer first so the AI is not a pile of DPS */
    ["tank", "healer"].forEach(function (want) {
      for (var i = 0; i < pool.length && picked.length < size; i++) {
        var u = pool[i];
        if (u.role === want && picked.indexOf(u) === -1 && spent + u.cost <= budget) {
          picked.push(u); spent += u.cost; break;
        }
      }
    });
    for (var i = 0; i < pool.length && picked.length < size; i++) {
      var u = pool[i];
      if (picked.indexOf(u) === -1 && spent + u.cost <= budget) { picked.push(u); spent += u.cost; }
    }
    return picked;
  }

  global.WHGame = {
    loadRoster: loadRoster,
    buildUnit: buildUnit,
    roleOf: roleOf,
    costOf: costOf,
    makeRng: makeRng,
    hashString: hashString,
    dailySeed: dailySeed,
    setArt: setArt,
    stageArt: stageArt,
    stagedImage: stagedImage,
    PORTRAIT_CROP: PORTRAIT_CROP,
    encodeParty: encodeParty,
    decodeParty: decodeParty,
    shuffled: shuffled,
    draftAi: draftAi,
    ROLE_LABEL: ROLE_LABEL,
    RACE_PASSIVE: RACE_PASSIVE
  };
})(window);
