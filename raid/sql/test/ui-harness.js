/* LOCAL TEST HARNESS ONLY -- not shipped to the page.
 *
 * Drives raid/index.html in Chromium with a stubbed Supabase client, so the UI
 * can be exercised without the hosted project (and without egress, which this
 * sandbox blocks to supabase.co anyway).
 *
 * The stub deliberately re-implements the RLS rules from 001_schema.sql and
 * 002_events.sql -- anon sees no rows and only the aggregate RPCs, a member
 * sees only their own availability and their own event responses, a leader and
 * an event's creator see more -- so that what is being tested is "does the page
 * behave correctly when the database answers the way it actually answers", not
 * "does the page filter things itself". If the page ever started relying on its
 * own filtering, this harness would keep passing while the real thing leaked,
 * so the SQL proofs are the authority; this only checks the UI on top of them.
 *
 * Run: NODE_PATH=/opt/node22/lib/node_modules node ui-harness.js
 */

const { chromium } = require('playwright');
const path = require('path');

const PAGE = 'file://' + path.resolve(__dirname, '../../index.html');
const SHOTS = process.env.SHOT_DIR || '/tmp/raid-shots';

const LEADER = { id: 'u-leader', display_name: 'Batty',       role: 'leader', avatar_url: null };
const MEMBER = { id: 'u-cedho',  display_name: 'Cedho Nalen', role: 'member', avatar_url: null };
const OTHER  = { id: 'u-tataru', display_name: 'Tataru',      role: 'member', avatar_url: null };
const FOURTH = { id: 'u-ysh',    display_name: 'Yshtola',     role: 'member', avatar_url: null };

/* Weekly slots are UTC hours-of-week. Fixed values so assertions are stable. */
const SEED = [
  { member_id: 'u-leader', slot: 42 }, { member_id: 'u-leader', slot: 43 },
  { member_id: 'u-leader', slot: 44 }, { member_id: 'u-leader', slot: 90 },
  { member_id: 'u-cedho',  slot: 42 }, { member_id: 'u-cedho',  slot: 43 },
  { member_id: 'u-cedho',  slot: 66 },
  { member_id: 'u-tataru', slot: 42 }, { member_id: 'u-tataru', slot: 90 },
];

const TYPES = [
  { code: 'savage', label: 'Savage Raid (8)', tanks: 2, healers: 2, dps: 4, party_size: 8, sort_order: 20 },
  { code: 'light_party', label: 'Light Party (4)', tanks: 1, healers: 1, dps: 2, party_size: 4, sort_order: 60 },
  { code: 'unrestricted', label: 'Unrestricted', tanks: null, healers: null, dps: null, party_size: null, sort_order: 999 },
];

/* The stub, stringified into the page before any of its own scripts run. */
function installStub(seed, members, types) {
  const T = {
    raid_availability: seed.slice(),
    raid_members: members.slice(),
    raid_event_types: types.slice(),
    raid_events: [],
    raid_event_signups: [],
    raid_event_responses: [],
  };
  let session = null;
  let seq = 0;
  const listeners = [];

  window.__stub = {
    T,
    calls: [],
    signIn(user) { session = { user: { id: user.id } }; listeners.forEach((f) => f('SIGNED_IN', session)); },
    signOut() { session = null; listeners.forEach((f) => f('SIGNED_OUT', null)); },
    get session() { return session; },
  };

  const uid = () => session?.user?.id ?? null;
  const isLeader = () => T.raid_members.some((p) => p.id === uid() && p.role === 'leader');
  const canManage = (eventId) => {
    const e = T.raid_events.find((x) => x.id === eventId);
    return Boolean(e) && (e.created_by === uid() || isLeader());
  };
  const DENIED = { message: 'permission denied for table' };

  /* Mirrors the SELECT policies. null means "no table privilege" (anon). */
  function visible(table) {
    if (!uid()) return null;
    switch (table) {
      case 'raid_members':
        return isLeader() ? T.raid_members.slice() : T.raid_members.filter((r) => r.id === uid());
      /* The narrow name-only projection. Every member reads every row -- that
         is the whole point of it existing. */
      case 'raid_member_directory':
        return T.raid_members.map(({ id, display_name, avatar_url, role }) =>
          ({ id, display_name, avatar_url, role }));
      case 'raid_availability':
        return isLeader() ? T.raid_availability.slice()
                          : T.raid_availability.filter((r) => r.member_id === uid());
      /* The consent boundary: responder, creator, leader. Nobody else -- not
         even another member signed up to the same event. */
      case 'raid_event_responses':
        return T.raid_event_responses.filter((r) => r.member_id === uid() || canManage(r.event_id));
      case 'raid_event_types':
      case 'raid_events':
      case 'raid_event_signups':
        return T[table].slice();
      default:
        return T[table] ? T[table].slice() : [];
    }
  }

  function builder(table) {
    const q = { eqs: [], ins: null, orders: [], single: false, op: null, payload: null, cols: null };

    const applyFilters = (rows) => {
      let out = rows;
      for (const [k, v] of q.eqs) out = out.filter((r) => r[k] === v);
      if (q.ins) out = out.filter((r) => q.ins.vals.includes(r[q.ins.col]));
      return out;
    };

    const run = () => {
      if (q.op === 'insert') {
        window.__stub.calls.push({ op: 'insert', table, payload: q.payload });
        if (!uid()) return { data: null, error: DENIED };
        const rows = [];
        for (const raw of q.payload) {
          const r = { ...raw };
          /* WITH CHECK halves of the insert policies. */
          if (table === 'raid_events' && r.created_by !== uid()) return rlsViolation(table);
          if ((table === 'raid_event_signups' || table === 'raid_event_responses'
               || table === 'raid_availability') && r.member_id !== uid()) return rlsViolation(table);
          if (table === 'raid_event_signups') {
            /* raid_guard_signup: assigned_role is the manager's alone. */
            if (!canManage(r.event_id)) r.assigned_role = null;
            r.id = r.id || 'sg-' + (++seq);
            r.seq = ++seq;
          }
          if (table === 'raid_events') r.id = r.id || 'ev-' + (++seq);
          if (table === 'raid_availability' || table === 'raid_event_responses') {
            const dup = T[table].some((x) => Object.keys(r).every((k) => x[k] === r[k]));
            if (dup) continue;
          }
          T[table].push(r);
          rows.push(r);
        }
        return { data: q.single ? (rows[0] ?? null) : rows, error: null };
      }

      if (q.op === 'update') {
        window.__stub.calls.push({ op: 'update', table, eqs: q.eqs, payload: q.payload });
        if (!uid()) return { data: null, error: DENIED };
        const targets = applyFilters(T[table]).filter((r) => {
          if (table === 'raid_events') return canManage(r.id);
          if (table === 'raid_event_signups') return r.member_id === uid() || canManage(r.event_id);
          if (table === 'raid_members') return r.id === uid() || isLeader();
          return r.member_id === uid();
        });
        for (const r of targets) {
          const patch = { ...q.payload };
          if (table === 'raid_event_signups' && !canManage(r.event_id)) delete patch.assigned_role;
          if (table === 'raid_events') { delete patch.id; delete patch.created_by; }
          Object.assign(r, patch);
        }
        return { data: targets, error: null };
      }

      if (q.op === 'delete') {
        window.__stub.calls.push({ op: 'delete', table, eqs: q.eqs, ins: q.ins });
        if (!uid()) return { data: null, error: DENIED };
        const doomed = applyFilters(T[table]).filter((r) => {
          if (table === 'raid_event_signups') return r.member_id === uid() || canManage(r.event_id);
          return r.member_id === uid();
        });
        for (const r of doomed) {
          T[table].splice(T[table].indexOf(r), 1);
          /* responses are FK'd to the signup and cascade with it */
          if (table === 'raid_event_signups') {
            T.raid_event_responses = T.raid_event_responses
              .filter((x) => !(x.event_id === r.event_id && x.member_id === r.member_id));
          }
        }
        return { data: doomed, error: null };
      }

      const rows = visible(table);
      if (rows === null) return { data: null, error: DENIED };
      let out = applyFilters(rows);
      for (const o of [...q.orders].reverse()) {
        out = out.slice().sort((a, b) => {
          const av = a[o.col], bv = b[o.col];
          if (av == null && bv == null) return 0;
          if (av == null) return o.nullsFirst ? -1 : 1;
          if (bv == null) return o.nullsFirst ? 1 : -1;
          return (av < bv ? -1 : av > bv ? 1 : 0) * (o.asc ? 1 : -1);
        });
      }
      return { data: q.single ? (out[0] ?? null) : out, error: null };
    };

    const rlsViolation = (t) => ({
      data: null,
      error: { message: `new row violates row-level security policy for table "${t}"` },
    });

    const api = {
      select(cols) { q.cols = cols; return api; },
      insert(payload) { q.op = 'insert'; q.payload = Array.isArray(payload) ? payload : [payload]; return api; },
      update(payload) { q.op = 'update'; q.payload = payload; return api; },
      delete() { q.op = 'delete'; return api; },
      eq(col, val) { q.eqs.push([col, val]); return api; },
      in(col, vals) { q.ins = { col, vals }; return api; },
      order(col, opts = {}) {
        q.orders.push({ col, asc: opts.ascending !== false, nullsFirst: Boolean(opts.nullsFirst) });
        return api;
      },
      single() { q.single = true; return api; },
      maybeSingle() { q.single = true; return api; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return api;
  }

  window.supabase = {
    createClient() {
      return {
        from: (table) => builder(table),
        /* SECURITY DEFINER: answers for everyone, aggregates only. */
        rpc(name) {
          window.__stub.calls.push({ op: 'rpc', name });
          if (name === 'raid_heatmap') {
            const by = new Map();
            for (const r of T.raid_availability) by.set(r.slot, (by.get(r.slot) || 0) + 1);
            return Promise.resolve({
              data: [...by.entries()].sort((a, b) => a[0] - b[0])
                .map(([slot, available]) => ({ slot, available })),
              error: null,
            });
          }
          if (name === 'raid_stats') {
            return Promise.resolve({
              data: [{
                members: T.raid_members.length,
                respondents: new Set(T.raid_availability.map((r) => r.member_id)).size,
              }],
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: { message: 'unknown rpc ' + name } });
        },
        /* The announce-event Edge Function. The real one re-checks
           raid_can_manage_event() against the caller's JWT; the stub answers
           the same way so the page's error handling can be exercised. */
        functions: {
          invoke(name, opts) {
            window.__stub.calls.push({ op: 'invoke', name, body: opts?.body });
            const forced = window.__stub.invokeResult;
            if (forced) {
              return Promise.resolve({
                data: null,
                error: {
                  message: 'Edge Function returned a non-2xx status code',
                  context: { json: async () => forced },
                },
              });
            }
            if (!canManage(opts?.body?.event_id)) {
              return Promise.resolve({
                data: null,
                error: { message: 'non-2xx', context: { json: async () => ({ error: 'forbidden' }) } },
              });
            }
            return Promise.resolve({
              data: {
                ok: true,
                announced: T.raid_event_signups.filter((x) => x.event_id === opts?.body?.event_id).length,
              },
              error: null,
            });
          },
        },
        auth: {
          getSession: () => Promise.resolve({ data: { session } }),
          onAuthStateChange: (cb) => { listeners.push(cb); return { data: { subscription: {} } }; },
          signInWithOAuth: () => Promise.resolve({ error: null }),
          signOut: () => { window.__stub.signOut(); return Promise.resolve({ error: null }); },
        },
      };
    },
  };
}

const results = [];
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ ok, label, actual, expected });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
}

(async () => {
  const fs = require('fs');
  fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });

  page.on('pageerror', (e) => {
    console.log('PAGE ERROR:', e.message);
    results.push({ ok: false, label: 'page error: ' + e.message });
  });

  await page.route('**/supabase-js@2/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**/config.js*', (r) => r.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: "window.RAID_CONFIG={url:'https://stub.supabase.co',key:'sb_publishable_stub'};",
  }));
  await page.addInitScript({
    content: `(${installStub.toString()})(${JSON.stringify(SEED)},`
      + `${JSON.stringify([LEADER, MEMBER, OTHER, FOURTH])},${JSON.stringify(TYPES)});`,
  });

  const signIn = async (u) => {
    await page.evaluate((x) => { window.__stub.signOut(); window.__stub.signIn(x); }, u);
    await page.waitForTimeout(250);
  };
  const openEvents = async () => {
    await page.locator('[data-view-target="events"]').click();
    await page.waitForTimeout(200);
  };

  await page.goto(PAGE);
  await page.waitForFunction(() => document.querySelectorAll('#overlap-grid .cell').length === 168);

  // ---- A. signed out -----------------------------------------------------
  console.log('\n=== A. anonymous visitor ===');
  check('overlap grid rendered (168 cells)', await page.locator('#overlap-grid .cell').count(), 168);
  check('"Events" tab hidden', await page.locator('[data-view-target="events"]').isHidden(), true);
  check('"My times" tab hidden', await page.locator('[data-needs="member"]').first().isHidden(), true);
  check('"Company" tab hidden', await page.locator('[data-needs="leader"]').isHidden(), true);
  check('no member names anywhere in the DOM',
    await page.evaluate(() => ['Batty', 'Cedho', 'Tataru', 'Yshtola']
      .filter((n) => document.body.innerText.includes(n))), []);
  check('only aggregate RPCs called, no table reads',
    await page.evaluate(() => window.__stub.calls.filter((c) => c.op !== 'rpc').length), 0);
  await page.screenshot({ path: `${SHOTS}/a-anon-overlap.png`, fullPage: true });

  // ---- B. member: weekly grid --------------------------------------------
  console.log('\n=== B. member, weekly availability ===');
  await signIn(MEMBER);
  check('"Events" and "My times" both revealed',
    [await page.locator('[data-view-target="events"]').isHidden(),
     await page.locator('[data-view-target="mine"]').isHidden()], [false, false]);
  check('"Company" still hidden for a member',
    await page.locator('[data-needs="leader"]').isHidden(), true);

  await page.locator('[data-view-target="mine"]').click();
  await page.waitForSelector('#mine-grid .cell');
  check('own grid shows exactly this member\'s 3 hours',
    await page.locator('#mine-grid .cell[aria-pressed="true"]').count(), 3);

  // ---- C. member creates a poll event ------------------------------------
  console.log('\n=== C. creating a poll event ===');
  await openEvents();
  check('empty state before anything exists',
    (await page.locator('#events-list').innerText()).includes('Nothing scheduled'), true);

  await page.locator('#new-event').click();
  await page.locator('#ev-title').fill('Savage reclear');
  await page.selectOption('#ev-type', 'savage');
  check('picking a duty prefills the composition',
    await page.evaluate(() => ['ev-tanks', 'ev-healers', 'ev-dps', 'ev-size']
      .map((i) => document.getElementById(i).value)), ['2', '2', '4', '8']);

  await page.locator('#ev-poll-start').fill('2026-09-07');
  await page.locator('#ev-save').click();
  await page.waitForSelector('#events-detail:not([hidden])');
  check('event created and opened',
    (await page.locator('#events-detail h1').innerText()).trim(), 'Savage reclear');
  check('poll grid spans the 14-day window',
    await page.evaluate(() => document.querySelectorAll('#poll-grid .dh').length), 14);
  check('creator sees the organiser view',
    await page.locator('#ev-schedule').count(), 1);
  await page.screenshot({ path: `${SHOTS}/c-event-created.png`, fullPage: true });

  // creator signs up and marks hours
  await page.locator('#role-picker input[value="healer"]').check();
  await page.locator('#ev-signup').click();
  await page.waitForTimeout(300);
  check('creator appears on the roster as a healer',
    (await page.locator('#roster').innerText()).includes('Cedho Nalen'), true);

  await page.evaluate(() => {
    /* Mark two hours directly through the stub, as the creator's own grid is
       the organiser (count) view rather than the painting one. */
    const s = window.__stub;
    for (const k of ['2026-09-08T23:00:00.000Z', '2026-09-09T23:00:00.000Z']) {
      s.T.raid_event_responses.push({ event_id: s.T.raid_events[0].id, member_id: 'u-cedho', starts_at: k });
    }
  });

  // ---- D. a second member responds ---------------------------------------
  console.log('\n=== D. another member signs up and marks hours ===');
  await signIn(OTHER);
  await openEvents();
  await page.locator('.ev-card').first().click();
  await page.waitForSelector('#events-detail:not([hidden])');

  check('non-creator gets the participant view, not the organiser one',
    await page.locator('#ev-schedule').count(), 0);
  check('non-creator sees the creator\'s NAME on the roster (directory)',
    (await page.locator('#roster').innerText()).includes('Cedho Nalen'), true);
  check('but sees none of the creator\'s marked hours',
    await page.evaluate(() => window.__stub.T.raid_event_responses
      .filter((r) => r.member_id !== 'u-tataru').length > 0
      && document.querySelectorAll('#poll-grid .cell[aria-pressed="true"]').length === 0), true);

  await page.locator('#role-picker input[value="tank"]').check();
  await page.locator('#role-picker input[value="dps"]').check();
  await page.locator('#ev-signup').click();
  await page.waitForTimeout(300);

  /* Mark the hour the creator can also make. */
  const targetCell = '#poll-grid .cell[data-key="2026-09-08T23:00:00.000Z"]';
  if (await page.locator(targetCell).count()) {
    await page.locator(targetCell).click();
    await page.waitForTimeout(900);
    check('marking an hour persists as this member\'s response',
      await page.evaluate(() => window.__stub.T.raid_event_responses
        .filter((r) => r.member_id === 'u-tataru').length), 1);
  }
  await page.screenshot({ path: `${SHOTS}/d-member-poll.png`, fullPage: true });

  // ---- E. creator schedules the winning hour -----------------------------
  console.log('\n=== E. the organiser locks in a time ===');
  await signIn(MEMBER);
  await openEvents();
  await page.locator('.ev-card').first().click();
  await page.waitForSelector('#poll-grid');

  check('organiser\'s grid is shaded by response counts',
    await page.evaluate(() => document.querySelectorAll('#poll-grid .cell:not(.h0)').length > 0), true);

  await page.locator(targetCell).click();
  await page.waitForTimeout(200);
  check('clicking an hour names who is free then',
    (await page.locator('#poll-who .name').allInnerTexts()).map((s) => s.trim()).sort(),
    ['Cedho Nalen', 'Tataru']);

  await page.locator('#ev-schedule').click();
  await page.waitForTimeout(400);
  check('event is now scheduled',
    await page.evaluate(() => window.__stub.T.raid_events[0].status), 'scheduled');
  check('detail shows the scheduled pill',
    (await page.locator('#events-detail .pill').first().innerText()).trim().toLowerCase(), 'scheduled');
  await page.screenshot({ path: `${SHOTS}/e-scheduled.png`, fullPage: true });

  // ---- F. roster: composition, order, backups ----------------------------
  console.log('\n=== F. roster, roles and the backup queue ===');
  /* Fill the party past capacity to force backups. Two more DPS-only signups
     after Tataru, so the 4 DPS seats fill and the rest overflow. */
  await page.evaluate(() => {
    const s = window.__stub, ev = s.T.raid_events[0];
    let n = 900;
    for (const id of ['u-leader', 'u-ysh']) {
      s.T.raid_event_signups.push({ id: 'sg-x' + (++n), event_id: ev.id, member_id: id,
                                    roles: ['dps'], assigned_role: null, seq: ++n });
    }
  });
  await page.locator('.ev-card') .first().click().catch(() => {});
  await openEvents();
  await page.locator('.ev-card').first().click();
  await page.waitForSelector('#roster');

  check('roster groups by role with counts',
    (await page.locator('#roster .slot-group h4').allInnerTexts())
      .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase()),
    ['tank 1 / 2', 'healer 1 / 2', 'dps 2 / 4', 'backups in signup order']);
  check('Tataru took the TANK seat, not a DPS one (scarcest role first)',
    (await page.locator('#roster .slot-group').first().innerText()).includes('Tataru'), true);
  check('empty seats are shown as open',
    await page.locator('#roster .slot-list li.is-empty').count() > 0, true);
  check('organiser sees pin controls', await page.locator('#roster .pin').count() > 0, true);
  await page.screenshot({ path: `${SHOTS}/f-roster.png`, fullPage: true });

  // ---- G. a plain member cannot pin --------------------------------------
  console.log('\n=== G. assigned_role is the organiser\'s alone ===');
  await signIn(FOURTH);
  await openEvents();
  await page.locator('.ev-card').first().click();
  await page.waitForSelector('#roster');
  check('a non-organiser sees no pin controls', await page.locator('#roster .pin').count(), 0);
  check('a non-organiser sees no cancel control', await page.locator('#ev-cancel-event').count(), 0);
  check('roster names visible to a plain member',
    await page.evaluate(() => {
      const t = document.getElementById('roster').innerText;
      return ['Batty', 'Cedho Nalen', 'Tataru', 'Yshtola'].filter((n) => t.includes(n));
    }), ['Batty', 'Cedho Nalen', 'Tataru', 'Yshtola']);
  check('and none of anyone else\'s marked hours',
    await page.evaluate(() => document.querySelectorAll('#poll-grid .cell[aria-pressed="true"]').length), 0);

  // ---- H. leader ----------------------------------------------------------
  console.log('\n=== H. leader ===');
  await signIn(LEADER);
  check('"Company" tab shown for a leader',
    await page.locator('[data-needs="leader"]').isHidden(), false);
  await openEvents();
  await page.locator('.ev-card').first().click();
  await page.waitForSelector('#roster');
  check('a leader can manage an event they did not create',
    await page.locator('#ev-cancel-event').count(), 1);
  check('a leader sees every response on the poll',
    await page.evaluate(() => document.querySelectorAll('#poll-grid .cell:not(.h0)').length > 0), true);
  await page.screenshot({ path: `${SHOTS}/h-leader-event.png`, fullPage: true });

  // ---- H2. announcing to Discord -----------------------------------------
  console.log('\n=== H2. announce to Discord ===');
  check('organiser sees the announce button', await page.locator('#ev-announce').count(), 1);

  await page.locator('#ev-announce').click();
  await page.waitForTimeout(300);
  check('it invokes announce-event with this event id',
    await page.evaluate(() => {
      const c = window.__stub.calls.filter((x) => x.op === 'invoke').pop();
      return c && c.name === 'announce-event' && c.body.event_id === window.__stub.T.raid_events[0].id;
    }), true);
  check('success is reported with the signup count',
    (await page.locator('#announce-status').innerText()).startsWith('Posted to Discord'), true);

  /* An unset webhook is configuration, not a bug -- the page must say which. */
  await page.evaluate(() => {
    window.__stub.invokeResult = {
      error: 'not_configured',
      message: 'DISCORD_WEBHOOK_URL is not set. Add it under Edge Functions \u2192 Secrets.',
    };
  });
  await page.locator('#ev-announce').click();
  await page.waitForTimeout(300);
  check('a missing webhook surfaces the actionable message, not a generic one',
    (await page.locator('#announce-status').innerText()).includes('DISCORD_WEBHOOK_URL is not set'), true);
  await page.evaluate(() => { window.__stub.invokeResult = null; });
  await page.screenshot({ path: `${SHOTS}/h2-announce.png`, fullPage: true });

  await signIn(FOURTH);
  await openEvents();
  await page.locator('.ev-card').first().click();
  await page.waitForSelector('#roster');
  check('a plain member has no announce button', await page.locator('#ev-announce').count(), 0);

  // ---- I. sign out --------------------------------------------------------
  console.log('\n=== I. after signing out ===');
  await page.locator('#auth-btn').click();
  await page.waitForFunction(() => document.querySelector('[data-needs="leader"]').hidden);
  check('every gated tab hidden again',
    [await page.locator('[data-view-target="events"]').isHidden(),
     await page.locator('[data-view-target="mine"]').isHidden(),
     await page.locator('[data-needs="leader"]').isHidden()], [true, true, true]);
  check('no names left in the DOM',
    await page.evaluate(() => ['Batty', 'Cedho', 'Tataru', 'Yshtola']
      .filter((n) => document.body.innerText.includes(n))), []);
  check('and no event titles either',
    await page.evaluate(() => document.body.innerText.includes('Savage reclear')), false);

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`screenshots in ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
})();
