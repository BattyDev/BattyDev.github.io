/* Wild Hearts · FFXIV Adventurers
   Reads the sanitized snapshot published from batty-mac. Everything here degrades:
   the page is useful after a single night of data and gets richer as history builds. */

(function () {
  "use strict";

  // Explicit rather than derived from location.pathname — /palworld computes its repo
  // name from the URL, which would resolve to a repo that does not exist for this path.
  var DATA_URL = "https://raw.githubusercontent.com/BattyDev/batty-ffxiv-status/data/ffxiv.json";
  var LOCAL_FALLBACK = "ffxiv.json";
  var ICONS = "assets/job-icons/";
  var MAX_JOBS_ON_CARD = 5;
  // Dawntrail's cap. Bump on the next expansion; jobs at or above it collapse into a
  // single badge rather than filling the card with identical chips.
  var LEVEL_CAP = 100;

  var $ = function (id) { return document.getElementById(id); };

  function slug(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function gcClass(grandCompany) {
    if (!grandCompany) return "";
    var key = String(grandCompany).toLowerCase();
    if (key.indexOf("maelstrom") > -1) return "gc-maelstrom";
    if (key.indexOf("adder") > -1) return "gc-adder";
    if (key.indexOf("flame") > -1) return "gc-flames";
    return "";
  }

  // A class/job page shows the base *class* name until its job is unlocked, so the
  // harvested icon set only ever contains whichever of the pair a given character had.
  // No number of characters guarantees both — a veteran roster never shows "Lancer".
  // Falling back to the job's icon keeps every chip illustrated.
  var CLASS_TO_JOB = {
    gladiator: "paladin", marauder: "warrior", conjurer: "white-mage",
    pugilist: "monk", lancer: "dragoon", archer: "bard",
    thaumaturge: "black-mage", arcanist: "summoner", rogue: "ninja"
  };

  function jobChip(job, isMain) {
    var chip = el("span", "job" + (isMain ? " is-main" : ""));
    var icon = el("img");
    var key = slug(job.job);
    icon.src = ICONS + key + ".png";
    icon.alt = "";
    icon.loading = "lazy";
    icon.width = 20;
    icon.height = 20;
    icon.addEventListener("error", function onError() {
      icon.removeEventListener("error", onError);
      if (CLASS_TO_JOB[key]) {
        icon.src = ICONS + CLASS_TO_JOB[key] + ".png";
        // A second failure removes it: better no icon than a broken-image box.
        icon.addEventListener("error", function () { icon.remove(); });
      } else {
        icon.remove();
      }
    });
    chip.appendChild(icon);
    chip.appendChild(document.createTextNode(job.job + " "));
    chip.appendChild(el("span", "lv", job.level));
    return chip;
  }

  function relativeDays(iso) {
    if (!iso) return null;
    var then = Date.parse(iso);
    if (isNaN(then)) return null;
    var days = Math.floor((Date.now() - then) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return days + " days ago";
    if (days < 14) return "last week";
    if (days < 60) return Math.floor(days / 7) + " weeks ago";
    return Math.floor(days / 30) + " months ago";
  }

  function formatDate(iso) {
    var when = new Date(iso);
    return isNaN(when) ? "—" : when.toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric"
    });
  }

  /* ---- expanded detail ---- */

  function statLine(label, value) {
    var row = el("div", "detail-row");
    row.appendChild(el("span", "detail-label", label));
    row.appendChild(el("span", "detail-value", value));
    return row;
  }

  function buildDetail(entry) {
    var detail = el("div", "char-detail");
    detail.hidden = true;

    if (entry.portrait) {
      var portrait = el("img", "detail-portrait");
      portrait.src = entry.portrait;
      portrait.alt = "";
      portrait.loading = "lazy";
      detail.appendChild(portrait);
    }

    var facts = el("div", "detail-facts");
    if (entry.race || entry.clan) facts.appendChild(statLine("Race", [entry.clan, entry.race].filter(Boolean).join(" · ")));
    if (entry.gc_rank) facts.appendChild(statLine("Rank", entry.gc_rank));
    if (entry.free_company) facts.appendChild(statLine("Company", entry.free_company));
    var ach = entry.achievements || {};
    if (ach.visible && ach.count != null) {
      facts.appendChild(statLine("Deeds", ach.count.toLocaleString() +
        (ach.points != null ? " · " + ach.points.toLocaleString() + " pts" : "")));
    }
    var cols = entry.collections || {};
    Object.keys(cols).sort().forEach(function (kind) {
      if (cols[kind] && cols[kind].owned != null) {
        facts.appendChild(statLine(kind.charAt(0).toUpperCase() + kind.slice(1), cols[kind].owned));
      }
    });
    if (entry.as_of) facts.appendChild(statLine("As of", entry.as_of));
    if (facts.children.length) detail.appendChild(facts);

    if (entry.gear && entry.gear.length) {
      var gearWrap = el("div", "detail-block");
      gearWrap.appendChild(el("h3", "detail-heading", "Equipment"));
      var grid = el("div", "gear-grid");
      entry.gear.forEach(function (piece) {
        var cell = el("span", "gear-slot");
        var img = el("img");
        img.src = piece.icon;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", function () { img.remove(); });
        cell.appendChild(img);
        // Item names exist only for opted-in characters; everyone else gets the slot.
        var label = piece.name || piece.slot.toLowerCase().replace(/(\d)/, " $1");
        cell.title = piece.ilvl ? label + " (i" + piece.ilvl + ")" : label;
        if (piece.name) {
          var cap = el("span", "gear-name", piece.name);
          if (piece.ilvl) cap.appendChild(el("span", "gear-ilvl", " i" + piece.ilvl));
          cell.appendChild(cap);
          cell.className = "gear-slot has-name";
        }
        grid.appendChild(cell);
      });
      gearWrap.appendChild(grid);
      detail.appendChild(gearWrap);
    }

    // Disciples of War/Magic, Hand and Land are separate progressions and get read
    // separately — a lump of 33 jobs sorted by level tells you much less than
    // "21 combat maxed, crafters at 100, gatherers still climbing".
    var GROUPS = [
      {key: "combat", label: "Combat"},
      {key: "craft", label: "Crafting"},
      {key: "gather", label: "Gathering"},
      {key: "field", label: "Field records"}
    ];
    var byRole = {};
    (entry.jobs || []).forEach(function (job) {
      var role = job.role || (job.field_record ? "field" : "combat");
      (byRole[role] = byRole[role] || []).push(job);
    });

    GROUPS.forEach(function (group) {
      var list = byRole[group.key];
      if (!list || !list.length) return;
      list.sort(function (a, b) {
        return b.level - a.level || String(a.job).localeCompare(String(b.job));
      });
      var maxed = list.filter(function (j) { return j.level >= LEVEL_CAP; }).length;
      var block = el("div", "detail-block");
      var heading = el("h3", "detail-heading", group.label + " (" + list.length + ")");
      if (maxed) heading.appendChild(el("span", "detail-count", maxed + " at cap"));
      block.appendChild(heading);
      var grid = el("div", "job-grid");
      list.forEach(function (job) { grid.appendChild(jobChip(job, false)); });
      block.appendChild(grid);
      detail.appendChild(block);
    });
    return detail;
  }

  function makeExpandable(card, entry) {
    var detail = card.getElementsByClassName("char-detail")[0];
    if (!detail) return;
    var toggle = el("button", "detail-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "Details";
    function setOpen(open) {
      detail.hidden = !open;
      card.classList.toggle("is-expanded", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Close" : "Details";
    }
    toggle.addEventListener("click", function () { setOpen(detail.hidden); });
    card.appendChild(toggle);

    // The name is the obvious thing to click, so make it work too — as a real button
    // rather than a click handler on a heading, so keyboard and screen readers get it.
    var nameEl = card.getElementsByClassName("char-name")[0];
    if (nameEl) {
      nameEl.classList.add("is-clickable");
      nameEl.setAttribute("role", "button");
      nameEl.setAttribute("tabindex", "0");
      nameEl.addEventListener("click", function () { setOpen(detail.hidden); });
      nameEl.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setOpen(detail.hidden);
        }
      });
    }
  }

  /* ---- roster ---- */

  function renderAdventurer(entry) {
    var card = el("div", "adventurer " + gcClass(entry.grand_company));
    card.setAttribute("role", "listitem");

    if (entry.status !== "ok") {
      card.appendChild(el("p", "char-name", entry.name || "Adventurer " + entry.id));
      var reason = entry.status === "not_found"
        ? "No longer found on The Lodestone."
        : "Profile could not be read on " + (entry.as_of || "the last attempt") + ".";
      card.appendChild(el("p", "char-unavailable", reason));
      return card;
    }

    var top = el("div", "char-head");
    if (entry.avatar) {
      var portrait = el("img", "portrait");
      portrait.src = entry.avatar;
      portrait.alt = "";
      portrait.loading = "lazy";
      top.appendChild(portrait);
    }

    var identity = el("div", "char-id");
    var name = el("h2", "char-name", entry.name);
    if (entry.title) name.appendChild(el("span", "char-title", "“" + entry.title + "”"));
    identity.appendChild(name);

    var descriptors = [entry.fc_rank, entry.clan || entry.race, entry.world]
      .filter(Boolean).join(" · ");
    if (descriptors) identity.appendChild(el("div", "char-meta", descriptors));
    if (entry.grand_company) {
      identity.appendChild(el("span", "gc-badge", entry.grand_company));
    }
    top.appendChild(identity);
    card.appendChild(top);

    // Combat jobs lead. A fully-levelled character has a dozen ties at 100, and the
    // server-side sort breaks those alphabetically — so without this the card opens
    // with Armorer and Blacksmith rather than what they actually play.
    var ROLE_ORDER = { combat: 0, gather: 1, craft: 2, field: 3 };
    var jobs = (entry.jobs || []).filter(function (job) { return !job.field_record; })
      .slice()
      .sort(function (a, b) {
        var roleA = ROLE_ORDER[a.role] != null ? ROLE_ORDER[a.role] : 9;
        var roleB = ROLE_ORDER[b.role] != null ? ROLE_ORDER[b.role] : 9;
        if (roleA !== roleB) return roleA - roleB;
        if (a.level !== b.level) return b.level - a.level;
        return String(a.job).localeCompare(String(b.job));
      });

    if (jobs.length) {
      var list = el("div", "job-list");
      var mainJob = entry.main_job ? entry.main_job.job : null;
      var capped = jobs.filter(function (job) { return job.level >= LEVEL_CAP; });
      var shown;

      if (capped.length >= 3) {
        // A veteran's top five are all 100, which is true but says nothing and makes
        // every maxed card look identical. Collapse the cap into one badge and spend
        // the remaining slots on jobs that are actually still moving.
        var main = jobs.filter(function (job) { return job.job === mainJob; })[0] || capped[0];
        var climbing = jobs.filter(function (job) {
          return job.level < LEVEL_CAP && job.job !== main.job;
        });
        shown = [main].concat(climbing.slice(0, MAX_JOBS_ON_CARD - 2));
        shown.forEach(function (job) { list.appendChild(jobChip(job, job.job === mainJob)); });
        list.appendChild(el("span", "job-cap", capped.length + " at cap"));
        var rest = jobs.length - shown.length - capped.length + (capped.indexOf(main) > -1 ? 1 : 0);
        if (rest > 0) list.appendChild(el("span", "job-more", "+" + rest + " more"));
      } else {
        shown = jobs.slice(0, MAX_JOBS_ON_CARD);
        shown.forEach(function (job) { list.appendChild(jobChip(job, job.job === mainJob)); });
        if (jobs.length > shown.length) {
          list.appendChild(el("span", "job-more", "+" + (jobs.length - shown.length) + " more"));
        }
      }
      card.appendChild(list);
    }

    var stats = el("div", "char-stats");
    var achievements = entry.achievements || {};
    if (achievements.visible && achievements.points != null) {
      var points = el("span", null, "Deeds ");
      points.appendChild(el("b", null, achievements.points.toLocaleString()));
      stats.appendChild(points);
    } else {
      stats.appendChild(el("span", "muted", "Deeds sealed"));
    }

    var collections = entry.collections || {};
    ["mounts", "minions"].forEach(function (kind) {
      var record = collections[kind];
      if (!record || record.owned == null) return;
      var wrap = el("span", null, kind.charAt(0).toUpperCase() + kind.slice(1) + " ");
      wrap.appendChild(el("b", null, record.owned));
      var delta = entry.collection_deltas ? entry.collection_deltas[kind] : null;
      if (delta) wrap.appendChild(el("span", "delta", " +" + delta));
      stats.appendChild(wrap);
    });
    card.appendChild(stats);

    card.appendChild(buildDetail(entry));
    makeExpandable(card, entry);

    // Only opted-in characters carry last_active at all — the publish step omits it
    // rather than the page hiding it, so there is nothing here to leak.
    if (entry.last_active) {
      var seen = relativeDays(entry.last_active);
      if (seen) {
        var line = el("div", "last-seen", "Last seen in Eorzea ");
        line.appendChild(el("b", null, seen));
        card.appendChild(line);
      }
    }
    return card;
  }

  function renderRoster(data) {
    var container = $("roster");
    container.textContent = "";
    // Free Company hierarchy first. fc_order is the character's position in
    // Lodestone's member list, which is itself rank-ordered. Anyone outside the FC
    // (config-only friends) has no order and sorts after, by level.
    var roster = (data.roster || []).slice().sort(function (a, b) {
      if ((a.status === "ok") !== (b.status === "ok")) return a.status === "ok" ? -1 : 1;
      var rankA = a.fc_order == null ? Infinity : a.fc_order;
      var rankB = b.fc_order == null ? Infinity : b.fc_order;
      if (rankA !== rankB) return rankA - rankB;
      var levelA = a.main_job ? a.main_job.level : -1;
      var levelB = b.main_job ? b.main_job.level : -1;
      if (levelA !== levelB) return levelB - levelA;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    if (!roster.length) {
      container.appendChild(el("p", "empty", "No adventurers recorded yet."));
      return;
    }
    roster.forEach(function (entry) { container.appendChild(renderAdventurer(entry)); });

    var withHistory = data.meta ? data.meta.with_history : 0;
    $("roster-lede").textContent = roster.length + " sworn of the Wild Hearts" +
      (withHistory ? " · " + withHistory + " sharing their chronicle" : "");
  }

  /* ---- deeds ---- */

  function renderDeeds(data) {
    var list = $("deeds");
    list.textContent = "";
    var names = {};
    (data.roster || []).forEach(function (entry) { names[entry.id] = entry.name; });

    var deeds = data.deeds || [];
    if (!deeds.length) {
      list.appendChild(el("li", "empty",
        "No deeds to show yet. Achievements appear here for adventurers who share their chronicle."));
      return;
    }
    deeds.forEach(function (deed) {
      var row = el("li", "deed");
      row.appendChild(el("span", "deed-who", names[deed.character_id] || deed.character_id));
      row.appendChild(el("span", "deed-name", deed.name || "An unnamed deed"));
      row.appendChild(el("span", "deed-when", formatDate(deed.obtained_at)));
      list.appendChild(row);
    });
  }

  /* ---- progression ---- */

  function sparkline(points) {
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "spark");
    svg.setAttribute("viewBox", "0 0 100 30");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");

    var levels = points.map(function (point) { return point[1]; });
    var low = Math.min.apply(null, levels);
    var high = Math.max.apply(null, levels);
    // A flat or single-point series would divide by zero; give it a mid-height line.
    var span = high - low || 1;

    if (points.length === 1) {
      var dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", "50");
      dot.setAttribute("cy", "15");
      dot.setAttribute("r", "2.5");
      svg.appendChild(dot);
      return svg;
    }

    var d = points.map(function (point, index) {
      var x = (index / (points.length - 1)) * 100;
      var y = 27 - ((point[1] - low) / span) * 24;
      return (index ? "L" : "M") + x.toFixed(2) + " " + y.toFixed(2);
    }).join(" ");

    var path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
    return svg;
  }

  function renderProgress(data) {
    var container = $("progress");
    container.textContent = "";

    var sharing = (data.roster || []).filter(function (entry) {
      return entry.job_series && Object.keys(entry.job_series).length;
    });

    if (!sharing.length) {
      container.appendChild(el("p", "empty",
        "No chronicles shared yet. Level progression appears here once an adventurer opts in."));
      return;
    }

    sharing.forEach(function (entry) {
      var card = el("div", "progress-card");
      card.appendChild(el("h2", null, entry.name));

      var jobs = Object.keys(entry.job_series).map(function (job) {
        var series = entry.job_series[job];
        return { job: job, series: series, level: series[series.length - 1][1] };
      }).sort(function (a, b) { return b.level - a.level; }).slice(0, 8);

      var onlyOnePoint = true;
      jobs.forEach(function (item) {
        if (item.series.length > 1) onlyOnePoint = false;
        var row = el("div", "spark-row");

        var label = el("span", "spark-label");
        var icon = el("img");
        icon.src = ICONS + slug(item.job) + ".png";
        icon.alt = "";
        icon.loading = "lazy";
        icon.addEventListener("error", function () { icon.remove(); });
        label.appendChild(icon);
        label.appendChild(document.createTextNode(item.job));
        row.appendChild(label);

        row.appendChild(sparkline(item.series));

        var first = item.series[0][1];
        var gained = item.level - first;
        var value = el("span", "spark-value", "Lv " + item.level);
        if (gained > 0) value.appendChild(el("span", "delta", " +" + gained));
        row.appendChild(value);
        card.appendChild(row);
      });

      if (onlyOnePoint) {
        card.appendChild(el("p", "spark-single",
          "One night recorded so far — the chronicle begins " +
          formatDate(data.history_begins) + "."));
      }
      container.appendChild(card);
    });
  }

  /* ---- views ---- */

  function wireViews() {
    var buttons = document.querySelectorAll(".system-icons button");
    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener("click", function () {
        Array.prototype.forEach.call(buttons, function (other) {
          other.classList.toggle("is-active", other === button);
          if (other === button) other.setAttribute("aria-current", "page");
          else other.removeAttribute("aria-current");
        });
        ["roster", "deeds", "progress"].forEach(function (name) {
          var section = $("view-" + name);
          var active = name === button.dataset.viewTarget;
          section.classList.toggle("is-active", active);
          section.hidden = !active;
        });
      });
    });
  }

  function showBanner(message) {
    var banner = $("banner");
    banner.textContent = message;
    banner.hidden = false;
  }

  function render(data) {
    renderRoster(data);
    renderDeeds(data);
    renderProgress(data);

    if (data.generated_at) {
      $("updated").textContent = "Updated " + formatDate(data.generated_at);
    }
    if (data.last_run && data.last_run.status && data.last_run.status !== "ok") {
      showBanner("The last chronicle run finished as “" + data.last_run.status +
                 "”, so some adventurers may be a day behind.");
    }
  }

  function load() {
    fetch(DATA_URL, { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("remote unavailable");
        return response.json();
      })
      .catch(function () {
        return fetch(LOCAL_FALLBACK, { cache: "no-store" }).then(function (response) {
          if (!response.ok) throw new Error("no data");
          return response.json();
        });
      })
      .then(render)
      .catch(function () {
        showBanner("The chronicle could not be read just now. It is published nightly.");
        $("roster").appendChild(el("p", "empty", "No data available."));
      });
  }

  wireViews();
  load();
})();
