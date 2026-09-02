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

const LEADER = { id: 'u-leader', display_name: 'Batty',       role: 'leader', avatar_url: null, timezone: null };
const MEMBER = { id: 'u-cedho',  display_name: 'Cedho Nalen', role: 'member', avatar_url: null, timezone: null };
const OTHER  = { id: 'u-tataru', display_name: 'Tataru',      role: 'member', avatar_url: null, timezone: null };
const FOURTH = { id: 'u-ysh',    display_name: 'Yshtola',     role: 'member', avatar_url: null, timezone: null };

/* Weekly slots are UTC hours-of-week. Fixed values so assertions are stable. */
const SEED = [
  { member_id: 'u-leader', slot: 42 }, { member_id: 'u-leader', slot: 43 },
  { member_id: 'u-leader', slot: 44 }, { member_id: 'u-leader', slot: 90 },
  { member_id: 'u-cedho',  slot: 42 }, { member_id: 'u-cedho',  slot: 43 },
  { member_id: 'u-cedho',  slot: 66 },
  { member_id: 'u-tataru', slot: 42 }, { member_id: 'u-tataru', slot: 90 },
];

/* A stand-in for the published Lodestone roster. Shapes match ffxiv.json:
   the job list is what rolesFromJobs() reads to suggest raid roles. */
const FC_ROSTER = { roster: [
  { id: '2299082', name: 'Cedho Nalen', world: 'Malboro', race: 'Hrothgar', title: 'Heliodrome Hero',
    grand_company: 'Flames', avatar: null,
    main_job: { job: 'Astrologian', level: 100 },
    jobs: [{ job: 'Astrologian', level: 100, role: 'combat' }, { job: 'Warrior', level: 90, role: 'combat' }] },
  { id: '27685561', name: 'Azathio Magnus', world: 'Malboro', race: 'Au Ra', title: 'The Unsevered',
    grand_company: 'Flames', avatar: null,
    main_job: { job: 'Dark Knight', level: 60 },
    jobs: [{ job: 'Dark Knight', level: 60, role: 'combat' }] },
  { id: '3000001', name: 'Lyse Hext', world: 'Malboro', race: 'Hyur', title: null,
    grand_company: 'Maelstrom', avatar: null,
    main_job: { job: 'Black Mage', level: 100 },
    jobs: [{ job: 'Black Mage', level: 100, role: 'combat' }] },
  { id: '3000002', name: 'Krile Baldesion', world: 'Malboro', race: 'Lalafell', title: null,
    grand_company: null, avatar: null,
    main_job: { job: 'Carpenter', level: 90 },
    jobs: [{ job: 'Carpenter', level: 90, role: 'craft' }] },
] };

const TYPES = [
  { code: 'savage', label: 'Savage Raid (8)', tanks: 2, healers: 2, dps: 4, party_size: 8, sort_order: 20 },
  { code: 'light_party', label: 'Light Party (4)', tanks: 1, healers: 1, dps: 2, party_size: 4, sort_order: 60 },
  { code: 'unrestricted', label: 'Unrestricted', tanks: null, healers: null, dps: null, party_size: null, sort_order: 999 },
];

/* The stub, stringified into the page before any of its own scripts run. */
function installStub(seed, members, types) {
  /* Tables and session live in sessionStorage so a page reload keeps them, the
     way a real Supabase client keeps its session. Without that, "does reloading
     keep me on the same tab" could not be tested at all -- the reload would
     wipe the data out from under the assertion. */
  const KEY = '__raid_stub__';
  const fresh = () => ({
    raid_availability: seed.slice(),
    raid_members: members.slice(),
    raid_event_types: types.slice(),
    raid_events: [],
    raid_event_signups: [],
    raid_event_responses: [],
    raid_characters: [],
  });
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { saved = null; }
  const T = saved?.T || fresh();
  let session = saved?.session ?? null;
  let seq = saved?.seq ?? 0;
  const persist = () => {
    try { sessionStorage.setItem(KEY, JSON.stringify({ T, session, seq })); } catch { /* ignore */ }
  };
  const listeners = [];

  window.__stub = {
    T,
    calls: [],
    signIn(user) { session = { user: { id: user.id } }; persist(); listeners.forEach((f) => f('SIGNED_IN', session)); },
    signOut() { session = null; persist(); listeners.forEach((f) => f('SIGNED_OUT', null)); },
    reset() { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } },
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
      /* Migration 003: a claim is an identity mapping, readable by all. */
      case 'raid_characters':
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
               || table === 'raid_availability' || table === 'raid_characters')
              && r.member_id !== uid()) return rlsViolation(table);
          if (table === 'raid_characters') {
            /* unique (lodestone_id): a character can be claimed only once. */
            if (T.raid_characters.some((x) => String(x.lodestone_id) === String(r.lodestone_id))) {
              return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
            }
            r.id = r.id || 'ch-' + (++seq);
          }
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
        persist();
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
        persist();
        return { data: targets, error: null };
      }

      if (q.op === 'delete') {
        window.__stub.calls.push({ op: 'delete', table, eqs: q.eqs, ins: q.ins });
        if (!uid()) return { data: null, error: DENIED };
        const doomed = applyFilters(T[table]).filter((r) => {
          if (table === 'raid_event_signups') return r.member_id === uid() || canManage(r.event_id);
          /* self, or a leader correcting a bad claim */
          if (table === 'raid_characters') return r.member_id === uid() || isLeader();
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
        persist();
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
  /* The page fetches the published roster from raw.githubusercontent, with a
     local file fallback. Serve the fixture for both, plus the job-icon map. */
  await page.route('**/ffxiv.json*', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(FC_ROSTER),
  }));
  await page.route('**/job-icons.json*', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ Astrologian: 'astrologian.png', 'Dark Knight': 'dark-knight.png',
                           'Black Mage': 'black-mage.png', Warrior: 'warrior.png', Carpenter: 'carpenter.png' }),
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
  check('lands on the welcome page, not the bare heatmap',
    await page.evaluate(() => document.getElementById('view-welcome').classList.contains('is-active')), true);
  check('with a Discord sign-in call to action',
    (await page.locator('#welcome-signin').innerText()).toLowerCase().includes('sign in with discord'), true);
  check('and a getting-started button',
    await page.locator('#welcome-guide').isVisible(), true);
  check('the guide opens for a signed-out visitor too',
    await (async () => {
      await page.locator('#welcome-guide').click();
      await page.waitForTimeout(200);
      return page.locator('#guide').isVisible();
    })(), true);
  check('and the guide explains the Discord state',
    (await page.locator('#guide').innerText()).includes('not connected yet'), true);
  await page.screenshot({ path: `${SHOTS}/a0-welcome.png`, fullPage: true });
  await page.locator('#guide-close').click();

  check('the public can still reach the overlap',
    await (async () => {
      await page.locator('#welcome-overlap').click();
      await page.waitForTimeout(200);
      return page.evaluate(() => document.getElementById('view-overlap').classList.contains('is-active'));
    })(), true);
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
  await page.evaluate(() => history.replaceState(null, '', location.pathname));
  await signIn(MEMBER);
  check('"Events" and "My times" both revealed',
    [await page.locator('[data-view-target="events"]').isHidden(),
     await page.locator('[data-view-target="mine"]').isHidden()], [false, false]);
  check('"Company" still hidden for a member',
    await page.locator('[data-needs="leader"]').isHidden(), true);

  check('a signed-in member lands on Events, not the heatmap',
    await page.evaluate(() => document.getElementById('view-events').classList.contains('is-active')), true);

  await page.locator('[data-view-target="mine"]').click();
  await page.waitForSelector('#mine-grid .cell');
  check('own grid shows exactly this member\'s 3 hours',
    await page.locator('#mine-grid .cell[aria-pressed="true"]').count(), 3);

  // ---- B2. timezone ------------------------------------------------------
  console.log('\n=== B2. timezone ===');
  check('the detected zone was persisted on first sign-in',
    await page.evaluate(() => window.__stub.T.raid_members.find((m) => m.id === 'u-cedho').timezone !== null), true);

  const slotsBefore = await page.evaluate(() =>
    [...document.querySelectorAll('#mine-grid .cell[aria-pressed="true"]')].map((c) => c.dataset.i).join(','));
  await page.selectOption('#tz-pick', 'Asia/Tokyo');
  await page.waitForTimeout(400);
  check('choosing a zone saves it to the member',
    await page.evaluate(() => window.__stub.T.raid_members.find((m) => m.id === 'u-cedho').timezone), 'Asia/Tokyo');
  const slotsAfter = await page.evaluate(() =>
    [...document.querySelectorAll('#mine-grid .cell[aria-pressed="true"]')].map((c) => c.dataset.i).join(','));
  check('the same stored hours land on different grid cells in a different zone',
    slotsBefore !== slotsAfter, true);
  check('but the stored UTC slots are untouched',
    await page.evaluate(() => window.__stub.T.raid_availability
      .filter((r) => r.member_id === 'u-cedho').map((r) => r.slot).sort((a, b) => a - b)), [42, 43, 66]);
  check('the zone label carries an abbreviation',
    await page.evaluate(() => /\(.+\)/.test(document.getElementById('tz-status').textContent)), true);

  await page.selectOption('#tz-pick', 'UTC');
  await page.waitForTimeout(300);

  // ---- B3. the view survives a reload ------------------------------------
  console.log('\n=== B3. routing ===');
  check('switching tabs writes the view to the URL',
    await page.evaluate(() => location.hash), '#mine');

  await page.locator('[data-view-target="chars"]').click();
  await page.waitForTimeout(150);
  check('and follows the tab', await page.evaluate(() => location.hash), '#chars');

  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#overlap-grid .cell').length === 168);
  await page.waitForTimeout(500);
  check('reloading keeps you on the tab you were on',
    await page.evaluate(() => document.getElementById('view-chars').classList.contains('is-active')), true);
  check('and keeps the saved timezone',
    await page.evaluate(() => document.getElementById('tz-pick').value), 'UTC');

  await page.locator('[data-view-target="mine"]').click();
  await page.waitForSelector('#mine-grid .cell');

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

  await page.locator('#ev-level').fill('100');
  await page.selectOption('#ev-level-rule', 'required');

  /* The bug that started this: an author display:flex outranked the UA's
     [hidden] rule, so the poll-length control stayed on screen after choosing
     a fixed time. */
  await page.locator('input[name="ev-mode"][value="fixed"]').check();
  await page.waitForTimeout(150);
  check('choosing a fixed time hides the poll-length control',
    await page.locator('#ev-poll-fields').isHidden(), true);
  check('and reveals the start-time control',
    await page.locator('#ev-fixed-fields').isHidden(), false);
  await page.locator('input[name="ev-mode"][value="poll"]').check();
  await page.waitForTimeout(150);
  check('and back again',
    [await page.locator('#ev-poll-fields').isHidden(),
     await page.locator('#ev-fixed-fields').isHidden()], [false, true]);

  check('the organiser can sign themselves up while creating',
    await page.locator('#ev-my-roles input').count(), 3);
  await page.locator('#ev-my-roles input[value="healer"]').check();

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

  check('opening an event puts it in the URL',
    await page.evaluate(() => /^#\/event\/.+/.test(location.hash)), true);

  /* Reload straight onto the event URL. Deliberately NOT via about:blank --
     a file:// origin loses its sessionStorage across that hop, which would
     sign the stub out and make this test fail for the wrong reason. */
  const eventUrl = await page.evaluate(() => location.href);
  await page.goto(eventUrl);
  await page.waitForFunction(() => document.querySelectorAll('#overlap-grid .cell').length === 168);
  await page.waitForSelector('#events-detail h1', { timeout: 15000 });
  check('following an event link opens that event',
    (await page.locator('#events-detail h1').innerText()).trim(), 'Savage reclear');

  check('creating signed the organiser up in the same step',
    await page.evaluate(() => window.__stub.T.raid_event_signups
      .filter((x) => x.member_id === 'u-cedho').map((x) => x.roles)), [['healer']]);
  check('creator appears on the roster already',
    (await page.locator('#roster').innerText()).includes('Cedho Nalen'), true);
  check('the level is shown on the event',
    (await page.locator('#events-detail .lvl-pill').first().innerText()).trim().toLowerCase(),
    'lv 100 required');

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
    await page.waitForTimeout(200);
    check('marking an hour does not write until saved',
      await page.evaluate(() => window.__stub.T.raid_event_responses
        .filter((r) => r.member_id === 'u-tataru').length), 0);
    check('the poll save button is armed',
      await page.locator('#poll-save').isDisabled(), false);
    await page.locator('#poll-save').click();
    await page.waitForTimeout(400);
    check('saving persists it as this member\'s response',
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

  // ---- H1. characters ----------------------------------------------------
  console.log('\n=== H1. character linking ===');
  await signIn(MEMBER);
  await page.locator('[data-view-target="chars"]').click();
  await page.waitForSelector('#claim-list .adventurer');

  check('the FC roster renders as claimable plates',
    await page.locator('#claim-list button.adventurer').count(), 4);
  check('nothing linked yet', (await page.locator('#chars-status').innerText()).trim(), 'None linked');
  check('a plate carries the Grand Company accent class',
    await page.evaluate(() => Boolean(document.querySelector('#claim-list .adventurer.gc-flames'))), true);
  check('a plate shows the character title',
    (await page.locator('#claim-list .char-title').first().innerText()).trim(), 'Heliodrome Hero');
  check('roles are inferred from levelled combat jobs',
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('#claim-list button.adventurer')]
        .find((el) => el.innerText.includes('Cedho Nalen'));
      return [...p.querySelectorAll('.role-hint span')].map((s) => s.textContent.trim());
    }), ['Tank', 'Healer']);
  check('a crafter suggests no raid role',
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('#claim-list button.adventurer')]
        .find((el) => el.innerText.includes('Krile'));
      return p.querySelectorAll('.role-hint span').length;
    }), 0);
  await page.screenshot({ path: `${SHOTS}/h1-claim-list.png`, fullPage: true });

  await page.locator('#claim-list button.adventurer').first().click();
  await page.waitForTimeout(300);
  check('claiming moves the character into "Yours"',
    (await page.locator('#my-chars .char-name').allInnerTexts()).map((s) => s.trim()), ['Cedho Nalen']);
  check('and takes it out of the claimable list',
    await page.locator('#claim-list button.adventurer').count(), 3);
  check('the claim was written as this member',
    await page.evaluate(() => window.__stub.T.raid_characters.map((c) => [c.member_id, c.character_name])),
    [['u-cedho', 'Cedho Nalen']]);

  await page.locator('#char-search').fill('krile');
  await page.waitForTimeout(150);
  check('search filters the roster',
    (await page.locator('#claim-list .char-name').allInnerTexts()).map((s) => s.trim()), ['Krile Baldesion']);
  await page.locator('#char-search').fill('');

  check('a plain member sees no leader claims panel',
    await page.locator('#claims-admin').isHidden(), true);

  /* Another member claims a different character, so the roster below has two. */
  await signIn(OTHER);
  await page.locator('[data-view-target="chars"]').click();
  await page.waitForSelector('#claim-list .adventurer');
  check('a member sees someone else\'s claim as already taken',
    await page.locator('#claim-list button.adventurer').count(), 3);
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('#claim-list button.adventurer')]
      .find((el) => el.innerText.includes('Azathio'));
    p.click();
  });
  await page.waitForTimeout(300);
  check('second member linked their own character',
    await page.evaluate(() => window.__stub.T.raid_characters.length), 2);

  // ---- H1b. characters show up on shared rosters --------------------------
  console.log('\n=== H1b. rosters lead with the character ===');
  await openEvents();
  await page.locator('.ev-card').first().click();
  await page.waitForSelector('#roster');
  check('the roster leads with the character, handle as a tag',
    await page.evaluate(() => {
      const li = [...document.querySelectorAll('#roster .slot-list li')]
        .find((x) => x.innerText.includes('Azathio Magnus'));
      return li ? li.querySelector('.char-tag')?.textContent.trim() : null;
    }), 'Tataru');
  check('a handle identical to the character name is not printed twice',
    await page.evaluate(() => {
      const li = [...document.querySelectorAll('#roster .slot-list li')]
        .find((x) => x.innerText.includes('Cedho Nalen'));
      return li ? li.querySelectorAll('.char-tag').length : -1;
    }), 0);
  check('someone with no linked character still shows their handle',
    await page.evaluate(() => document.getElementById('roster').innerText.includes('Batty')), true);
  await page.screenshot({ path: `${SHOTS}/h1b-roster-characters.png`, fullPage: true });

  // ---- H1c. leaders correct a bad claim -----------------------------------
  console.log('\n=== H1c. a leader corrects a bad claim ===');
  await signIn(LEADER);
  await page.locator('[data-view-target="chars"]').click();
  await page.waitForSelector('#claim-list .adventurer');
  check('a leader sees the all-claims panel', await page.locator('#claims-admin').isHidden(), false);
  check('listing every claim', await page.locator('#all-claims .claim-row').count(), 2);

  await page.locator('#all-claims .claim-row [data-unlink]').first().click();
  await page.waitForTimeout(300);
  check('a leader can remove someone else\'s claim',
    await page.evaluate(() => window.__stub.T.raid_characters.length), 1);

  await signIn(FOURTH);
  await page.locator('[data-view-target="chars"]').click();
  await page.waitForSelector('#claim-list .adventurer');
  check('a plain member cannot remove another member\'s claim',
    await page.evaluate(async () => {
      const before = window.__stub.T.raid_characters.length;
      const target = window.__stub.T.raid_characters[0];
      const c = window.supabase.createClient();
      await c.from('raid_characters').delete().eq('id', target.id);
      return window.__stub.T.raid_characters.length === before;
    }), true);

  // ---- H2. announcing to Discord -----------------------------------------
  console.log('\n=== H2. announce to Discord ===');
  /* Back to the event as its creator: the previous block left the page on the
     Characters view as a different member. */
  await signIn(MEMBER);
  await openEvents();
  await page.locator('.ev-card').first().click();
  await page.waitForSelector('#roster');
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
  check('signing out returns to the welcome page',
    await page.evaluate(() => document.getElementById('view-welcome').classList.contains('is-active')), true);
  check('no names left in the DOM',
    await page.evaluate(() => ['Batty', 'Cedho', 'Tataru', 'Yshtola']
      .filter((n) => document.body.innerText.includes(n))), []);
  check('and no event titles either',
    await page.evaluate(() => document.body.innerText.includes('Savage reclear')), false);

  await page.evaluate(() => window.__stub.reset());
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`screenshots in ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
})();
