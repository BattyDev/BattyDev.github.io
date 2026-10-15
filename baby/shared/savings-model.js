/* BattyDev · Baby — the savings model
   Turns the `savings` block of the data file into the numbers every view needs.
   Pure: no DOM, no fetching. Shared by the hub tile and /baby/savings.

   The data is a ledger, not a set of balances, so there is one source of truth
   and nothing to keep in sync (schema in baby/AGENTS.md):

     goals:    { id, name, icon, target, needBy | weeksBeforeDue, note, bought }
     accounts: { id, name, note }
     entries:  { date, amount, goal, account, kind, note }

   An entry with no `goal` is general money, saved for the pot as a whole. A
   negative amount takes money back out (moving it between goals is one negative
   and one positive entry). `kind: "purchase"` is money spent on a goal: it
   leaves the account but does not un-fund the goal, which is marked `bought`.

   No money moves through any of this; it is a notebook of what has been set
   aside where. */

'use strict';

/* eslint-disable-next-line no-unused-vars */
function SavingsModel(savings, P) {
  const s = savings || {};
  const now = BB.today();
  const isPurchase = (e) => e.kind === 'purchase';
  const amt = (e) => Number(e.amount) || 0;

  const entries = (s.entries || [])
    .map((e) => ({ ...e, d: BB.parseDate(e.date), amount: amt(e) }))
    .filter((e) => e.d)
    .sort((a, b) => a.d - b.d);

  const accounts = (s.accounts || []).map((a) => ({ ...a, balance: 0, byGoal: new Map() }));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const accountName = (id) => (accountById.get(id) || {}).name || id || 'Unspecified';

  /* needBy may be a date, or weeks before the due date. The relative form keeps
     dates out of anything that might end up in the clear, and follows the due
     date if it moves. */
  function needByOf(g) {
    if (g.needBy) return BB.parseDate(g.needBy);
    if (g.weeksBeforeDue != null && P) return BB.addDays(P.due, -7 * Number(g.weeksBeforeDue));
    return null;
  }

  const fundedBy = new Map();
  let general = 0;
  let saved = 0;
  let spent = 0;
  for (const e of entries) {
    if (isPurchase(e)) spent += e.amount;
    else {
      saved += e.amount;
      if (e.goal) fundedBy.set(e.goal, (fundedBy.get(e.goal) || 0) + e.amount);
      else general += e.amount;
    }
    /* Account balances: what is actually sitting where right now. */
    let acct = accountById.get(e.account);
    if (!acct) {
      acct = { id: e.account, name: accountName(e.account), balance: 0, byGoal: new Map(), unlisted: true };
      accounts.push(acct);
      accountById.set(acct.id, acct);
    }
    const delta = isPurchase(e) ? -e.amount : e.amount;
    acct.balance += delta;
    const k = e.goal || '';
    acct.byGoal.set(k, (acct.byGoal.get(k) || 0) + delta);
  }

  const goals = (s.goals || []).map((g) => {
    const target = Number(g.target) || 0;
    const funded = fundedBy.get(g.id) || 0;
    const bought = !!g.bought;
    const covered = bought ? target : Math.max(0, Math.min(funded, target));
    const by = needByOf(g);
    const left = Math.max(0, target - covered);
    const weeks = by ? BB.daysBetween(now, by) / 7 : null;
    let state = 'is-short';
    let perWeek = 0;
    if (bought) state = 'is-bought';
    else if (left === 0) state = 'is-good';
    else if (weeks !== null && weeks <= 0) state = 'is-over';
    else if (weeks !== null) perWeek = left / Math.max(1, weeks);
    return { ...g, target, funded, covered, left, by, weeks, perWeek, state, bought, pct: target ? covered / target : 0 };
  }).sort((a, b) => (a.by ? a.by.getTime() : Infinity) - (b.by ? b.by.getTime() : Infinity) || a.target - b.target);

  const goalName = (id) => (id ? (goals.find((g) => g.id === id) || {}).name || id : 'General fund');

  const target = goals.reduce((n, g) => n + g.target, 0);
  const assigned = goals.reduce((n, g) => n + g.covered, 0);
  /* General money counts toward the whole, up to what is still uncovered. */
  const covered = assigned + Math.max(0, Math.min(general, target - assigned));
  const paceNeeded = goals.reduce((n, g) => n + g.perWeek, 0);

  /* What has actually gone in over the last four weeks, per week. */
  const since = BB.addDays(now, -28);
  const recent = entries
    .filter((e) => !isPurchase(e) && e.d >= since && e.d <= now)
    .reduce((n, e) => n + e.amount, 0) / 4;

  return {
    goals, accounts, entries, general, saved, spent, target, assigned, covered, paceNeeded, recent,
    pct: target ? covered / target : 0,
    goalName, accountName, isPurchase,
  };
}
