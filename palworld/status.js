const owner = location.hostname.split(".")[0];
const repository = location.pathname.split("/").filter(Boolean)[0] || `${owner}.github.io`;
const localPreview = location.hostname === "127.0.0.1" || location.hostname === "localhost";
const statusUrl = localPreview ? "status.json" : `https://raw.githubusercontent.com/${owner}/${repository}/data/status.json`;
let latestData = null;

const byId = id => document.getElementById(id);
const text = (id, value) => { byId(id).textContent = value ?? "—"; };
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const displayValue = value => {
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
};
const duration = seconds => {
  seconds = Math.max(0, Number(seconds || 0));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); const minutes = Math.floor(seconds % 3600 / 60);
  return [days && `${days}d`, (days || hours) && `${hours}h`, `${minutes}m`].filter(Boolean).join(" ");
};
const timeAgo = value => {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};
const tidyNumber = value => {
  const parsed = number(value);
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};
const multiplier = value => `${tidyNumber(value)}×`;
const percentLess = value => Math.max(0, Math.round((1 - number(value)) * 100));

function buildSettingCallouts(data) {
  const config = data.configuration || {};
  const cards = [];
  const add = (icon, title, detail, tone = "cyan") => cards.push({icon, title, detail, tone});

  if (config.ExpRate != null) add("⚡", `${multiplier(config.ExpRate)} XP!`, "Level up faster and spend more time exploring.", "gold");
  if (config.PalCaptureRate != null) add("◎", `${multiplier(config.PalCaptureRate)} capture power`, "More successful catches when every sphere matters.", "cyan");
  if (config.CollectionDropRate != null) add("⛏", `${multiplier(config.CollectionDropRate)} gathering drops`, "Mining, logging and gathering pay off in a big way.", "green");
  if (config.EnemyDropItemRate != null) add("✦", `${multiplier(config.EnemyDropItemRate)} enemy drops`, "Winning a fight comes with a better haul.", "pink");
  if (config.WorkSpeedRate != null) add("⚙", `${multiplier(config.WorkSpeedRate)} work speed`, "Base projects move from idea to finished faster.", "gold");
  if (config.BaseCampMaxNumInGuild != null) add("🏕", `${tidyNumber(config.BaseCampMaxNumInGuild)} bases per guild`, "Plenty of room for outposts, factories and questionable architecture.", "cyan");
  if (config.BaseCampWorkerMaxNum != null) add("🐾", `${tidyNumber(config.BaseCampWorkerMaxNum)} Pals per base`, "Build a serious workforce at every camp.", "green");
  if (number(config.EquipmentDurabilityDamageRate) === 0) add("🛠", "Equipment never wears out", "Tools, armor and weapons stay adventure-ready.", "pink");
  else if (config.EquipmentDurabilityDamageRate != null && number(config.EquipmentDurabilityDamageRate) < 1) add("🛠", `${percentLess(config.EquipmentDurabilityDamageRate)}% less equipment wear`, "Repair less. Explore more.", "pink");
  if (config.BuildObjectDamageRate != null && number(config.BuildObjectDamageRate) < 1) add("🛡", `${percentLess(config.BuildObjectDamageRate)}% less base damage`, "Hard-earned builds are almost impossible to knock down.", "cyan");
  if (config.ItemWeightRate != null && number(config.ItemWeightRate) > 0 && number(config.ItemWeightRate) < 1) add("🎒", `Items weigh ${percentLess(config.ItemWeightRate)}% less`, "Bring home the loot without constant inventory shuffling.", "gold");

  for (const feature of Array.isArray(data.features) ? data.features : []) {
    if (!feature?.title) continue;
    cards.splice(Math.min(1, cards.length), 0, {
      icon: feature.icon || "★",
      title: feature.title,
      detail: feature.detail || "An active server-side world enhancement.",
      tone: feature.tone || "pink",
    });
  }
  return cards.slice(0, 10);
}

function renderSettingCallouts(data) {
  const grid = byId("setting-callouts"); grid.replaceChildren();
  const callouts = buildSettingCallouts(data);
  if (!callouts.length) {
    const note = document.createElement("p"); note.className = "muted"; note.textContent = "World highlights will appear with the next settings snapshot."; grid.append(note); return;
  }
  for (const callout of callouts) {
    const card = document.createElement("article"); card.className = `callout callout-${callout.tone}`;
    const icon = document.createElement("span"); icon.className = "callout-icon"; icon.textContent = callout.icon;
    const copy = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = callout.title;
    const detail = document.createElement("p"); detail.textContent = callout.detail;
    copy.append(title, detail); card.append(icon, copy); grid.append(card);
  }
}

function guildBadges(guild) {
  const badges = [];
  const bases = number(guild.bases);
  const workers = number(guild.workers);
  const levels = guild.worker_levels || {};
  const species = Array.isArray(guild.top_worker_species) ? guild.top_worker_species.length : 0;
  const add = (icon, title, detail, rank) => badges.push({icon, title, detail, rank});

  if (bases >= 1) add("🏕", "Camp Established", `Built ${bases === 1 ? "their first base" : `${bases} active bases`}.`, 1);
  if (bases >= 3) add("🗺", "Island Network", `Connected a network of ${bases} bases.`, 3);
  if (workers >= 10) add("🐾", "Crew Assembled", `${workers} working Pals keep the guild moving.`, 2);
  if (workers >= 30) add("⚙", "Industrial Powerhouse", `A workforce ${workers} Pals strong.`, 4);
  if (number(levels.maximum) >= 50) add("⭐", "Veteran Workforce", `Raised a base worker to level ${levels.maximum}.`, 5);
  if (species >= 8) add("🌈", "Specialist Team", `At least ${species} worker species represented.`, 3);
  return badges.sort((a, b) => b.rank - a.rank).slice(0, 4);
}

function renderAchievements(guilds = []) {
  const grid = byId("achievement-grid"); grid.replaceChildren();
  const populated = guilds.map(guild => ({guild, badges: guildBadges(guild)})).filter(item => item.badges.length);
  if (!populated.length) {
    const note = document.createElement("p"); note.className = "muted"; note.textContent = "Guild accomplishments will appear when an active base snapshot is available."; grid.append(note); return;
  }
  for (const {guild, badges} of populated) {
    const card = document.createElement("article"); card.className = "achievement-card";
    const heading = document.createElement("div"); heading.className = "achievement-heading";
    const crest = document.createElement("span"); crest.className = "guild-crest"; crest.textContent = "✦";
    const copy = document.createElement("div");
    const eyebrow = document.createElement("span"); eyebrow.textContent = "Guild record";
    const title = document.createElement("h3"); title.textContent = guild.name;
    copy.append(eyebrow, title); heading.append(crest, copy); card.append(heading);
    const list = document.createElement("ul"); list.className = "badge-list";
    for (const badge of badges) {
      const item = document.createElement("li");
      const icon = document.createElement("span"); icon.className = "badge-icon"; icon.textContent = badge.icon;
      const words = document.createElement("div");
      const name = document.createElement("strong"); name.textContent = badge.title;
      const detail = document.createElement("span"); detail.textContent = badge.detail;
      words.append(name, detail); item.append(icon, words); list.append(item);
    }
    card.append(list); grid.append(card);
  }
}

function setTabs() {
  for (const button of document.querySelectorAll(".tab-button")) {
    button.addEventListener("click", () => {
      const selected = button.dataset.tab;
      for (const candidate of document.querySelectorAll(".tab-button")) {
        const active = candidate === button;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-selected", String(active));
      }
      for (const panel of document.querySelectorAll(".tab-panel")) {
        const active = panel.dataset.panel === selected;
        panel.classList.toggle("active", active);
        panel.hidden = !active;
      }
      history.replaceState(null, "", selected === "detail" ? "#data-overload" : location.pathname + location.search);
      if (selected === "detail" && latestData) renderCharts(latestData.history || []);
    });
  }
  if (location.hash === "#data-overload") document.querySelector('[data-tab="detail"]').click();
}

function renderQuick(data) {
  const age = Date.now() - Date.parse(data.updated_at);
  const stale = age > 10 * 60 * 1000;
  const unavailable = age > 30 * 60 * 1000;
  const online = Boolean(data.online) && !unavailable;
  const state = byId("state");
  state.textContent = online ? "● Online" : unavailable ? "● Status unavailable" : "● Offline";
  state.className = `status ${online ? "online" : "offline"}`;
  byId("stale").hidden = !stale;
  text("server-name", data.server_name); text("description", data.description);
  text("version", data.version); text("players", data.players);
  text("players-max", `of ${data.max_players} players`); text("fps", data.fps);
  text("day", data.world_day); text("bases", data.base_camps); text("uptime", duration(data.uptime));

  const playerList = byId("player-list"); playerList.replaceChildren();
  const names = Array.isArray(data.player_names) ? data.player_names : [];
  for (const name of names.length ? names : ["Nobody online"]) {
    const item = document.createElement("li"); item.textContent = name; playerList.append(item);
  }
  const recentList = byId("recent-list"); recentList.replaceChildren();
  const recent = Array.isArray(data.recent_players) ? data.recent_players : [];
  if (recent.length) {
    for (const player of recent) {
      const item = document.createElement("li");
      const name = document.createElement("strong"); name.textContent = player.name;
      const seen = document.createElement("span"); seen.textContent = `Last seen ${new Date(player.last_seen).toLocaleString()}`;
      item.append(name, seen); recentList.append(item);
    }
  } else {
    const item = document.createElement("li"); item.textContent = "No players seen this week"; recentList.append(item);
  }
  renderSettingCallouts(data);
  renderAchievements(data.guilds || []);
}

function addDefinition(list, label, value) {
  const term = document.createElement("dt"); term.textContent = label;
  const detail = document.createElement("dd"); detail.textContent = value;
  term.dataset.filter = `${label} ${value}`.toLowerCase(); detail.dataset.filter = term.dataset.filter;
  list.append(term, detail);
}

function renderCapabilities(capabilities = {}) {
  const container = byId("capabilities"); container.replaceChildren();
  for (const [label, available] of Object.entries(capabilities)) {
    const chip = document.createElement("span");
    chip.className = `capability ${available ? "yes" : "no"}`;
    chip.textContent = `${label.replaceAll("_", " ")} ${available ? "ready" : "missing"}`;
    container.append(chip);
  }
}

function renderPlayers(players = []) {
  const body = byId("player-detail-body"); body.replaceChildren();
  if (!players.length) {
    const row = document.createElement("tr"); const cell = document.createElement("td");
    cell.colSpan = 5; cell.className = "muted"; cell.textContent = "Nobody online"; row.append(cell); body.append(row); return;
  }
  for (const player of players) {
    const row = document.createElement("tr");
    const ping = number(player.ping);
    const values = [player.name, player.level ?? "—", `${ping.toFixed(1)} ms`, player.guild || "No guild data", player.health_percent == null ? "—" : `${player.health_percent}%`];
    values.forEach((value, index) => {
      const cell = document.createElement("td"); cell.textContent = value;
      if (index === 2) cell.className = `ping ${ping > 150 ? "high" : ping >= 75 ? "medium" : "low"}`;
      row.append(cell);
    });
    body.append(row);
  }
}

function renderGuilds(guilds = []) {
  const grid = byId("guild-grid"); grid.replaceChildren();
  if (!guilds.length) { const note = document.createElement("p"); note.className = "muted"; note.textContent = "No populated guild snapshot is available yet."; grid.append(note); return; }
  for (const guild of guilds) {
    const card = document.createElement("article"); card.className = "guild-card";
    const heading = document.createElement("h3"); heading.textContent = guild.name; card.append(heading);
    const numbers = document.createElement("div"); numbers.className = "guild-numbers";
    const onlineCount = Array.isArray(guild.online_players) ? guild.online_players.length : 0;
    for (const [value, label] of [[guild.bases, "Bases"], [guild.workers, "Workers"], [onlineCount, "Online"]]) {
      const box = document.createElement("div"); box.className = "guild-number";
      const strong = document.createElement("strong"); strong.textContent = value ?? 0;
      const span = document.createElement("span"); span.textContent = label; box.append(strong, span); numbers.append(box);
    }
    card.append(numbers);
    const levels = guild.worker_levels || {};
    const details = document.createElement("p"); details.className = "guild-subline";
    const lines = [];
    if (levels.count) lines.push(`Worker levels ${levels.minimum}–${levels.maximum}, average ${levels.average}`);
    if (guild.worker_health_average != null) lines.push(`Average worker health ${guild.worker_health_average}%`);
    if (onlineCount) lines.push(`Online: ${guild.online_players.join(", ")}`);
    details.textContent = lines.join(" · ") || "No additional worker telemetry"; card.append(details);
    const badges = guildBadges(guild);
    if (badges.length) {
      const badgeRow = document.createElement("div"); badgeRow.className = "guild-badge-row";
      for (const badge of badges) {
        const chip = document.createElement("span"); chip.className = "guild-badge"; chip.textContent = `${badge.icon} ${badge.title}`; badgeRow.append(chip);
      }
      card.append(badgeRow);
    }
    grid.append(card);
  }
}

function renderCensus(census = {}) {
  text("actor-total", census.total_actors ?? 0);
  const workerCount = census.counts?.BaseCampPal ?? 0; text("worker-total", workerCount);
  const body = byId("census-body"); body.replaceChildren();
  const categories = new Set([...Object.keys(census.counts || {}), ...Object.keys(census.levels || {})]);
  for (const category of [...categories].sort()) {
    const levels = census.levels?.[category] || {};
    const values = [category, census.counts?.[category] ?? levels.count ?? 0, levels.average ?? "—", levels.minimum == null ? "—" : `${levels.minimum}–${levels.maximum}`, census.health_average?.[category] == null ? "—" : `${census.health_average[category]}%`];
    const row = document.createElement("tr");
    for (const value of values) { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }
    body.append(row);
  }
  if (!categories.size) { const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 5; cell.className = "muted"; cell.textContent = "No actor snapshot available"; row.append(cell); body.append(row); }
  renderRankLists("species-lists", census.top_species || {});
  renderRankLists("action-lists", census.top_actions || {});
}

function renderRankLists(id, groups) {
  const container = byId(id); container.replaceChildren();
  for (const [category, entries] of Object.entries(groups)) {
    if (!Array.isArray(entries) || !entries.length) continue;
    const group = document.createElement("section"); group.className = "rank-group";
    const title = document.createElement("h3"); title.textContent = category; group.append(title);
    const list = document.createElement("ol");
    for (const entry of entries.slice(0, 10)) {
      const item = document.createElement("li"); const name = document.createElement("span"); const count = document.createElement("strong");
      name.textContent = entry.name; name.title = entry.name; count.textContent = entry.count; item.append(name, count); list.append(item);
    }
    group.append(list); container.append(group);
  }
  if (!container.children.length) { const note = document.createElement("p"); note.className = "muted"; note.textContent = "No snapshot data available."; container.append(note); }
}

function renderSystem(system = {}) {
  const labels = {
    load_average: ["Load average", value => Array.isArray(value) ? value.join(" / ") : "—"],
    memory_percent: ["Memory used", value => `${value}%`],
    memory_used_gib: ["RAM used", value => `${value} GiB`],
    memory_total_gib: ["Total RAM", value => `${value} GiB`],
    palworld_memory_gib: ["Palworld RAM", value => `${value} GiB`],
    disk_percent: ["Disk used", value => `${value}%`],
    disk_free_gib: ["Disk free", value => `${value} GiB`],
    battery_percent: ["Battery", value => `${value}%`],
    battery_status: ["Power state", value => value],
    temperature_c: ["Peak sensor", value => `${value} °C`],
  };
  const grid = byId("system-grid"); grid.replaceChildren();
  for (const [key, [label, formatter]] of Object.entries(labels)) {
    if (system[key] == null) continue;
    const item = document.createElement("div"); item.className = "system-item";
    const span = document.createElement("span"); span.textContent = label;
    const strong = document.createElement("strong"); strong.textContent = formatter(system[key]); item.append(span, strong); grid.append(item);
  }
  if (!grid.children.length) { const note = document.createElement("p"); note.className = "muted"; note.textContent = "Host health unavailable."; grid.append(note); }
}

function renderConfiguration(configuration = {}) {
  const list = byId("configuration"); list.replaceChildren();
  const entries = Object.entries(configuration).sort(([a], [b]) => a.localeCompare(b));
  for (const [label, value] of entries) addDefinition(list, label, displayValue(value));
  text("config-count", `${entries.length} settings`);
}

function drawChart(canvas, samples, field, color, fallbackId) {
  const empty = byId(fallbackId);
  if (!samples.length) { canvas.hidden = true; empty.hidden = false; return; }
  canvas.hidden = false; empty.hidden = true;
  const ratio = window.devicePixelRatio || 1; const width = canvas.clientWidth || 320; const height = 190;
  canvas.width = width * ratio; canvas.height = height * ratio;
  const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height);
  const values = samples.map(sample => number(sample[field])); const min = Math.min(...values, 0); const max = Math.max(...values, 1);
  const pad = 18; const x = index => pad + index * (width - pad * 2) / Math.max(1, values.length - 1); const y = value => height - pad - (value - min) * (height - pad * 2) / Math.max(1, max - min);
  ctx.strokeStyle = "#38517b"; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) { const gy = pad + i * (height - pad * 2) / 3; ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(width - pad, gy); ctx.stroke(); }
  const gradient = ctx.createLinearGradient(0, pad, 0, height); gradient.addColorStop(0, `${color}55`); gradient.addColorStop(1, `${color}00`);
  ctx.beginPath(); values.forEach((value, index) => index ? ctx.lineTo(x(index), y(value)) : ctx.moveTo(x(index), y(value))); ctx.lineTo(x(values.length - 1), height - pad); ctx.lineTo(x(0), height - pad); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath(); values.forEach((value, index) => index ? ctx.lineTo(x(index), y(value)) : ctx.moveTo(x(index), y(value))); ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = "#a9bdd8"; ctx.font = "11px system-ui"; ctx.fillText(String(max), 2, pad + 3); ctx.fillText(String(min), 2, height - pad + 3);
}

function renderCharts(history = []) {
  const samples = Array.isArray(history) ? history : [];
  drawChart(byId("fps-chart"), samples, "fps", "#57daf6", "fps-chart-empty");
  drawChart(byId("players-chart"), samples, "players", "#ffd765", "players-chart-empty");
}

function renderDetail(data) {
  const performance = data.performance || {};
  text("detail-fps", performance.fps ?? data.fps);
  text("average-fps", performance.average_fps || "—");
  text("frame-time", performance.frame_time_ms ? `${performance.frame_time_ms} ms` : "—");
  text("snapshot-age", performance.snapshot_time ? timeAgo(`${performance.snapshot_time.replace(" ", "T")}Z`) : "—");
  renderCapabilities(data.capabilities || {}); renderPlayers(data.online_players || []); renderGuilds(data.guilds || []);
  renderCensus(data.pal_census || {}); renderSystem(data.system || {}); renderConfiguration(data.configuration || {}); renderCharts(data.history || []);
}

async function refresh() {
  try {
    const response = await fetch(`${statusUrl}?t=${Date.now()}`, {cache: "no-store"});
    if (!response.ok) throw new Error("snapshot unavailable");
    const data = await response.json(); latestData = data;
    renderQuick(data); renderDetail(data);
    const updated = byId("updated"); updated.dateTime = data.updated_at; updated.textContent = new Date(data.updated_at).toLocaleString();
  } catch (_) {
    byId("stale").hidden = false; text("state", "● Status unavailable"); byId("state").className = "status offline";
  }
}

byId("config-filter").addEventListener("input", event => {
  const query = event.target.value.trim().toLowerCase();
  const children = [...byId("configuration").children];
  for (let index = 0; index < children.length; index += 2) {
    const visible = !query || children[index].dataset.filter.includes(query);
    children[index].classList.toggle("filtered", !visible); children[index + 1]?.classList.toggle("filtered", !visible);
  }
});
window.addEventListener("resize", () => { if (latestData && !byId("detail-tab").hidden) renderCharts(latestData.history || []); });
setTabs(); refresh(); setInterval(refresh, 5 * 60 * 1000);
