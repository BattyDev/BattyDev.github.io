/* Test + preview harness for the announce embed.
 *
 *   node --experimental-strip-types test/harness.mjs
 *
 * Imports buildEmbed() from index.ts directly, so what is asserted here is what
 * Discord receives. The preview at the end is an approximation of Discord's
 * rendering -- close enough to catch a layout that has gone wrong without
 * posting to a real channel to find out.
 */

import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/* index.ts imports supabase-js from jsr: and calls Deno.serve at module scope.
   Neither survives Node, and neither is under test -- buildEmbed is a pure
   function. Strip the import and the server, keep everything else verbatim. */
const work = mkdtempSync(join(tmpdir(), 'fc-announce-'));
const source = readFileSync(join(HERE, '..', 'index.ts'), 'utf8');
const cut = source.indexOf('Deno.serve(');
if (cut < 0) { console.error('Could not find Deno.serve in index.ts'); process.exit(1); }
const rewritten = source
  .slice(0, cut)
  .replace(/^import \{ createClient \} from 'jsr:@supabase\/supabase-js@2';$/m, '');
writeFileSync(join(work, 'fn.ts'), rewritten);
const { buildEmbed } = await import(pathToFileURL(join(work, 'fn.ts')).href);

const results = [];
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
};

const PEOPLE = new Map([
  ['m1', { display_name: 'batty_jjk', avatar_url: 'https://cdn.discordapp.com/a1.png', character: 'Batty Jjk' }],
  ['m2', { display_name: 'nalen', avatar_url: null, character: 'Cedho Nalen' }],
  ['m3', { display_name: 'tataru', avatar_url: null, character: null }],
]);

const EV = {
  id: 'e-1', title: 'Test Event – I want Rathalos',
  description: 'Run til everyone who wants it gets it',
  status: 'scheduled', scheduled_at: '2026-09-03T18:00:00Z',
  tanks_needed: 1, healers_needed: 1, dps_needed: 2, party_size: 4,
  min_level: null, level_rule: null, created_by: 'm1',
};
const SIGNUPS = [{ member_id: 'm1', roles: ['tank'], assigned_role: 'tank' }];

console.log('\n=== A. names match the site\'s rule ===');
let e = buildEmbed(EV, SIGNUPS, PEOPLE);
check('leads with the character, not the handle',
  e.fields[0].value.includes('Batty Jjk'), true);
/* slug() only lowercases -- "Batty Jjk" and "batty_jjk" are genuinely
   different strings, so the site shows the tag here and so does this. The
   tag is dropped only on an exact case-insensitive match. */
check('an exactly matching handle is not printed twice',
  buildEmbed(EV, [{ member_id: 'm4', roles: ['dps'], assigned_role: null }],
    new Map([['m4', { display_name: 'Cedho Nalen', avatar_url: null, character: 'cedho nalen' }]]))
    .fields[0].value.includes('('), false);

e = buildEmbed(EV, [{ member_id: 'm2', roles: ['healer'], assigned_role: null }], PEOPLE);
check('a differing handle is kept as a tag',
  e.fields[0].value.includes('Cedho Nalen (nalen)'), true);

e = buildEmbed(EV, [{ member_id: 'm3', roles: ['dps'], assigned_role: null }], PEOPLE);
check('somebody with no character falls back to the handle',
  e.fields[0].value.includes('tataru'), true);

console.log('\n=== B. the numbers people scroll for ===');
e = buildEmbed(EV, SIGNUPS, PEOPLE);
check('spots left is stated', e.description.includes('**3 spots left**'), true);
check('composition uses role icons', e.description.includes('🛡️ 1  💚 1  ⚔️ 2'), true);
check('without a redundant party glyph', e.description.includes('👥'), false);
check('the field header carries the count', e.fields[0].name, 'Signed up — 1/4');

e = buildEmbed(EV, [
  { member_id: 'm1', roles: ['tank'], assigned_role: 'tank' },
  { member_id: 'm2', roles: ['healer'], assigned_role: null },
  { member_id: 'm3', roles: ['dps'], assigned_role: null },
  { member_id: 'm4', roles: ['dps'], assigned_role: null },
], PEOPLE);
check('a full event says so rather than "0 spots left"',
  e.description.includes('**full**'), true);
check('one spot left is singular',
  buildEmbed(EV, SIGNUPS.concat([
    { member_id: 'm2', roles: ['healer'], assigned_role: null },
    { member_id: 'm3', roles: ['dps'], assigned_role: null },
  ]), PEOPLE).description.includes('**1 spot left**'), true);

const noCap = { ...EV, party_size: null, tanks_needed: null, healers_needed: null, dps_needed: null };
e = buildEmbed(noCap, SIGNUPS, PEOPLE);
check('an unlimited event has no spots-left claim', e.description.includes('spot'), false);
check('and says Unlimited', e.description.includes('Unlimited'), true);
check('its field header drops the denominator', e.fields[0].name, 'Signed up — 1');

const noSize = { ...EV, party_size: null };
check('seats fall back to the sum of role needs',
  buildEmbed(noSize, SIGNUPS, PEOPLE).fields[0].name, 'Signed up — 1/4');

console.log('\n=== C. roles ===');
e = buildEmbed(EV, [
  { member_id: 'm1', roles: ['tank'], assigned_role: 'tank' },
  { member_id: 'm2', roles: ['tank', 'dps'], assigned_role: null },
], PEOPLE);
check('a pinned role is named, because it is a decision',
  e.fields[0].value.includes('🛡️ **Tank**'), true);
check('an offered pair shows both icons',
  e.fields[0].value.includes('🛡️ ⚔️'), true);

console.log('\n=== D. states ===');
e = buildEmbed({ ...EV, status: 'cancelled' }, SIGNUPS, PEOPLE);
check('a cancelled event leads with it', e.description.startsWith('### ⚠️ Cancelled'), true);
check('and changes colour', e.color, 0xd4722a);

e = buildEmbed({ ...EV, scheduled_at: null }, SIGNUPS, PEOPLE);
check('no time yet says what to do', e.description.includes('add your hours'), true);

e = buildEmbed(EV, [], PEOPLE);
check('an empty roster invites the first signup', e.fields[0].name, 'Signed up — nobody yet');
check('with a link', e.fields[0].value.includes('/#/event/e-1'), true);

e = buildEmbed({ ...EV, min_level: 100, level_rule: 'required' }, SIGNUPS, PEOPLE);
check('a required level is shown', e.description.includes('Level 100 required'), true);
check('an absent level adds no line',
  buildEmbed(EV, SIGNUPS, PEOPLE).description.includes('Level'), false);

console.log('\n=== E. the organiser ===');
e = buildEmbed(EV, SIGNUPS, PEOPLE);
check('is credited by character name alone', e.author.name, 'Organised by Batty Jjk');
check('while the roster keeps the handle, so you know who to ping',
  e.fields[0].value.includes('Batty Jjk (batty_jjk)'), true);
check('with their avatar', e.author.icon_url, 'https://cdn.discordapp.com/a1.png');
check('an avatarless organiser omits the key rather than sending null',
  'icon_url' in buildEmbed({ ...EV, created_by: 'm2' }, SIGNUPS, PEOPLE).author, false);

console.log('\n=== F. safety and limits ===');
const many = Array.from({ length: 60 }, (_, i) => ({
  member_id: `x${i}`, roles: ['dps'], assigned_role: null,
}));
e = buildEmbed({ ...EV, party_size: null, tanks_needed: null, healers_needed: null, dps_needed: null }, many, PEOPLE);
check('a long roster stays inside the 1024 field cap', e.fields[0].value.length <= 1024, true);
check('and says how many were dropped', /…and \d+ more/.test(e.fields[0].value), true);

const multiline = { ...EV, description: 'line one\nline two\nline three' };
e = buildEmbed(multiline, SIGNUPS, PEOPLE);
check('every line of a multi-line description is quoted',
  (e.description.match(/^> /gm) || []).length, 3);

check('the whole description stays inside the 4096 cap',
  buildEmbed({ ...EV, description: 'x'.repeat(5000) }, SIGNUPS, PEOPLE).description.length <= 4096, true);

/* ---- preview ---- */
console.log('\n\n════════ PREVIEW (approximating Discord) ════════\n');
const show = (ev, signups, label) => {
  const em = buildEmbed(ev, signups, PEOPLE);
  console.log(`── ${label} ─────────────────────────────`);
  if (em.author) console.log(`  ${em.author.name}`);
  console.log(`  ${em.title}`);
  for (const l of em.description.split('\n')) console.log(`  ${l}`);
  for (const f of em.fields) {
    console.log(`  ${f.name}`);
    for (const l of f.value.split('\n')) console.log(`  ${l}`);
  }
  console.log(`  ${em.footer.text}\n`);
};
show(EV, [
  { member_id: 'm1', roles: ['tank'], assigned_role: 'tank' },
  { member_id: 'm2', roles: ['healer', 'dps'], assigned_role: null },
], 'a scheduled event');
show({ ...EV, scheduled_at: null, min_level: 100, level_rule: 'required' }, [], 'a poll with nobody yet');

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
