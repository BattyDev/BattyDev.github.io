/* LOCAL TEST HARNESS ONLY -- not shipped to the page.
 *
 * Drives raid/index.html in Chromium with a stubbed Supabase client, so the UI
 * can be exercised without the hosted project existing (and without egress,
 * which this sandbox blocks to supabase.co anyway).
 *
 * The stub deliberately re-implements the RLS rules from 001_schema.sql --
 * anon sees no rows and only the RPCs, a member sees only their own rows, a
 * leader sees all -- so that what is being tested is "does the page behave
 * correctly when the database answers the way it actually answers", not "does
 * the page filter things itself". If the page ever started relying on its own
 * filtering, this harness would keep passing while the real thing leaked, so
 * the SQL proof in 01_rls_proof.sql is the authority; this only checks the UI
 * on top of it.
 *
 * Run: NODE_PATH=/opt/node22/lib/node_modules node ui-harness.js
 */

const { chromium } = require('playwright');
const path = require('path');

const PAGE = 'file://' + path.resolve(__dirname, '../../index.html');
const SHOTS = process.env.SHOT_DIR || '/tmp/raid-shots';

const LEADER = { id: 'u-leader', display_name: 'Batty', role: 'leader', avatar_url: null };
const MEMBER = { id: 'u-cedho', display_name: 'Cedho Nalen', role: 'member', avatar_url: null };
const OTHER  = { id: 'u-tataru', display_name: 'Tataru', role: 'member', avatar_url: null };

/* Slots are UTC hours-of-week. Fixed values so assertions are stable. */
const SEED = [
  { member_id: 'u-leader', slot: 42 }, { member_id: 'u-leader', slot: 43 },
  { member_id: 'u-leader', slot: 44 }, { member_id: 'u-leader', slot: 90 },
  { member_id: 'u-cedho',  slot: 42 }, { member_id: 'u-cedho',  slot: 43 },
  { member_id: 'u-cedho',  slot: 66 },
  { member_id: 'u-tataru', slot: 42 }, { member_id: 'u-tataru', slot: 90 },
];

/* The stub, stringified into the page before any of its own scripts run. */
function installStub(seed, members) {
  /* config.js is served by a route below rather than set here -- it loads after
     this init script and would otherwise overwrite the value with the empty
     placeholder that ships in the repo. */
  const rows = seed.slice();
  const people = members.slice();
  let session = null;
  const listeners = [];

  window.__stub = {
    rows, people,
    calls: [],
    signIn(user) {
      session = { user: { id: user.id } };
      listeners.forEach((f) => f('SIGNED_IN', session));
    },
    signOut() {
      session = null;
      listeners.forEach((f) => f('SIGNED_OUT', null));
    },
    get session() { return session; },
  };

  const uid = () => session?.user?.id ?? null;
  const isLeader = () => people.some((p) => p.id === uid() && p.role === 'leader');

  /* Mirrors the RLS SELECT policies. */
  const visibleRows = () => {
    if (!uid()) return null;                       // anon: no table privilege
    if (isLeader()) return rows.slice();
    return rows.filter((r) => r.member_id === uid());
  };
  const visiblePeople = () => {
    if (!uid()) return null;
    if (isLeader()) return people.slice();
    return people.filter((p) => p.id === uid());
  };

  const DENIED = { message: 'permission denied for table' };

  function builder(table) {
    const q = { _eq: {}, _in: null, _single: false };
    const run = () => {
      let data = table === 'members' ? visiblePeople() : visibleRows();
      if (data === null) return { data: null, error: DENIED };
      for (const [k, v] of Object.entries(q._eq)) data = data.filter((r) => r[k] === v);
      if (q._in) data = data.filter((r) => q._in.vals.includes(r[q._in.col]));
      if (table === 'availability' && q._embed) {
        data = data.map((r) => ({ ...r, members: people.find((p) => p.id === r.member_id) || null }));
      }
      return { data: q._single ? (data[0] ?? null) : data, error: null };
    };

    const api = {
      select(cols) { q._embed = String(cols || '').includes('members('); return api; },
      eq(col, val) { q._eq[col] = val; return api; },
      in(col, vals) { q._in = { col, vals }; return api; },
      order() { return api; },
      maybeSingle() { q._single = true; return api; },
      single() { q._single = true; return api; },
      insert(payload) {
        window.__stub.calls.push({ op: 'insert', table, payload });
        if (!uid()) return Promise.resolve({ data: null, error: DENIED });
        /* The WITH CHECK half of the insert policy. */
        const bad = payload.some((r) => r.member_id !== uid());
        if (bad) {
          return Promise.resolve({
            data: null,
            error: { message: 'new row violates row-level security policy for table "availability"' },
          });
        }
        for (const r of payload) {
          if (!rows.some((x) => x.member_id === r.member_id && x.slot === r.slot)) rows.push({ ...r });
        }
        return Promise.resolve({ data: payload, error: null });
      },
      delete() {
        q._del = true;
        return api;
      },
      then(resolve, reject) {
        if (q._del) {
          window.__stub.calls.push({ op: 'delete', table, eq: { ...q._eq }, in: q._in });
          if (!uid()) return Promise.resolve({ data: null, error: DENIED }).then(resolve, reject);
          for (let i = rows.length - 1; i >= 0; i--) {
            const r = rows[i];
            const matchEq = Object.entries(q._eq).every(([k, v]) => r[k] === v);
            const matchIn = !q._in || q._in.vals.includes(r[q._in.col]);
            /* RLS USING clause: a member can only delete their own. */
            const allowed = isLeader() ? false : r.member_id === uid();
            if (matchEq && matchIn && allowed) rows.splice(i, 1);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
        return Promise.resolve(run()).then(resolve, reject);
      },
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
          if (name === 'availability_heatmap') {
            const by = new Map();
            for (const r of rows) by.set(r.slot, (by.get(r.slot) || 0) + 1);
            return Promise.resolve({
              data: [...by.entries()].sort((a, b) => a[0] - b[0])
                .map(([slot, available]) => ({ slot, available })),
              error: null,
            });
          }
          if (name === 'availability_stats') {
            return Promise.resolve({
              data: [{ members: people.length, respondents: new Set(rows.map((r) => r.member_id)).size }],
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: { message: 'unknown rpc ' + name } });
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
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });

  page.on('pageerror', (e) => { console.log('PAGE ERROR:', e.message); results.push({ ok: false, label: 'page error: ' + e.message }); });

  /* The page pulls supabase-js from a CDN this sandbox cannot reach; the stub
     replaces it, so serve an empty script rather than letting it hang. */
  await page.route('**/supabase-js@2/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));

  /* Stand in for the unfilled config.js that ships in the repo. */
  await page.route('**/config.js*', (r) => r.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: "window.RAID_CONFIG={url:'https://stub.supabase.co',key:'sb_publishable_stub'};",
  }));
  await page.addInitScript({ content: `(${installStub.toString()})(${JSON.stringify(SEED)}, ${JSON.stringify([LEADER, MEMBER, OTHER])});` });

  await page.goto(PAGE);
  await page.waitForFunction(() => document.querySelectorAll('#overlap-grid .cell').length === 168);

  // ---- A. signed out -----------------------------------------------------
  console.log('\n=== A. anonymous visitor ===');
  check('overlap grid rendered (168 cells)',
    await page.locator('#overlap-grid .cell').count(), 168);
  check('"My times" tab hidden',
    await page.locator('[data-needs="member"]').isHidden(), true);
  check('"Company" tab hidden',
    await page.locator('[data-needs="leader"]').isHidden(), true);
  check('no member names anywhere in the DOM',
    await page.evaluate(() => {
      const t = document.body.innerText;
      return ['Batty', 'Cedho', 'Tataru'].filter((n) => t.includes(n));
    }), []);
  check('heatmap shows shaded cells',
    await page.evaluate(() => document.querySelectorAll('#overlap-grid .cell:not(.h0)').length > 0), true);
  check('stats line rendered',
    (await page.locator('#overlap-stats').innerText()).includes('3 of 3 members'), true);
  check('best windows listed',
    await page.locator('#best-windows li').count() > 0, true);
  check('only aggregate RPCs called, no table reads',
    await page.evaluate(() => window.__stub.calls.filter((c) => c.op !== 'rpc').length), 0);
  await page.screenshot({ path: `${SHOTS}/a-anon-overlap.png`, fullPage: true });

  // ---- B. member ---------------------------------------------------------
  console.log('\n=== B. signed in as a member ===');
  await page.evaluate((u) => window.__stub.signIn(u), MEMBER);
  await page.waitForFunction(() => !document.querySelector('[data-needs="member"]').hidden);

  check('"My times" tab now shown',
    await page.locator('[data-needs="member"]').isHidden(), false);
  check('"Company" tab still hidden for a member',
    await page.locator('[data-needs="leader"]').isHidden(), true);

  await page.locator('[data-needs="member"]').click();
  await page.waitForSelector('#mine-grid .cell');
  check('own grid shows exactly this member\'s 3 hours',
    await page.locator('#mine-grid .cell[aria-pressed="true"]').count(), 3);

  /* Toggle a cell and confirm the write goes out scoped to this member. */
  const before = await page.locator('#mine-grid .cell[aria-pressed="true"]').count();
  await page.locator('#mine-grid .cell[aria-pressed="false"]').first().click();
  await page.waitForTimeout(900);
  check('toggling a cell marks it',
    await page.locator('#mine-grid .cell[aria-pressed="true"]').count(), before + 1);
  check('insert was scoped to the signed-in member',
    await page.evaluate(() => {
      const ins = window.__stub.calls.filter((c) => c.op === 'insert');
      return ins.length && ins.every((c) => c.payload.every((p) => p.member_id === 'u-cedho'));
    }), true);
  check('delete was scoped to the signed-in member',
    await page.evaluate(() => window.__stub.calls.filter((c) => c.op === 'delete')
      .every((c) => c.eq.member_id === 'u-cedho')), true);
  check('no other member\'s name leaked into the member view',
    await page.evaluate(() => {
      const t = document.body.innerText;
      return ['Batty', 'Tataru'].filter((n) => t.includes(n));
    }), []);
  await page.screenshot({ path: `${SHOTS}/b-member-mine.png`, fullPage: true });

  /* Unhiding the leader tab by hand must not produce leader data. */
  await page.evaluate(() => {
    document.querySelector('[data-needs="leader"]').hidden = false;
    document.querySelector('[data-needs="leader"]').click();
  });
  await page.waitForTimeout(300);
  check('force-opening the Company view as a member shows no roster',
    (await page.locator('#company-members').innerText()).trim(), '');
  await page.screenshot({ path: `${SHOTS}/b-member-forced-company.png`, fullPage: true });

  // ---- C. leader ---------------------------------------------------------
  console.log('\n=== C. signed in as a leader ===');
  await page.evaluate(() => window.__stub.signOut());
  await page.evaluate((u) => window.__stub.signIn(u), LEADER);
  await page.waitForFunction(() => !document.querySelector('[data-needs="leader"]').hidden);

  check('"Company" tab shown for a leader',
    await page.locator('[data-needs="leader"]').isHidden(), false);

  await page.locator('[data-needs="leader"]').click();
  await page.waitForSelector('#company-members .chip');
  check('leader sees all three members by name',
    (await page.locator('#company-members .chip .name').allInnerTexts()).map((s) => s.trim()).sort(),
    ['Batty', 'Cedho Nalen', 'Tataru']);
  check('leader is badged',
    await page.locator('#company-members .chip.is-leader').count(), 1);

  /* Click the busiest cell and confirm names come back for it. */
  const busiest = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#company-grid .cell')];
    let best = null;
    for (const c of cells) {
      const n = Number((c.getAttribute('aria-label').match(/(\d+) free/) || [0, 0])[1]);
      if (!best || n > best.n) best = { i: c.dataset.i, n };
    }
    return best;
  });
  await page.locator(`#company-grid .cell[data-i="${busiest.i}"]`).click();
  await page.waitForTimeout(200);
  check('busiest hour lists every free member by name',
    (await page.locator('#company-who .chip .name').allInnerTexts()).map((s) => s.trim()).sort(),
    ['Batty', 'Cedho Nalen', 'Tataru']);
  await page.screenshot({ path: `${SHOTS}/c-leader-company.png`, fullPage: true });

  await page.locator('[data-view-target="overlap"]').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/c-leader-overlap.png`, fullPage: true });

  // ---- D. sign out -------------------------------------------------------
  console.log('\n=== D. after signing out ===');
  await page.locator('#auth-btn').click();
  await page.waitForFunction(() => document.querySelector('[data-needs="leader"]').hidden);
  check('both gated tabs hidden again',
    [await page.locator('[data-needs="member"]').isHidden(),
     await page.locator('[data-needs="leader"]').isHidden()], [true, true]);
  check('names gone from the DOM',
    await page.evaluate(() => ['Batty', 'Cedho', 'Tataru']
      .filter((n) => document.body.innerText.includes(n))), []);

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`screenshots in ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
})();
