/* Browser check for /church/deacons — the lesson renderer and the deck.
 *
 * Not part of the site: .github is excluded from the Pages artifact, so this
 * never ships. It is also not wired into CI; it is a thing to run by hand when
 * changing assets/lesson.js or the stylesheets.
 *
 *   npm i --no-save playwright          # from the repository root
 *   node .github/checks/deacons-lessons.mjs
 *
 * It needs a Chromium. It uses $CHROMIUM_PATH if set, else Playwright's own.
 *
 * Self-contained on purpose: it copies church/ to a temp directory and writes
 * its own FIXTURE lesson data there, so no invented lesson content ever lands
 * in lessons/. The fixtures deliberately cover the awkward shapes — a complete
 * lesson, a guide draft with no discussion at all, one with more questions
 * than the deck can hold, a scripture with no url, and text carrying markup
 * characters.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { cp, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}/church/deacons`;

/* ---------- fixtures ---------- */

const complete = {
  date: '2026-09-20', sunday: 'third', status: 'complete',
  chapter: { number: 9, title: 'FIXTURE chapter', url: 'https://example.com/guide' },
  lesson: { title: 'FIXTURE magazine lesson', url: 'https://example.com/lesson' },
  title: 'FIXTURE complete lesson',
  truth: 'FIXTURE truth & <angle> test.',
  invitation: 'FIXTURE invitation.', minutesTotal: 21,
  atAGlance: 'FIXTURE one. FIXTURE two.',
  background: [
    { text: 'FIXTURE plain point.' },
    { text: 'FIXTURE hard point.', hard: true },
    { text: 'FIXTURE advisor point.', origin: 'advisor' }
  ],
  open: { minutes: 3, hook: 'FIXTURE hook?', how: 'FIXTURE how.', materials: ['a key'], origin: 'advisor' },
  discussion: [
    { minutes: 5, question: 'FIXTURE q one?', followUp: 'f1', hopingFor: 'h1',
      scriptures: [{ ref: 'Doctrine and Covenants 13:1', url: 'https://example.com/dc13', excerpt: 'FIXTURE excerpt' }] },
    { minutes: 5, question: 'FIXTURE q two?', followUp: 'f2', hopingFor: 'h2',
      scriptures: [{ ref: 'Matthew 16:19', url: 'https://example.com/m16' }, { ref: 'FIXTURE unlinked 1:1' }],
      activity: { title: 'FIXTURE activity', instructions: 'FIXTURE instructions.', rows: ['row a', 'row b'] } },
    { minutes: 4, question: 'FIXTURE q three?', followUp: 'f3', hopingFor: 'h3', origin: 'advisor',
      scriptures: [{ ref: 'Alma 13:6', url: 'https://example.com/a13' }] }
  ],
  invite: { minutes: 5, ask: 'FIXTURE ask.', christ: 'FIXTURE Christ tie.', blessings: ['FIXTURE blessing'] },
  backPocket: {
    extraQuestions: ['FIXTURE extra one?', { text: 'FIXTURE extra two?', origin: 'advisor' }],
    ifDiscussionDies: 'FIXTURE revive.', ifShortOnTime: 'FIXTURE cut.', ifTimeLeft: 'FIXTURE extend.',
    hardQuestion: { q: 'FIXTURE hard q?', a: 'FIXTURE hard a.' }
  },
  sources: [
    { kind: 'guide', title: 'FIXTURE guide', url: 'https://example.com/guide', fetched: '2026-01-01' },
    { kind: 'magazine', title: 'FIXTURE magazine', url: 'https://example.com/lesson', fetched: '2026-01-01' }
  ]
};

// More questions than the deck can hold, to prove the cap.
const crowded = {
  ...complete, date: '2026-09-27', sunday: 'last', title: 'FIXTURE crowded lesson',
  discussion: Array.from({ length: 8 }, (_, i) => ({
    minutes: 2, question: `FIXTURE crowded q${i + 1}?`, followUp: 'f', hopingFor: 'h',
    scriptures: [{ ref: `Alma ${i + 1}:1`, url: `https://example.com/a${i + 1}` }]
  }))
};

// A real guide draft: no discussion at all, scriptures at the top level.
const draft = {
  date: '2026-11-01', sunday: 'fast', status: 'guide-draft',
  chapter: { number: 11, title: 'FIXTURE ch11', url: 'https://example.com/g11' },
  title: 'FIXTURE guide draft', truth: 'FIXTURE draft truth.',
  invitation: 'FIXTURE draft invitation.', minutesTotal: 20,
  atAGlance: 'FIXTURE one. FIXTURE two.',
  scriptures: [
    { ref: 'Doctrine and Covenants 107:20', url: 'https://example.com/dc107', excerpt: 'FIXTURE draft excerpt' },
    { ref: 'Mosiah 18:9', url: 'https://example.com/mos18' }
  ],
  background: [{ text: 'FIXTURE draft background.' }],
  invite: { minutes: 5, ask: 'FIXTURE draft ask.', christ: 'FIXTURE draft Christ tie.', blessings: ['FIXTURE blessing'] },
  sources: [{ kind: 'guide', title: 'FIXTURE guide', url: 'https://example.com/g11', fetched: '2026-01-01' }]
};

const manifest = [
  { date: '2026-09-20', sunday: 'third', chapter: 9, title: complete.title, truth: complete.truth, status: 'complete' },
  { date: '2026-09-27', sunday: 'last', chapter: 9, title: crowded.title, truth: 'FIXTURE crowded.', status: 'complete' },
  { date: '2026-10-04', sunday: 'fast', chapter: 10, title: 'FIXTURE queued', truth: 'FIXTURE queued.', status: 'awaiting-source' },
  { date: '2026-11-01', sunday: 'fast', chapter: 11, title: draft.title, truth: draft.truth, status: 'guide-draft' }
];

/* ---------- harness ---------- */

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
// innerText applies text-transform; most of this section is uppercased in CSS.
const raw = loc => loc.evaluate(n => n.textContent);
const rawAll = loc => loc.evaluateAll(n => n.map(x => x.textContent));

const dir = await mkdtemp(join(tmpdir(), 'deacons-check-'));
await cp(join(ROOT, 'church'), join(dir, 'church'), { recursive: true });
const lessons = join(dir, 'church', 'deacons', 'lessons');
await writeFile(join(lessons, 'manifest.json'), JSON.stringify(manifest, null, 2));
for (const d of [complete, crowded, draft]) {
  await writeFile(join(lessons, `${d.date}.json`), JSON.stringify(d, null, 2));
}

const server = createServer((req, res) => {
  let p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  if (p.endsWith('/')) p += 'index.html';
  const file = join(dir, p);
  if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
  const stream = createReadStream(file);
  stream.on('error', () => res.writeHead(404).end('not found'));
  stream.on('open', () => {
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    stream.pipe(res);
  });
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('response', r => {
  // The awaiting-source lesson has no JSON on purpose.
  if (r.status() >= 400 && r.url().includes('127.0.0.1') && !r.url().endsWith('2026-10-04.json'))
    errors.push(r.status() + ' ' + r.url());
});
const warnings = [];
page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });

try {
  console.log('\n[index]');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  eq('every manifest row listed', await page.locator('.lesson-list li').count(), 4);
  eq('built rows are links', await page.locator('a.row-link').count(), 3);
  eq('awaiting-source row is not a link', await page.locator('.row-link.is-pending').count(), 1);
  eq('status badges', await rawAll(page.locator('.badge')),
    ['Complete', 'Complete', 'Awaiting source', 'Guide draft']);
  eq('sorted by date', await raw(page.locator('.row-date').first()), 'Sunday, September 20, 2026');

  console.log('\n[outline]');
  await page.goto(BASE + '/lesson.html?d=2026-09-20', { waitUntil: 'networkidle' });
  eq('all seven sections', await rawAll(page.locator('.sec-t')),
    ['At a glance', 'What I need to know first', 'Open', 'Core discussion',
     'Invitation', 'Back pocket', 'Sources']);
  eq('one card per question', await page.locator('.q').count(), 3);
  eq("Advisor's option marks", await page.locator('.origin').count(), 4);
  eq('hard-concept flag', await page.locator('.flag').count(), 1);
  eq('scriptures linked', await page.locator('a.scripture').count(), 3);
  eq('a scripture with no url is flagged, not hidden', await page.locator('.scripture-unlinked').count(), 1);
  eq('scripture href intact', await page.locator('a.scripture').first().getAttribute('href'), 'https://example.com/dc13');
  eq('activity kept', await page.locator('.activity').count(), 1);
  eq('discussion minutes summed', await raw(page.locator('.sec').nth(3).locator('.mins')), '14 min');
  eq('total minutes in the header', await raw(page.locator('.chapter-line .total')), '21 min planned');
  ok('markup characters render literally',
    (await raw(page.locator('.pair dd').first())).includes('& <angle>'));
  eq('no draft notice on a complete lesson', await page.locator('.notice').count(), 0);
  ok('no placeholder text', !/lorem ipsum/i.test(await page.content()));

  console.log('\n[view toggle]');
  await page.locator('.toggle').click();
  ok('url gained view=present', page.url().endsWith('?d=2026-09-20&view=present'), page.url());
  eq('nine slides', await page.locator('.slide').count(), 9);
  eq('slide order', await page.locator('.slide').evaluateAll(n => n.map(s => s.classList[1])),
    ['slide-title', 'slide-hook', 'slide-scripture', 'slide-question', 'slide-question',
     'slide-question', 'slide-activity', 'slide-invite', 'slide-closing']);
  eq('one active slide', await page.locator('.slide.is-active').count(), 1);
  eq('counter', await page.locator('.deck-counter').innerText(), '1 / 9');
  eq('a question slide carries the question and nothing else',
    await page.locator('.slide-question').first().locator('.slide-inner > *').count(), 1);
  ok('deck fills the viewport', await page.locator('.slide.is-active').evaluate(n => {
    const r = n.getBoundingClientRect();
    return Math.abs(r.width - innerWidth) < 2 && Math.abs(r.height - innerHeight) < 2;
  }));
  ok('question type is large enough for a room',
    await page.locator('.slide-q').first().evaluate(n => parseFloat(getComputedStyle(n).fontSize) >= 40));
  eq('site chrome hidden while presenting', await page.locator('#chrome').isVisible(), false);

  console.log('\n[keyboard]');
  const counter = () => page.locator('.deck-counter').innerText();
  await page.keyboard.press('ArrowRight'); eq('ArrowRight', await counter(), '2 / 9');
  await page.keyboard.press(' ');          eq('Space', await counter(), '3 / 9');
  await page.keyboard.press('ArrowLeft');  eq('ArrowLeft', await counter(), '2 / 9');
  await page.keyboard.press('Home');       eq('Home', await counter(), '1 / 9');
  await page.keyboard.press('ArrowLeft');  eq('first slide clamps', await counter(), '1 / 9');
  await page.keyboard.press('End');        eq('End', await counter(), '9 / 9');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(' ');
  eq('last slide does not advance into nothing', await counter(), '9 / 9');
  eq('still exactly one active slide', await page.locator('.slide.is-active').count(), 1);

  console.log('\n[pointer and touch]');
  await page.keyboard.press('Home');
  await page.mouse.click(1000, 360); eq('click right half', await counter(), '2 / 9');
  await page.mouse.click(200, 360);  eq('click left half', await counter(), '1 / 9');
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (from, to, y = 360) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(120);
  };
  await swipe(900, 300); eq('swipe left advances', await counter(), '2 / 9');
  // Regression: without overscroll-behavior this ran Chromium's history-back
  // gesture and dropped out of the deck entirely.
  await swipe(300, 900); eq('swipe right goes back, and stays in the deck', await counter(), '1 / 9');
  await swipe(600, 585); eq('a short drag is not a swipe', await counter(), '1 / 9');

  console.log('\n[navigation]');
  await page.keyboard.press('Escape');
  ok('Esc returns to the outline', await page.locator('.lesson-head h1').count() === 1);
  ok('Esc drops view=present', page.url().endsWith('?d=2026-09-20'), page.url());
  await page.goBack();
  ok('back restores the deck', await page.locator('.slide').count() === 9);
  await page.goBack();
  ok('back again restores the outline', await page.locator('.lesson-head h1').count() === 1);
  await page.goto(BASE + '/lesson.html?d=2026-09-20&view=present', { waitUntil: 'networkidle' });
  eq('the deck is linkable', await page.locator('.slide.is-active').count(), 1);
  await page.keyboard.press('ArrowRight');
  eq('keyboard live after a deep link', await counter(), '2 / 9');

  console.log('\n[deck cap]');
  await page.goto(BASE + '/lesson.html?d=2026-09-27', { waitUntil: 'networkidle' });
  eq('the outline keeps every question', await page.locator('.q').count(), 8);
  await page.locator('.toggle').click();
  const n = await page.locator('.slide').count();
  ok('deck capped at 10', n <= 10, 'got ' + n);
  eq('the invitation survives the cap', await page.locator('.slide-invite').count(), 1);
  eq('the closing slide survives the cap', await page.locator('.slide-closing').count(), 1);
  eq('counter matches', await counter(), `1 / ${n}`);
  ok('truncation is announced', warnings.some(t => t.includes('questions but room for')), warnings.join('|'));

  console.log('\n[guide draft with no discussion]');
  await page.goto(BASE + '/lesson.html?d=2026-11-01', { waitUntil: 'networkidle' });
  eq('draft notice shown', await page.locator('.notice').count(), 1);
  eq('sections present', await rawAll(page.locator('.sec-t')),
    ['At a glance', 'What I need to know first', 'Invitation', 'Sources']);
  eq('chapter cross-references rendered', await page.locator('.glance-scriptures a.scripture').count(), 2);
  eq('promised blessings rendered', await page.locator('.blessings li').count(), 1);
  await page.locator('.toggle').click();
  eq('its deck falls back to the chapter cross-references',
    await page.locator('.slide').evaluateAll(x => x.map(s => s.classList[1])),
    ['slide-title', 'slide-scripture', 'slide-invite', 'slide-closing']);
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowRight');
  eq('short deck still clamps', await counter(), '4 / 4');

  console.log('\n[error states]');
  await page.goto(BASE + '/lesson.html?d=2026-10-04', { waitUntil: 'networkidle' });
  ok('a missing lesson names the date',
    (await page.locator('.oops h1').innerText()).includes('October 4, 2026'));
  await page.goto(BASE + '/lesson.html', { waitUntil: 'networkidle' });
  ok('no ?d= explains itself', (await page.locator('.oops h1').innerText()).includes('No lesson requested'));
  await page.goto(BASE + '/lesson.html?d=../manifest', { waitUntil: 'networkidle' });
  ok('a non-date ?d= is rejected rather than fetched',
    (await page.locator('.oops h1').innerText()).includes('No lesson requested'));

  console.log('\n[360px]');
  await page.setViewportSize({ width: 360, height: 740 });
  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  await page.goto(BASE + '/lesson.html?d=2026-09-20', { waitUntil: 'networkidle' });
  ok('outline: no horizontal page scroll', await noHScroll());
  await page.locator('.toggle').click();
  ok('deck: no horizontal page scroll', await noHScroll());
  ok('deck: still readable in the hand',
    await page.locator('.slide-title').first().evaluate(n => parseFloat(getComputedStyle(n).fontSize) >= 28));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  ok('index: no horizontal page scroll', await noHScroll());
  await page.goto(`http://127.0.0.1:${PORT}/church/`, { waitUntil: 'networkidle' });
  ok('hub: no horizontal page scroll', await noHScroll());

  console.log('\n[reduced motion]');
  const rm = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 720 } });
  const rp = await rm.newPage();
  await rp.goto(BASE + '/lesson.html?d=2026-09-20&view=present', { waitUntil: 'networkidle' });
  eq('slide transitions disabled',
    await rp.locator('.slide').first().evaluate(n => getComputedStyle(n).transitionDuration), '0s');
  await rm.close();

  console.log('\n[shipped tree]');
  for (const f of ['church/deacons/lesson.html', 'church/deacons/index.html']) {
    const html = await readFile(join(ROOT, f), 'utf8');
    ok(`${f} is noindex`, /noindex/.test(html));
    ok(`${f} carries no lesson content`, !/FIXTURE|Eternal truth<\/dt>/.test(html));
  }
  const live = JSON.parse(await readFile(join(ROOT, 'church/deacons/lessons/manifest.json'), 'utf8'));
  ok('the real manifest is valid json with known statuses',
    Array.isArray(live) && live.every(r => ['complete', 'guide-draft', 'awaiting-source'].includes(r.status)));

  console.log('\n[errors]');
  eq('no page errors, no unexpected request failures', errors, []);
} finally {
  await browser.close();
  server.close();
  await rm(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
