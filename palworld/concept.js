// Fixed, not derived from location.hostname/pathname: this only worked by
// coincidence while the site was served from battydev.github.io. A custom
// domain would make location.hostname something else entirely, silently
// pointing the data fetch at the wrong GitHub repo.
const conceptOwner = "BattyDev";
const conceptRepository = "batty-mac-palworld-status";
const conceptLocal = ["127.0.0.1", "localhost"].includes(location.hostname);
const conceptStatusUrl = conceptLocal
  ? "status.json"
  : `https://raw.githubusercontent.com/${conceptOwner}/${conceptRepository}/data/status.json`;
let conceptPortraits = {};
let conceptPortraitLoad = null;
let activeInspectorPal = null;
let inspectorMaxed = false;
let inspectorAnchor = null;
let inspectorCloseTimer = null;
const inspectorDesktopQuery = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 901px)");
const playerIdentities = [
  {
    character: "Batty",
    profile: "Batman JJK",
    aliases: ["Batty", "Batty JJK", "Batman JJK"]
  },
  {
    character: "Marty katch'em",
    profile: "shotbyMARTY",
    aliases: ["Marty katch'em", "shotbyMARTY"]
  },
  {
    character: "TheNumbersMason",
    profile: "VapeNationMason",
    aliases: ["TheNumbersMason", "VapeNationMason"]
  },
  {
    character: "Owlz",
    profile: "OwlzBandit",
    aliases: ["Owlz", "OwlzBandit"]
  }
];

const elementIcons = {
  neutral: "assets/elements/neutral.webp",
  fire: "assets/elements/fire.webp",
  water: "assets/elements/water.webp",
  electricity: "assets/elements/electricity.webp",
  electric: "assets/elements/electricity.webp",
  grass: "assets/elements/grass.webp",
  dark: "assets/elements/dark.webp",
  dragon: "assets/elements/dragon.webp",
  ground: "assets/elements/ground.webp",
  earth: "assets/elements/ground.webp",
  ice: "assets/elements/ice.webp"
};

const $ = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];

// Native "click" synthesis from touch was reported unreliable on both iOS
// Safari and Android Chrome for opening the Pal inspector, so touch taps are
// detected manually here instead of trusting the browser to turn a touch
// gesture into a click. Mouse input is left alone (handled by the existing
// click listener) since this only reacts to pen/touch pointer types.
function bindTap(el, onTap) {
  const MOVE_THRESHOLD = 12;
  const TIME_THRESHOLD = 600;
  let origin = null;
  el.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse") return;
    origin = {x: event.clientX, y: event.clientY, time: Date.now()};
  });
  el.addEventListener("pointerup", event => {
    if (!origin || event.pointerType === "mouse") { origin = null; return; }
    const dx = Math.abs(event.clientX - origin.x);
    const dy = Math.abs(event.clientY - origin.y);
    const dt = Date.now() - origin.time;
    origin = null;
    if (dx <= MOVE_THRESHOLD && dy <= MOVE_THRESHOLD && dt <= TIME_THRESHOLD) onTap(event);
  });
  el.addEventListener("pointercancel", () => { origin = null; });
}

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const tidy = value => {
  const parsed = finite(value);
  return Number.isInteger(parsed) ? `${parsed}` : parsed.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};
const elapsed = seconds => {
  let remaining = Math.max(0, finite(seconds));
  const days = Math.floor(remaining / 86400);
  remaining %= 86400;
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor(remaining % 3600 / 60);
  return [days && `${days}d`, (days || hours) && `${hours}h`, `${minutes}m`].filter(Boolean).join(" ");
};
const seenAgo = value => {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};
const playerNameKey = value => String(value || "").trim().toLocaleLowerCase();
const playerIdentity = value => {
  const key = playerNameKey(value);
  return playerIdentities.find(identity =>
    identity.aliases.some(alias => playerNameKey(alias) === key)
  );
};
const canonicalPlayerKey = value => {
  const identity = playerIdentity(value);
  return playerNameKey(identity?.character || value);
};
const playerSecondaryLabel = (name, guild, gamertag) => {
  const identity = playerIdentity(name);
  // The hardcoded identity list (manually confirmed aliases) wins when
  // present; otherwise fall back to whatever gamertag the status feed
  // resolved automatically for this player (see xbox_gamertag in status.json).
  const resolvedGamertag = identity?.profile || gamertag;
  return [guild || "No guild observed", resolvedGamertag ? `Xbox · ${resolvedGamertag}` : null]
    .filter(Boolean)
    .join(" · ");
};

const conceptDataBranchAsset = path => conceptLocal
  ? path
  : `https://raw.githubusercontent.com/${conceptOwner}/${conceptRepository}/data/${path}`;

const gamerpicUrl = name => {
  const identity = playerIdentity(name);
  const slug = (identity?.character || name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return slug ? conceptDataBranchAsset(`assets/players/${slug}.png`) : null;
};

// Cached daily via OpenXBL by a private server-side job; only a resolved PNG
// (never the API key or an XUID) ever reaches this checkout. The letter
// stays as the fallback until (or unless) an image is confirmed to load.
function applyGamerpic(el, name) {
  if (!el) return;
  el.textContent = (name || "?").slice(0, 1).toUpperCase();
  const url = gamerpicUrl(name);
  if (!url) return;
  const img = new Image();
  img.alt = "";
  // Not lazy: this image is never attached to the DOM until it has already
  // loaded, and loading="lazy" depends on viewport-intersection, which is
  // meaningless (and breaks the load unpredictably) for a detached node.
  img.decoding = "async";
  img.onload = () => {
    el.textContent = "";
    el.append(img);
  };
  img.src = url;
}

function fill(name, value) {
  for (const node of all(`[data-field="${name}"]`)) node.textContent = value ?? "—";
}

function worldHighlights(data) {
  const config = data.configuration || {};
  const items = [];
  const add = (value, label, note) => items.push({value, label, note});
  if (config.ExpRate != null) add(`${tidy(config.ExpRate)}×`, "XP", "Faster leveling");
  if (config.PalCaptureRate != null) add(`${tidy(config.PalCaptureRate)}×`, "Capture", "Friendlier catches");
  if (config.CollectionDropRate != null) add(`${tidy(config.CollectionDropRate)}×`, "Resources", "Bigger gathering haul");
  if (config.WorkSpeedRate != null) add(`${tidy(config.WorkSpeedRate)}×`, "Work speed", "Quicker base projects");
  if (config.BaseCampWorkerMaxNum != null) add(tidy(config.BaseCampWorkerMaxNum), "Pals per base", "A proper workforce");
  if (config.BaseCampMaxNumInGuild != null) add(tidy(config.BaseCampMaxNumInGuild), "Guild bases", "Room to expand");
  if (finite(config.EquipmentDurabilityDamageRate) === 0) add("None", "Equipment wear", "No repair chores");
  if (config.BuildObjectDamageRate != null && finite(config.BuildObjectDamageRate) < 1) {
    add(`${Math.round((1 - finite(config.BuildObjectDamageRate)) * 100)}%`, "Less base damage", "Built to last");
  }
  for (const feature of Array.isArray(data.features) ? data.features : []) {
    if (feature?.title) add("2×", "Base radius", feature.title);
  }
  return items.slice(0, 8);
}

function achievementFor(guild) {
  const bases = finite(guild.bases);
  const workers = finite(guild.workers);
  const maximum = finite(guild.worker_levels?.maximum);
  if (maximum >= 50) return {mark: "★", title: "Veteran crew", note: `Level ${maximum} worker`};
  if (workers >= 30) return {mark: "⚙", title: "Powerhouse", note: `${workers} working Pals`};
  if (bases >= 3) return {mark: "◆", title: "Island network", note: `${bases} active bases`};
  if (workers >= 10) return {mark: "●", title: "Crew assembled", note: `${workers} working Pals`};
  return {mark: "△", title: "Camp established", note: `${bases} active base${bases === 1 ? "" : "s"}`};
}

function iconForHighlight(label) {
  const icons = {
    "XP": "bi-lightning-charge-fill",
    "Capture": "bi-bullseye",
    "Resources": "bi-box-seam-fill",
    "Work speed": "bi-gear-wide-connected",
    "Pals per base": "bi-people-fill",
    "Guild bases": "bi-houses-fill",
    "Equipment wear": "bi-shield-check",
    "Less base damage": "bi-bricks",
    "Base radius": "bi-bounding-box-circles"
  };
  return icons[label] || "bi-stars";
}

function themeForHighlight(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function renderHighlights(data) {
  const host = $("#concept-highlights");
  if (!host) return;
  host.replaceChildren();
  for (const item of worldHighlights(data)) {
    const article = document.createElement("article");
    article.className = `concept-highlight setting-${themeForHighlight(item.label)}`;
    article.innerHTML = `<i class="setting-art bi ${iconForHighlight(item.label)}" aria-hidden="true"></i><strong></strong><span></span><small></small>`;
    article.querySelector("strong").textContent = item.value;
    article.querySelector("span").textContent = item.label;
    article.querySelector("small").textContent = item.note;
    host.append(article);
  }
}

function appendParty(host, pals, emptyCopy = "No companion has been observed in the latest loaded snapshot.") {
  const party = Array.isArray(pals) ? pals.slice(0, 5) : [];
  const hasRichProfiles = party.some(pal => pal?.partner_skill);
  const wrapper = document.createElement("div");
  wrapper.className = "party-sightings";
  const label = document.createElement("small");
  label.textContent = hasRichProfiles ? "Current party" : "Party sightings";
  const chips = document.createElement("div");
  chips.className = party.some(pal => pal && typeof pal === "object") ? "pal-party-grid" : "pal-chips";
  for (const pal of party) {
    if (pal && typeof pal === "object") {
      const hasRichProfile = Boolean(pal.partner_skill);
      const card = document.createElement("button");
      card.type = "button";
      card.className = `pal-party-card${hasRichProfile ? "" : " is-summary-only"}`;
      const portrait = document.createElement("span");
      portrait.className = "pal-party-portrait";
      const image = document.createElement("img");
      image.className = "pal-party-image";
      image.alt = "";
      const portraitUrl = portraitForPal(pal);
      if (portraitUrl) {
        image.src = portraitUrl;
        image.addEventListener("error", () => image.remove());
        portrait.append(image);
      }
      const elementOverlay = createElementIcons(pal.elements, true);
      elementOverlay.classList.add("is-overlay");
      portrait.append(elementOverlay);
      const copy = document.createElement("span");
      copy.className = "pal-party-copy";
      const title = document.createElement("strong");
      title.textContent = pal.nickname || pal.species || "Unknown Pal";
      const subline = document.createElement("span");
      subline.className = "pal-party-subline";
      const species = document.createElement("small");
      const nickname = String(pal.nickname || "").trim();
      const speciesName = String(pal.species || "").trim();
      if (nickname && speciesName && nickname.toLocaleLowerCase() !== speciesName.toLocaleLowerCase()) {
        species.textContent = speciesName;
        subline.append(species);
      }
      const meta = document.createElement("span");
      meta.className = "pal-party-meta";
      const level = document.createElement("b");
      level.textContent = `Lv ${tidy(pal.level)}`;
      meta.append(level);
      if (pal.stars != null) meta.append(createStarRating(pal.stars, true));
      copy.append(title, subline, meta);
      card.append(portrait, copy);
      const showDesktopPreview = () => {
        if (!inspectorDesktopQuery.matches) return;
        cancelInspectorClose();
        openPalInspector(pal, card);
      };
      card.addEventListener("mouseenter", showDesktopPreview);
      card.addEventListener("mouseleave", scheduleInspectorClose);
      card.addEventListener("focus", showDesktopPreview);
      card.addEventListener("blur", scheduleInspectorClose);
      bindTap(card, () => {
        if (!inspectorDesktopQuery.matches) openPalInspector(pal);
      });
      card.addEventListener("click", event => {
        if (inspectorDesktopQuery.matches) {
          event.preventDefault();
          showDesktopPreview();
          return;
        }
        openPalInspector(pal);
      });
      if (!hasRichProfile) {
        card.title = "Detailed profile pending the next showcase refresh";
      }
      chips.append(card);
      continue;
    }
    const chip = document.createElement("span");
    const species = pal.species || pal.name || "Unknown Pal";
    const name = pal.nickname ? `${pal.nickname} (${species})` : species;
    chip.textContent = pal.level == null ? name : `${name} · Lv ${tidy(pal.level)}`;
    chips.append(chip);
  }
  if (!chips.children.length) {
    const empty = document.createElement("em");
    empty.textContent = emptyCopy;
    chips.append(empty);
  }
  wrapper.append(label, chips);
  host.append(wrapper);
}

function createStarRating(value, compact = false) {
  const rating = Math.max(0, Math.min(4, Math.round(finite(value))));
  const wrapper = document.createElement("span");
  wrapper.className = `star-rating${compact ? " is-compact" : ""}`;
  wrapper.setAttribute("aria-label", `${rating} of 4 condensation stars`);

  const icons = document.createElement("span");
  icons.className = "star-icons";
  icons.setAttribute("aria-hidden", "true");
  for (let index = 1; index <= 4; index += 1) {
    const star = document.createElement("i");
    star.className = index <= rating ? "is-filled" : "is-empty";
    star.textContent = index <= rating ? "\u2605" : "\u2606";
    icons.append(star);
  }
  wrapper.append(icons);
  return wrapper;
}

function createElementIcons(values, compact = false) {
  const labels = [];
  for (const value of Array.isArray(values) ? values : []) {
    const label = String(value || "").trim();
    const key = label.toLocaleLowerCase().replace(/[^a-z]/g, "");
    if (label && elementIcons[key] && !labels.some(item => item.key === key)) {
      labels.push({key, label});
    }
  }

  const wrapper = document.createElement("span");
  wrapper.className = `pal-element-icons${compact ? " is-compact" : ""}`;
  wrapper.setAttribute("aria-label", labels.length ? `Elements: ${labels.map(item => item.label).join(", ")}` : "Elements unavailable");
  wrapper.title = labels.map(item => item.label).join(" / ");

  for (const {key, label} of labels) {
    const icon = document.createElement("span");
    icon.className = `pal-element-icon element-${key}`;
    icon.title = label;
    const image = document.createElement("img");
    image.src = elementIcons[key];
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    icon.append(image);
    wrapper.append(icon);
  }
  return wrapper;
}

function showcaseParty(data, playerName, fallback = []) {
  const players = data?.pal_showcase?.players;
  if (!Array.isArray(players)) return fallback;
  const lookup = String(playerName || "").toLocaleLowerCase();
  const player = players.find(item => String(item?.name || "").toLocaleLowerCase() === lookup);
  return Array.isArray(player?.party) && player.party.length ? player.party : fallback;
}

function portraitForPal(pal) {
  const key = String(pal?.species || "").toLocaleLowerCase();
  return conceptPortraits[key] || "";
}

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value ?? "—";
}

function fillDefinitionList(host, rows) {
  host.replaceChildren();
  for (const [label, value, detail] of rows) {
    const block = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value ?? "—";
    block.append(dt, dd);
    if (detail) {
      const small = document.createElement("small");
      small.textContent = detail;
      block.append(small);
    }
    host.append(block);
  }
}

function renderInspectorStats(pal) {
  const stats = inspectorMaxed ? pal.maxed_projection : pal.stats;
  setText("[data-pal-stats-mode]", inspectorMaxed ? "Maxed projection" : "Current build");
  fillDefinitionList($("[data-pal-stats]"), [
    ["HP", stats?.hp == null ? "—" : Math.round(stats.hp).toLocaleString()],
    ["Attack", stats?.attack == null ? "—" : Math.round(stats.attack).toLocaleString()],
    ["Defense", stats?.defense == null ? "—" : Math.round(stats.defense).toLocaleString()],
    ["Work speed", stats?.work_speed == null ? "—" : Math.round(stats.work_speed).toLocaleString()]
  ]);
  const toggle = $("[data-pal-maxed-toggle]");
  toggle?.classList.toggle("is-active", inspectorMaxed);
}

function renderSkillList(host, skills, emptyCopy) {
  host.replaceChildren();
  for (const skill of Array.isArray(skills) ? skills : []) {
    const row = document.createElement("article");
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    const detail = document.createElement("small");
    name.textContent = skill.name || "Unknown skill";
    detail.textContent = [skill.element, skill.power == null ? null : `${tidy(skill.power)} power`, skill.cooldown == null ? null : `${tidy(skill.cooldown)}s`].filter(Boolean).join(" · ");
    copy.append(name, detail);
    const description = document.createElement("p");
    description.textContent = skill.description || "";
    row.append(copy, description);
    host.append(row);
  }
  if (!host.children.length) {
    const empty = document.createElement("p");
    empty.className = "pal-data-empty";
    empty.textContent = emptyCopy;
    host.append(empty);
  }
}

function normalizedPartnerSkill(pal) {
  const source = Array.isArray(pal?.partner_skill?.levels) ? pal.partner_skill.levels : [];
  const legacyOneBased = source.length > 0
    && !source.some(item => finite(item.level) === 0)
    && source.every(item => finite(item.level) >= 1 && finite(item.level) <= 5);
  const offset = legacyOneBased ? 1 : 0;
  return {
    levels: source.map(item => ({...item, level: finite(item.level) - offset})),
    currentLevel: Math.max(0, Math.min(4, finite(pal?.partner_skill?.current_level) - offset))
  };
}

function renderPartnerRank(pal, selectedLevel) {
  const levels = normalizedPartnerSkill(pal).levels;
  const selected = levels.find(item => finite(item.level) === finite(selectedLevel)) || levels[0];
  setText("[data-pal-partner-effect]", selected?.effect || "No partner-skill effect data available.");
  for (const button of all("[data-partner-rank]")) {
    button.classList.toggle("is-active", finite(button.dataset.partnerRank) === finite(selected?.level));
  }
}

function cancelInspectorClose() {
  if (inspectorCloseTimer == null) return;
  window.clearTimeout(inspectorCloseTimer);
  inspectorCloseTimer = null;
}

function scheduleInspectorClose() {
  cancelInspectorClose();
  inspectorCloseTimer = window.setTimeout(() => {
    const inspector = $("#pal-inspector");
    const anchorHovered = inspectorAnchor?.matches(":hover");
    const inspectorHovered = inspector?.matches(":hover");
    const focusInside = inspector?.contains(document.activeElement);
    const anchorFocused = document.activeElement === inspectorAnchor;
    if (anchorHovered || inspectorHovered || focusInside || anchorFocused) return;
    closePalInspector();
  }, 180);
}

function positionPalInspector(anchor) {
  const inspector = $("#pal-inspector");
  const panel = inspector?.querySelector(".pal-inspector-panel");
  if (!inspector || !panel || !anchor || inspector.hidden || !inspector.classList.contains("is-popover")) return;

  const anchorRect = anchor.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const gap = 12;
  const edge = 12;
  let left = anchorRect.right + gap;
  if (left + panelRect.width > window.innerWidth - edge) {
    left = anchorRect.left - panelRect.width - gap;
  }
  left = Math.max(edge, Math.min(left, window.innerWidth - panelRect.width - edge));

  let top = anchorRect.top;
  top = Math.max(edge, Math.min(top, window.innerHeight - panelRect.height - edge));
  inspector.style.setProperty("--inspector-left", `${Math.round(left)}px`);
  inspector.style.setProperty("--inspector-top", `${Math.round(top)}px`);
}

function openPalInspector(pal, anchor = null) {
  const inspector = $("#pal-inspector");
  if (!inspector || !pal) return;
  cancelInspectorClose();
  const popover = Boolean(anchor && inspectorDesktopQuery.matches);
  inspectorAnchor = popover ? anchor : null;
  inspector.classList.toggle("is-popover", popover);
  inspector.classList.toggle("is-mobile-dialog", !popover);
  inspector.classList.toggle("is-limited-profile", !pal.partner_skill);
  inspector.querySelector(".pal-inspector-panel")?.setAttribute("aria-modal", popover ? "false" : "true");
  activeInspectorPal = pal;
  inspectorMaxed = false;
  setText("[data-pal-name]", pal.nickname || pal.species || "Unknown Pal");
  setText("[data-pal-species]", pal.nickname ? pal.species : "Party Pal");
  setText("[data-pal-level]", tidy(pal.level));
  setText("[data-pal-gender]", pal.gender ? ` · ${pal.gender}` : "");
  setText("[data-pal-owner]", pal.owner ? ` · ${pal.owner}'s party` : "");
  const stars = $("[data-pal-stars]");
  stars.replaceChildren(createStarRating(pal.stars));

  const elements = $("[data-pal-elements]");
  elements.replaceChildren(createElementIcons(pal.elements));

  const portrait = $("[data-pal-portrait]");
  const portraitUrl = portraitForPal(pal);
  if (portraitUrl) portrait.src = portraitUrl;
  else portrait.removeAttribute("src");
  portrait.alt = `${pal.nickname || pal.species} portrait`;
  portrait.hidden = !portraitUrl;
  portrait.onerror = () => { portrait.hidden = true; };

  setText("[data-pal-partner-name]", pal.partner_skill?.name || "Partner Skill");
  const rankHost = $("[data-pal-partner-ranks]");
  rankHost.replaceChildren();
  const partnerSkill = normalizedPartnerSkill(pal);
  for (const level of partnerSkill.levels) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.partnerRank = level.level;
    button.textContent = `Lv.${level.level}`;
    button.addEventListener("click", () => renderPartnerRank(pal, level.level));
    rankHost.append(button);
  }
  renderPartnerRank(pal, partnerSkill.currentLevel);

  renderSkillList($("[data-pal-active-skills]"), pal.active_skills, "No equipped active skills found.");
  renderSkillList($("[data-pal-learned]"), pal.learned_skills, "No learned-skill library found.");
  setText("[data-pal-learned-count]", finite(pal.learned_skills?.length));

  const passiveHost = $("[data-pal-passives]");
  passiveHost.replaceChildren();
  for (const passive of Array.isArray(pal.passives) ? pal.passives : []) {
    const row = document.createElement("article");
    const heading = document.createElement("strong");
    const rank = finite(passive.rank);
    heading.textContent = `${passive.name || "Unknown passive"}${rank ? ` · ${rank > 0 ? "+" : ""}${rank}` : ""}`;
    const copy = document.createElement("p");
    copy.textContent = passive.description || "Effect details unavailable.";
    row.append(heading, copy);
    passiveHost.append(row);
  }
  if (!passiveHost.children.length) {
    const empty = document.createElement("p");
    empty.className = "pal-data-empty";
    empty.textContent = "No passive skills found.";
    passiveHost.append(empty);
  }

  const trust = pal.trust || {};
  setText("[data-pal-trust-rank]", `Rank ${finite(trust.rank)}`);
  const trustBar = $("[data-pal-trust-bar]");
  trustBar.style.width = `${Math.max(0, Math.min(100, finite(trust.progress_percent)))}%`;
  setText("[data-pal-trust-copy]", trust.next_rank_points == null
    ? `${finite(trust.points).toLocaleString()} points · Maximum trust`
    : `${finite(trust.points).toLocaleString()} / ${finite(trust.next_rank_points).toLocaleString()} points`);

  fillDefinitionList($("[data-pal-potential]"), [
    ["HP", finite(pal.potential?.hp)],
    ["Attack", finite(pal.potential?.attack)],
    ["Defense", finite(pal.potential?.defense)]
  ]);
  fillDefinitionList($("[data-pal-souls]"), [
    ["HP", finite(pal.souls?.hp)],
    ["Attack", finite(pal.souls?.attack)],
    ["Defense", finite(pal.souls?.defense)],
    ["Work", finite(pal.souls?.work_speed)]
  ]);
  renderInspectorStats(pal);

  const workHost = $("[data-pal-work]");
  workHost.replaceChildren();
  for (const work of Array.isArray(pal.work_suitability) ? pal.work_suitability : []) {
    const row = document.createElement("div");
    const name = document.createElement("strong");
    const level = document.createElement("b");
    const detail = document.createElement("small");
    name.textContent = work.name || work.id || "Work";
    level.textContent = `Lv.${finite(work.level)}`;
    const bonus = finite(work.direct_bonus) + finite(work.passive_bonus);
    detail.textContent = bonus ? `Base ${finite(work.base_level)} + ${bonus} bonus` : `Base level ${finite(work.base_level)}`;
    row.append(name, level, detail);
    workHost.append(row);
  }
  if (!workHost.children.length) {
    const empty = document.createElement("p");
    empty.className = "pal-data-empty";
    empty.textContent = "No work suitability found.";
    workHost.append(empty);
  }

  const flagHost = $("[data-pal-flags]");
  flagHost.replaceChildren();
  const flagLabels = {alpha: "Alpha", lucky: "Lucky", awakened: "Awakened", imported: "Imported", favorite: "Favorite"};
  for (const [key, label] of Object.entries(flagLabels)) {
    if (!pal.flags?.[key]) continue;
    const chip = document.createElement("span");
    chip.textContent = label;
    flagHost.append(chip);
  }

  inspector.hidden = false;
  document.body.classList.toggle("has-pal-inspector", !popover);
  if (popover) {
    window.requestAnimationFrame(() => positionPalInspector(anchor));
  } else {
    // preventScroll matters specifically on iOS Safari: without it, focusing
    // the close button right as the fixed-position dialog opens can trigger
    // Safari's focus-triggered scroll-into-view against the dynamic
    // address-bar viewport, which can leave the dialog looking like it never
    // opened.
    $(".pal-inspector-close")?.focus({preventScroll: true});
  }
}

function closePalInspector() {
  const inspector = $("#pal-inspector");
  if (!inspector || inspector.hidden) return;
  cancelInspectorClose();
  inspector.hidden = true;
  activeInspectorPal = null;
  inspectorAnchor = null;
  inspector.classList.remove("is-popover", "is-mobile-dialog", "is-limited-profile");
  inspector.style.removeProperty("--inspector-left");
  inspector.style.removeProperty("--inspector-top");
  document.body.classList.remove("has-pal-inspector");
}

function renderOnline(data) {
  const host = $("#concept-online");
  if (!host) return;
  host.replaceChildren();
  const players = Array.isArray(data.online_players) ? data.online_players : [];
  for (const player of players) {
    const item = document.createElement("li");
    item.className = "player-card";
    const avatar = document.createElement("span");
    avatar.className = "player-avatar";
    applyGamerpic(avatar, player.name);
    const body = document.createElement("div");
    body.className = "player-card-body";
    const heading = document.createElement("div");
    heading.className = "player-card-heading";
    const name = document.createElement("strong");
    name.textContent = player.name || "Unknown player";
    const guild = document.createElement("span");
    guild.textContent = playerSecondaryLabel(player.name, player.guild, player.xbox_gamertag);
    heading.append(name, guild);
    const stats = document.createElement("dl");
    stats.className = "player-stats";
    const values = [
      ["Level", player.level],
      ["Health", player.health_percent == null ? null : `${tidy(player.health_percent)}%`],
      ["Ping", player.ping == null ? null : `${tidy(player.ping)} ms`],
      ["Activity", player.action || player.stage || "Exploring"]
    ];
    for (const [term, value] of values) {
      const block = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = term;
      dd.textContent = value == null ? "—" : value;
      block.append(dt, dd);
      stats.append(block);
    }
    body.append(heading, stats);
    appendParty(body, showcaseParty(data, player.name, player.party_sightings));
    item.append(avatar, body);
    host.append(item);
  }
  if (!players.length) {
    const item = document.createElement("li");
    item.className = "people-empty";
    item.textContent = "The islands are quiet. Nobody is online.";
    host.append(item);
  }
}

function renderRecent(data) {
  const host = $("#concept-recent");
  if (!host) return;
  host.replaceChildren();
  const onlineNames = new Set(
    (Array.isArray(data.player_names) ? data.player_names : []).map(canonicalPlayerKey)
  );
  const source = Array.isArray(data.known_players) ? data.known_players : data.recent_players;
  const displayedIdentities = new Set();
  const recent = Array.isArray(source)
    ? source.filter(player => {
      const identity = canonicalPlayerKey(player.name);
      if (player.online || onlineNames.has(identity) || displayedIdentities.has(identity)) return false;
      displayedIdentities.add(identity);
      return true;
    }).slice(0, 20)
    : [];
  for (const player of recent) {
    const item = document.createElement("li");
    item.className = "offline-player-card";
    const body = document.createElement("div");
    body.className = "player-card-body";
    const heading = document.createElement("div");
    heading.className = "player-card-heading";
    const name = document.createElement("strong");
    name.textContent = player.name;
    const guild = document.createElement("span");
    guild.textContent = playerSecondaryLabel(player.name, player.guild || "Guild not observed", player.xbox_gamertag);
    heading.append(name, guild);
    const details = document.createElement("div");
    details.className = "offline-player-meta";
    const level = document.createElement("span");
    level.textContent = player.level == null ? "Level unknown" : `Level ${tidy(player.level)}`;
    const time = document.createElement("span");
    time.textContent = player.last_seen ? `Last seen ${seenAgo(player.last_seen)} ago` : "Last seen before tracking began";
    details.append(level, time);
    body.append(heading, details);
    appendParty(body, showcaseParty(data, player.name, player.party_sightings), "No recent companion sighting.");
    item.append(body);
    host.append(item);
  }
  if (!recent.length) {
    const item = document.createElement("li");
    item.className = "people-empty";
    item.textContent = "Everyone recently seen is currently online.";
    host.append(item);
  }
}

function achievementsForGuild(guild) {
  const achievements = [];
  const bases = finite(guild.bases);
  const workers = finite(guild.workers);
  const levels = guild.worker_levels || {};
  const health = finite(guild.worker_health_average);
  const working = finite(guild.top_worker_actions?.find(action => action.name === "Working")?.count);
  const add = (icon, title, detail, rank) => achievements.push({icon, title, detail, rank});

  if (bases >= 1) add("bi-house-heart-fill", "Camp Established", `${bases === 1 ? "First base is online" : `${bases} active bases across the islands`}.`, 1);
  if (bases >= 3) add("bi-map-fill", "Island Network", `A network of ${bases} working bases.`, 3);
  if (workers >= 10) add("bi-people-fill", "Crew Assembled", `${workers} working Pals keep the guild moving.`, 2);
  if (workers >= 30) add("bi-gear-wide-connected", "Industrial Powerhouse", `A workforce ${workers} Pals strong.`, 4);
  if (finite(levels.maximum) >= 50) add("bi-star-fill", "Veteran Workforce", `Raised a base worker to level ${levels.maximum}.`, 5);
  if (health >= 95 && workers >= 5) add("bi-heart-pulse-fill", "Well-Kept Crew", `${tidy(health)}% average worker health.`, 3);
  if (working >= 20) add("bi-hammer", "Always Building", `${working} Pals working in the latest snapshot.`, 3);
  return achievements;
}

function renderAchievements(data) {
  const host = $("#concept-achievements");
  if (!host) return;
  host.replaceChildren();
  const guilds = Array.isArray(data.guilds) ? data.guilds : [];

  for (const guild of guilds) {
    for (const achievement of achievementsForGuild(guild)) {
      const card = document.createElement("article");
      card.className = `achievement-card rank-${achievement.rank}`;
      const icon = document.createElement("i");
      icon.className = `bi ${achievement.icon}`;
      const copy = document.createElement("div");
      const guildName = document.createElement("small");
      guildName.textContent = guild.name;
      const title = document.createElement("h3");
      title.textContent = achievement.title;
      const detail = document.createElement("p");
      detail.textContent = achievement.detail;
      copy.append(guildName, title, detail);
      card.append(icon, copy);
      host.append(card);
    }
  }

  if (!host.children.length) host.textContent = "The current snapshot has not unlocked any guild accomplishments yet.";
}

function displayData(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (value == null || value === "") return "—";
  return typeof value === "number" ? tidy(value) : String(value);
}

function addDataRow(host, label, value) {
  const row = document.createElement("div");
  const term = document.createElement("span");
  const detail = document.createElement("strong");
  term.textContent = label;
  detail.textContent = displayData(value);
  row.append(term, detail);
  host.append(row);
}

function renderOverkill(data, online) {
  const summary = $("#concept-overkill-summary");
  const censusHost = $("#concept-census");
  const playerHost = $("#concept-player-detail");
  const configHost = $("#concept-configuration");
  if (!summary || !censusHost || !playerHost || !configHost) return;
  summary.replaceChildren();
  censusHost.replaceChildren();
  playerHost.replaceChildren();
  configHost.replaceChildren();

  const performance = data.performance || {};
  const system = data.system || {};
  const census = data.pal_census || {};
  const summaryItems = [
    ["bi-activity", "Server status", online ? "Online" : "Offline"],
    ["bi-speedometer2", "Average FPS", performance.average_fps ?? data.fps],
    ["bi-hourglass-split", "Frame time", performance.frame_time_ms == null ? "—" : `${tidy(performance.frame_time_ms)} ms`],
    ["bi-memory", "Palworld memory", system.palworld_memory_gib == null ? "—" : `${tidy(system.palworld_memory_gib)} GiB`],
    ["bi-thermometer-half", "Host temperature", system.temperature_c == null ? "—" : `${tidy(system.temperature_c)} °C`],
    ["bi-database-fill", "Disk free", system.disk_free_gib == null ? "—" : `${tidy(system.disk_free_gib)} GiB`]
  ];
  for (const [iconName, label, value] of summaryItems) {
    const card = document.createElement("article");
    const icon = document.createElement("i");
    icon.className = `bi ${iconName}`;
    const small = document.createElement("small");
    small.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = displayData(value);
    card.append(icon, small, strong);
    summary.append(card);
  }

  addDataRow(censusHost, "Total actors", census.total_actors);
  for (const [label, value] of Object.entries(census.counts || {})) addDataRow(censusHost, label, value);
  for (const [label, value] of Object.entries(census.health_average || {})) addDataRow(censusHost, `${label} health`, `${tidy(value)}%`);
  for (const player of Array.isArray(data.online_players) ? data.online_players : []) {
    const companions = Array.isArray(player.party_sightings) ? player.party_sightings.length : 0;
    const health = player.health_percent == null ? "health unknown" : `${tidy(player.health_percent)}% health`;
    addDataRow(
      playerHost,
      player.name,
      `Lv ${displayData(player.level)} · ${player.guild || "No guild"} · ${tidy(player.ping)} ms · ${health} · ${companions} party sighting${companions === 1 ? "" : "s"}`
    );
  }
  if (!playerHost.children.length) addDataRow(playerHost, "Players", "Nobody online");
  for (const [label, value] of Object.entries(data.configuration || {}).sort(([a], [b]) => a.localeCompare(b))) {
    addDataRow(configHost, label, value);
  }
}

function renderGuilds(data) {
  const host = $("#concept-guilds");
  if (!host) return;
  host.replaceChildren();
  for (const guild of Array.isArray(data.guilds) ? data.guilds : []) {
    const achievement = achievementFor(guild);
    const article = document.createElement("article");
    article.className = "guild-detail-card";
    const header = document.createElement("header");
    const identity = document.createElement("div");
    identity.className = "guild-identity";
    const crest = document.createElement("span");
    crest.className = "guild-crest";
    crest.innerHTML = `<i class="bi bi-shield-fill"></i>`;
    const identityCopy = document.createElement("div");
    const eyebrow = document.createElement("small");
    eyebrow.textContent = "Guild profile";
    const name = document.createElement("h3");
    name.textContent = guild.name;
    const identityNote = document.createElement("p");
    identityNote.textContent = achievement.title;
    identityCopy.append(eyebrow, name, identityNote);
    identity.append(crest, identityCopy);
    const totals = document.createElement("div");
    totals.className = "guild-totals";
    for (const [value, label] of [
      [finite(guild.bases), "Bases"],
      [finite(guild.workers), "Working Pals"],
      [Array.isArray(guild.members) ? guild.members.length : finite(guild.online_players?.length), "Members observed"]
    ]) {
      const metric = document.createElement("span");
      metric.innerHTML = `<strong>${value}</strong><small>${label}</small>`;
      totals.append(metric);
    }
    header.append(identity, totals);

    const overview = document.createElement("div");
    overview.className = "guild-overview";
    const badge = document.createElement("b");
    badge.textContent = achievement.mark;
    const overviewCopy = document.createElement("span");
    const workerLevels = guild.worker_levels || {};
    overviewCopy.innerHTML = `<strong></strong><small></small>`;
    overviewCopy.querySelector("strong").textContent = achievement.title;
    overviewCopy.querySelector("small").textContent = [
      achievement.note,
      workerLevels.average == null ? null : `average worker level ${tidy(workerLevels.average)}`,
      guild.worker_health_average == null ? null : `${tidy(guild.worker_health_average)}% average worker health`
    ].filter(Boolean).join(" · ");
    overview.append(badge, overviewCopy);

    const columns = document.createElement("div");
    columns.className = "guild-detail-columns";
    const membersSection = document.createElement("section");
    const membersTitle = document.createElement("h4");
    membersTitle.innerHTML = `<i class="bi bi-people-fill"></i> Members`;
    const memberList = document.createElement("div");
    memberList.className = "guild-member-list";
    for (const member of Array.isArray(guild.members) ? guild.members : []) {
      const memberCard = document.createElement("article");
      memberCard.className = `guild-member ${member.online ? "is-online" : ""}`;
      const memberHead = document.createElement("div");
      memberHead.className = "guild-member-head";
      const memberAvatar = document.createElement("span");
      memberAvatar.className = "guild-member-avatar";
      applyGamerpic(memberAvatar, member.name);
      const memberIdentity = document.createElement("div");
      memberIdentity.className = "guild-member-identity";
      const memberName = document.createElement("strong");
      memberName.textContent = member.name || "Unknown member";
      const level = document.createElement("small");
      level.textContent = member.level == null ? "Level unknown" : `Level ${tidy(member.level)}`;
      memberIdentity.append(memberName, level);
      const memberState = document.createElement("span");
      memberState.textContent = member.online
        ? "Online now"
        : member.last_seen
          ? `Seen ${seenAgo(member.last_seen)} ago`
          : "Previously observed";
      memberHead.append(memberAvatar, memberIdentity, memberState);
      memberCard.append(memberHead);
      appendParty(memberCard, showcaseParty(data, member.name, member.party_sightings), "No recent companion sighting.");
      memberList.append(memberCard);
    }
    if (!memberList.children.length) {
      const empty = document.createElement("p");
      empty.className = "guild-empty";
      empty.textContent = "No members have been safely matched to this guild yet.";
      memberList.append(empty);
    }
    membersSection.append(membersTitle, memberList);

    const basesSection = document.createElement("section");
    const basesTitle = document.createElement("h4");
    basesTitle.innerHTML = `<i class="bi bi-houses-fill"></i> Bases & working Pals`;
    const baseList = document.createElement("div");
    baseList.className = "guild-base-list";
    for (const base of Array.isArray(guild.bases_detail) ? guild.bases_detail : []) {
      const details = document.createElement("details");
      details.className = "guild-base";
      const summary = document.createElement("summary");
      const baseIcon = document.createElement("i");
      baseIcon.className = "bi bi-house-gear-fill";
      baseIcon.setAttribute("aria-hidden", "true");
      const baseName = document.createElement("strong");
      baseName.textContent = base.label || "Base";
      const count = document.createElement("span");
      count.textContent = `${finite(base.worker_count)} working Pals`;
      summary.append(baseIcon, baseName, count);
      const roster = document.createElement("div");
      roster.className = "worker-roster";
      for (const worker of Array.isArray(base.workers) ? base.workers : []) {
        const row = document.createElement("div");
        row.className = "worker-card";
        const portrait = document.createElement("span");
        portrait.className = "worker-portrait";
        const portraitUrl = portraitForPal(worker);
        if (portraitUrl) {
          const image = document.createElement("img");
          image.src = portraitUrl;
          image.alt = "";
          image.addEventListener("error", () => image.remove());
          portrait.append(image);
        } else {
          portrait.innerHTML = `<i class="bi bi-stars"></i>`;
        }
        const workerCopy = document.createElement("span");
        workerCopy.className = "worker-copy";
        const workerName = document.createElement("strong");
        const species = worker.species || "Unknown Pal";
        workerName.textContent = worker.nickname ? `${worker.nickname} (${species})` : species;
        const stats = document.createElement("span");
        // worker.action is a raw internal AI/blueprint identifier (e.g.
        // "BP_AIAction_BaseCampWorker_Wait"), not a human-readable label --
        // deliberately not shown until there's a real name mapping for it.
        const parts = [
          worker.level == null ? null : `Lv ${tidy(worker.level)}`,
          worker.health_percent == null ? null : `${tidy(worker.health_percent)}% HP`
        ].filter(Boolean);
        stats.textContent = parts.join(" · ") || "Details unavailable";
        workerCopy.append(workerName, stats);
        row.append(portrait, workerCopy);
        roster.append(row);
      }
      if (!roster.children.length) roster.textContent = "No workers were loaded near this Palbox in the latest snapshot.";
      details.append(summary, roster);
      if (!baseList.children.length) details.open = true;
      baseList.append(details);
    }
    if (!baseList.children.length) {
      const empty = document.createElement("p");
      empty.className = "guild-empty";
      empty.textContent = "Base rosters appear after the server observes the guild's loaded bases.";
      baseList.append(empty);
    }
    basesSection.append(basesTitle, baseList);
    columns.append(membersSection, basesSection);
    article.append(header, overview, columns);
    host.append(article);
  }
  if (!host.children.length) host.textContent = "Guild records are waiting for the next active snapshot.";
}

function bossCountdown(value) {
  const remaining = Math.max(0, Math.floor((Date.parse(value) - Date.now()) / 1000));
  if (!remaining) return "Checking…";
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  return hours
    ? `${hours}h ${String(minutes).padStart(2, "0")}m`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function updateBossCountdowns() {
  for (const node of all("[data-respawn-at]")) {
    node.textContent = bossCountdown(node.dataset.respawnAt);
  }
}

function selectBoss(key) {
  for (const node of all("[data-boss-key]")) {
    node.classList.toggle("is-selected", node.dataset.bossKey === key);
  }
}

// Bosses are assumed alive unless a kill was actually observed (status
// "down"); there is no third "not observed" state to display.
function bossStatusCopy(boss) {
  if (boss.status === "down") return boss.estimate_source === "measured" ? "Measured respawn" : "Estimated respawn";
  return boss.health_percent == null ? "Alive now" : `${tidy(boss.health_percent)}% health`;
}

// Same confirm-load-before-swap pattern as the gamerpic avatars: the status
// glyph shows immediately, and only gets replaced with the Pal portrait (plus
// the glyph demoted to a small corner badge) once the image is confirmed to
// load, so a bad/missing portrait never leaves a broken image on the radar.
function applyBossFace(container, boss, glyphClass) {
  container.replaceChildren();
  const icon = document.createElement("i");
  icon.className = `bi ${glyphClass}`;
  container.append(icon);
  const portraitUrl = portraitForPal({species: boss.name});
  if (!portraitUrl) return;
  const img = new Image();
  img.alt = "";
  // See applyGamerpic: no loading="lazy" here either, same reason.
  img.decoding = "async";
  img.onload = () => {
    const face = document.createElement("span");
    face.className = "boss-face";
    const badge = document.createElement("i");
    badge.className = `boss-status-badge bi ${glyphClass}`;
    face.append(img, badge);
    container.replaceChildren(face);
  };
  img.src = portraitUrl;
}

function renderBossRadar(data) {
  const tracker = data.boss_tracker || {};
  const bosses = Array.isArray(tracker.bosses) ? tracker.bosses : [];
  const list = $("#boss-list");
  const summary = $("#boss-summary");
  const coverage = $("[data-boss-coverage]");
  if (!list || !summary || !coverage) return;

  list.replaceChildren();
  summary.replaceChildren();
  const trackerFresh = tracker.updated_at && Date.now() - Date.parse(tracker.updated_at) < 7 * 60 * 1000;
  for (const node of all("[data-boss-signal]")) node.classList.toggle("is-live", Boolean(trackerFresh));
  coverage.textContent = bosses.length
    ? `${bosses.length} alpha${bosses.length === 1 ? "" : "s"} learned · regions load near players`
    : "Waiting for alpha sightings";

  const counts = tracker.summary || {};
  // Fold any legacy "unknown" bucket the publisher might still send into
  // alive: bosses are assumed alive unless a kill was actually observed.
  const downCount = counts.down ?? bosses.filter(item => item.status === "down").length;
  const aliveCount = (counts.alive ?? bosses.filter(item => item.status === "alive").length)
    + (counts.unknown ?? bosses.filter(item => item.status === "unknown").length);
  const summaryItems = [
    ["alive", aliveCount, "Alive now"],
    ["down", downCount, "Respawning"]
  ];
  for (const [state, value, label] of summaryItems) {
    const card = document.createElement("article");
    card.className = state;
    const strong = document.createElement("strong");
    strong.textContent = finite(value);
    const span = document.createElement("span");
    span.textContent = label;
    card.append(strong, span);
    summary.append(card);
  }
  fill("bosses-up", finite(aliveCount));

  for (const boss of bosses) {
    const key = String(boss.key || boss.name || "boss");
    const status = boss.status === "down" ? "down" : "alive";
    const bossName = boss.name || "Unknown Alpha";

    // We don't have (and shouldn't try to rebuild) real per-species spawn
    // location data ourselves, so "where to find it" links out to the
    // Palworld Fandom wiki's page for that Pal, which has habitat/wild
    // spawn info already.
    const card = document.createElement("a");
    card.href = `https://palworld.fandom.com/wiki/${encodeURIComponent(bossName.trim())}`;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.className = `boss-card status-${status}`;
    card.dataset.bossKey = key;
    const icon = document.createElement("span");
    icon.className = "boss-state-icon";
    applyBossFace(icon, boss, status === "down" ? "bi-hourglass-split" : "bi-lightning-charge-fill");
    const copy = document.createElement("span");
    copy.className = "boss-card-copy";
    const name = document.createElement("strong");
    name.textContent = bossName;
    const linkHint = document.createElement("i");
    linkHint.className = "bi bi-box-arrow-up-right boss-card-link-hint";
    linkHint.setAttribute("aria-hidden", "true");
    name.append(linkHint);
    const meta = document.createElement("small");
    meta.textContent = `${boss.level ? `Lv ${boss.level} · ` : ""}${bossStatusCopy(boss)}`;
    copy.append(name, meta);
    const time = document.createElement("span");
    time.className = "boss-card-time";
    const timeValue = document.createElement("strong");
    const timeLabel = document.createElement("small");
    if (status === "down" && boss.estimated_respawn_at) {
      timeValue.dataset.respawnAt = boss.estimated_respawn_at;
      timeValue.textContent = bossCountdown(boss.estimated_respawn_at);
      timeLabel.textContent = "until check";
    } else {
      timeValue.textContent = status === "alive" ? "UP" : "—";
      timeLabel.textContent = status === "alive" ? "loaded now" : "no claim";
    }
    time.append(timeValue, timeLabel);
    card.append(icon, copy, time);
    card.addEventListener("click", () => selectBoss(key));
    list.append(card);
  }

  if (!bosses.length) {
    const note = document.createElement("p");
    note.className = "boss-list-empty";
    note.textContent = "The tracker learns an Alpha the first time somebody visits it. No player positions or IDs are needed.";
    list.append(note);
  }
  updateBossCountdowns();
}

async function loadPortraits() {
  if (!conceptPortraitLoad) {
    conceptPortraitLoad = fetch(`pal-portraits.json?v=1`, {cache: "force-cache"})
      .then(response => response.ok ? response.json() : {})
      .catch(() => ({}));
  }
  conceptPortraits = await conceptPortraitLoad;
}

async function loadConcept() {
  try {
    await loadPortraits();
    const response = await fetch(`${conceptStatusUrl}?t=${Date.now()}`, {cache: "no-store"});
    if (!response.ok) throw new Error("Status unavailable");
    const data = await response.json();
    const online = Boolean(data.online) && Date.now() - Date.parse(data.updated_at) < 30 * 60 * 1000;
    fill("server-name", data.server_name || "Batty Mac");
    fill("description", data.description || "Palworld dedicated server");
    fill("version", data.version || "Unavailable");
    fill("status", online ? "Online" : "Offline");
    fill("players", finite(data.players));
    fill("max-players", finite(data.max_players));
    // The average smooths out momentary dips (autosave, load spikes) that
    // make the instantaneous reading look worse than the server's actual
    // typical performance; fall back to the instantaneous fps if a
    // publisher snapshot doesn't have the averaged field yet.
    fill("fps", Math.round(finite(data.performance?.average_fps ?? data.fps)));
    fill("day", finite(data.world_day));
    fill("bases", finite(data.base_camps));
    fill("guild-count", finite(Array.isArray(data.guilds) ? data.guilds.length : 0));
    fill("uptime", elapsed(data.uptime));
    fill("updated", new Date(data.updated_at).toLocaleString());
    for (const node of all("[data-status-dot]")) node.classList.toggle("is-online", online);
    renderHighlights(data);
    renderOnline(data);
    renderRecent(data);
    renderGuilds(data);
    renderAchievements(data);
    renderOverkill(data, online);
    renderBossRadar(data);
  } catch (_) {
    fill("status", "Signal lost");
    for (const node of all("[data-status-dot]")) node.classList.remove("is-online");
  }
}

applyGamerpic($(".gamerpic"), "Batty");

loadConcept();
setInterval(loadConcept, 60000);
setInterval(updateBossCountdowns, 1000);

function updateClock() {
  const clock = $("[data-clock]");
  if (!clock) return;
  const now = new Date();
  clock.dateTime = now.toISOString();
  clock.textContent = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

updateClock();
setInterval(updateClock, 30000);

for (const control of all("[data-pal-close]")) {
  control.addEventListener("click", closePalInspector);
  bindTap(control, closePalInspector);
}

const palInspector = $("#pal-inspector");
palInspector?.addEventListener("mouseenter", cancelInspectorClose);
palInspector?.addEventListener("mouseleave", () => {
  if (palInspector.classList.contains("is-popover")) scheduleInspectorClose();
});
palInspector?.addEventListener("focusin", cancelInspectorClose);
palInspector?.addEventListener("focusout", () => {
  if (palInspector.classList.contains("is-popover")) scheduleInspectorClose();
});

window.addEventListener("resize", () => {
  const inspector = $("#pal-inspector");
  if (!inspector?.hidden && inspector.classList.contains("is-popover")) {
    closePalInspector();
  }
});
window.addEventListener("scroll", () => {
  if (inspectorAnchor) positionPalInspector(inspectorAnchor);
}, {passive: true});

$("[data-pal-maxed-toggle]")?.addEventListener("click", () => {
  if (!activeInspectorPal) return;
  inspectorMaxed = !inspectorMaxed;
  renderInspectorStats(activeInspectorPal);
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("#pal-inspector")?.hidden) closePalInspector();
});

function showView(name, updateAddress = true) {
  const target = $(`[data-view="${name}"]`);
  if (!target) return;

  for (const pane of all("[data-view]")) {
    const active = pane === target;
    pane.hidden = !active;
    pane.classList.toggle("is-active", active);
  }

  for (const control of all("[data-view-target]")) {
    const active = control.dataset.viewTarget === name;
    control.classList.toggle("is-active", active);
    if (control.closest(".system-icons")) {
      if (active) control.setAttribute("aria-current", "page");
      else control.removeAttribute("aria-current");
    }
  }

  if (updateAddress) history.replaceState(null, "", `#${name}`);
  window.scrollTo({top: 0, behavior: "smooth"});
}

for (const control of all("[data-view-target]")) {
  control.addEventListener("click", event => {
    event.preventDefault();
    showView(control.dataset.viewTarget);
  });
}

const initialView = location.hash.replace("#", "");
showView($(`[data-view="${initialView}"]`) ? initialView : "home", false);
