/* BattyDev · Baby · Savings
   Four looks at one ledger (../shared/savings-model.js does the sums):
   the stack (a thermometer made of the items), item by item, where the money
   sits, and the history. Nothing here moves money; it is a notebook. */

'use strict';

const { $, esc, plural, fmtDate, usd } = BB;

/* Account identity colours: the first three slots of the validated dark
   categorical palette (checked against this panel surface). A fourth account
   or more falls back to a labelled neutral rather than a generated hue. */
const ACCT_COLORS = ['#3987e5', '#d95926', '#199e70'];
const ACCT_OTHER = '#7d94a4';

let M = null;
let P = null;

const pct = (f) => `${Math.round(f * 100)}%`;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/* "5/6" when the split is a simple fraction, which reads more naturally than
   83% for a $500-of-$600 crib. Otherwise the percentage. */
function fraction(covered, target) {
  if (!target || covered <= 0 || covered >= target) return pct(target ? covered / target : 0);
  if (Number.isInteger(covered) && Number.isInteger(target)) {
    const g = gcd(covered, target);
    if (target / g <= 12) return `${covered / g}/${target / g}`;
  }
  return pct(covered / target);
}

function needByText(g) {
  if (!g.by) return 'no date set';
  const wbd = g.weeksBeforeDue != null ? Number(g.weeksBeforeDue) : null;
  const rel = wbd === 0 ? 'due date' : wbd ? `${plural(wbd, 'week')} before due` : '';
  return `by ${fmtDate(g.by)}${rel ? ` · ${rel}` : ''}`;
}

function statusText(g) {
  if (g.bought) return `Bought${g.bought.date ? ` ${fmtDate(BB.parseDate(g.bought.date))}` : ''}`;
  if (g.state === 'is-good') return 'Fully saved';
  if (g.state === 'is-over') return `${usd(g.left)} short, and it was needed ${fmtDate(g.by)}`;
  if (g.perWeek) return `${usd(g.perWeek)}/wk gets there in time`;
  return `${usd(g.left)} to go`;
}

/* Status always carries an icon and a word, never colour alone. */
const STATE_ICON = {
  'is-bought': 'bi-bag-check-fill', 'is-good': 'bi-check-circle-fill',
  'is-over': 'bi-exclamation-triangle-fill', 'is-short': 'bi-hourglass-split',
};

/* ---------- the stack ---------- */

function renderStack() {
  $('stack-heading').textContent = `${usd(M.covered)} of ${usd(M.target)}`;
  $('stack-lede').textContent =
    `${pct(M.pct)} of the way there across ${plural(M.goals.length, 'item')}.`;

  /* Block heights: a floor so small items stay legible, plus a share of the
     rest in proportion to cost. Bottom of the tower is needed first. */
  const n = M.goals.length;
  const floor = 46;
  const extra = 380;
  const gap = 2; // matches .tower's gap
  let cum = 0;
  let filledPx = 0;
  let totalPx = 0;
  const blocks = M.goals.map((g, i) => {
    const from = cum;
    cum += g.target;
    /* How much of this block the running total reaches. */
    const f = g.target ? Math.max(0, Math.min(1, (M.covered - from) / g.target)) : 0;
    const h = floor + (M.target ? (extra * g.target) / M.target : extra / n);
    const sep = i ? gap : 0;
    totalPx += h + sep;
    if (f > 0) filledPx += f * h + sep;
    return `
      <li class="block ${f >= 1 ? 'is-full' : f > 0 ? 'is-part' : ''}" style="height:${h.toFixed(0)}px">
        <span class="block-fill" style="height:${(f * 100).toFixed(1)}%"></span>
        ${iconSVG(g.icon, f, 'block-art')}
        <span class="block-name">${esc(g.name)}</span>
        <span class="block-amt">${usd(g.target)}${f >= 1 ? ' <i class="bi bi-check-lg" aria-label="covered"></i>' : ''}</span>
      </li>`;
  });
  /* Reversed in markup order so the first-needed item sits at the bottom. */
  $('tower').innerHTML = blocks.reverse().join('');
  /* The tube follows the tower's drawn fill line rather than the raw
     percentage: block heights have a legibility floor, so they are not quite
     proportional to cost, and the two must not disagree on screen. */
  $('tube-fill').style.height = `${(totalPx ? (filledPx / totalPx) * 100 : 0).toFixed(2)}%`;
  $('bulb').textContent = pct(M.pct);

  const onPace = M.paceNeeded > 0 && M.recent >= M.paceNeeded;
  $('stack-stats').innerHTML = [
    { k: 'Saved', v: usd(M.saved) },
    { k: 'Goal', v: usd(M.target) },
    { k: 'Still needed', v: usd(M.target - M.covered) },
    { k: 'General fund', v: usd(M.general), d: 'not tied to an item' },
    { k: 'Pace needed', v: `${usd(M.paceNeeded)}<small>/wk</small>`, d: 'to have each item on time' },
    { k: 'Last 4 weeks', v: `${usd(M.recent)}<small>/wk</small>`,
      d: M.paceNeeded > 0
        ? `<span class="${onPace ? 'down' : 'up'}"><i class="bi ${onPace ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'}"></i> ${onPace ? 'on pace' : 'behind pace'}</span>`
        : '' },
    { k: 'Spent', v: usd(M.spent), d: 'on items already bought' },
  ].map((x) => `
    <div class="stat"><span class="k">${esc(x.k)}</span><span class="v">${x.v}</span>${x.d ? `<span class="d">${x.d}</span>` : ''}</div>`).join('');
}

/* ---------- item by item ---------- */

function whereHeld(goalId) {
  return M.accounts
    .map((a) => ({ name: a.name, amt: a.byGoal.get(goalId || '') || 0 }))
    .filter((x) => Math.abs(x.amt) >= 0.5);
}

function renderItems() {
  const cards = [];
  if (M.general) {
    const where = whereHeld(null);
    cards.push(`
      <article class="card is-general">
        ${iconSVG('jar', M.target ? Math.min(1, M.general / Math.max(1, M.target - M.assigned)) : 0, 'card-art')}
        <h3>General fund</h3>
        <p class="card-amt"><b>${usd(M.general)}</b></p>
        <p class="card-sub">Not tied to one item. Counts toward the whole stack.</p>
        ${where.length ? `<p class="card-where"><i class="bi bi-bank"></i> ${where.map((w) => `${esc(w.name)} ${usd(w.amt)}`).join(' · ')}</p>` : ''}
      </article>`);
  }
  for (const g of M.goals) {
    const where = whereHeld(g.id);
    cards.push(`
      <article class="card ${g.state}">
        ${g.bought ? '<span class="card-badge"><i class="bi bi-bag-check-fill"></i> bought</span>' : ''}
        ${iconSVG(g.icon, g.pct, 'card-art')}
        <h3>${esc(g.name)}</h3>
        <p class="card-amt"><b>${usd(g.covered)}</b> of ${usd(g.target)} <span class="frac">${esc(fraction(g.covered, g.target))}</span></p>
        <div class="bar"><span style="width:${(g.pct * 100).toFixed(1)}%"></span></div>
        <p class="card-sub"><i class="bi ${STATE_ICON[g.state]}"></i> ${esc(statusText(g))}</p>
        <p class="card-sub muted">${esc(needByText(g))}</p>
        ${where.length ? `<p class="card-where"><i class="bi bi-bank"></i> ${where.map((w) => `${esc(w.name)} ${usd(w.amt)}`).join(' · ')}</p>` : ''}
        ${g.note ? `<p class="card-note">${esc(g.note)}</p>` : ''}
      </article>`);
  }
  $('carousel').innerHTML = cards.join('') || '<p class="empty">No items yet.</p>';

  const step = (dir) => {
    const card = $('carousel').querySelector('.card');
    const w = card ? card.getBoundingClientRect().width + 14 : 240;
    $('carousel').scrollBy({ left: dir * w, behavior: 'smooth' });
  };
  $('car-prev').onclick = () => step(-1);
  $('car-next').onclick = () => step(1);

  $('goals').innerHTML = M.goals.map((g) => `
    <div class="goal ${g.state}">
      <div class="goal-label">
        <b>${esc(g.name)}</b>
        <span>${usd(g.covered)} of ${usd(g.target)}</span>
        <span class="target"><i class="bi ${STATE_ICON[g.state]}"></i> ${esc(statusText(g))} · ${esc(needByText(g))}</span>
      </div>
      <div class="bar"><span style="width:${(g.pct * 100).toFixed(1)}%"></span></div>
    </div>`).join('') || '<p class="empty">No items yet.</p>';
}

/* ---------- where the money is ---------- */

function renderAccounts() {
  const colored = M.accounts.map((a, i) => ({ ...a, color: ACCT_COLORS[i] || ACCT_OTHER }));
  const held = colored.filter((a) => a.balance > 0.5);
  const total = held.reduce((n, a) => n + a.balance, 0);
  $('accounts-lede').textContent = `${usd(total)} set aside across ${plural(held.length, 'account')}.`;

  $('acct-bar').setAttribute('aria-label', held.map((a) => `${a.name} ${usd(a.balance)}`).join(', '));
  $('acct-bar').innerHTML = held.map((a) => `
    <span class="seg" style="flex:${a.balance} 1 0;background:${a.color}" title="${esc(a.name)}: ${usd(a.balance)}"></span>`).join('');
  $('acct-legend').innerHTML = held.map((a) => `
    <li><span class="sw" style="background:${a.color}"></span>${esc(a.name)} <b>${usd(a.balance)}</b>
      <span class="muted">${total ? pct(a.balance / total) : ''}</span></li>`).join('');

  $('acct-cards').innerHTML = colored.map((a) => {
    const rows = [...a.byGoal.entries()]
      .filter(([, v]) => Math.abs(v) >= 0.5)
      .sort((x, y) => y[1] - x[1])
      .map(([gid, v]) => `<tr><td>${esc(M.goalName(gid || null))}</td><td class="num">${usd(v)}</td></tr>`);
    const last = M.entries.filter((e) => e.account === a.id).pop();
    return `
      <article class="panel acct">
        <h2><span class="sw" style="background:${a.color}"></span>${esc(a.name)}</h2>
        <p class="acct-bal">${usd(a.balance)}</p>
        ${a.note ? `<p class="note">${esc(a.note)}</p>` : ''}
        ${rows.length ? `<table class="items"><tbody>${rows.join('')}</tbody></table>` : '<p class="empty">Empty.</p>'}
        ${last ? `<p class="fine">Last activity ${esc(fmtDate(last.d, { month: 'short', day: 'numeric', year: 'numeric' }))}</p>` : ''}
      </article>`;
  }).join('') || '<p class="empty">No accounts yet.</p>';
}

/* ---------- history ---------- */

const filter = { goal: '', acct: '' };

function filtered() {
  return M.entries.filter((e) =>
    (!filter.goal || (filter.goal === '_general' ? !e.goal : e.goal === filter.goal))
    && (!filter.acct || e.account === filter.acct));
}

function renderFilters() {
  const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  $('f-goal').innerHTML = opt('', 'All items') + opt('_general', 'General fund')
    + M.goals.map((g) => opt(g.id, g.name)).join('');
  $('f-acct').innerHTML = opt('', 'All accounts') + M.accounts.map((a) => opt(a.id, a.name)).join('');
  $('f-goal').onchange = (ev) => { filter.goal = ev.target.value; renderHistory(); };
  $('f-acct').onchange = (ev) => { filter.acct = ev.target.value; renderHistory(); };
}

const compact = (n) => (n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : `$${Math.round(n)}`);

function niceMax(v) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((x) => x >= v);
}

function renderChart(list, target) {
  const el = $('chart');
  const W = Math.max(280, el.clientWidth || 0);
  if (!el.clientWidth) return; // hidden view: drawn when it is shown
  const H = 260;
  const m = { l: 46, r: 14, t: 18, b: 28 };
  const deposits = list.filter((e) => !M.isPurchase(e));

  if (!deposits.length) {
    el.innerHTML = '<p class="empty">Nothing saved here yet.</p>';
    return;
  }

  /* One step per day: the running total after that day's entries. */
  const days = [];
  let run = 0;
  for (const e of deposits) {
    run += e.amount;
    const last = days[days.length - 1];
    if (last && last.d.getTime() === e.d.getTime()) { last.total = run; last.items.push(e); } else days.push({ d: e.d, total: run, items: [e] });
  }

  const now = BB.today();
  const x0 = BB.addDays(days[0].d, -3);
  const x1 = new Date(Math.max(now, days[days.length - 1].d, P ? P.due : 0) || now);
  const yMax = niceMax(Math.max(target, run) * 1.04);
  const X = (d) => m.l + ((d - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - v / yMax) * (H - m.t - m.b);

  /* Step path: flat until the next deposit, then straight up. */
  let line = `M${X(x0).toFixed(1)},${Y(0).toFixed(1)}`;
  let prev = 0;
  for (const p of days) {
    line += ` H${X(p.d).toFixed(1)} V${Y(p.total).toFixed(1)}`;
    prev = p.total;
  }
  const end = new Date(Math.min(now, x1));
  line += ` H${X(end).toFixed(1)}`;
  const area = `${line} V${Y(0).toFixed(1)} H${X(x0).toFixed(1)} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const xTicks = [];
  for (let d = new Date(x0.getFullYear(), x0.getMonth() + 1, 1); d <= x1; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) xTicks.push(d);
  const every = Math.ceil(xTicks.length / Math.max(2, Math.floor((W - 60) / 56)));

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
         aria-label="Running total saved: ${usd(prev)} against a goal of ${usd(target)}">
      ${yTicks.map((v) => `
        <line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>
        <text class="tick" x="${m.l - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${compact(v)}</text>`).join('')}
      ${xTicks.filter((_, i) => i % every === 0).map((d) => `
        <text class="tick" x="${X(d).toFixed(1)}" y="${H - 8}" text-anchor="middle">${d.toLocaleDateString(undefined, { month: 'short' })}</text>`).join('')}
      ${target ? `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${Y(target).toFixed(1)}" y2="${Y(target).toFixed(1)}"/>
        <text class="ref-label" x="${W - m.r}" y="${(Y(target) - 6).toFixed(1)}" text-anchor="end">Goal ${usd(target)}</text>` : ''}
      ${P && P.due <= x1 ? `<line class="ref" x1="${X(P.due).toFixed(1)}" x2="${X(P.due).toFixed(1)}" y1="${m.t}" y2="${Y(0).toFixed(1)}"/>
        <text class="ref-label" x="${(X(P.due) - 4).toFixed(1)}" y="${(m.t + 10).toFixed(1)}" text-anchor="end">Due</text>` : ''}
      <path class="area" d="${area}"/>
      <path class="line" d="${line}"/>
      <circle class="end" cx="${X(end).toFixed(1)}" cy="${Y(prev).toFixed(1)}" r="4.5"/>
      <text class="end-label" x="${(X(end) + 8).toFixed(1)}" y="${(Y(prev) + 4).toFixed(1)}">${usd(prev)}</text>
      <line class="cross" id="cross" y1="${m.t}" y2="${Y(0).toFixed(1)}" visibility="hidden"/>
      <circle class="cross-dot" id="cross-dot" r="4.5" visibility="hidden"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}"/>
    </svg>
    <div class="tip" id="tip" hidden></div>`;

  /* Crosshair + tooltip: snaps to the latest day at or before the pointer. */
  const svg = el.querySelector('svg');
  const tip = $('tip');
  const cross = $('cross');
  const dot = $('cross-dot');
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
  svg.querySelector('.hit').addEventListener('pointermove', (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let p = null;
    for (const d of days) if (X(d.d) <= px + 6) p = d;
    if (!p) { hide(); return; }
    const cx = X(p.d);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', Y(p.total)); dot.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>${esc(fmtDate(p.d, { month: 'short', day: 'numeric', year: 'numeric' }))}</b>
      <span>Total ${usd(p.total)}</span>
      ${p.items.map((e) => `<span class="muted">${e.amount < 0 ? '−' : '+'}${usd(Math.abs(e.amount))} ${esc(M.goalName(e.goal || null))}</span>`).join('')}`;
    tip.hidden = false;
    const left = (cx / W) * r.width;
    tip.style.left = `${Math.min(Math.max(8, left + 12), r.width - tip.offsetWidth - 8)}px`;
    tip.style.top = `${Math.max(0, (Y(p.total) / H) * r.height - tip.offsetHeight - 12)}px`;
  });
  svg.querySelector('.hit').addEventListener('pointerleave', hide);
}

function renderHistory() {
  const list = filtered();
  const goal = M.goals.find((g) => g.id === filter.goal);
  const target = filter.goal === '_general' || filter.acct ? 0 : goal ? goal.target : M.target;
  $('chart-title').textContent = goal ? `${goal.name}: saved so far`
    : filter.goal === '_general' ? 'General fund: saved so far' : 'Saved so far';
  renderChart(list, target);

  const rows = [...list].reverse().map((e) => {
    const spent = M.isPurchase(e);
    const sign = spent || e.amount < 0 ? '−' : '+';
    return `
      <tr class="${spent ? 'is-spent' : e.amount < 0 ? 'is-out' : ''}">
        <td>${esc(fmtDate(e.d, { month: 'short', day: 'numeric', year: 'numeric' }))}</td>
        <td>${esc(M.goalName(e.goal || null))}${spent ? ' <span class="tag">spent</span>' : ''}</td>
        <td>${esc(M.accountName(e.account))}</td>
        <td class="num">${sign}${usd(Math.abs(e.amount))}</td>
        <td>${e.note ? `<span class="note">${esc(e.note)}</span>` : ''}</td>
      </tr>`;
  });
  $('ledger').innerHTML = rows.length ? `
    <table class="items">
      <thead><tr><th>Date</th><th>Item</th><th>Account</th><th class="num">Amount</th><th>Note</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>` : '<p class="empty">No entries match.</p>';
}

/* ---------- boot ---------- */

BB.unlock((data) => {
  BB.chrome(data);
  P = BB.pregnancy(data.pregnancy && data.pregnancy.due);
  M = SavingsModel(data.savings, P);
  renderStack();
  renderItems();
  renderAccounts();
  renderFilters();
  document.addEventListener('bb:view', (ev) => { if (ev.detail === 'history') renderHistory(); });
  let t = null;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(renderHistory, 150); });
  BB.views();
  renderHistory();
});
